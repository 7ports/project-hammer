/**
 * Proxy route for the City of Toronto live ferry service status.
 *
 * Upstream: https://www.toronto.ca/data/parks/live/ferry.json
 * Mounted at /api/ferry-status in index.ts
 *
 * The City endpoint lacks CORS headers, so the browser cannot call it
 * directly. This handler fetches it server-side, extracts the Jack Layton
 * Ferry Terminal asset (LocationID 3789), normalises the response to a
 * typed FerryStatusResponse, and caches the result for 60 seconds.
 *
 * Status codes from the City:
 *   0 = closed
 *   1 = open
 *   2 = alert / disruption
 */

import { Router } from 'express';
import type { Request, Response } from 'express';

const FERRY_STATUS_URL = 'https://www.toronto.ca/data/parks/live/ferry.json';
const FERRY_LOCATION_ID = 3789;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CityAsset {
  LocationID: number;
  AssetID: number;
  PostedDate: string;
  AssetName: string;
  SeasonStart: string | null;
  SeasonEnd: string | null;
  Reason: string | null;
  Comments: string | null;
  Status: number;
}

interface CityFerryResponse {
  assets: CityAsset[];
}

export interface FerryStatusResponse {
  status: 'open' | 'alert' | 'closed' | 'unknown';
  reason: string | null;
  message: string | null;
  postedAt: string | null;
  source: 'live' | 'error';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function mapStatus(code: number): FerryStatusResponse['status'] {
  if (code === 0) return 'closed';
  if (code === 1) return 'open';
  if (code === 2) return 'alert';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const upstream = await fetch(FERRY_STATUS_URL, {
      headers: { 'User-Agent': 'toronto-ferry-tracker/2.0' },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      throw new Error(`Upstream returned ${upstream.status}`);
    }

    const data = (await upstream.json()) as CityFerryResponse;
    const asset = data.assets.find(a => a.LocationID === FERRY_LOCATION_ID);

    if (!asset) {
      const response: FerryStatusResponse = {
        status: 'unknown',
        reason: null,
        message: null,
        postedAt: null,
        source: 'live',
      };
      res.json(response);
      return;
    }

    // Parse PostedDate as Eastern Standard Time (UTC-5).
    // The City API returns a naive datetime string ("2026-04-03 20:57:57")
    // with no timezone indicator — it is always Eastern Time.
    const postedAt = asset.PostedDate
      ? new Date(asset.PostedDate.replace(' ', 'T') + '-05:00').toISOString()
      : null;

    const response: FerryStatusResponse = {
      status: mapStatus(asset.Status),
      reason: asset.Reason ?? null,
      message: asset.Comments ? stripHtml(asset.Comments) : null,
      postedAt,
      source: 'live',
    };

    // Cache for 60 seconds — status changes infrequently
    res.set('Cache-Control', 'public, max-age=60');
    res.json(response);
  } catch (err) {
    console.error('[ferry-status] upstream fetch failed:', err);
    // Always return 200 — the client inspects `source: 'error'` to decide
    // whether to show a degraded UI rather than treating this as a hard failure.
    const fallback: FerryStatusResponse = {
      status: 'unknown',
      reason: null,
      message: null,
      postedAt: null,
      source: 'error',
    };
    res.status(200).json(fallback);
  }
});

export default router;
