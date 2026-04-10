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
