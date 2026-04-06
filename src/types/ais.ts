export interface VesselPosition {
  mmsi: number;
  name: string;
  latitude: number;
  longitude: number;
  heading: number;   // degrees, 0-359
  speed: number;     // knots
  timestamp: string; // ISO 8601
}
