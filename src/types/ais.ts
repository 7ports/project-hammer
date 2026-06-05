export interface VesselPosition {
  mmsi: number;
  name: string;
  latitude: number;
  longitude: number;
  heading: number;        // degrees, 0-359, or 511 (AIS sentinel — providers emit when raw heading is unavailable)
  sog: number;            // speed over ground, knots
  cog: number;            // course over ground, degrees
  speed: number;          // @deprecated alias for sog
  timestamp: string;      // ISO 8601
  receivedAt?: number;    // Unix ms (client-side, set when pushed to positionHistory)
  /**
   * AIS Navigational Status code (ITU-R M.1371). Only present when the
   * server's active provider exposes it (aisstream.io does; aprs.fi and
   * vesselapi do not). Common values: 0=under way using engine, 1=at anchor,
   * 5=moored, 8=under way sailing, 15=undefined.
   */
  navStatus?: number;
}
