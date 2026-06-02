/**
 * WeatherSnapshotter — periodic weather poller + trip-boundary capture.
 *
 * Two responsibilities, one class:
 *   1. Periodically fetch the current observation and persist it to
 *      `weather_snapshots`. This builds a rolling buffer the snapshotter can
 *      look up later when associating weather with the START of a past trip.
 *   2. On trip-completion notifications, look up the closest snapshots to the
 *      trip's start_at and end_at and INSERT linking rows into `trip_weather`.
 *
 * The poller fires once on start (so the system always has at least one
 * snapshot during tests / fresh deploys), then at the configured interval.
 * All failures are swallowed and logged — the snapshotter is best-effort and
 * never blocks ingestion or the SSE relay (see ais-storage.md §7.4).
 */

import type { Database, Statement } from 'better-sqlite3';
import type { WeatherObservation } from '../types';
import type { PersistedTrip } from '../tripInference/service';
import { liveFetchObservation, type FetchObservation } from './fetcher';

/** Default poll cadence — 10 minutes. CYTZ observations update ~hourly. */
export const DEFAULT_WEATHER_POLL_INTERVAL_MS = 10 * 60 * 1_000;

/**
 * Maximum gap (ms) between a trip boundary timestamp and the nearest weather
 * snapshot. Past this, we skip the linking row rather than associate stale
 * weather with the trip. 90 minutes covers the CYTZ ~hourly cadence plus
 * a little slack for outages.
 */
const MAX_SNAPSHOT_GAP_MS = 90 * 60 * 1_000;

export interface WeatherSnapshotterOptions {
  db: Database;
  /** Function that returns the latest observation. Defaults to the live GeoMet fetcher. */
  fetchObservation?: FetchObservation;
}

interface WeatherSnapshotRowIn {
  captured_at: number;
  observed_at: string | null;
  temperature_c: number | null;
  feels_like_c: number | null;
  wind_kmh: number | null;
  wind_dir_deg: number | null;
  wind_gust_kmh: number | null;
  visibility_km: number | null;
  precip_1h_mm: number | null;
  condition: string | null;
  precipitation_warning: number;
  raw_observation: string | null;
}

export class WeatherSnapshotter {
  private readonly db: Database;
  private readonly fetchObservation: FetchObservation;
  private pollTimer: NodeJS.Timeout | null = null;

  private readonly insertSnapshotStmt: Statement;
  private readonly nearestSnapshotStmt: Statement;
  private readonly insertTripWeatherStmt: Statement;

  constructor(opts: WeatherSnapshotterOptions) {
    this.db = opts.db;
    this.fetchObservation = opts.fetchObservation ?? liveFetchObservation;

    this.insertSnapshotStmt = this.db.prepare(
      `INSERT INTO weather_snapshots
        (captured_at, observed_at, temperature_c, feels_like_c, wind_kmh, wind_dir_deg,
         wind_gust_kmh, visibility_km, precip_1h_mm, condition, precipitation_warning, raw_observation)
       VALUES (@captured_at, @observed_at, @temperature_c, @feels_like_c, @wind_kmh, @wind_dir_deg,
               @wind_gust_kmh, @visibility_km, @precip_1h_mm, @condition, @precipitation_warning, @raw_observation)`,
    );

    // Pick the snapshot with the smallest absolute time delta from the target.
    this.nearestSnapshotStmt = this.db.prepare(
      `SELECT id, captured_at
       FROM weather_snapshots
       ORDER BY ABS(captured_at - ?) ASC
       LIMIT 1`,
    );

    this.insertTripWeatherStmt = this.db.prepare(
      `INSERT OR IGNORE INTO trip_weather (trip_id, boundary, weather_snapshot_id)
       VALUES (?, ?, ?)`,
    );
  }

  /**
   * Fetch the latest observation and persist it to weather_snapshots.
   * Returns the new row id on success, or null on any failure.
   */
  async pollOnce(): Promise<number | null> {
    let obs: WeatherObservation;
    try {
      obs = await this.fetchObservation();
    } catch (err) {
      console.error('[weatherSnapshots] fetchObservation failed:', err);
      return null;
    }
    return this.persistObservation(obs);
  }

  /** Persist a fully-formed observation. Exposed for tests / replays. */
  persistObservation(obs: WeatherObservation): number | null {
    try {
      const row: WeatherSnapshotRowIn = {
        captured_at: Date.now(),
        observed_at: obs.observedAt ?? null,
        temperature_c: obs.temperatureCelsius,
        feels_like_c: obs.feelsLikeCelsius,
        wind_kmh: obs.windSpeedKmh,
        wind_dir_deg: obs.windDirectionDeg,
        wind_gust_kmh: obs.windGustKmh,
        visibility_km: obs.visibilityKm,
        precip_1h_mm: obs.precipitationLastHourMm,
        condition: obs.condition ?? null,
        precipitation_warning: obs.precipitationWarning ? 1 : 0,
        raw_observation: safeStringify(obs),
      };
      const result = this.insertSnapshotStmt.run(row);
      return Number(result.lastInsertRowid);
    } catch (err) {
      console.error('[weatherSnapshots] persistObservation failed:', err);
      return null;
    }
  }

  /**
   * Look up the closest weather snapshot to each boundary timestamp and
   * persist linking rows in `trip_weather`. Snapshots more than
   * MAX_SNAPSHOT_GAP_MS away are not linked — better to omit than mislabel.
   */
  captureForTrip(trip: PersistedTrip): {
    startSnapshotId: number | null;
    endSnapshotId: number | null;
  } {
    let startSnapshotId: number | null = null;
    let endSnapshotId: number | null = null;
    try {
      startSnapshotId = this.linkBoundary(trip.id, 'start', trip.startAt);
      endSnapshotId = this.linkBoundary(trip.id, 'end', trip.endAt);
    } catch (err) {
      console.error(`[weatherSnapshots] captureForTrip(${trip.id}) failed:`, err);
    }
    return { startSnapshotId, endSnapshotId };
  }

  private linkBoundary(
    tripId: number,
    boundary: 'start' | 'end',
    targetTs: number,
  ): number | null {
    const nearest = this.nearestSnapshotStmt.get(targetTs) as
      | { id: number; captured_at: number }
      | undefined;
    if (!nearest) return null;
    if (Math.abs(nearest.captured_at - targetTs) > MAX_SNAPSHOT_GAP_MS) {
      return null;
    }
    this.insertTripWeatherStmt.run(tripId, boundary, nearest.id);
    return nearest.id;
  }

  /**
   * Start the poller. Fires once immediately so the snapshot table is never
   * empty when the first trip completes, then on the supplied interval.
   * Returns a stop handle.
   */
  start(intervalMs: number = DEFAULT_WEATHER_POLL_INTERVAL_MS): () => void {
    if (this.pollTimer !== null) {
      throw new Error('WeatherSnapshotter already started');
    }
    void this.pollOnce();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
    this.pollTimer.unref?.();
    return () => this.stop();
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
