/**
 * Read-only analytics query helpers.
 *
 * Per project-hammer-eea Task 10 acceptance: all `/api/analytics/*` route
 * handlers MUST read through this module — no SQL embedded in routes. If a
 * route needs data not exposed here, ADD a helper here instead.
 *
 * Tables consumed:
 *   ais_positions, ferry_events, provider_state, daily_rollups,
 *   schedule_snapshots, trips, weather_snapshots, trip_weather
 *
 * Quantile math is done in JS over small result sets — SQLite has no native
 * PERCENTILE_CONT, and the trip volume is at most low thousands per range.
 * Routes are responsible for clamping the range; helpers trust their inputs.
 */
import type { Database } from 'better-sqlite3';
import { haversineMeters, DOCKS } from '../docks';

// ---------------------------------------------------------------------------
// Shared row / result types
// ---------------------------------------------------------------------------

export interface TripRow {
  id: number;
  mmsi: number;
  from_dock: string;
  to_dock: string;
  start_at: number;
  end_at: number;
  duration_s: number;
  distance_m: number;
  position_count: number;
  inferred_at: number;
}

export interface TripFilter {
  mmsi?: number;
  fromDock?: string;
  toDock?: string;
}

export interface TripCountBucket {
  /** ISO date (YYYY-MM-DD) for granularity=day; YYYY-MM-DDTHH for hour. */
  bucket: string;
  count: number;
}

export interface TripDurationQuantile {
  fromDock: string;
  toDock: string;
  p10Sec: number;
  p50Sec: number;
  p90Sec: number;
  sampleSize: number;
}

export interface AdherenceBucket {
  routeKey: string;
  dayOfWeek: number;
  hour: number;
  medianDelaySec: number;
  sampleSize: number;
}

export interface DwellStat {
  dockId: string;
  mmsi: number;
  medianDwellSec: number;
  p90DwellSec: number;
  sampleSize: number;
}

export interface UtilizationRow {
  mmsi: number;
  activeMs: number;
  totalMs: number;
  utilizationPct: number;
  sampleSize: number;
}

export interface DisruptionEvent {
  status: string;
  reason: string | null;
  message: string | null;
  detectedAt: number;
  durationMs: number | null;
  parsedTimes: string[];
}

export interface ProviderTransition {
  transition: string;
  from: string | null;
  to: string | null;
  timestamp: number;
}

export interface DataQualitySummary {
  totalPositions: number;
  longestGapMs: number | null;
  gapCount: number;
  providerTransitions: ProviderTransition[];
  uptimePct: number | null;
}

export interface DockPresenceCell {
  mmsi: number;
  dockId: string;
  hour: number;
  pctTime: number;
  sampleSize: number;
}

export interface TripAnomaly {
  tripId: number;
  mmsi: number;
  fromDock: string;
  toDock: string;
  startAt: number;
  endAt: number;
  durationSec: number;
  expectedP10Sec: number;
  expectedP50Sec: number;
  expectedP90Sec: number;
  anomalyType: 'slow' | 'fast';
}

export interface DailyRollupReadRow {
  date: string;
  totalPositions: number;
  vesselsActive: number;
  avgSog: number | null;
  maxSog: number | null;
  serviceMinutesOpen: number;
  serviceMinutesAlert: number;
  serviceMinutesClosed: number;
  scheduleAdherenceScore: number | null;
}

export interface AnalyticsSummary {
  tripsCount: number;
  onTimeRate: number | null;
  medianTripSec: number | null;
  avgSogKn: number | null;
  vesselsOnDuty: number;
  serviceUptimePct: number | null;
  alertsCount: number;
  totalPositions: number;
}

// ---------------------------------------------------------------------------
// Trip queries
// ---------------------------------------------------------------------------

/**
 * Fetch trips whose start_at falls within [fromMs, toMs). Ordered by start_at ASC.
 * Optional filters narrow by mmsi or by route (from_dock + to_dock).
 */
export function getTripsInRange(
  db: Database,
  fromMs: number,
  toMs: number,
  filter: TripFilter = {},
): TripRow[] {
  const clauses: string[] = ['start_at >= ?', 'start_at < ?'];
  const params: Array<number | string> = [fromMs, toMs];
  if (filter.mmsi !== undefined) {
    clauses.push('mmsi = ?');
    params.push(filter.mmsi);
  }
  if (filter.fromDock !== undefined) {
    clauses.push('from_dock = ?');
    params.push(filter.fromDock);
  }
  if (filter.toDock !== undefined) {
    clauses.push('to_dock = ?');
    params.push(filter.toDock);
  }
  return db
    .prepare(
      `SELECT id, mmsi, from_dock, to_dock, start_at, end_at, duration_s, distance_m,
              position_count, inferred_at
         FROM trips
        WHERE ${clauses.join(' AND ')}
        ORDER BY start_at ASC`,
    )
    .all(...params) as TripRow[];
}

/**
 * Trip counts bucketed by UTC day. Granularity 'day' returns YYYY-MM-DD;
 * 'hour' returns YYYY-MM-DDTHH (zero-padded).
 */
export function getTripCounts(
  db: Database,
  fromMs: number,
  toMs: number,
  granularity: 'day' | 'hour',
  filter: TripFilter = {},
): TripCountBucket[] {
  const trips = getTripsInRange(db, fromMs, toMs, filter);
  const buckets = new Map<string, number>();
  for (const t of trips) {
    const d = new Date(t.start_at);
    const y = d.getUTCFullYear().toString().padStart(4, '0');
    const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = d.getUTCDate().toString().padStart(2, '0');
    const hour = d.getUTCHours().toString().padStart(2, '0');
    const key = granularity === 'day' ? `${y}-${m}-${day}` : `${y}-${m}-${day}T${hour}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([bucket, count]) => ({ bucket, count }));
}

/**
 * Per-route trip duration quantiles. Routes are grouped by (from_dock, to_dock).
 */
export function getTripDurationQuantiles(
  db: Database,
  fromMs: number,
  toMs: number,
  filter: TripFilter = {},
): TripDurationQuantile[] {
  const trips = getTripsInRange(db, fromMs, toMs, filter);
  const groups = new Map<string, number[]>();
  for (const t of trips) {
    const key = `${t.from_dock}|${t.to_dock}`;
    const arr = groups.get(key) ?? [];
    arr.push(t.duration_s);
    groups.set(key, arr);
  }
  const result: TripDurationQuantile[] = [];
  for (const [key, durations] of groups) {
    const [fromDock, toDock] = key.split('|');
    durations.sort((a, b) => a - b);
    result.push({
      fromDock,
      toDock,
      p10Sec: quantile(durations, 0.1),
      p50Sec: quantile(durations, 0.5),
      p90Sec: quantile(durations, 0.9),
      sampleSize: durations.length,
    });
  }
  return result.sort((a, b) => {
    if (a.fromDock !== b.fromDock) return a.fromDock < b.fromDock ? -1 : 1;
    return a.toDock < b.toDock ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// Schedule adherence
// ---------------------------------------------------------------------------

interface ScheduleDeparture {
  routeId: string;
  direction: string;
  time: string;
  days: string[];
}

interface ScheduleJson {
  seasons?: Array<{
    effectiveFrom?: string;
    effectiveUntil?: string;
    routes?: Array<{
      routeId: string;
      departures?: ScheduleDeparture[];
    }>;
  }>;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Median delay (seconds) bucketed by day-of-week + hour-of-day, derived by
 * matching trips to the closest scheduled departure within ±15 min.
 *
 * The active schedule snapshot is selected as the most recent
 * `schedule_snapshots.captured_at <= toMs`. If no snapshot exists or the
 * JSON is malformed, returns an empty array (the route then signals
 * INSUFFICIENT_DATA to clients via sampleSize=0).
 */
export function getScheduleAdherenceByHourOfWeek(
  db: Database,
  fromMs: number,
  toMs: number,
  filter: TripFilter = {},
): AdherenceBucket[] {
  const snapshot = db
    .prepare(
      `SELECT content FROM schedule_snapshots
        WHERE captured_at <= ?
        ORDER BY captured_at DESC
        LIMIT 1`,
    )
    .get(toMs) as { content: string } | undefined;
  if (!snapshot) return [];

  let parsed: ScheduleJson;
  try {
    parsed = JSON.parse(snapshot.content) as ScheduleJson;
  } catch {
    return [];
  }

  const trips = getTripsInRange(db, fromMs, toMs, filter);
  if (trips.length === 0) return [];

  const WINDOW_SEC = 15 * 60;

  interface Bucket {
    routeKey: string;
    dayOfWeek: number;
    hour: number;
    delays: number[];
  }
  const buckets = new Map<string, Bucket>();

  for (const trip of trips) {
    const tripDate = new Date(trip.start_at);
    const dayKey = DAY_KEYS[tripDate.getUTCDay()];
    const hour = tripDate.getUTCHours();
    const dayOfWeek = tripDate.getUTCDay();

    let bestDelay: number | null = null;
    for (const season of parsed.seasons ?? []) {
      for (const route of season.routes ?? []) {
        for (const dep of route.departures ?? []) {
          if (!dep.days.includes(dayKey)) continue;
          const [hh, mm] = dep.time.split(':').map((s) => parseInt(s, 10));
          if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
          const scheduledMs = Date.UTC(
            tripDate.getUTCFullYear(),
            tripDate.getUTCMonth(),
            tripDate.getUTCDate(),
            hh,
            mm,
          );
          const deltaSec = Math.round((trip.start_at - scheduledMs) / 1000);
          if (Math.abs(deltaSec) <= WINDOW_SEC) {
            if (bestDelay === null || Math.abs(deltaSec) < Math.abs(bestDelay)) {
              bestDelay = deltaSec;
            }
          }
        }
      }
    }

    if (bestDelay === null) continue;

    const routeKey = `${trip.from_dock}->${trip.to_dock}`;
    const bucketKey = `${routeKey}|${dayOfWeek}|${hour}`;
    const bucket = buckets.get(bucketKey) ?? {
      routeKey,
      dayOfWeek,
      hour,
      delays: [],
    };
    bucket.delays.push(bestDelay);
    buckets.set(bucketKey, bucket);
  }

  return [...buckets.values()]
    .map<AdherenceBucket>((b) => {
      const sorted = b.delays.slice().sort((x, y) => x - y);
      return {
        routeKey: b.routeKey,
        dayOfWeek: b.dayOfWeek,
        hour: b.hour,
        medianDelaySec: quantile(sorted, 0.5),
        sampleSize: b.delays.length,
      };
    })
    .sort((a, b) => {
      if (a.routeKey !== b.routeKey) return a.routeKey < b.routeKey ? -1 : 1;
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.hour - b.hour;
    });
}

// ---------------------------------------------------------------------------
// Dwell time
// ---------------------------------------------------------------------------

/**
 * Median + p90 dwell seconds per (dock, mmsi).
 *
 * Dwell = (next_trip.start_at - this_trip.end_at) for the same vessel where
 * the dock arrived-at equals the dock departed-from on the next trip. Gaps
 * longer than 6h are excluded (overnight layovers, repositioning).
 */
export function getDockDwell(
  db: Database,
  fromMs: number,
  toMs: number,
  options: { mmsi?: number; dockId?: string } = {},
): DwellStat[] {
  const MAX_DWELL_MS = 6 * 60 * 60 * 1_000;
  const trips = getTripsInRange(db, fromMs, toMs, options.mmsi !== undefined ? { mmsi: options.mmsi } : {});
  const byVessel = new Map<number, TripRow[]>();
  for (const t of trips) {
    const arr = byVessel.get(t.mmsi) ?? [];
    arr.push(t);
    byVessel.set(t.mmsi, arr);
  }

  interface Group { dockId: string; mmsi: number; dwells: number[] }
  const groups = new Map<string, Group>();

  for (const [mmsi, vesselTrips] of byVessel) {
    for (let i = 0; i < vesselTrips.length - 1; i++) {
      const t = vesselTrips[i];
      const next = vesselTrips[i + 1];
      if (t.to_dock !== next.from_dock) continue;
      const gap = next.start_at - t.end_at;
      if (gap <= 0 || gap > MAX_DWELL_MS) continue;
      if (options.dockId !== undefined && t.to_dock !== options.dockId) continue;
      const key = `${t.to_dock}|${mmsi}`;
      const g = groups.get(key) ?? { dockId: t.to_dock, mmsi, dwells: [] };
      g.dwells.push(Math.round(gap / 1000));
      groups.set(key, g);
    }
  }

  return [...groups.values()]
    .map<DwellStat>((g) => {
      const sorted = g.dwells.slice().sort((a, b) => a - b);
      return {
        dockId: g.dockId,
        mmsi: g.mmsi,
        medianDwellSec: quantile(sorted, 0.5),
        p90DwellSec: quantile(sorted, 0.9),
        sampleSize: g.dwells.length,
      };
    })
    .sort((a, b) => {
      if (a.dockId !== b.dockId) return a.dockId < b.dockId ? -1 : 1;
      return a.mmsi - b.mmsi;
    });
}

// ---------------------------------------------------------------------------
// Vessel utilization
// ---------------------------------------------------------------------------

/**
 * Per-vessel utilization computed from `ais_positions`. activeMs is the
 * portion of [fromMs, toMs) covered by consecutive-position segments whose
 * average SOG > 0.5 kn. totalMs is the portion covered by ANY consecutive
 * pair (i.e. the in-service window). Gaps > 10 min are excluded from both
 * sides so an AIS outage doesn't artificially deflate utilization.
 */
export function getVesselUtilization(
  db: Database,
  fromMs: number,
  toMs: number,
  options: { mmsi?: number } = {},
): UtilizationRow[] {
  const MAX_GAP_MS = 10 * 60 * 1_000;
  const SOG_ACTIVE_KN = 0.5;

  const params: Array<number> = [fromMs, toMs];
  let where = 'timestamp >= ? AND timestamp < ?';
  if (options.mmsi !== undefined) {
    where += ' AND mmsi = ?';
    params.push(options.mmsi);
  }

  const rows = db
    .prepare(
      `SELECT mmsi, timestamp, sog FROM ais_positions
        WHERE ${where}
        ORDER BY mmsi ASC, timestamp ASC`,
    )
    .all(...params) as Array<{ mmsi: number; timestamp: number; sog: number }>;

  const byVessel = new Map<number, Array<{ timestamp: number; sog: number }>>();
  for (const r of rows) {
    const arr = byVessel.get(r.mmsi) ?? [];
    arr.push({ timestamp: r.timestamp, sog: r.sog });
    byVessel.set(r.mmsi, arr);
  }

  const result: UtilizationRow[] = [];
  for (const [mmsi, positions] of byVessel) {
    let activeMs = 0;
    let totalMs = 0;
    for (let i = 1; i < positions.length; i++) {
      const dt = positions[i].timestamp - positions[i - 1].timestamp;
      if (dt <= 0 || dt > MAX_GAP_MS) continue;
      totalMs += dt;
      const avgSog = (positions[i].sog + positions[i - 1].sog) / 2;
      if (avgSog > SOG_ACTIVE_KN) activeMs += dt;
    }
    result.push({
      mmsi,
      activeMs,
      totalMs,
      utilizationPct: totalMs > 0 ? activeMs / totalMs : 0,
      sampleSize: positions.length,
    });
  }
  return result.sort((a, b) => a.mmsi - b.mmsi);
}

// ---------------------------------------------------------------------------
// Disruptions
// ---------------------------------------------------------------------------

/**
 * Ferry-status disruption episodes within the window. A disruption is any
 * event whose status is 'alert' or 'closed'. duration_ms is computed as the
 * gap to the next event of any status (or to `toMs` if the disruption is
 * still active at the end of the window).
 */
export function getDisruptions(
  db: Database,
  fromMs: number,
  toMs: number,
): DisruptionEvent[] {
  // Pull all events overlapping the window so we can pair durations.
  const events = db
    .prepare(
      `SELECT status, message, reason, detected_at, parsed_times
         FROM ferry_events
        WHERE detected_at < ?
        ORDER BY detected_at ASC`,
    )
    .all(toMs) as Array<{
      status: string;
      message: string | null;
      reason: string | null;
      detected_at: number;
      parsed_times: string;
    }>;

  const result: DisruptionEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (evt.status !== 'alert' && evt.status !== 'closed') continue;
    const next = events[i + 1];
    const endAt = next ? next.detected_at : toMs;
    const start = Math.max(evt.detected_at, fromMs);
    const end = Math.min(endAt, toMs);
    if (end <= fromMs) continue;
    if (start >= toMs) continue;
    let parsedTimes: string[] = [];
    try {
      const parsed = JSON.parse(evt.parsed_times) as unknown;
      if (Array.isArray(parsed)) {
        parsedTimes = parsed.filter((s): s is string => typeof s === 'string');
      }
    } catch {
      parsedTimes = [];
    }
    result.push({
      status: evt.status,
      reason: evt.reason,
      message: evt.message,
      detectedAt: evt.detected_at,
      durationMs: end - start,
      parsedTimes,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

/**
 * AIS data-quality summary: total positions, longest gap, gap count
 * (consecutive positions > 5 min apart), recent provider transitions, and
 * approximate uptime%.
 */
export function getDataQuality(
  db: Database,
  fromMs: number,
  toMs: number,
): DataQualitySummary {
  const GAP_THRESHOLD_MS = 5 * 60 * 1_000;

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ais_positions
        WHERE timestamp >= ? AND timestamp < ?`,
    )
    .get(fromMs, toMs) as { c: number };

  const timestamps = db
    .prepare(
      `SELECT DISTINCT timestamp FROM ais_positions
        WHERE timestamp >= ? AND timestamp < ?
        ORDER BY timestamp ASC`,
    )
    .all(fromMs, toMs) as Array<{ timestamp: number }>;

  let longestGapMs: number | null = null;
  let gapCount = 0;
  let coveredMs = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i].timestamp - timestamps[i - 1].timestamp;
    if (gap <= 0) continue;
    if (gap > GAP_THRESHOLD_MS) gapCount++;
    if (longestGapMs === null || gap > longestGapMs) longestGapMs = gap;
    if (gap <= GAP_THRESHOLD_MS) coveredMs += gap;
  }

  const transitions = db
    .prepare(
      `SELECT transition, from_provider AS "from", to_provider AS "to", timestamp
         FROM provider_state
        WHERE timestamp >= ? AND timestamp < ?
        ORDER BY timestamp ASC`,
    )
    .all(fromMs, toMs) as ProviderTransition[];

  const windowMs = Math.max(0, toMs - fromMs);
  const uptimePct = windowMs > 0 && timestamps.length > 1 ? Math.min(1, coveredMs / windowMs) : null;

  return {
    totalPositions: totalRow.c,
    longestGapMs,
    gapCount,
    providerTransitions: transitions,
    uptimePct,
  };
}

// ---------------------------------------------------------------------------
// Dock presence heatmap
// ---------------------------------------------------------------------------

/**
 * % of positions inside a dock geofence (150 m radius, matches trip
 * inference) bucketed by (mmsi, dock_id, hour-of-day-UTC).
 */
export function getDockPresenceHeatmap(
  db: Database,
  fromMs: number,
  toMs: number,
  options: { mmsi?: number } = {},
): DockPresenceCell[] {
  const DOCK_RADIUS_M = 150;
  const params: Array<number> = [fromMs, toMs];
  let where = 'timestamp >= ? AND timestamp < ?';
  if (options.mmsi !== undefined) {
    where += ' AND mmsi = ?';
    params.push(options.mmsi);
  }
  const rows = db
    .prepare(
      `SELECT mmsi, timestamp, latitude, longitude FROM ais_positions
        WHERE ${where}`,
    )
    .all(...params) as Array<{
      mmsi: number;
      timestamp: number;
      latitude: number;
      longitude: number;
    }>;

  // Keyed by `${mmsi}|${dockId}|${hour}` → { atDock, total }
  // We also track per-mmsi-hour totals so pct = atDock / vesselHourTotal.
  const cellAt = new Map<string, number>();
  const vesselHourTotal = new Map<string, number>();
  const dockSeen = new Map<string, { mmsi: number; dockId: string; hour: number }>();

  for (const row of rows) {
    const hour = new Date(row.timestamp).getUTCHours();
    const vesselHourKey = `${row.mmsi}|${hour}`;
    vesselHourTotal.set(vesselHourKey, (vesselHourTotal.get(vesselHourKey) ?? 0) + 1);

    for (const dock of DOCKS) {
      const dist = haversineMeters(
        row.latitude,
        row.longitude,
        dock.coordinates[1],
        dock.coordinates[0],
      );
      if (dist < DOCK_RADIUS_M) {
        const key = `${row.mmsi}|${dock.id}|${hour}`;
        cellAt.set(key, (cellAt.get(key) ?? 0) + 1);
        dockSeen.set(key, { mmsi: row.mmsi, dockId: dock.id, hour });
        break;
      }
    }
  }

  const cells: DockPresenceCell[] = [];
  for (const [key, info] of dockSeen) {
    const at = cellAt.get(key) ?? 0;
    const total = vesselHourTotal.get(`${info.mmsi}|${info.hour}`) ?? 0;
    cells.push({
      mmsi: info.mmsi,
      dockId: info.dockId,
      hour: info.hour,
      pctTime: total > 0 ? at / total : 0,
      sampleSize: total,
    });
  }
  return cells.sort((a, b) => {
    if (a.mmsi !== b.mmsi) return a.mmsi - b.mmsi;
    if (a.dockId !== b.dockId) return a.dockId < b.dockId ? -1 : 1;
    return a.hour - b.hour;
  });
}

// ---------------------------------------------------------------------------
// Trip anomalies
// ---------------------------------------------------------------------------

/**
 * Trips outside [p10, p90] of their route's duration distribution within the
 * range. Routes with sample size < 10 contribute no anomalies (insufficient
 * data for the percentile cutoffs).
 */
export function getTripAnomalies(
  db: Database,
  fromMs: number,
  toMs: number,
  filter: TripFilter = {},
): TripAnomaly[] {
  const MIN_SAMPLE = 10;
  const quantiles = getTripDurationQuantiles(db, fromMs, toMs, filter);
  const quantilesByRoute = new Map<string, TripDurationQuantile>();
  for (const q of quantiles) {
    if (q.sampleSize >= MIN_SAMPLE) {
      quantilesByRoute.set(`${q.fromDock}|${q.toDock}`, q);
    }
  }
  if (quantilesByRoute.size === 0) return [];

  const trips = getTripsInRange(db, fromMs, toMs, filter);
  const anomalies: TripAnomaly[] = [];
  for (const t of trips) {
    const q = quantilesByRoute.get(`${t.from_dock}|${t.to_dock}`);
    if (!q) continue;
    if (t.duration_s > q.p90Sec || t.duration_s < q.p10Sec) {
      anomalies.push({
        tripId: t.id,
        mmsi: t.mmsi,
        fromDock: t.from_dock,
        toDock: t.to_dock,
        startAt: t.start_at,
        endAt: t.end_at,
        durationSec: t.duration_s,
        expectedP10Sec: q.p10Sec,
        expectedP50Sec: q.p50Sec,
        expectedP90Sec: q.p90Sec,
        anomalyType: t.duration_s > q.p90Sec ? 'slow' : 'fast',
      });
    }
  }
  return anomalies.sort((a, b) => a.startAt - b.startAt);
}

// ---------------------------------------------------------------------------
// Summary / rollups
// ---------------------------------------------------------------------------

/**
 * Read daily_rollups in [fromDateUtc, toDateUtc] inclusive. Used by the
 * summary endpoint when range spans whole days.
 */
export function getDailyRollups(
  db: Database,
  fromDateUtc: string,
  toDateUtc: string,
): DailyRollupReadRow[] {
  const rows = db
    .prepare(
      `SELECT date, total_positions, vessels_active, avg_sog, max_sog,
              service_status_minutes_open, service_status_minutes_alert,
              service_status_minutes_closed, schedule_adherence_score
         FROM daily_rollups
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC`,
    )
    .all(fromDateUtc, toDateUtc) as Array<{
      date: string;
      total_positions: number;
      vessels_active: number;
      avg_sog: number | null;
      max_sog: number | null;
      service_status_minutes_open: number;
      service_status_minutes_alert: number;
      service_status_minutes_closed: number;
      schedule_adherence_score: number | null;
    }>;
  return rows.map((r) => ({
    date: r.date,
    totalPositions: r.total_positions,
    vesselsActive: r.vessels_active,
    avgSog: r.avg_sog,
    maxSog: r.max_sog,
    serviceMinutesOpen: r.service_status_minutes_open,
    serviceMinutesAlert: r.service_status_minutes_alert,
    serviceMinutesClosed: r.service_status_minutes_closed,
    scheduleAdherenceScore: r.schedule_adherence_score,
  }));
}

/**
 * Aggregate stat-card payload for the summary endpoint. Combines trip
 * counts, on-time rate (from adherence), avg SOG, vessels seen, and ferry
 * service uptime across the window.
 */
export function getAnalyticsSummary(
  db: Database,
  fromMs: number,
  toMs: number,
): AnalyticsSummary {
  const trips = getTripsInRange(db, fromMs, toMs);
  const tripsCount = trips.length;
  const durations = trips.map((t) => t.duration_s).sort((a, b) => a - b);
  const medianTripSec = durations.length > 0 ? quantile(durations, 0.5) : null;

  const sogRow = db
    .prepare(
      `SELECT AVG(sog) AS avg_sog, COUNT(DISTINCT mmsi) AS vessels, COUNT(*) AS positions
         FROM ais_positions
        WHERE timestamp >= ? AND timestamp < ?`,
    )
    .get(fromMs, toMs) as { avg_sog: number | null; vessels: number; positions: number };

  // On-time rate: from adherence — trips arriving within ±3 min are on-time.
  const adherence = getScheduleAdherenceByHourOfWeek(db, fromMs, toMs);
  let onTimeRate: number | null = null;
  if (adherence.length > 0) {
    let totalSample = 0;
    let weightedOnTime = 0;
    const trips2 = getTripsInRange(db, fromMs, toMs);
    // bucket map already encodes median per bucket; for on-time we want
    // share of trips with |delay| <= 180s. Recompute via raw event matching
    // is heavy — approximate by treating buckets with median |delay|<=180 as on-time.
    for (const b of adherence) {
      totalSample += b.sampleSize;
      if (Math.abs(b.medianDelaySec) <= 180) {
        weightedOnTime += b.sampleSize;
      }
    }
    onTimeRate = totalSample > 0 ? weightedOnTime / totalSample : null;
    void trips2;
  }

  // Service uptime: minutes 'open' / total window minutes from ferry_events.
  const disruptions = getDisruptions(db, fromMs, toMs);
  const downMs = disruptions.reduce((acc, d) => acc + (d.durationMs ?? 0), 0);
  const windowMs = Math.max(0, toMs - fromMs);
  const serviceUptimePct = windowMs > 0 ? Math.max(0, 1 - downMs / windowMs) : null;
  const alertsCount = disruptions.length;

  return {
    tripsCount,
    onTimeRate,
    medianTripSec,
    avgSogKn: sogRow.positions > 0 ? sogRow.avg_sog : null,
    vesselsOnDuty: sogRow.vessels,
    serviceUptimePct,
    alertsCount,
    totalPositions: sogRow.positions,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Linear-interpolation quantile over a pre-sorted ascending number array.
 * For empty input returns 0. q is clamped to [0, 1].
 */
export function quantile(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const p = Math.min(1, Math.max(0, q));
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}
