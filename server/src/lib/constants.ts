/**
 * Shared constants for the Toronto Island Ferry Tracker backend.
 * MMSIs must only be hardcoded here — never in routes or other modules.
 */

/** The four Toronto Island Ferry vessels tracked via aisstream.io */
export const VESSEL_MMSIS = [
  316045069, // Sam McBride
  316045081, // Wm Inglis
  316045082, // Thomas Rennie
  316050853, // Marilyn Bell I
] as const;

/** Union type of all valid ferry MMSIs, derived from the tuple */
export type VesselMMSI = (typeof VESSEL_MMSIS)[number];

/** WebSocket endpoint for aisstream.io AIS data */
export const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream';

/** Default port the Express server listens on */
export const DEFAULT_PORT = 3001;
