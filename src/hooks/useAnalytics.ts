import { useEffect, useRef, useState } from 'react';
import type { AnalyticsEnvelope, RangeKey } from '../types/analytics';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export interface UseAnalyticsState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  generatedAt: string | null;
}

export interface UseAnalyticsOptions {
  range?: RangeKey;
  /** Extra query params appended verbatim (skips empty strings). */
  params?: Record<string, string | number | undefined>;
  /** Refetch interval in ms; defaults to 60_000 for live endpoints. Set 0 to disable. */
  pollMs?: number;
}

function buildUrl(path: string, opts: UseAnalyticsOptions): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (opts.range) url.searchParams.set('range', opts.range);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v === undefined || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Generic analytics fetcher with loading/error states and optional polling.
 * Returns the unwrapped `data` field from the API envelope.
 */
export function useAnalytics<T>(
  path: string,
  opts: UseAnalyticsOptions = {},
): UseAnalyticsState<T> {
  const [state, setState] = useState<UseAnalyticsState<T>>({
    data: null,
    loading: true,
    error: null,
    generatedAt: null,
  });

  // Stable key so the effect only re-runs when meaningful inputs change.
  const key = JSON.stringify({ path, ...opts });
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    lastKeyRef.current = key;
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch(buildUrl(path, opts), { headers: { Accept: 'application/json' } });
        const body = (await res.json()) as AnalyticsEnvelope<T>;
        if (cancelled) return;
        if (!res.ok || body.error) {
          setState({
            data: null,
            loading: false,
            error: body.error ?? `HTTP ${res.status}`,
            generatedAt: body.generatedAt ?? null,
          });
          return;
        }
        setState({
          data: body.data,
          loading: false,
          error: null,
          generatedAt: body.generatedAt ?? null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Network error',
          generatedAt: null,
        });
      }
    }

    setState((prev) => ({ ...prev, loading: true }));
    void load();

    const pollMs = opts.pollMs ?? 60_000;
    if (pollMs > 0) {
      const id = window.setInterval(() => {
        if (!cancelled) void load();
      }, pollMs);
      return () => {
        cancelled = true;
        window.clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
