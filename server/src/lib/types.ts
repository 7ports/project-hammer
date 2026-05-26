/**
 * Shared types for the AIS provider system.
 *
 * These types define the data contract between providers, the provider manager,
 * backend routes, and (indirectly) the frontend via SSE. Any change here
 * affects the entire pipeline — modify with care.
 */

import type { VesselMMSI } from './constants';

// ---------------------------------------------------------------------------
// Core data types
// ---------------------------------------------------------------------------

export interface VesselPosition {
  mmsi: VesselMMSI;
  name: string;
  latitude: number;
  longitude: number;
  /** Normalised heading: TrueHeading when available, else Math.round(Cog) % 360. */
  heading: number;
  /** Speed over ground in knots (raw Sog from AIS). */
  sog: number;
  /** Course over ground in degrees (raw Cog from AIS). */
  cog: number;
  /** @deprecated use sog — kept for short-term backwards compat */
  speed: number;
  /** ISO 8601 timestamp from the AIS stream. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Listener types
// ---------------------------------------------------------------------------

export type PositionListener = (pos: VesselPosition) => void;
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Weather observation (CYTZ surface weather via MSC SWOB / GeoMet)
// ---------------------------------------------------------------------------

export interface WeatherObservation {
  stationName: string;
  observedAt: string;
  temperatureCelsius: number | null;
  feelsLikeCelsius: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  windGustKmh: number | null;
  relativeHumidityPct: number | null;
  visibilityKm: number | null;
  pressureKpa: number | null;
  /** Dew-point temperature in Celsius (SWOB `dwpt_temp`). */
  dewPointCelsius: number | null;
  /**
   * SWOB `cld_amt_code_1` cloud amount on the okta-like scale used by MSC:
   * 0=clear · 1–2=few · 3–4=scattered · 5–6=broken · 7=overcast minus · 8=overcast.
   */
  cloudAmountOktas: number | null;
  /** Precipitation accumulated in the past hour, mm (SWOB `pcpn_amt_pst1hr`). */
  precipitationLastHourMm: number | null;
  /** Precipitation accumulated in the past 24 hours, mm (SWOB `pcpn_amt_pst24hrs`). */
  precipitationLast24hMm: number | null;
  /**
   * Raw SWOB `prsnt_wx_1` code retained for diagnostics only.
   * The upstream code system is NAV CANADA AWOS (not WMO 4677); there is no
   * reliable single-code → label mapping. The `condition` field is derived
   * from real observations (precipitation, cloud cover, visibility) instead.
   */
  presentWeatherCode: string | null;
  condition: string;
  precipitationWarning: boolean;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface AISProxyDiagnostics {
  wsStatus: 'connected' | 'disconnected' | 'connecting';
  totalMessages: number;
  positionReports: number;
  matchedVessels: number;
  reconnects: number;
  connectedAt: string | null;
  lastMessageAt: string | null;
  lastNonPositionMessage: string | null;
  /** Name of the currently active provider. */
  activeProvider: string;
  /** Per-provider health details. */
  providerDetails: import('./providers/types').ProviderDiagnostics[];
  /** Number of failover events since startup. */
  failoverCount: number;
  /** ISO timestamp of the most recent failover. */
  lastFailoverAt: string | null;
}
