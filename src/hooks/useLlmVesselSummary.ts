/**
 * useLlmVesselSummary — fetches a Claude-Haiku-generated 1-2 sentence
 * summary of a vessel's current state.
 *
 * The endpoint is gated server-side on ANTHROPIC_API_KEY (503 "LLM
 * disabled" when unset) and client-side on VITE_LLM_FEATURES=true; this
 * hook short-circuits to { summary: null, ... } when the flag is off so
 * the call site never sees a render of an unwanted feature.
 *
 * The vessel is reduced to a small, stable payload before being POSTed
 * so the server cache (1 min TTL, hash-keyed) hits on identical state
 * across renders — re-renders driven by clock ticks alone do not trigger
 * new LLM calls.
 */

import { useEffect, useState } from 'react';
import { config } from '../lib/config';
import type { Vessel } from '../types/vessel';

export interface UseLlmVesselSummaryResult {
  summary: string | null;
  loading: boolean;
  /** "disabled" when the feature flag is off; "off" when the server returns 503. */
  error: 'disabled' | 'off' | 'rate-limited' | 'fetch-failed' | null;
}

interface VesselPayload {
  name: string;
  status: string;
  sog: number | null;
  cog: number | null;
  nearestDock: string;
  destination: string | null;
  departedFrom: string | null;
  etaMinutes: number | null;
  nextDepartureAt: string | null;
  destinationConfidence: number | null;
  destinationReasons: string[];
}

function toPayload(vessel: Vessel): VesselPayload {
  return {
    name: vessel.name,
    status: vessel.status,
    sog: vessel.sog ?? null,
    cog: vessel.cog ?? null,
    nearestDock: vessel.nearestDock.name,
    destination: vessel.destination?.name ?? null,
    departedFrom: vessel.departedFrom?.name ?? null,
    etaMinutes: vessel.etaMinutes ?? null,
    nextDepartureAt: vessel.nextDepartureAt ?? null,
    destinationConfidence: vessel.destinationConfidence ?? null,
    destinationReasons: vessel.destinationReasons ?? [],
  };
}

/**
 * Stable string key for the vessel state we care about — used as the
 * useEffect dependency so re-renders that don't change LLM-relevant
 * state don't trigger refetches.
 */
function vesselKey(p: VesselPayload): string {
  return [
    p.name,
    p.status,
    p.nearestDock,
    p.destination,
    p.departedFrom,
    p.etaMinutes,
    p.nextDepartureAt,
    p.destinationConfidence,
    p.destinationReasons.join('|'),
    // SOG/COG bucketed so tiny GPS jitter doesn't churn the cache.
    p.sog !== null ? Math.round(p.sog * 2) / 2 : null,
    p.cog !== null ? Math.round(p.cog / 5) * 5 : null,
  ].join('::');
}

export function useLlmVesselSummary(vessel: Vessel | null): UseLlmVesselSummaryResult {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UseLlmVesselSummaryResult['error']>(null);

  // Compute the payload + key outside the effect so we can use the key
  // (a primitive) as the dep instead of the object reference.
  const payload = vessel ? toPayload(vessel) : null;
  const key = payload ? vesselKey(payload) : null;

  useEffect(() => {
    if (!config.llmFeaturesEnabled) {
      setSummary(null);
      setError('disabled');
      return;
    }
    if (!payload) {
      setSummary(null);
      setError(null);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`${config.apiUrl}/api/llm/vessel-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vessel: payload }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (res.status === 503) {
          setError('off');
          setSummary(null);
          return;
        }
        if (res.status === 429) {
          setError('rate-limited');
          return;
        }
        if (!res.ok) {
          setError('fetch-failed');
          return;
        }
        const data = (await res.json()) as { summary?: string };
        if (typeof data.summary === 'string') {
          setSummary(data.summary);
          setError(null);
        } else {
          setError('fetch-failed');
        }
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError('fetch-failed');
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { summary, loading, error };
}
