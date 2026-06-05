/**
 * /api/analytics/* — 10 read-only endpoints backed by `server/src/lib/storage`.
 *
 * All routes:
 *   - Parse a window from `?range=7d|30d|90d` (default 7d).
 *   - Read through storage helpers — no SQL is embedded here.
 *   - Return `{ data, generatedAt, cached }` per project-hammer-eea spec.
 *   - Set `Cache-Control` per the design report §6 (live=30s, rollup=300s).
 *   - Return a 503 envelope when the storage subsystem isn't initialised
 *     (matches the rest of the server's "best-effort persistence" posture).
 *
 * Mounted in src/index.ts at `/api/analytics`.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getAnalyticsSummary,
  getDataQuality,
  getDisruptions,
  getDockDwell,
  getDockPresenceHeatmap,
  getScheduleAdherenceByHourOfWeek,
  getTripAnomalies,
  getTripCounts,
  getTripDurationQuantiles,
  getTripsInRange,
  getVesselUtilization,
  isStorageInitialised,
  getDb,
} from '../lib/storage';

const router = Router();

/** Standard envelope returned by every analytics endpoint. */
interface Envelope<T> {
  data: T;
  generatedAt: string;
  cached: boolean;
}

const LIVE_CACHE = 'public, max-age=30';
const ROLLUP_CACHE = 'public, max-age=300';

const SUPPORTED_RANGES: Record<string, number> = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

interface RangeWindow {
  fromMs: number;
  toMs: number;
  rangeKey: string;
  days: number;
}

function parseRange(req: Request): RangeWindow {
  const raw = typeof req.query['range'] === 'string' ? req.query['range'] : '7d';
  const days = SUPPORTED_RANGES[raw] ?? SUPPORTED_RANGES['7d'];
  const toMs = Date.now();
  const fromMs = toMs - days * 24 * 60 * 60 * 1_000;
  return { fromMs, toMs, rangeKey: raw in SUPPORTED_RANGES ? raw : '7d', days };
}

function parseMmsi(req: Request): number | undefined {
  const raw = req.query['mmsi'];
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) ? n : undefined;
}

function parseString(req: Request, key: string): string | undefined {
  const raw = req.query[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function envelope<T>(data: T): Envelope<T> {
  return { data, generatedAt: new Date().toISOString(), cached: false };
}

function send<T>(res: Response, cache: string, data: T): void {
  res.set('Cache-Control', cache);
  res.json(envelope(data));
}

function notReady(res: Response): void {
  res.status(503).json({
    data: null,
    generatedAt: new Date().toISOString(),
    cached: false,
    error: 'STORAGE_UNAVAILABLE',
  });
}

function guarded(
  handler: (req: Request, res: Response) => void,
): (req: Request, res: Response) => void {
  return (req, res) => {
    if (!isStorageInitialised()) {
      notReady(res);
      return;
    }
    try {
      handler(req, res);
    } catch (err) {
      console.error('[analytics] handler threw:', err);
      res.status(500).json({
        data: null,
        generatedAt: new Date().toISOString(),
        cached: false,
        error: 'INTERNAL',
      });
    }
  };
}

// ---------------------------------------------------------------------------
// 1. /summary  — stat-card payload (live: trips today, on-time, etc.)
// ---------------------------------------------------------------------------

router.get(
  '/summary',
  guarded((req, res) => {
    const { fromMs, toMs, rangeKey, days } = parseRange(req);
    const summary = getAnalyticsSummary(getDb(), fromMs, toMs);
    send(res, LIVE_CACHE, {
      range: { key: rangeKey, days, fromMs, toMs },
      summary,
    });
  }),
);

// ---------------------------------------------------------------------------
// 2. /trips  — trip series with filters + granularity
// ---------------------------------------------------------------------------

router.get(
  '/trips',
  guarded((req, res) => {
    const { fromMs, toMs, rangeKey } = parseRange(req);
    const granularity = parseString(req, 'granularity') === 'hour' ? 'hour' : 'day';
    const filter = {
      mmsi: parseMmsi(req),
      fromDock: parseString(req, 'from_dock'),
      toDock: parseString(req, 'to_dock'),
    };
    const series = getTripCounts(getDb(), fromMs, toMs, granularity, filter);
    const trips = getTripsInRange(getDb(), fromMs, toMs, filter);
    send(res, LIVE_CACHE, {
      range: { key: rangeKey, fromMs, toMs },
      granularity,
      series,
      tripsCount: trips.length,
      trips: trips.slice(-200),
    });
  }),
);

// ---------------------------------------------------------------------------
// 3. /trip-duration  — quantiles per (from_dock, to_dock)
// ---------------------------------------------------------------------------

router.get(
  '/trip-duration',
  guarded((req, res) => {
    const { fromMs, toMs, rangeKey } = parseRange(req);
    const filter = {
      mmsi: parseMmsi(req),
      fromDock: parseString(req, 'from_dock'),
      toDock: parseString(req, 'to_dock'),
    };
    const quantiles = getTripDurationQuantiles(getDb(), fromMs, toMs, filter);
    send(res, ROLLUP_CACHE, {
      range: { key: rangeKey, fromMs, toMs },
      routes: quantiles,
    });
  }),
);

// ---------------------------------------------------------------------------
// 4. /adherence  — median delay by hour-of-week
// ---------------------------------------------------------------------------

router.get(
  '/adherence',
  guarded((req, res) => {
    const { fromMs, toMs, rangeKey } = parseRange(req);
    const filter = {
      mmsi: parseMmsi(req),
      fromDock: parseString(req, 'from_dock'),
      toDock: parseString(req, 'to_dock'),
    };
    const buckets = getScheduleAdherenceByHourOfWeek(getDb(), fromMs, toMs, filter);
    send(res, ROLLUP_CACHE, {
      range: { key: rangeKey, fromMs, toMs },
      granularity: 'hour-of-week',
      buckets,
    });
  }),
);

// ---------------------------------------------------------------------------
// 5. /dwell  — median + p90 dock dwell per (dock, mmsi)
// ---------------------------------------------------------------------------

router.get(
  '/dwell',
  guarded((req, res) => {
    const { fromMs, toMs, rangeKey } = parseRange(req);
    const dwell = getDockDwell(getDb(), fromMs, toMs, {
      mmsi: parseMmsi(req),
      dockId: parseString(req, 'dock_id'),
    });
    send(res, ROLLUP_CACHE, {
      range: { key: rangeKey, fromMs, toMs },
      stats: dwell,
    });
  }),
);

// ---------------------------------------------------------------------------
// 6. /utilization  — per-vessel hours active vs in service
// ---------------------------------------------------------------------------

router.get(
  '/utilization',
  guarded((req, res) => {
    const { fromMs, toMs, rangeKey } = parseRange(req);
    const rows = getVesselUtilization(getDb(), fromMs, toMs, {
      mmsi: parseMmsi(req),
    });
    send(res, ROLLUP_CACHE, {
      range: { key: rangeKey, fromMs, toMs },
      vessels: rows,
    });
  }),
);

// ---------------------------------------------------------------------------
// 7. /disruptions  — ferry-status alert/closed episodes
// ---------------------------------------------------------------------------

router.get(
  '/disruptions',
  guarded((req, res) => {
    const { fromMs, toMs, rangeKey } = parseRange(req);
    const events = getDisruptions(getDb(), fromMs, toMs);
    send(res, LIVE_CACHE, {
      range: { key: rangeKey, fromMs, toMs },
      events,
      count: events.length,
    });
  }),
);

// ---------------------------------------------------------------------------
// 8. /data-quality  — provider uptime + AIS gap stats
// ---------------------------------------------------------------------------

router.get(
  '/data-quality',
  guarded((req, res) => {
    const { fromMs, toMs, rangeKey } = parseRange(req);
    const summary = getDataQuality(getDb(), fromMs, toMs);
    send(res, LIVE_CACHE, {
      range: { key: rangeKey, fromMs, toMs },
      ...summary,
    });
  }),
);

// ---------------------------------------------------------------------------
// 9. /heatmap-dock-presence  — % time per (mmsi, dock, hour-of-day)
// ---------------------------------------------------------------------------

router.get(
  '/heatmap-dock-presence',
  guarded((req, res) => {
    const { fromMs, toMs, rangeKey } = parseRange(req);
    const cells = getDockPresenceHeatmap(getDb(), fromMs, toMs, {
      mmsi: parseMmsi(req),
    });
    send(res, ROLLUP_CACHE, {
      range: { key: rangeKey, fromMs, toMs },
      cells,
    });
  }),
);

// ---------------------------------------------------------------------------
// 10. /anomalies  — trips outside p10/p90 of their route's distribution
// ---------------------------------------------------------------------------

router.get(
  '/anomalies',
  guarded((req, res) => {
    const { fromMs, toMs, rangeKey } = parseRange(req);
    const filter = {
      mmsi: parseMmsi(req),
      fromDock: parseString(req, 'from_dock'),
      toDock: parseString(req, 'to_dock'),
    };
    const anomalies = getTripAnomalies(getDb(), fromMs, toMs, filter);
    send(res, ROLLUP_CACHE, {
      range: { key: rangeKey, fromMs, toMs },
      anomalies,
      count: anomalies.length,
    });
  }),
);

export default router;
