export interface VesselPosition {
  mmsi: number;
  name: string;
  latitude: number;
  longitude: number;
  heading: number;        // degrees, 0-359 (normalised — 511 never sent)
  sog: number;            // speed over ground, knots
  cog: number;            // course over ground, degrees
  speed: number;          // @deprecated alias for sog
  timestamp: string;      // ISO 8601
  receivedAt?: number;    // Unix ms (client-side, set when pushed to positionHistory)
}
