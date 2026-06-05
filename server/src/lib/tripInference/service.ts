/**
 * TripInferenceService — DB-backed scheduler around inferTripsFromPositions.
 *
 * Responsibilities:
 *   - Reads positions from `ais_positions` per vessel since the last
 *     processed cursor (MAX(end_at) per mmsi, with a small lookback window so
 *     a trip whose start straddles the cursor isn't missed).
 *   - Calls the pure inferTripsFromPositions on each vessel's stream.
 *   - INSERT OR IGNORE into `trips` (the UNIQUE(mmsi, start_at) constraint
 *     makes re-runs idempotent).
 *   - Notifies registered onTripCompleted listeners with newly inserted trips.
 *   - Optional cron via setInterval.
 *
 * Failure isolation (§7.4 of ais-storage.md): every per-vessel pass is wrapped
 * in try/catch and the cron loop never throws to the caller. A DB-level
 * failure on one MMSI will not stop the others.
 */

import type { Database } from 'better-sqlite3';
import { VESSEL_MMSIS } from '../constants';
import {
  inferTripsFromPositions,
  type InferenceInputPosition,
  type InferredTrip,
} from './inferTrips';

/** Default scan cadence — 5 minutes. The trip cadence on the harbour is ~15 min. */
export const DEFAULT_TRIP_INFERENCE_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * How far back to look when scanning per vessel. A trip's start_at can fall
 * before the cursor (which is MAX(end_at)), so we widen the window by the
 * longest plausible single trip duration (~30 min) plus a small safety margin.
 */
const SCAN_LOOKBACK_MS = 45 * 60 * 1_000;

export interface PersistedTrip extends InferredTrip {
  /** rowid of the newly inserted trips row. */
  id: number;
}

export type TripCompletedListener = (trip: PersistedTrip) => void;

export interface TripInferenceServiceOptions {
  db: Database;
  /** Subset of MMSIs to scan. Defaults to all configured ferry MMSIs. */
  mmsis?: readonly number[];
}

export class TripInferenceService {
  private readonly db: Database;
  private readonly mmsis: readonly number[];
  private readonly listeners = new Set<TripCompletedListener>();
  private timer: NodeJS.Timeout | null = null;

  private readonly selectPositionsStmt;
  private readonly selectCursorStmt;
  private readonly insertTripStmt;

  constructor(opts: TripInferenceServiceOptions) {
    this.db = opts.db;
    this.mmsis = opts.mmsis ?? (VESSEL_MMSIS as readonly number[]);

    this.selectPositionsStmt = this.db.prepare(
      `SELECT timestamp, latitude, longitude, sog
       FROM ais_positions
       WHERE mmsi = ? AND timestamp >= ?
       ORDER BY timestamp ASC`,
    );

    this.selectCursorStmt = this.db.prepare(
      `SELECT COALESCE(MAX(end_at), 0) AS cursor FROM trips WHERE mmsi = ?`,
    );

    this.insertTripStmt = this.db.prepare(
      `INSERT OR IGNORE INTO trips
        (mmsi, from_dock, to_dock, start_at, end_at, duration_s, distance_m, position_count, inferred_at)
       VALUES (@mmsi, @from_dock, @to_dock, @start_at, @end_at, @duration_s, @distance_m, @position_count, @inferred_at)`,
    );
  }

  onTripCompleted(cb: TripCompletedListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Run a single inference pass across all configured MMSIs. Never throws. */
  runOnce(): PersistedTrip[] {
    const newlyInserted: PersistedTrip[] = [];
    const now = Date.now();

    for (const mmsi of this.mmsis) {
      try {
        const inserted = this.runForVessel(mmsi, now);
        for (const trip of inserted) newlyInserted.push(trip);
      } catch (err) {
        console.error(`[tripInference] runForVessel(${mmsi}) failed — continuing:`, err);
      }
    }

    for (const trip of newlyInserted) {
      for (const cb of this.listeners) {
        try {
          cb(trip);
        } catch (err) {
          console.error('[tripInference] onTripCompleted listener threw:', err);
        }
      }
    }

    return newlyInserted;
  }

  private runForVessel(mmsi: number, now: number): PersistedTrip[] {
    const { cursor } = this.selectCursorStmt.get(mmsi) as { cursor: number };
    const lowerBound = Math.max(0, cursor - SCAN_LOOKBACK_MS);

    const rows = this.selectPositionsStmt.all(mmsi, lowerBound) as Array<{
      timestamp: number;
      latitude: number;
      longitude: number;
      sog: number;
    }>;

    if (rows.length === 0) return [];

    const positions: InferenceInputPosition[] = rows.map((r) => ({
      timestamp: r.timestamp,
      latitude: r.latitude,
      longitude: r.longitude,
      sog: r.sog,
    }));

    const candidates = inferTripsFromPositions(positions, mmsi);
    if (candidates.length === 0) return [];

    const inserted: PersistedTrip[] = [];
    for (const t of candidates) {
      const result = this.insertTripStmt.run({
        mmsi: t.mmsi,
        from_dock: t.fromDock,
        to_dock: t.toDock,
        start_at: t.startAt,
        end_at: t.endAt,
        duration_s: t.durationSeconds,
        distance_m: t.distanceMeters,
        position_count: t.positionCount,
        inferred_at: now,
      });
      if (result.changes === 1) {
        inserted.push({ ...t, id: Number(result.lastInsertRowid) });
      }
    }
    return inserted;
  }

  /** Schedule periodic runs. Returns a stop handle. */
  start(intervalMs: number = DEFAULT_TRIP_INFERENCE_INTERVAL_MS): () => void {
    if (this.timer !== null) {
      throw new Error('TripInferenceService already started');
    }
    this.timer = setInterval(() => {
      try {
        this.runOnce();
      } catch (err) {
        console.error('[tripInference] scheduled runOnce threw — continuing:', err);
      }
    }, intervalMs);
    this.timer.unref?.();
    return () => this.stop();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
