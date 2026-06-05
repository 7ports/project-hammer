/**
 * useLlmDisruptionNarrative — fetches a Claude-Haiku-generated 2-3
 * sentence plain-English explanation of an active ferry service
 * disruption.
 *
 * Same gating as useLlmVesselSummary: VITE_LLM_FEATURES=true on the
 * client + ANTHROPIC_API_KEY on the server. Short-circuits to null when
 * the input describes a non-disrupted (open / unknown) state.
 */

import { useEffect, useState } from 'react';
import { config } from '../lib/config';

export interface DisruptionPayload {
  status: 'alert' | 'closed';
  reason: string | null;
  message: string | null;
  parsedTimes: string[];
  postedAt: string | null;
}

export interface UseLlmDisruptionNarrativeResult {
  narrative: string | null;
  loading: boolean;
  error: 'disabled' | 'off' | 'rate-limited' | 'fetch-failed' | null;
}

function disruptionKey(p: DisruptionPayload | null): string | null {
  if (!p) return null;
  return [p.status, p.reason ?? '', p.message ?? '', p.parsedTimes.join('|')].join('::');
}

export function useLlmDisruptionNarrative(
  disruption: DisruptionPayload | null,
): UseLlmDisruptionNarrativeResult {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UseLlmDisruptionNarrativeResult['error']>(null);

  const key = disruptionKey(disruption);

  useEffect(() => {
    if (!config.llmFeaturesEnabled) {
      setNarrative(null);
      setError('disabled');
      return;
    }
    if (!disruption) {
      setNarrative(null);
      setError(null);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`${config.apiUrl}/api/llm/disruption-narrative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disruption }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (res.status === 503) {
          setError('off');
          setNarrative(null);
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
        const data = (await res.json()) as { narrative?: string };
        if (typeof data.narrative === 'string') {
          setNarrative(data.narrative);
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

  return { narrative, loading, error };
}
