export interface DockLocation {
  id: string;
  name: string;
  coordinates: [number, number]; // [longitude, latitude]
}

export const DOCK_LOCATIONS: DockLocation[] = [
  { id: 'jack-layton', name: 'Jack Layton Ferry Terminal', coordinates: [-79.3750, 43.6402] },
  { id: 'wards-island', name: "Ward's Island", coordinates: [-79.3578, 43.6314] },
  { id: 'centre-island', name: 'Centre Island', coordinates: [-79.3784, 43.6224] },
  { id: 'hanlans-point', name: "Hanlan's Point", coordinates: [-79.3890, 43.6279] },
];

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimate minutes to reach a dock at current speed.
 * Returns undefined if SOG is too low to estimate reliably (< 0.5 kn).
 */
export function etaMinutesToDock(
  lat: number,
  lon: number,
  dock: DockLocation,
  sogKnots: number,
): number | undefined {
  if (sogKnots < 0.5) return undefined;
  const distKm = haversineKm(lat, lon, dock.coordinates[1], dock.coordinates[0]);
  const speedKmh = sogKnots * 1.852;
  return Math.round((distKm / speedKmh) * 60);
}

export function nearestDock(lat: number, lon: number): DockLocation {
  let nearest = DOCK_LOCATIONS[0];
  let minDist = haversineKm(lat, lon, nearest.coordinates[1], nearest.coordinates[0]);

  for (let i = 1; i < DOCK_LOCATIONS.length; i++) {
    const dock = DOCK_LOCATIONS[i];
    const dist = haversineKm(lat, lon, dock.coordinates[1], dock.coordinates[0]);
    if (dist < minDist) {
      minDist = dist;
      nearest = dock;
    }
  }

  return nearest;
}
