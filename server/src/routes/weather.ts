/**
 * Cached proxy to the Environment Canada GeoMet OGC API for real-time
 * surface weather observations at Billy Bishop Toronto City Airport (CYTZ).
 *
 * Upstream: https://api.weather.gc.ca/collections/swob-realtime/items
 * Station:  CYTZ — WMO 71265, MSC/Climate ID 6158359
 *           Billy Bishop Toronto City Airport, 43.6274°N 79.3962°W
 *
 * The route caches the transformed response for CACHE_TTL_MS (5 minutes) to
 * avoid hammering the public API on every client poll.  If the upstream
 * fails and stale data is available it is returned with the warning header
 * X-Cache: stale.
 */

import { Router, Request, Response } from 'express';
import type { WeatherObservation } from '../lib/types';

export const weatherRouter = Router();

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: WeatherObservation;
  fetchedAt: number; // Date.now()
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache: CacheEntry | null = null;

// ---------------------------------------------------------------------------
// Upstream URL
// ---------------------------------------------------------------------------

/**
 * Bounding box centred on Billy Bishop Toronto City Airport (CYTZ).
 * Returns the single most-recent observation (limit=1).
 */
const UPSTREAM_URL =
  'https://api.weather.gc.ca/collections/swob-realtime/items' +
  '?bbox=-79.42,43.61,-79.37,43.64&limit=1&f=json';

// ---------------------------------------------------------------------------
// Observation-derived condition
// ---------------------------------------------------------------------------

/**
 * Derive a user-facing condition string from real observations rather than
 * trusting any single upstream code. The upstream feed (NAV CANADA AWOS) emits
 * `prsnt_wx_1` values outside the WMO 4677 synoptic range (e.g. 300), so a
 * single-code lookup is unreliable and was the source of consistently wrong
 * labels. Observations (precipitation amount, cloud cover, visibility,
 * temperature) are the authoritative signals.
 *
 * The one narrow exception is WMO thunder codes (17, 29, 95–99) — these are
 * unambiguous and observations have no other thunder signal.
 */
function deriveCondition(args: {
  tempC: number | null;
  precipLastHourMm: number | null;
  cloudOktas: number | null;
  visibilityKm: number | null;
  presentWeatherCode: number | null;
}): { condition: string; precipitationWarning: boolean } {
  const { tempC, precipLastHourMm, cloudOktas, visibilityKm, presentWeatherCode } = args;

  if (
    presentWeatherCode !== null &&
    (presentWeatherCode === 17 ||
      presentWeatherCode === 29 ||
      (presentWeatherCode >= 95 && presentWeatherCode <= 99))
  ) {
    return { condition: 'Thunderstorm', precipitationWarning: true };
  }

  if (precipLastHourMm !== null && precipLastHourMm > 0) {
    const isFreezing = tempC !== null && tempC <= 0;
    if (precipLastHourMm > 5) {
      return {
        condition: isFreezing ? 'Heavy Snow' : 'Heavy Rain',
        precipitationWarning: true,
      };
    }
    if (precipLastHourMm > 0.5) {
      return {
        condition: isFreezing ? 'Snow' : 'Rain',
        precipitationWarning: true,
      };
    }
    return {
      condition: isFreezing ? 'Light Snow' : 'Drizzle',
      precipitationWarning: true,
    };
  }

  if (visibilityKm !== null && visibilityKm < 1) {
    return { condition: 'Fog', precipitationWarning: false };
  }
  if (visibilityKm !== null && visibilityKm < 5) {
    return { condition: 'Mist/Haze', precipitationWarning: false };
  }

  if (cloudOktas !== null) {
    if (cloudOktas >= 7) return { condition: 'Overcast', precipitationWarning: false };
    if (cloudOktas >= 5) return { condition: 'Mostly Cloudy', precipitationWarning: false };
    if (cloudOktas >= 3) return { condition: 'Partly Cloudy', precipitationWarning: false };
    if (cloudOktas >= 1) return { condition: 'Mostly Clear', precipitationWarning: false };
  }

  return { condition: 'Clear', precipitationWarning: false };
}

// ---------------------------------------------------------------------------
// Wind chill / humidex helpers
// ---------------------------------------------------------------------------

/**
 * Environment Canada wind chill formula.
 * Applies when temp <= 10°C and wind speed >= 5 km/h.
 */
function windChill(tempC: number, windKmh: number): number | null {
  if (tempC > 10 || windKmh < 5) return null;
  const wc =
    13.12 +
    0.6215 * tempC -
    11.37 * Math.pow(windKmh, 0.16) +
    0.3965 * tempC * Math.pow(windKmh, 0.16);
  return Math.round(wc * 10) / 10;
}

/**
 * Environment Canada humidex formula.
 * Applies when temp >= 20°C and dew point >= 0°C.
 */
function humidex(tempC: number, relHumPct: number): number | null {
  if (tempC < 20) return null;
  // Approximate dew point from Magnus formula
  const a = 17.625;
  const b = 243.04;
  const alpha = (a * tempC) / (b + tempC) + Math.log(relHumPct / 100);
  const dewPoint = (b * alpha) / (a - alpha);
  if (dewPoint < 0) return null;
  // Vapour pressure in hPa
  const e = 6.112 * Math.exp((17.67 * dewPoint) / (dewPoint + 243.5));
  const hx = tempC + 0.5555 * (e - 10);
  return Math.round(hx * 10) / 10;
}

// ---------------------------------------------------------------------------
// GeoMet response parsing
// ---------------------------------------------------------------------------

/**
 * GeoMet returns a flat properties object. Property names that are observations
 * sit directly on the properties object (e.g. properties.air_temp = 8.5).
 * There are also many QA flag properties (e.g. air_temp_qa_summary).
 * Some older/alternate formats nest observations under data_present_flag.observations.
 * We try both.
 */
interface GeoMetObservationItem {
  name: string;
  value: string;
  uom: string;
}

interface GeoMetProperties {
  station_name?: string;
  obs_date_tm?: string;
  observation_time?: string;
  air_temp?: number | string | null;
  wind_spd?: number | string | null;
  wind_dir?: number | string | null;
  rel_hum?: number | string | null;
  visibility?: number | string | null;
  max_wind_spd?: number | string | null;
  mslp?: number | string | null;
  present_weather?: number | string | null;
  dew_point?: number | string | null;
  cloud_amount?: number | string | null;
  precip_1h?: number | string | null;
  precip_24h?: number | string | null;
  data_present_flag?: {
    observations?: GeoMetObservationItem[];
  };
  [key: string]: unknown;
}

interface GeoMetFeature {
  properties: GeoMetProperties;
}

interface GeoMetResponse {
  features: GeoMetFeature[];
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function parseObservations(props: GeoMetProperties): Record<string, number | null> {
  const result: Record<string, number | null> = {};

  // Try nested observations array first (alternate format)
  const nested = props.data_present_flag?.observations;
  if (Array.isArray(nested)) {
    for (const obs of nested) {
      result[obs.name] = toNum(obs.value);
    }
  }

  // Overlay flat properties (flat format takes precedence when both exist)
  const flatKeys = [
    'air_temp', 'wind_spd', 'wind_dir', 'rel_hum',
    'visibility', 'max_wind_spd', 'mslp', 'present_weather',
    'dew_point', 'cloud_amount', 'precip_1h', 'precip_24h',
  ] as const;
  for (const key of flatKeys) {
    const v = props[key];
    if (v !== undefined && v !== null) {
      result[key] = toNum(v);
    }
  }

  // Real-world SWOB/AWOS field name aliases (actual GeoMet API uses long names)
  // Only fill in if the short-name key was not already populated above.
  const realFieldAliases: Array<[string, string]> = [
    ['avg_wnd_spd_10m_pst2mts', 'wind_spd'],
    ['avg_wnd_spd_10m_pst10mts', 'wind_spd'],
    ['avg_wnd_dir_10m_pst2mts', 'wind_dir'],
    ['avg_wnd_dir_10m_pst10mts', 'wind_dir'],
    ['max_wnd_gst_spd_10m_pst10mts', 'max_wind_spd'],
    ['prsnt_wx_1', 'present_weather'],
    ['avg_vis_pst10mts', 'visibility'],
    ['dwpt_temp', 'dew_point'],
    ['cld_amt_code_1', 'cloud_amount'],
    ['pcpn_amt_pst1hr', 'precip_1h'],
    ['pcpn_amt_pst24hrs', 'precip_24h'],
  ];
  for (const [realKey, shortKey] of realFieldAliases) {
    if (result[shortKey] === undefined) {
      const v = props[realKey];
      if (v !== undefined && v !== null) {
        result[shortKey] = toNum(v);
      }
    }
  }

  return result;
}

export function transformGeoMet(raw: unknown): WeatherObservation {
  const fallback: WeatherObservation = {
    stationName: 'Billy Bishop Toronto City A',
    observedAt: new Date().toISOString(),
    temperatureCelsius: null,
    feelsLikeCelsius: null,
    windSpeedKmh: null,
    windDirectionDeg: null,
    windGustKmh: null,
    relativeHumidityPct: null,
    visibilityKm: null,
    pressureKpa: null,
    dewPointCelsius: null,
    cloudAmountOktas: null,
    precipitationLastHourMm: null,
    precipitationLast24hMm: null,
    presentWeatherCode: null,
    condition: 'Unknown',
    precipitationWarning: false,
  };

  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as GeoMetResponse).features) ||
    (raw as GeoMetResponse).features.length === 0
  ) {
    return fallback;
  }

  const feature = (raw as GeoMetResponse).features[0];
  if (!feature?.properties) return fallback;

  const props = feature.properties;
  const obs = parseObservations(props);

  const tempC = obs['air_temp'] ?? null;
  const windKmh = obs['wind_spd'] ?? null;
  const relHum = obs['rel_hum'] ?? null;
  const visibilityKm = obs['visibility'] ?? null;
  const cloudOktas = obs['cloud_amount'] ?? null;
  const precip1h = obs['precip_1h'] ?? null;
  const precip24h = obs['precip_24h'] ?? null;
  const dewPointC = obs['dew_point'] ?? null;

  // Compute feels-like: wind chill when cold, humidex when warm
  let feelsLike: number | null = tempC;
  if (tempC !== null && windKmh !== null) {
    const wc = windChill(tempC, windKmh);
    if (wc !== null) feelsLike = wc;
  }
  if (tempC !== null && relHum !== null && feelsLike === tempC) {
    const hx = humidex(tempC, relHum);
    if (hx !== null) feelsLike = hx;
  }

  const rawWeatherCode = obs['present_weather'] ?? null;
  const codeNum = rawWeatherCode !== null ? Math.floor(rawWeatherCode) : null;
  const { condition, precipitationWarning } = deriveCondition({
    tempC,
    precipLastHourMm: precip1h,
    cloudOktas,
    visibilityKm,
    presentWeatherCode: codeNum,
  });

  // mslp from GeoMet is in hPa; convert to kPa
  const mslpHpa = obs['mslp'] ?? null;
  const pressureKpa = mslpHpa !== null ? Math.round((mslpHpa / 10) * 10) / 10 : null;

  return {
    stationName: typeof props.station_name === 'string'
      ? props.station_name
      : typeof props['stn_nam-value'] === 'string'
        ? props['stn_nam-value']
        : 'Billy Bishop Toronto City A',
    observedAt: typeof props.obs_date_tm === 'string'
      ? props.obs_date_tm
      : typeof props.observation_time === 'string'
        ? props.observation_time
        : new Date().toISOString(),
    temperatureCelsius: tempC,
    feelsLikeCelsius: feelsLike,
    windSpeedKmh: windKmh,
    windDirectionDeg: obs['wind_dir'] ?? null,
    windGustKmh: obs['max_wind_spd'] ?? null,
    relativeHumidityPct: relHum,
    visibilityKm,
    pressureKpa,
    dewPointCelsius: dewPointC,
    cloudAmountOktas: cloudOktas,
    precipitationLastHourMm: precip1h,
    precipitationLast24hMm: precip24h,
    presentWeatherCode: rawWeatherCode !== null ? String(rawWeatherCode) : null,
    condition,
    precipitationWarning,
  };
}

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

    const raw: unknown = await upstream.json();
    const data = transformGeoMet(raw);

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
