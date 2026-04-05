/**
 * Cached proxy to the Environment Canada GeoMet OGC API for real-time
 * surface weather observations at Billy Bishop Toronto City Airport (CYTZ).
 *
 * Upstream: https://api.weather.gc.ca/collections/swob-realtime/items
 * Station:  CYTZ — WMO 71265, MSC/Climate ID 6158359
 *           Billy Bishop Toronto City Airport, 43.6274°N 79.3962°W
 *
 * The route caches the upstream response for CACHE_TTL_MS (5 minutes) to
 * avoid hammering the public API on every client poll.  If the upstream
 * fails and stale data is available it is returned with the warning header
 * X-Cache: stale.
 */

import { Router, Request, Response } from 'express';

export const weatherRouter = Router();

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: unknown;
  fetchedAt: number; // Date.now()
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache: CacheEntry | null = null;

// ---------------------------------------------------------------------------
// Upstream URL
// ---------------------------------------------------------------------------

/**
 * Bounding box centred on Billy Bishop Toronto City Airport (CYTZ).
 * Degrees: west, south, east, north — tight enough to return only CYTZ
 * observations while being resilient to minor coordinate drift.
 *
 * Returns the single most-recent observation (limit=1).
 */
const UPSTREAM_URL =
  'https://api.weather.gc.ca/collections/swob-realtime/items' +
  '?bbox=-79.42,43.61,-79.37,43.64&limit=1&f=json';

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

weatherRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const now = Date.now();

  // 1. Serve from cache if still fresh
  if (cache !== null && now - cache.fetchedAt < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'hit');
    res.json(cache.data);
    return;
  }

  // 2. Fetch from upstream
  try {
    const upstream = await fetch(UPSTREAM_URL, {
      headers: { Accept: 'application/json' },
    });

    if (!upstream.ok) {
      throw new Error(
        `Upstream responded ${upstream.status} ${upstream.statusText}`,
      );
    }

    const data: unknown = await upstream.json();

    // Store in cache
    cache = { data, fetchedAt: now };

    res.setHeader('X-Cache', 'miss');
    res.json(data);
  } catch (err) {
    // 3. Upstream failed — return stale data if available
    if (cache !== null) {
      res.setHeader('X-Cache', 'stale');
      res.json(cache.data);
      return;
    }

    // No cache at all — return 503
    console.error('[weatherRouter] Upstream fetch failed:', err);
    res.status(503).json({ error: 'Weather data temporarily unavailable' });
  }
});
