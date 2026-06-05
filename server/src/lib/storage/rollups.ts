/**
 * Daily position rollups + weekly VACUUM.
 *
 * Per .voltron/reports/ais-storage.md §6.4 / §6.6 / Phase C:
 *   - Daily cron at 03:00 UTC aggregates yesterday's `ais_positions` rows into
 *     `daily_rollups` (schema §6.4: keyed by date, total_positions,
 *     vessels_active, avg_sog, max_sog, service_status_minutes_{open,alert,
 *     closed}, schedule_adherence_score).
 *   - Weekly cron at Sunday 04:00 UTC runs SQLite VACUUM, logging before/after
 *     file size. VACUUM is best-effort: a failure here NEVER affects ingest.
 *
 * Timezone: rollup `date` is UTC (YYYY-MM-DD). The report mentions Toronto
 * local; UTC is chosen here for stability (Fly machines run UTC unless TZ is
 * set explicitly) and to avoid DST-edge double rollup. Day boundaries are
 * unix-ms [startOfDayUTC, startOfNextDayUTC).
 *
 * Failure isolation (report §7.4): every public entry point wraps its work in
 * try/catch and logs. Ingest / SSE must never see a thrown error from here.
 */
import type { Database } from 'better-sqlite3';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Helpers — date boundaries (UTC) and date strings
// ---------------------------------------------------------------------------

/** Format a Date as 'YYYY-MM-DD' in UTC. */
export function utcDateString(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Returns [startMs, endMs) for the given UTC YYYY-MM-DD string. */
export function utcDayBoundaries(dateStr: string): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (!Number.isFinite(startMs)) {
    throw new Error(`Invalid rollup date string: ${dateStr}`);
  }
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1_000 };
}

/** YYYY-MM-DD for the UTC day before `now`. */
export function yesterdayUtcDateString(now: Date): string {
  const y = new Date(now.getTime());
  y.setUTCDate(y.getUTCDate() - 1);
  return utcDateString(y);
}

// ---------------------------------------------------------------------------
// Core rollup — pure, idempotent
// ---------------------------------------------------------------------------

export interface DailyRollupRow {
  date: string;
  total_positions: number;
  vessels_active: number;
  avg_sog: number | null;
  max_sog: number | null;
  service_status_minutes_open: number;
  service_status_minutes_alert: number;
  service_status_minutes_closed: number;
  schedule_adherence_score: number | null;
}

const ACTIVE_VESSEL_MIN_POSITIONS = 10;

/**
 * Compute the rollup row for one UTC date and UPSERT it into `daily_rollups`.
 * Runs in a single transaction. Idempotent: re-running for the same date
 * replaces the prior row in place.
 *
 * Throws on DB error so callers can decide whether to log-and-continue.
 */
export function computeDailyRollup(db: Database, dateStr: string): DailyRollupRow {
  const { startMs, endMs } = utcDayBoundaries(dateStr);

  // Aggregate positions for the day.
  const agg = db
    .prepare(
      `SELECT
          COUNT(*)        AS total_positions,
          AVG(sog)        AS avg_sog,
          MAX(sog)        AS max_sog
       FROM ais_positions
       WHERE timestamp >= ? AND timestamp < ?`,
    )
    .get(startMs, endMs) as {
    total_positions: number;
    avg_sog: number | null;
    max_sog: number | null;
  };

  // Vessels active = distinct MMSIs with >= ACTIVE_VESSEL_MIN_POSITIONS in
  // the window. Doing this in SQL avoids loading per-row data into JS.
  const activeRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
          SELECT mmsi FROM ais_positions
          WHERE timestamp >= ? AND timestamp < ?
          GROUP BY mmsi
          HAVING COUNT(*) >= ?
       )`,
    )
    .get(startMs, endMs, ACTIVE_VESSEL_MIN_POSITIONS) as { c: number };

  // Compute service-status time-in-state from ferry_events. ferry_events
  // records *transitions*, so for an arbitrary day window we must:
  //   1. Find the last event before startMs to know the starting status.
  //   2. Walk events strictly inside [startMs, endMs) summing durations.
  //   3. Close the final segment at endMs.
  // If no prior event exists, default to 'open' — matches the City API
  // baseline behaviour (no alert = service open).
  const minutes = computeStatusMinutes(db, startMs, endMs);

  const row: DailyRollupRow = {
    date: dateStr,
    total_positions: agg.total_positions ?? 0,
    vessels_active: activeRow.c ?? 0,
    avg_sog: agg.total_positions > 0 ? agg.avg_sog : null,
    max_sog: agg.total_positions > 0 ? agg.max_sog : null,
    service_status_minutes_open: minutes.open,
    service_status_minutes_alert: minutes.alert,
    service_status_minutes_closed: minutes.closed,
    // Left null — populated by a future analyzer per §6.4.
    schedule_adherence_score: null,
  };

  db.prepare(
    `INSERT OR REPLACE INTO daily_rollups (
        date,
        total_positions,
        vessels_active,
        avg_sog,
        max_sog,
        service_status_minutes_open,
        service_status_minutes_alert,
        service_status_minutes_closed,
        schedule_adherence_score
      ) VALUES (
        @date,
        @total_positions,
        @vessels_active,
        @avg_sog,
        @max_sog,
        @service_status_minutes_open,
        @service_status_minutes_alert,
        @service_status_minutes_closed,
        @schedule_adherence_score
      )`,
  ).run(row);

  return row;
}

interface StatusMinuteCounts {
  open: number;
  alert: number;
  closed: number;
}

type TrackedStatus = 'open' | 'alert' | 'closed';

function normalizeStatus(raw: string): TrackedStatus {
  if (raw === 'open' || raw === 'alert' || raw === 'closed') return raw;
  // 'unknown' or anything else folds into 'open' for accounting: we'd rather
  // under-count outages than fabricate them.
  return 'open';
}

function computeStatusMinutes(
  db: Database,
  startMs: number,
  endMs: number,
): StatusMinuteCounts {
  const totals: StatusMinuteCounts = { open: 0, alert: 0, closed: 0 };

  const priorRow = db
    .prepare(
      `SELECT status FROM ferry_events
        WHERE detected_at < ?
        ORDER BY detected_at DESC
        LIMIT 1`,
    )
    .get(startMs) as { status: string } | undefined;

  let currentStatus: TrackedStatus = priorRow ? normalizeStatus(priorRow.status) : 'open';
  let segmentStart = startMs;

  const dayEvents = db
    .prepare(
      `SELECT status, detected_at FROM ferry_events
        WHERE detected_at >= ? AND detected_at < ?
        ORDER BY detected_at ASC`,
    )
    .all(startMs, endMs) as Array<{ status: string; detected_at: number }>;

  for (const evt of dayEvents) {
    const t = Math.max(segmentStart, Math.min(evt.detected_at, endMs));
    totals[currentStatus] += t - segmentStart;
    currentStatus = normalizeStatus(evt.status);
    segmentStart = t;
  }
  // Close the final segment at endMs.
  totals[currentStatus] += endMs - segmentStart;

  // Convert ms → minutes (floored).
  return {
    open: Math.floor(totals.open / 60_000),
    alert: Math.floor(totals.alert / 60_000),
    closed: Math.floor(totals.closed / 60_000),
  };
}

// ---------------------------------------------------------------------------
// Daily rollup entry — wraps computeDailyRollup with failure isolation
// ---------------------------------------------------------------------------

export interface RunDailyRollupResult {
  date: string;
  row: DailyRollupRow | null;
  error: Error | null;
}

/**
 * Run the rollup for the UTC date prior to `now` (or `targetDate` if supplied).
 * Logs and swallows errors per §7.4 — never throws.
 */
export function runDailyRollup(
  db: Database,
  options: { now?: Date; targetDate?: string } = {},
): RunDailyRollupResult {
  const now = options.now ?? new Date();
  const date = options.targetDate ?? yesterdayUtcDateString(now);
  try {
    const row = computeDailyRollup(db, date);
    console.log(
      `[storage] daily rollup ${date}: positions=${row.total_positions} vessels_active=${row.vessels_active} avg_sog=${row.avg_sog?.toFixed?.(2) ?? 'null'} max_sog=${row.max_sog ?? 'null'} status_min(o/a/c)=${row.service_status_minutes_open}/${row.service_status_minutes_alert}/${row.service_status_minutes_closed}`,
    );
    return { date, row, error: null };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(`[storage] daily rollup ${date} failed — continuing:`, e);
    return { date, row: null, error: e };
  }
}

// ---------------------------------------------------------------------------
// Weekly VACUUM
// ---------------------------------------------------------------------------

export interface VacuumResult {
  bytesBefore: number | null;
  bytesAfter: number | null;
  error: Error | null;
}

/**
 * Run SQLite VACUUM. Logs before/after DB file size. Swallows errors — VACUUM
 * is best-effort maintenance; an exception here MUST NOT break ingestion.
 *
 * `dbPath` is optional: when omitted, we attempt to read the file size from
 * the open Database object's `name` property. In tests we pass the path
 * explicitly.
 */
export function runWeeklyVacuum(db: Database, dbPath?: string): VacuumResult {
  const path = dbPath ?? db.name;
  const bytesBefore = safeFileSize(path);
  try {
    db.exec('VACUUM');
    const bytesAfter = safeFileSize(path);
    console.log(
      `[storage] weekly VACUUM ok: before=${formatBytes(bytesBefore)} after=${formatBytes(bytesAfter)}`,
    );
    return { bytesBefore, bytesAfter, error: null };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error('[storage] weekly VACUUM failed — continuing:', e);
    return { bytesBefore, bytesAfter: null, error: e };
  }
}

function safeFileSize(path: string | undefined): number | null {
  if (!path) return null;
  try {
    return fs.statSync(path).size;
  } catch {
    return null;
  }
}

function formatBytes(n: number | null): string {
  if (n === null) return 'unknown';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

// ---------------------------------------------------------------------------
// Scheduler — daily at 03:00 UTC, weekly Sunday 04:00 UTC
// ---------------------------------------------------------------------------

const DAILY_HOUR_UTC = 3; // 03:00 UTC = ~23:00 ET previous day (DST aware), per report §6.6
const DAILY_MINUTE_UTC = 0;
const WEEKLY_HOUR_UTC = 4; // 04:00 UTC Sunday — one hour after daily so they don't overlap
const WEEKLY_MINUTE_UTC = 0;
const WEEKLY_DOW_UTC = 0; // Sunday

export interface RollupJobsHandle {
  stop(): void;
  /** Exposed for tests so they can drive the cron synchronously. */
  triggerDaily(): RunDailyRollupResult;
  /** Exposed for tests so they can drive VACUUM synchronously. */
  triggerWeekly(): VacuumResult;
}

export interface StartRollupJobsOptions {
  /** Override "now" for tests. */
  now?: () => Date;
  /** Explicit path; falls back to db.name. */
  dbPath?: string;
  /**
   * If true, skip the timer arming. Tests pass this to construct a handle
   * without scheduling background work.
   */
  disableTimers?: boolean;
}

/**
 * Register the daily rollup + weekly VACUUM cron timers. Returns a handle
 * with stop() and test-only trigger methods.
 *
 * Caller (server/src/index.ts) wraps the call in try/catch so a scheduling
 * failure does not block ingest or SSE.
 */
export function startRollupJobs(
  db: Database,
  options: StartRollupJobsOptions = {},
): RollupJobsHandle {
  const nowFn = options.now ?? (() => new Date());
  const dbPath = options.dbPath;

  let dailyTimer: NodeJS.Timeout | null = null;
  let weeklyTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  function armDaily(): void {
    if (stopped || options.disableTimers) return;
    const delay = msUntilNextDaily(nowFn());
    dailyTimer = setTimeout(() => {
      runDailyRollup(db);
      armDaily();
    }, delay);
    dailyTimer.unref?.();
  }

  function armWeekly(): void {
    if (stopped || options.disableTimers) return;
    const delay = msUntilNextWeekly(nowFn());
    weeklyTimer = setTimeout(() => {
      runWeeklyVacuum(db, dbPath);
      armWeekly();
    }, delay);
    weeklyTimer.unref?.();
  }

  armDaily();
  armWeekly();

  console.log(
    `[storage] rollup jobs scheduled: daily @ ${pad2(DAILY_HOUR_UTC)}:${pad2(DAILY_MINUTE_UTC)} UTC, weekly Sunday @ ${pad2(WEEKLY_HOUR_UTC)}:${pad2(WEEKLY_MINUTE_UTC)} UTC`,
  );

  return {
    stop(): void {
      stopped = true;
      if (dailyTimer !== null) clearTimeout(dailyTimer);
      if (weeklyTimer !== null) clearTimeout(weeklyTimer);
      dailyTimer = null;
      weeklyTimer = null;
    },
    triggerDaily(): RunDailyRollupResult {
      return runDailyRollup(db, { now: nowFn() });
    },
    triggerWeekly(): VacuumResult {
      return runWeeklyVacuum(db, dbPath);
    },
  };
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function msUntilNextDaily(now: Date): number {
  const next = new Date(now.getTime());
  next.setUTCHours(DAILY_HOUR_UTC, DAILY_MINUTE_UTC, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function msUntilNextWeekly(now: Date): number {
  const next = new Date(now.getTime());
  next.setUTCHours(WEEKLY_HOUR_UTC, WEEKLY_MINUTE_UTC, 0, 0);
  const currentDow = next.getUTCDay();
  let daysAhead = (WEEKLY_DOW_UTC - currentDow + 7) % 7;
  if (daysAhead === 0 && next.getTime() <= now.getTime()) {
    daysAhead = 7;
  }
  next.setUTCDate(next.getUTCDate() + daysAhead);
  return next.getTime() - now.getTime();
}
