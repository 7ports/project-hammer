import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

const CKAN_URL =
  'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search' +
  '?resource_id=0da005de-270d-49d1-b45b-32e2e777a381&limit=8&sort=Timestamp%20desc';

// In-memory cache — refresh every 15 minutes (data updates hourly, so this is fine)
interface CacheEntry {
  data: BusynessResponse;
  fetchedAt: number;
}
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

export type BusynessLevel = 'quiet' | 'moderate' | 'busy' | 'very-busy';

interface BusynessResponse {
  level: BusynessLevel;
  recentRedemptionsPerHour: number | null; // null if API unavailable/stale
  dataTimestamp: string | null;            // ISO timestamp of most recent record
  source: 'api' | 'heuristic';
}

// Thresholds based on 11-year ridership patterns (18k/day peak summer ~= 150/15min peak)
// These are aggregate redemptions across all routes in the most recent hour
function levelFromRedemptions(perHour: number): BusynessLevel {
  if (perHour < 40)  return 'quiet';
  if (perHour < 200) return 'moderate';
  if (perHour < 600) return 'busy';
  return 'very-busy';
}

// Deterministic heuristic fallback (aggregate only)
function heuristicLevel(): BusynessLevel {
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay();
  const month = now.getMonth();
  const isWeekend = dow === 0 || dow === 6;
  const isSummer = month >= 5 && month <= 7;
  const isShoulderSeason = (month >= 3 && month <= 4) || (month >= 8 && month <= 9);
  const isPeakHour = hour >= 10 && hour <= 18;
  const isMidday = hour >= 11 && hour <= 15;
  const isWinter = !isSummer && !isShoulderSeason;

  if (isSummer && isWeekend && isPeakHour) return 'very-busy';
  if (isSummer && (isWeekend || isMidday)) return 'busy';
  if (isShoulderSeason && isWeekend && isPeakHour) return 'busy';
  if (isShoulderSeason && isMidday) return 'moderate';
  if (isWinter) return isWeekend && isMidday ? 'moderate' : 'quiet';
  return 'moderate';
}

async function fetchBusyness(): Promise<BusynessResponse> {
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

    const records = json.result?.records ?? [];
    if (records.length === 0) throw new Error('No records');

    // Sum redemptions across the last 4 records (= ~1 hour of 15-min intervals)
    const recent = records.slice(0, 4);
    const perHour = recent.reduce((sum, r) => sum + (r['Redemption Count'] ?? 0), 0);
    const dataTimestamp = records[0].Timestamp;

    // Only trust the data if it's less than 14 hours old (handles overnight lag)
    const dataAge = Date.now() - new Date(dataTimestamp).getTime();
    const isStale = dataAge > 14 * 60 * 60 * 1000;

    const data: BusynessResponse = isStale
      ? { level: heuristicLevel(), recentRedemptionsPerHour: null, dataTimestamp, source: 'heuristic' }
      : { level: levelFromRedemptions(perHour), recentRedemptionsPerHour: perHour, dataTimestamp, source: 'api' };

    cache = { data, fetchedAt: Date.now() };
    return data;
  } catch {
    // API unavailable — fall back to heuristic
    const data: BusynessResponse = {
      level: heuristicLevel(),
      recentRedemptionsPerHour: null,
      dataTimestamp: null,
      source: 'heuristic',
    };
    cache = { data, fetchedAt: Date.now() };
    return data;
  }
}

router.get('/', async (_req: Request, res: Response) => {
  const data = await fetchBusyness();
  res.json(data);
});

export default router;
