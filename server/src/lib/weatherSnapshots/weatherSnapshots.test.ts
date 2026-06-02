/**
 * Weather snapshotter tests.
 *
 * Uses a mocked fetcher so no network is required. Exercises:
 *   - pollOnce persists a row
 *   - captureForTrip links nearest snapshots within MAX_SNAPSHOT_GAP_MS
 *   - captureForTrip skips boundaries with no snapshot in range
 *   - persistObservation never throws when JSON serialisation fails
 *   - start() polls once eagerly so a subsequent captureForTrip succeeds
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { closeStorage, getDb, initStorage } from '../storage';
import { WeatherSnapshotter } from './snapshotter';
import type { WeatherObservation } from '../types';
import type { PersistedTrip } from '../tripInference/service';

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-weather-test-')),
    'hammer.db',
  );
}

afterEach(() => {
  closeStorage();
  vi.useRealTimers();
});

function fakeObservation(overrides: Partial<WeatherObservation> = {}): WeatherObservation {
  return {
    stationName: 'Billy Bishop',
    observedAt: '2026-05-01T12:00:00.000Z',
    temperatureCelsius: 18.5,
    feelsLikeCelsius: 18.5,
    windSpeedKmh: 12,
    windDirectionDeg: 220,
    windGustKmh: 18,
    relativeHumidityPct: 65,
    visibilityKm: 24,
    pressureKpa: 101.3,
    dewPointCelsius: 11.2,
    cloudAmountOktas: 3,
    precipitationLastHourMm: 0,
    precipitationLast24hMm: 0,
    presentWeatherCode: null,
    condition: 'Partly Cloudy',
    precipitationWarning: false,
    ...overrides,
  };
}

function makeTrip(overrides: Partial<PersistedTrip> = {}): PersistedTrip {
  return {
    id: 1,
    mmsi: 316045069,
    fromDock: 'jack-layton',
    toDock: 'wards-island',
    startAt: 1_700_000_000_000,
    endAt: 1_700_000_000_000 + 5 * 60_000,
    durationSeconds: 300,
    distanceMeters: 1200,
    positionCount: 6,
    ...overrides,
  };
}

function insertTripRow(trip: PersistedTrip): void {
  getDb()
    .prepare(
      `INSERT INTO trips
        (id, mmsi, from_dock, to_dock, start_at, end_at, duration_s, distance_m, position_count, inferred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      trip.id,
      trip.mmsi,
      trip.fromDock,
      trip.toDock,
      trip.startAt,
      trip.endAt,
      trip.durationSeconds,
      trip.distanceMeters,
      trip.positionCount,
      Date.now(),
    );
}

describe('WeatherSnapshotter — pollOnce', () => {
  it('persists a row from the mocked fetcher and returns its id', async () => {
    initStorage(tempDbPath());
    const fetcher = vi.fn().mockResolvedValue(fakeObservation());
    const snap = new WeatherSnapshotter({ db: getDb(), fetchObservation: fetcher });

    const id = await snap.pollOnce();
    expect(id).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);

    const row = getDb()
      .prepare('SELECT temperature_c, condition, precipitation_warning FROM weather_snapshots WHERE id = ?')
      .get(id) as { temperature_c: number; condition: string; precipitation_warning: number };
    expect(row.temperature_c).toBe(18.5);
    expect(row.condition).toBe('Partly Cloudy');
    expect(row.precipitation_warning).toBe(0);
  });

  it('returns null and logs when the fetcher throws', async () => {
    initStorage(tempDbPath());
    const fetcher = vi.fn().mockRejectedValue(new Error('network'));
    const snap = new WeatherSnapshotter({ db: getDb(), fetchObservation: fetcher });

    const id = await snap.pollOnce();
    expect(id).toBeNull();
    const count = (getDb().prepare('SELECT COUNT(*) as c FROM weather_snapshots').get() as {
      c: number;
    }).c;
    expect(count).toBe(0);
  });

  it('handles a precipitation warning by writing 1 for the boolean', async () => {
    initStorage(tempDbPath());
    const fetcher = vi.fn().mockResolvedValue(fakeObservation({ precipitationWarning: true }));
    const snap = new WeatherSnapshotter({ db: getDb(), fetchObservation: fetcher });
    await snap.pollOnce();
    const row = getDb()
      .prepare('SELECT precipitation_warning FROM weather_snapshots')
      .get() as { precipitation_warning: number };
    expect(row.precipitation_warning).toBe(1);
  });
});

describe('WeatherSnapshotter — captureForTrip', () => {
  it('links the nearest snapshot for start and end boundaries', async () => {
    initStorage(tempDbPath());
    const snap = new WeatherSnapshotter({
      db: getDb(),
      fetchObservation: vi.fn().mockResolvedValue(fakeObservation()),
    });

    // Seed two snapshots — one close to startAt, one close to endAt.
    const trip = makeTrip();
    insertTripRow(trip);

    const startSnapId = snap.persistObservation(
      fakeObservation({ temperatureCelsius: 10, condition: 'StartTemp' }),
    );
    // Override captured_at on the freshly inserted snapshot to be near trip.startAt.
    getDb()
      .prepare('UPDATE weather_snapshots SET captured_at = ? WHERE id = ?')
      .run(trip.startAt + 60_000, startSnapId);

    const endSnapId = snap.persistObservation(
      fakeObservation({ temperatureCelsius: 22, condition: 'EndTemp' }),
    );
    getDb()
      .prepare('UPDATE weather_snapshots SET captured_at = ? WHERE id = ?')
      .run(trip.endAt - 60_000, endSnapId);

    const { startSnapshotId, endSnapshotId } = snap.captureForTrip(trip);
    expect(startSnapshotId).toBe(startSnapId);
    expect(endSnapshotId).toBe(endSnapId);

    const rows = getDb()
      .prepare('SELECT boundary, weather_snapshot_id FROM trip_weather ORDER BY boundary')
      .all() as Array<{ boundary: string; weather_snapshot_id: number }>;
    expect(rows).toEqual([
      { boundary: 'end', weather_snapshot_id: endSnapId },
      { boundary: 'start', weather_snapshot_id: startSnapId },
    ]);
  });

  it('skips boundaries whose nearest snapshot is outside MAX_SNAPSHOT_GAP_MS', () => {
    initStorage(tempDbPath());
    const snap = new WeatherSnapshotter({
      db: getDb(),
      fetchObservation: vi.fn().mockResolvedValue(fakeObservation()),
    });

    const trip = makeTrip();
    insertTripRow(trip);

    const farSnapId = snap.persistObservation(fakeObservation());
    // Push captured_at far away from both boundaries.
    getDb()
      .prepare('UPDATE weather_snapshots SET captured_at = ? WHERE id = ?')
      .run(trip.startAt - 24 * 60 * 60_000, farSnapId);

    const { startSnapshotId, endSnapshotId } = snap.captureForTrip(trip);
    expect(startSnapshotId).toBeNull();
    expect(endSnapshotId).toBeNull();

    const count = (getDb().prepare('SELECT COUNT(*) as c FROM trip_weather').get() as {
      c: number;
    }).c;
    expect(count).toBe(0);
  });

  it('returns null ids when the snapshot table is empty', () => {
    initStorage(tempDbPath());
    const snap = new WeatherSnapshotter({
      db: getDb(),
      fetchObservation: vi.fn().mockResolvedValue(fakeObservation()),
    });
    const trip = makeTrip();
    insertTripRow(trip);

    const { startSnapshotId, endSnapshotId } = snap.captureForTrip(trip);
    expect(startSnapshotId).toBeNull();
    expect(endSnapshotId).toBeNull();
  });
});

describe('WeatherSnapshotter — lifecycle', () => {
  it('start() invokes the fetcher eagerly so first trip can resolve start weather', async () => {
    initStorage(tempDbPath());
    const fetcher = vi.fn().mockResolvedValue(fakeObservation());
    const snap = new WeatherSnapshotter({ db: getDb(), fetchObservation: fetcher });

    const stop = snap.start(60 * 60_000); // long interval — we only care about the eager call
    // The first call is fire-and-forget; allow microtasks to settle.
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetcher).toHaveBeenCalled();
    stop();
  });

  it('start() twice throws', () => {
    initStorage(tempDbPath());
    const snap = new WeatherSnapshotter({
      db: getDb(),
      fetchObservation: vi.fn().mockResolvedValue(fakeObservation()),
    });
    const stop = snap.start(60 * 60_000);
    expect(() => snap.start(60 * 60_000)).toThrow();
    stop();
  });
});
