/**
 * /api/llm/* — LLM-generated vessel summaries and disruption narratives.
 *
 * Both endpoints share the same shape:
 *   - POST JSON body, returns JSON.
 *   - 503 "LLM disabled" if ANTHROPIC_API_KEY is missing (no crash).
 *   - 429 "Rate limited" when the per-endpoint token bucket is empty
 *     (5 calls/sec sustained).
 *   - 1-minute TTL cache keyed by SHA-256 of the canonicalised input —
 *     a re-fetch of the same vessel doesn't re-call Claude.
 *   - 502 if the Anthropic SDK throws.
 *
 * Mounted at /api/llm in server/src/index.ts.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { TokenBucket } from '../lib/llm/tokenBucket';
import { TtlCache } from '../lib/llm/cache';
import { isLlmEnabled, LlmDisabledError } from '../lib/llm/client';
import {
  generateVesselSummary,
  type VesselSummaryInput,
  type VesselSummaryResult,
} from '../lib/llm/vesselSummary';
import {
  generateDisruptionNarrative,
  type DisruptionNarrativeInput,
  type DisruptionNarrativeResult,
} from '../lib/llm/disruptionNarrative';

// ---------------------------------------------------------------------------
// Rate limiters (one bucket per endpoint, 5 req/sec sustained)
// ---------------------------------------------------------------------------

const RATE_LIMIT_PER_SEC = 5;

const vesselSummaryBucket = new TokenBucket(RATE_LIMIT_PER_SEC, RATE_LIMIT_PER_SEC);
const disruptionNarrativeBucket = new TokenBucket(
  RATE_LIMIT_PER_SEC,
  RATE_LIMIT_PER_SEC,
);

// ---------------------------------------------------------------------------
// Caches (1-minute TTL)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;

const vesselSummaryCache = new TtlCache<VesselSummaryResult>(CACHE_TTL_MS);
const disruptionNarrativeCache = new TtlCache<DisruptionNarrativeResult>(CACHE_TTL_MS);

// ---------------------------------------------------------------------------
// Test seam: reset all in-memory state.
// ---------------------------------------------------------------------------

export function _resetLlmRouteState(): void {
  vesselSummaryBucket._reset();
  disruptionNarrativeBucket._reset();
  vesselSummaryCache._clear();
  disruptionNarrativeCache._clear();
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function parseVesselInput(body: unknown): VesselSummaryInput | null {
  if (!isObject(body)) return null;
  const vessel = body['vessel'];
  if (!isObject(vessel)) return null;
  const name = vessel['name'];
  const status = vessel['status'];
  const nearestDock = vessel['nearestDock'];
  if (typeof name !== 'string' || typeof status !== 'string' || typeof nearestDock !== 'string') {
    return null;
  }
  return {
    name,
    status,
    nearestDock,
    sog: numberOrNull(vessel['sog']),
    cog: numberOrNull(vessel['cog']),
    destination: stringOrNull(vessel['destination']),
    departedFrom: stringOrNull(vessel['departedFrom']),
    etaMinutes: numberOrNull(vessel['etaMinutes']),
    nextDepartureAt: stringOrNull(vessel['nextDepartureAt']),
    destinationConfidence: numberOrNull(vessel['destinationConfidence']),
    destinationReasons: stringArrayOrUndefined(vessel['destinationReasons']),
  };
}

function parseDisruptionInput(body: unknown): DisruptionNarrativeInput | null {
  if (!isObject(body)) return null;
  const disruption = body['disruption'];
  if (!isObject(disruption)) return null;
  const status = disruption['status'];
  if (status !== 'alert' && status !== 'closed') return null;
  const parsedTimes = disruption['parsedTimes'];
  return {
    status,
    reason: stringOrNull(disruption['reason']),
    message: stringOrNull(disruption['message']),
    parsedTimes: Array.isArray(parsedTimes)
      ? parsedTimes.filter((t): t is string => typeof t === 'string')
      : [],
    postedAt: stringOrNull(disruption['postedAt']),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((v): v is string => typeof v === 'string');
  return strings.length > 0 ? strings : undefined;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router = Router();

router.post('/vessel-summary', async (req: Request, res: Response) => {
  if (!isLlmEnabled()) {
    res.status(503).json({ error: 'LLM disabled' });
    return;
  }

  const input = parseVesselInput(req.body);
  if (!input) {
    res.status(400).json({ error: 'Invalid input — expected { vessel: { name, status, nearestDock, ... } }' });
    return;
  }

  const cacheKey = TtlCache.hashKey(input);
  const cached = vesselSummaryCache.get(cacheKey);
  if (cached !== null) {
    res.set('X-LLM-Cache', 'HIT');
    res.json(cached);
    return;
  }

  if (!vesselSummaryBucket.tryConsume()) {
    res.status(429).json({ error: 'Rate limited — try again shortly' });
    return;
  }

  try {
    const result = await generateVesselSummary(input);
    vesselSummaryCache.set(cacheKey, result);
    res.set('X-LLM-Cache', 'MISS');
    res.json(result);
  } catch (err) {
    if (err instanceof LlmDisabledError) {
      res.status(503).json({ error: 'LLM disabled' });
      return;
    }
    console.error('[llm] vessel-summary failed:', err);
    res.status(502).json({ error: 'LLM upstream error' });
  }
});

router.post('/disruption-narrative', async (req: Request, res: Response) => {
  if (!isLlmEnabled()) {
    res.status(503).json({ error: 'LLM disabled' });
    return;
  }

  const input = parseDisruptionInput(req.body);
  if (!input) {
    res.status(400).json({ error: 'Invalid input — expected { disruption: { status, ... } }' });
    return;
  }

  const cacheKey = TtlCache.hashKey(input);
  const cached = disruptionNarrativeCache.get(cacheKey);
  if (cached !== null) {
    res.set('X-LLM-Cache', 'HIT');
    res.json(cached);
    return;
  }

  if (!disruptionNarrativeBucket.tryConsume()) {
    res.status(429).json({ error: 'Rate limited — try again shortly' });
    return;
  }

  try {
    const result = await generateDisruptionNarrative(input);
    disruptionNarrativeCache.set(cacheKey, result);
    res.set('X-LLM-Cache', 'MISS');
    res.json(result);
  } catch (err) {
    if (err instanceof LlmDisabledError) {
      res.status(503).json({ error: 'LLM disabled' });
      return;
    }
    console.error('[llm] disruption-narrative failed:', err);
    res.status(502).json({ error: 'LLM upstream error' });
  }
});

export default router;
