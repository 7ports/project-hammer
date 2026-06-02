/**
 * Tests for daily rollups + weekly VACUUM.
 *
 * Acceptance §5 in the bead: insert ~100 fixture rows across 2 UTC dates,
 * compute rollups, assert aggregates per date. Also covers:
 *   - INSERT OR REPLACE idempotency
 *   - Service-status minute accounting from ferry_events transitions
 *   - VACUUM error isolation
 *   - Scheduler timing helpers
 */
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  closeStorage,
  computeDailyRollup,
  getDb,
  initStorage,
  msUntilNextDaily,
  msUntilNextWeekly,
  runDailyRollup,
  runWeeklyVacuum,
  startRollupJobs,
  utcDateString,
  utcDayBoundaries,
  yesterdayUtcDateString,
} from './index';

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-rollups-test-')),
    'hammer.db',
  );
}

afterEach(() => {
  closeStorage();
});

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

describe('date helpers', () => {
  it('utcDateString formats UTC components, not local', () => {
    expect(utcDateString(new Date('2026-05-15T23:59:59.999Z'))).toBe('2026-05-15');
    expect(utcDateString(new Date('2026-05-16T00:00:00.000Z'))).toBe('2026-05-16');
  });

  it('utcDayBoundaries returns [startMs, endMs) for a UTC date', () => {
    const { startMs, endMs } = utcDayBoundaries('2026-05-15');
    expect(startMs).toBe(Date.parse('2026-05-15T00:00:00.000Z'));
    expect(endMs).toBe(Date.parse('2026-05-16T00:00:00.000Z'));
    expect(endMs - startMs).toBe(86_400_000);
  });

  it('yesterdayUtcDateString returns the prior UTC day', () => {
    expect(yesterdayUtcDateString(new Date('2026-05-16T12:00:00.000Z'))).toBe('2026-05-15');
    // Boundary: just after midnight UTC → yesterday is the prior calendar day
    expect(yesterdayUtcDateString(new Date('2026-05-16T00:00:30.000Z'))).toBe('2026-05-15');
  });

  it('utcDayBoundaries throws on garbage input', () => {
    expect(() => utcDayBoundaries('not-a-date')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// computeDailyRollup — the bead's acceptance test
// ---------------------------------------------------------------------------

interface PositionFixture {
  mmsi: number;
  timestamp: number;
  sog: number;
  cog: number;
  heading: number;
  nav_status: number | null;
  latitude: number;
  longitude: number;
  provider: string;
  ingested_at: number;
}

function insertPositions(rows: PositionFixture[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO ais_positions
       (mmsi, provider, timestamp, ingested_at, latitude, longitude, sog, cog, heading, nav_status)
     VALUES (@mmsi, @provider, @timestamp, @ingested_at, @latitude, @longitude, @sog, @cog, @heading, @nav_status)`,
  );
  const txn = getDb().transaction((batch: PositionFixture[]) => {
    for (const r of batch) stmt.run(r);
  });
  txn(rows);
}

function makePos(date: string, mmsi: number, idx: number, sog: number): PositionFixture {
  const ts = Date.parse(`${date}T00:00:00.000Z`) + idx * 60_000;
  return {
    mmsi,
    provider: 'aisstream',
    timestamp: ts,
    ingested_at: ts + 500,
    latitude: 43.6 + idx * 0.0001,
    longitude: -79.4 + idx * 0.0001,
    sog,
    cog: 90,
    heading: 90,
    nav_status: 0,
  };
}

describe('computeDailyRollup', () => {
  it('aggregates ~100 positions across 2 UTC dates and produces per-date rollups', () => {
    initStorage(tempDbPath());

    // Date A: 2026-05-15 — 60 positions for vessel A (active), 12 for vessel B (active)
    // Date B: 2026-05-16 — 30 positions for vessel A (active), 5 for vessel C (inactive, <10)
    const dayA = '2026-05-15';
    const dayB = '2026-05-16';
    const A_MMSI = 316045069;
    const B_MMSI = 316045081;
    const C_MMSI = 316045082;

    const rows: PositionFixture[] = [];
    for (let i = 0; i < 60; i++) rows.push(makePos(dayA, A_MMSI, i, 6 + (i % 5)));
    for (let i = 0; i < 12; i++) rows.push(makePos(dayA, B_MMSI, i, 4));
    for (let i = 0; i < 30; i++) rows.push(makePos(dayB, A_MMSI, i, 10));
    for (let i = 0; i < 5; i++) rows.push(makePos(dayB, C_MMSI, i, 2));
    insertPositions(rows);

    const rA = computeDailyRollup(getDb(), dayA);
    const rB = computeDailyRollup(getDb(), dayB);

    // Day A
    expect(rA.date).toBe(dayA);
    expect(rA.total_positions).toBe(72);
    expect(rA.vessels_active).toBe(2); // A (60) and B (12)
    expect(rA.max_sog).toBe(10); // 6,7,8,9,10 cycle → max 10
    expect(rA.avg_sog).not.toBeNull();

    // Day B
    expect(rB.date).toBe(dayB);
    expect(rB.total_positions).toBe(35);
    expect(rB.vessels_active).toBe(1); // only A; C has 5 < 10
    expect(rB.max_sog).toBe(10);

    // Persisted to daily_rollups
    const persisted = getDb()
      .prepare('SELECT date, total_positions, vessels_active FROM daily_rollups ORDER BY date')
      .all() as Array<{ date: string; total_positions: number; vessels_active: number }>;
    expect(persisted).toEqual([
      { date: dayA, total_positions: 72, vessels_active: 2 },
      { date: dayB, total_positions: 35, vessels_active: 1 },
    ]);
  });

  it('is idempotent — INSERT OR REPLACE on rerun', () => {
    initStorage(tempDbPath());
    const dayA = '2026-05-15';
    insertPositions([makePos(dayA, 316045069, 0, 5)]);

    computeDailyRollup(getDb(), dayA);
    computeDailyRollup(getDb(), dayA);

    const count = (
      getDb().prepare('SELECT COUNT(*) AS c FROM daily_rollups').get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it('writes zero rollup when the day has no positions', () => {
    initStorage(tempDbPath());
    const r = computeDailyRollup(getDb(), '2026-05-15');
    expect(r.total_positions).toBe(0);
    expect(r.vessels_active).toBe(0);
    expect(r.avg_sog).toBeNull();
    expect(r.max_sog).toBeNull();
  });

  it('attributes status minutes from ferry_events transitions', () => {
    initStorage(tempDbPath());
    const day = '2026-05-15';
    const dayStart = Date.parse(`${day}T00:00:00.000Z`);
    const evStmt = getDb().prepare(
      `INSERT INTO ferry_events (status, message, reason, posted_at, detected_at, parsed_times)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    // Prior event: 2 days before, status=open → starts day as open
    evStmt.run('open', null, null, null, dayStart - 2 * 86_400_000, '[]');
    // At 06:00 → alert
    evStmt.run('alert', 'Weather', 'Weather', null, dayStart + 6 * 3_600_000, '[]');
    // At 09:00 → closed
    evStmt.run('closed', 'Closed', 'Weather', null, dayStart + 9 * 3_600_000, '[]');
    // At 15:00 → open again
    evStmt.run('open', null, null, null, dayStart + 15 * 3_600_000, '[]');

    const r = computeDailyRollup(getDb(), day);
    // Open: 00:00–06:00 (360) + 15:00–24:00 (540) = 900 min
    expect(r.service_status_minutes_open).toBe(900);
    // Alert: 06:00–09:00 = 180 min
    expect(r.service_status_minutes_alert).toBe(180);
    // Closed: 09:00–15:00 = 360 min
    expect(r.service_status_minutes_closed).toBe(360);
    // Sanity: total = 1440 min/day
    const total =
      r.service_status_minutes_open +
      r.service_status_minutes_alert +
      r.service_status_minutes_closed;
    expect(total).toBe(1440);
  });

  it("defaults to 'open' when no prior ferry event exists", () => {
    initStorage(tempDbPath());
    const day = '2026-05-15';
    const r = computeDailyRollup(getDb(), day);
    expect(r.service_status_minutes_open).toBe(1440);
    expect(r.service_status_minutes_alert).toBe(0);
    expect(r.service_status_minutes_closed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runDailyRollup — error isolation
// ---------------------------------------------------------------------------

describe('runDailyRollup', () => {
  it('targets yesterday UTC by default', () => {
    initStorage(tempDbPath());
    const now = new Date('2026-05-16T03:00:00.000Z');
    const result = runDailyRollup(getDb(), { now });
    expect(result.date).toBe('2026-05-15');
    expect(result.error).toBeNull();
    expect(result.row).not.toBeNull();
  });

  it('honours an explicit targetDate', () => {
    initStorage(tempDbPath());
    const result = runDailyRollup(getDb(), { targetDate: '2026-05-10' });
    expect(result.date).toBe('2026-05-10');
  });

  it('swallows compute errors and returns the error in the result', () => {
    initStorage(tempDbPath());
    // Drop the daily_rollups table so the INSERT inside computeDailyRollup
    // throws.
    getDb().exec('DROP TABLE daily_rollups');

    const result = runDailyRollup(getDb(), { targetDate: '2026-05-15' });
    expect(result.error).not.toBeNull();
    expect(result.row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runWeeklyVacuum
// ---------------------------------------------------------------------------

describe('runWeeklyVacuum', () => {
  it('runs VACUUM and reports before/after byte sizes', () => {
    const dbPath = tempDbPath();
    initStorage(dbPath);

    // Insert a row and delete it so VACUUM has free pages to reclaim.
    const ins = getDb().prepare(
      `INSERT INTO ais_positions
         (mmsi, provider, timestamp, ingested_at, latitude, longitude, sog, cog, heading, nav_status)
       VALUES (?, 'aisstream', ?, ?, 43.6, -79.4, 5, 90, 90, 0)`,
    );
    for (let i = 0; i < 500; i++) ins.run(316045069, i, i + 1);
    getDb().exec('DELETE FROM ais_positions');

    const result = runWeeklyVacuum(getDb(), dbPath);
    expect(result.error).toBeNull();
    expect(result.bytesBefore).not.toBeNull();
    expect(result.bytesAfter).not.toBeNull();
    expect(result.bytesBefore).toBeGreaterThan(0);
  });

  it('swallows errors so a broken VACUUM does not crash callers', () => {
    initStorage(tempDbPath());
    closeStorage(); // Close the DB so VACUUM throws.
    // We can still construct a fake handle and call directly. Instead just
    // verify that calling on a closed db produces an error result.
    const db = new Database(':memory:');
    db.close();
    const result = runWeeklyVacuum(db);
    expect(result.error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startRollupJobs — scheduler
// ---------------------------------------------------------------------------

describe('startRollupJobs', () => {
  it('returns a handle with stop() + trigger helpers and never throws on cron', () => {
    initStorage(tempDbPath());

    const handle = startRollupJobs(getDb(), {
      now: () => new Date('2026-05-15T12:00:00.000Z'),
      disableTimers: true,
    });

    const daily = handle.triggerDaily();
    expect(daily.error).toBeNull();
    expect(daily.date).toBe('2026-05-14'); // yesterday

    const weekly = handle.triggerWeekly();
    expect(weekly.error).toBeNull();

    handle.stop();
  });

  it('msUntilNextDaily picks the next 03:00 UTC', () => {
    // 2026-05-15T02:00:00Z → next is same-day 03:00 → 1h delay
    expect(msUntilNextDaily(new Date('2026-05-15T02:00:00.000Z'))).toBe(3_600_000);
    // 2026-05-15T04:00:00Z → next is next-day 03:00 → 23h delay
    expect(msUntilNextDaily(new Date('2026-05-15T04:00:00.000Z'))).toBe(23 * 3_600_000);
  });

  it('msUntilNextWeekly picks the next Sunday 04:00 UTC', () => {
    // 2026-05-17 is a Sunday (verify by parsing).
    expect(new Date('2026-05-17T00:00:00.000Z').getUTCDay()).toBe(0);

    // Sunday 03:00 → same day at 04:00 → 1h
    expect(msUntilNextWeekly(new Date('2026-05-17T03:00:00.000Z'))).toBe(3_600_000);
    // Sunday 05:00 → next Sunday 04:00 → 6d23h
    expect(msUntilNextWeekly(new Date('2026-05-17T05:00:00.000Z'))).toBe(
      6 * 86_400_000 + 23 * 3_600_000,
    );
    // Monday 04:00 → next Sunday 04:00 → 6d
    expect(msUntilNextWeekly(new Date('2026-05-18T04:00:00.000Z'))).toBe(6 * 86_400_000);
  });
});
