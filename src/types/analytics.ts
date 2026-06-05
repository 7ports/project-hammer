/**
 * Response shapes for `/api/analytics/*` endpoints.
 * Mirrors the server-side types in `server/src/lib/storage/queries.ts`.
 * The server always wraps payloads in `{ data, generatedAt, cached }`.
 */

export interface AnalyticsEnvelope<T> {
  data: T;
  generatedAt: string;
  cached: boolean;
  error?: string;
}

export interface RangeWindow {
  key: string;
  days?: number;
  fromMs: number;
  toMs: number;
}

export type RangeKey = '1d' | '7d' | '30d' | '90d';

// ── /summary ────────────────────────────────────────────────────────────────
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

export interface SummaryPayload {
  range: RangeWindow;
  summary: AnalyticsSummary;
}

// ── /trips ─────────────────────────────────────────────────────────────────
export interface TripCountBucket {
  bucket: string;
  count: number;
}

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

export interface TripsPayload {
  range: RangeWindow;
  granularity: 'hour' | 'day';
  series: TripCountBucket[];
  tripsCount: number;
  trips: TripRow[];
}

// ── /trip-duration ─────────────────────────────────────────────────────────
export interface TripDurationQuantile {
  fromDock: string;
  toDock: string;
  p10Sec: number;
  p50Sec: number;
  p90Sec: number;
  sampleSize: number;
}

export interface TripDurationPayload {
  range: RangeWindow;
  routes: TripDurationQuantile[];
}

// ── /utilization ───────────────────────────────────────────────────────────
export interface UtilizationRow {
  mmsi: number;
  activeMs: number;
  totalMs: number;
  utilizationPct: number;
  sampleSize: number;
}

export interface UtilizationPayload {
  range: RangeWindow;
  vessels: UtilizationRow[];
}

// ── /dwell ─────────────────────────────────────────────────────────────────
export interface DwellStat {
  dockId: string;
  mmsi: number;
  medianDwellSec: number;
  p90DwellSec: number;
  sampleSize: number;
}

export interface DwellPayload {
  range: RangeWindow;
  stats: DwellStat[];
}

// ── /disruptions ───────────────────────────────────────────────────────────
export interface DisruptionEvent {
  status: string;
  reason: string | null;
  message: string | null;
  detectedAt: number;
  durationMs: number | null;
  parsedTimes: string[];
}

export interface DisruptionsPayload {
  range: RangeWindow;
  events: DisruptionEvent[];
  count: number;
}

// ── /data-quality ──────────────────────────────────────────────────────────
export interface ProviderTransition {
  transition: string;
  from: string | null;
  to: string | null;
  timestamp: number;
}

export interface DataQualityPayload {
  range: RangeWindow;
  totalPositions: number;
  longestGapMs: number | null;
  gapCount: number;
  providerTransitions: ProviderTransition[];
  uptimePct: number | null;
}
