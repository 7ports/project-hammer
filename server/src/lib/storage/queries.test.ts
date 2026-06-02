/**
 * Unit tests for the analytics query helpers. These complement the per-route
 * integration tests by exercising the storage-module surface directly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  closeStorage,
  getDb,
  initStorage,
  getDailyRollups,
  getTripCounts,
  getTripDurationQuantiles,
  getTripsInRange,
  quantile,
} from './index';

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-queries-test-')),
    'hammer.db',
  );
}

const NOW = 1_750_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

afterEach(() => {
  closeStorage();
});

describe('quantile', () => {
  it('returns 0 for empty array', () => {
    expect(quantile([], 0.5)).toBe(0);
  });
  it('returns the value for length-1 arrays', () => {
    expect(quantile([42], 0.9)).toBe(42);
  });
  it('interpolates linearly between adjacent values', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 0.0)).toBe(1);
    expect(quantile([1, 2, 3, 4, 5], 1.0)).toBe(5);
    expect(quantile([0, 10], 0.5)).toBe(5);
  });
  it('clamps q to [0, 1]', () => {
    expect(quantile([1, 2, 3], -0.5)).toBe(1);
    expect(quantile([1, 2, 3], 1.5)).toBe(3);
  });
});

describe('getTripsInRange', () => {
  beforeEach(() => {
    initStorage(tempDbPath());
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO trips (mmsi, from_dock, to_dock, start_at, end_at, duration_s, distance_m, position_count, inferred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(316045069, 'jack-layton', 'centre-island', NOW - 3 * DAY_MS, NOW - 3 * DAY_MS + 500_000, 500, 2000, 50, NOW);
    insert.run(316045069, 'jack-layton', 'wards-island', NOW - 2 * DAY_MS, NOW - 2 * DAY_MS + 600_000, 600, 2300, 60, NOW);
    insert.run(316045081, 'jack-layton', 'centre-island', NOW - 1 * DAY_MS, NOW - 1 * DAY_MS + 550_000, 550, 2200, 55, NOW);
  });

  it('returns trips ordered by start_at ascending', () => {
    const trips = getTripsInRange(getDb(), NOW - 7 * DAY_MS, NOW);
    expect(trips.length).toBe(3);
    expect(trips[0].start_at).toBeLessThan(trips[1].start_at);
    expect(trips[1].start_at).toBeLessThan(trips[2].start_at);
  });

  it('filters by mmsi', () => {
    const trips = getTripsInRange(getDb(), NOW - 7 * DAY_MS, NOW, { mmsi: 316045081 });
    expect(trips.length).toBe(1);
    expect(trips[0].mmsi).toBe(316045081);
  });

  it('filters by from_dock + to_dock', () => {
    const trips = getTripsInRange(getDb(), NOW - 7 * DAY_MS, NOW, {
      fromDock: 'jack-layton',
      toDock: 'centre-island',
    });
    expect(trips.length).toBe(2);
    for (const t of trips) {
      expect(t.to_dock).toBe('centre-island');
    }
  });

  it('excludes trips outside the window', () => {
    const trips = getTripsInRange(getDb(), NOW - 1.5 * DAY_MS, NOW);
    expect(trips.length).toBe(1);
    expect(trips[0].mmsi).toBe(316045081);
  });
});

describe('getTripCounts', () => {
  beforeEach(() => {
    initStorage(tempDbPath());
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO trips (mmsi, from_dock, to_dock, start_at, end_at, duration_s, distance_m, position_count, inferred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Two trips on day1, one on day2
    insert.run(316045069, 'jack-layton', 'centre-island', NOW - 2 * DAY_MS, NOW - 2 * DAY_MS + 500_000, 500, 2000, 50, NOW);
    insert.run(316045069, 'jack-layton', 'centre-island', NOW - 2 * DAY_MS + HOUR_MS, NOW - 2 * DAY_MS + HOUR_MS + 500_000, 500, 2000, 50, NOW);
    insert.run(316045069, 'jack-layton', 'centre-island', NOW - 1 * DAY_MS, NOW - 1 * DAY_MS + 500_000, 500, 2000, 50, NOW);
  });

  it('buckets by day', () => {
    const counts = getTripCounts(getDb(), NOW - 7 * DAY_MS, NOW, 'day');
    expect(counts.length).toBe(2);
    const total = counts.reduce((acc, c) => acc + c.count, 0);
    expect(total).toBe(3);
    expect(counts[0].count).toBe(2);
    expect(counts[1].count).toBe(1);
  });

  it('buckets by hour', () => {
    const counts = getTripCounts(getDb(), NOW - 7 * DAY_MS, NOW, 'hour');
    // 3 distinct hours expected
    expect(counts.length).toBe(3);
    for (const c of counts) {
      expect(c.bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    }
  });
});

describe('getTripDurationQuantiles', () => {
  beforeEach(() => {
    initStorage(tempDbPath());
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO trips (mmsi, from_dock, to_dock, start_at, end_at, duration_s, distance_m, position_count, inferred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const durations = [400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900];
    let t = NOW - 5 * DAY_MS;
    for (const d of durations) {
      insert.run(316045069, 'jack-layton', 'centre-island', t, t + d * 1000, d, 2200, 60, NOW);
      t += HOUR_MS;
    }
  });

  it('computes p10/p50/p90 per route', () => {
    const quantiles = getTripDurationQuantiles(getDb(), NOW - 30 * DAY_MS, NOW);
    expect(quantiles.length).toBe(1);
    const q = quantiles[0];
    expect(q.fromDock).toBe('jack-layton');
    expect(q.toDock).toBe('centre-island');
    expect(q.sampleSize).toBe(11);
    expect(q.p50Sec).toBe(650);
    expect(q.p10Sec).toBeLessThan(q.p50Sec);
    expect(q.p90Sec).toBeGreaterThan(q.p50Sec);
  });
});

describe('getDailyRollups', () => {
  it('reads daily_rollups in a date range', () => {
    initStorage(tempDbPath());
    const db = getDb();
    db.prepare(
      `INSERT INTO daily_rollups (
        date, total_positions, vessels_active, avg_sog, max_sog,
        service_status_minutes_open, service_status_minutes_alert,
        service_status_minutes_closed, schedule_adherence_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('2025-05-15', 1000, 3, 4.5, 8.1, 1440, 0, 0, null);

    const rows = getDailyRollups(db, '2025-05-01', '2025-05-31');
    expect(rows.length).toBe(1);
    expect(rows[0].date).toBe('2025-05-15');
    expect(rows[0].totalPositions).toBe(1000);
    expect(rows[0].vesselsActive).toBe(3);
    expect(rows[0].avgSog).toBeCloseTo(4.5);
    expect(rows[0].scheduleAdherenceScore).toBeNull();
  });
});
