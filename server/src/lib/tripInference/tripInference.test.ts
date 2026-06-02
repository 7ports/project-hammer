/**
 * Trip inference tests.
 *
 * - The pure inferTripsFromPositions function is exercised against
 *   hand-rolled position fixtures spanning the four canonical scenarios:
 *   complete A→B trip, in-transit (no trip), false-departure return, and
 *   multi-trip chains.
 * - The DB-backed TripInferenceService is exercised against an in-memory
 *   SQLite DB so the cursor / INSERT OR IGNORE / listener wiring is covered
 *   end-to-end without touching the live providers.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  closeStorage,
  getDb,
  initStorage,
} from '../storage';
import {
  inferTripsFromPositions,
  TripInferenceService,
  TRIP_INFERENCE_CONFIG,
  type InferenceInputPosition,
} from './index';
import { DOCKS } from '../docks';

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-trip-test-')),
    'hammer.db',
  );
}

afterEach(() => {
  closeStorage();
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const JACK_LAYTON = DOCKS.find((d) => d.id === 'jack-layton')!;
const WARDS = DOCKS.find((d) => d.id === 'wards-island')!;
const CENTRE = DOCKS.find((d) => d.id === 'centre-island')!;

function atDockPos(
  dock: { coordinates: readonly [number, number] },
  ts: number,
  sog = 0.1,
): InferenceInputPosition {
  return {
    timestamp: ts,
    latitude: dock.coordinates[1],
    longitude: dock.coordinates[0],
    sog,
  };
}

function transitPos(
  fromDock: { coordinates: readonly [number, number] },
  toDock: { coordinates: readonly [number, number] },
  fraction: number,
  ts: number,
  sog = 6,
): InferenceInputPosition {
  const [fLon, fLat] = fromDock.coordinates;
  const [tLon, tLat] = toDock.coordinates;
  return {
    timestamp: ts,
    latitude: fLat + (tLat - fLat) * fraction,
    longitude: fLon + (tLon - fLon) * fraction,
    sog,
  };
}

// ---------------------------------------------------------------------------
// Pure inference
// ---------------------------------------------------------------------------

describe('inferTripsFromPositions — pure function', () => {
  it('emits one trip for a clean dock-to-dock crossing', () => {
    const t0 = 1_700_000_000_000;
    const positions: InferenceInputPosition[] = [
      atDockPos(JACK_LAYTON, t0),
      atDockPos(JACK_LAYTON, t0 + 30_000),
      transitPos(JACK_LAYTON, WARDS, 0.25, t0 + 60_000),
      transitPos(JACK_LAYTON, WARDS, 0.5, t0 + 120_000),
      transitPos(JACK_LAYTON, WARDS, 0.75, t0 + 180_000),
      atDockPos(WARDS, t0 + 240_000),
    ];

    const trips = inferTripsFromPositions(positions, 316045069);

    expect(trips).toHaveLength(1);
    expect(trips[0].fromDock).toBe('jack-layton');
    expect(trips[0].toDock).toBe('wards-island');
    expect(trips[0].startAt).toBe(t0 + 60_000);
    expect(trips[0].endAt).toBe(t0 + 240_000);
    expect(trips[0].durationSeconds).toBe(180);
    expect(trips[0].distanceMeters).toBeGreaterThan(500);
    expect(trips[0].positionCount).toBeGreaterThanOrEqual(3);
    expect(trips[0].mmsi).toBe(316045069);
  });

  it('emits no trip when the vessel returns to the same dock', () => {
    const t0 = 1_700_000_000_000;
    const positions: InferenceInputPosition[] = [
      atDockPos(JACK_LAYTON, t0),
      transitPos(JACK_LAYTON, WARDS, 0.3, t0 + 30_000),
      transitPos(JACK_LAYTON, WARDS, 0.4, t0 + 60_000),
      // Vessel turns back
      transitPos(JACK_LAYTON, WARDS, 0.2, t0 + 90_000),
      atDockPos(JACK_LAYTON, t0 + 120_000),
    ];
    expect(inferTripsFromPositions(positions, 316045069)).toEqual([]);
  });

  it('emits no trip when the vessel is still in transit at end of input', () => {
    const t0 = 1_700_000_000_000;
    const positions: InferenceInputPosition[] = [
      atDockPos(JACK_LAYTON, t0),
      transitPos(JACK_LAYTON, WARDS, 0.5, t0 + 60_000),
      transitPos(JACK_LAYTON, WARDS, 0.7, t0 + 120_000),
    ];
    expect(inferTripsFromPositions(positions, 316045069)).toEqual([]);
  });

  it('emits no trip when no origin dock is observed before the transit', () => {
    const t0 = 1_700_000_000_000;
    const positions: InferenceInputPosition[] = [
      transitPos(JACK_LAYTON, WARDS, 0.5, t0),
      atDockPos(WARDS, t0 + 60_000),
    ];
    expect(inferTripsFromPositions(positions, 316045069)).toEqual([]);
  });

  it('chains multiple trips back to back', () => {
    const t0 = 1_700_000_000_000;
    const positions: InferenceInputPosition[] = [
      atDockPos(JACK_LAYTON, t0),
      transitPos(JACK_LAYTON, WARDS, 0.5, t0 + 60_000),
      atDockPos(WARDS, t0 + 180_000),
      atDockPos(WARDS, t0 + 240_000),
      transitPos(WARDS, CENTRE, 0.5, t0 + 300_000),
      atDockPos(CENTRE, t0 + 420_000),
    ];
    const trips = inferTripsFromPositions(positions, 316045069);
    expect(trips).toHaveLength(2);
    expect(trips[0]).toMatchObject({ fromDock: 'jack-layton', toDock: 'wards-island' });
    expect(trips[1]).toMatchObject({ fromDock: 'wards-island', toDock: 'centre-island' });
  });

  it('treats high SOG within dock radius as in-transit (passing through)', () => {
    const t0 = 1_700_000_000_000;
    // SOG above the at-dock threshold even while geographically near a dock.
    const movingNearDock: InferenceInputPosition = {
      timestamp: t0 + 60_000,
      latitude: JACK_LAYTON.coordinates[1],
      longitude: JACK_LAYTON.coordinates[0],
      sog: TRIP_INFERENCE_CONFIG.atDockSogMaxKnots + 5,
    };
    const positions: InferenceInputPosition[] = [
      atDockPos(WARDS, t0),
      movingNearDock,
      atDockPos(CENTRE, t0 + 120_000),
    ];
    const trips = inferTripsFromPositions(positions, 316045069);
    expect(trips).toHaveLength(1);
    expect(trips[0].fromDock).toBe('wards-island');
    expect(trips[0].toDock).toBe('centre-island');
  });

  it('returns [] for an empty input', () => {
    expect(inferTripsFromPositions([], 316045069)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Service: DB-backed pass
// ---------------------------------------------------------------------------

describe('TripInferenceService — DB integration', () => {
  function seedPositions(
    mmsi: number,
    positions: InferenceInputPosition[],
  ): void {
    const stmt = getDb().prepare(
      `INSERT INTO ais_positions
        (mmsi, provider, timestamp, ingested_at, latitude, longitude, sog, cog, heading, nav_status)
       VALUES (?, 'aisstream', ?, ?, ?, ?, ?, 0, 0, NULL)`,
    );
    for (const p of positions) {
      stmt.run(mmsi, p.timestamp, p.timestamp, p.latitude, p.longitude, p.sog);
    }
  }

  it('inserts a single trip row and fires onTripCompleted exactly once', () => {
    initStorage(tempDbPath());
    const mmsi = 316045069;
    const t0 = 1_700_000_000_000;
    seedPositions(mmsi, [
      atDockPos(JACK_LAYTON, t0),
      transitPos(JACK_LAYTON, WARDS, 0.5, t0 + 60_000),
      atDockPos(WARDS, t0 + 240_000),
    ]);

    const svc = new TripInferenceService({ db: getDb(), mmsis: [mmsi] });
    const events: number[] = [];
    svc.onTripCompleted((trip) => events.push(trip.id));

    const inserted = svc.runOnce();
    expect(inserted).toHaveLength(1);
    expect(events).toEqual([inserted[0].id]);

    const rows = getDb().prepare('SELECT from_dock, to_dock, mmsi FROM trips').all() as Array<{
      from_dock: string;
      to_dock: string;
      mmsi: number;
    }>;
    expect(rows).toEqual([{ from_dock: 'jack-layton', to_dock: 'wards-island', mmsi }]);
  });

  it('is idempotent across re-runs (UNIQUE(mmsi, start_at) prevents duplicates)', () => {
    initStorage(tempDbPath());
    const mmsi = 316045069;
    const t0 = 1_700_000_000_000;
    seedPositions(mmsi, [
      atDockPos(JACK_LAYTON, t0),
      transitPos(JACK_LAYTON, WARDS, 0.5, t0 + 60_000),
      atDockPos(WARDS, t0 + 240_000),
    ]);

    const svc = new TripInferenceService({ db: getDb(), mmsis: [mmsi] });

    expect(svc.runOnce()).toHaveLength(1);
    expect(svc.runOnce()).toHaveLength(0);
    const count = (getDb().prepare('SELECT COUNT(*) as c FROM trips').get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it('isolates a single-vessel failure from the rest of the fleet', () => {
    initStorage(tempDbPath());
    const ok = 316045069;
    const broken = 316045081;
    const t0 = 1_700_000_000_000;
    seedPositions(ok, [
      atDockPos(JACK_LAYTON, t0),
      transitPos(JACK_LAYTON, WARDS, 0.5, t0 + 60_000),
      atDockPos(WARDS, t0 + 240_000),
    ]);
    seedPositions(broken, [
      atDockPos(JACK_LAYTON, t0),
      transitPos(JACK_LAYTON, CENTRE, 0.5, t0 + 60_000),
      atDockPos(CENTRE, t0 + 240_000),
    ]);

    const svc = new TripInferenceService({ db: getDb(), mmsis: [broken, ok] });
    // Hook a listener that throws for one mmsi — should not break others.
    svc.onTripCompleted((trip) => {
      if (trip.mmsi === broken) throw new Error('boom');
    });

    expect(() => svc.runOnce()).not.toThrow();
    const count = (getDb().prepare('SELECT COUNT(*) as c FROM trips').get() as { c: number }).c;
    expect(count).toBe(2);
  });
});
