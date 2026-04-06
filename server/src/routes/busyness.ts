import { Router } from 'express';
import type { Request, Response } from 'express';

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

interface RidershipRecord {
  timestamp: string;    // ISO 8601
  redemptions: number;
}

interface RidershipResponse {
  records: RidershipRecord[];
  dataTimestamp: string | null;   // most recent record timestamp (may be hours old)
  dataAgeHours: number | null;    // how many hours ago was the most recent record
}

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

    const data: RidershipResponse = { records, dataTimestamp, dataAgeHours };
    cache = { data, fetchedAt: Date.now() };
    return data;
  } catch {
    const data: RidershipResponse = { records: [], dataTimestamp: null, dataAgeHours: null };
    cache = { data, fetchedAt: Date.now() };
    return data;
  }
}

router.get('/', async (_req: Request, res: Response) => {
  const data = await fetchRidership();
  res.json(data);
});

export default router;
