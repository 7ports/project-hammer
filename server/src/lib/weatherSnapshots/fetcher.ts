/**
 * Weather observation fetcher.
 *
 * Thin wrapper around the same GeoMet (Environment Canada) endpoint the
 * `/api/weather` route already uses. Kept separate from `routes/weather.ts`
 * so the snapshotter doesn't share that route's in-memory cache — the
 * snapshotter wants the freshest observation it can get, not the cached one.
 *
 * The transform itself is imported from the route so the column derivation
 * (condition, feels-like, etc.) stays in one place.
 */

import { transformGeoMet } from '../../routes/weather';
import type { WeatherObservation } from '../types';

const UPSTREAM_URL =
  'https://api.weather.gc.ca/collections/swob-realtime/items' +
  '?bbox=-79.42,43.61,-79.37,43.64&limit=1&f=json';

const FETCH_TIMEOUT_MS = 8_000;

export type FetchObservation = () => Promise<WeatherObservation>;

/** Live fetcher backed by GeoMet. Used in production; tests inject a fake. */
export const liveFetchObservation: FetchObservation = async () => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(UPSTREAM_URL, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!upstream.ok) {
      throw new Error(`Upstream responded ${upstream.status} ${upstream.statusText}`);
    }
    const raw: unknown = await upstream.json();
    return transformGeoMet(raw);
  } finally {
    clearTimeout(timer);
  }
};
