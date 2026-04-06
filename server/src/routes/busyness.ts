import { Router } from 'express';
import type { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const router = Router();

const CKAN_URL =
  'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search' +
  '?resource_id=0da005de-270d-49d1-b45b-32e2e777a381&limit=32&sort=Timestamp%20desc';

// In-memory cache — refresh every 15 minutes
interface CacheEntry {
  data: RidershipResponse;
  fetchedAt: number;
}
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

export type BusynessLevel = 'quiet' | 'moderate' | 'busy' | 'very-busy';

interface RidershipRecord {
  timestamp: string;    // ISO 8601
  redemptions: number;
}

interface RidershipResponse {
  records: RidershipRecord[];
  dataTimestamp: string | null;   // most recent record timestamp (may be hours old)
  dataAgeHours: number | null;    // how many hours ago was the most recent record
  computedLevel: BusynessLevel | null;
  bucketsLoaded: number;
}

// ---------------------------------------------------------------------------
// Load historical median buckets
// ---------------------------------------------------------------------------

interface MedianBucket {
  hour: number;
  dow: number;
  month: number;
  p50: number;
  p75: number;
  p90: number;
  samples: number;
}

interface MedianFile {
  generatedAt: string;
  source: string;
  buckets: MedianBucket[];
}

function loadMedianBuckets(): Map<string, { p50: number; p75: number; p90: number }> {
  try {
    const filePath = resolve(__dirname, '../data/ridershipMedians.json');
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as MedianFile;
    const map = new Map<string, { p50: number; p75: number; p90: number }>();
    for (const b of parsed.buckets) {
      const key = `${b.hour}:${b.dow}:${b.month}`;
      map.set(key, { p50: b.p50, p75: b.p75, p90: b.p90 });
    }
    console.log(`[busyness] Loaded ${map.size} historical median buckets`);
    return map;
  } catch (err) {
    console.warn('[busyness] Could not load ridershipMedians.json — falling back to heuristic', err);
    return new Map();
  }
}

// Load once at module startup
const medianBuckets = loadMedianBuckets();

// ---------------------------------------------------------------------------
// Data-driven level computation
// ---------------------------------------------------------------------------

function computeDataDrivenLevel(
  records: RidershipRecord[],
  buckets: Map<string, { p50: number; p75: number; p90: number }>,
): BusynessLevel | null {
  if (records.length === 0 || buckets.size === 0) return null;

  // Use the most recent record (records are in chronological order)
  const latest = records[records.length - 1];
  const ts = new Date(latest.timestamp);
  if (isNaN(ts.getTime())) return null;

  const hour = ts.getHours();
  const dow = ts.getDay();
  const month = ts.getMonth() + 1; // CKAN month is 1-indexed

  const key = `${hour}:${dow}:${month}`;
  const bucket = buckets.get(key);
  if (!bucket) return null;

  const count = latest.redemptions;
  if (count <= bucket.p50) return 'quiet';
  if (count <= bucket.p75) return 'moderate';
  if (count <= bucket.p90) return 'busy';
  return 'very-busy';
}

// ---------------------------------------------------------------------------
// CKAN fetch
// ---------------------------------------------------------------------------

async function fetchRidership(): Promise<RidershipResponse> {
  // Check cache first
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const res = await fetch(CKAN_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`CKAN HTTP ${res.status}`);

    const json = await res.json() as {
      result?: {
        records?: Array<{ Timestamp: string; 'Redemption Count': number }>;
      };
    };

    const raw = json.result?.records ?? [];
    if (raw.length === 0) throw new Error('No records');

    // Reverse from desc to chronological order for charting
    const records: RidershipRecord[] = raw
      .slice()
      .reverse()
      .map((r) => ({
        timestamp: r.Timestamp,
        redemptions: r['Redemption Count'] ?? 0,
      }));

    const dataTimestamp = raw[0].Timestamp;
    const dataAgeHours = (Date.now() - new Date(dataTimestamp).getTime()) / (60 * 60 * 1000);
    const computedLevel = computeDataDrivenLevel(records, medianBuckets);

    const data: RidershipResponse = {
      records,
      dataTimestamp,
      dataAgeHours,
      computedLevel,
      bucketsLoaded: medianBuckets.size,
    };
    cache = { data, fetchedAt: Date.now() };
    return data;
  } catch {
    const data: RidershipResponse = {
      records: [],
      dataTimestamp: null,
      dataAgeHours: null,
      computedLevel: null,
      bucketsLoaded: medianBuckets.size,
    };
    cache = { data, fetchedAt: Date.now() };
    return data;
  }
}

router.get('/', async (_req: Request, res: Response) => {
  const data = await fetchRidership();
  res.json(data);
});

export default router;
