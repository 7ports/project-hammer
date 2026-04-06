export interface VesselPosition {
  mmsi: number;
  name: string;
  latitude: number;
  longitude: number;
  heading: number;        // degrees, 0-359; 511 = not available
  speed: number;          // knots
  sog?: number | null;    // speed over ground, knots
  cog?: number | null;    // course over ground, degrees
  timestamp: string;      // ISO 8601
}
