/**
 * Server-side dock locations for the Toronto Island Ferry network.
 *
 * Mirrors the frontend's src/lib/docks.ts but keeps only what the trip
 * inference service needs (id, name, lat/lon). Route metadata stays in the
 * frontend file. Coordinates are duplicated by design — both sides need the
 * same source of truth and there is no shared package yet.
 */

export interface ServerDock {
  id: string;
  name: string;
  /** [longitude, latitude] — matches the frontend tuple order. */
  coordinates: readonly [number, number];
}

export const DOCKS: readonly ServerDock[] = [
  { id: 'jack-layton',          name: 'Jack Layton Ferry Terminal', coordinates: [-79.3750, 43.6402] },
  { id: 'wards-island',         name: "Ward's Island",              coordinates: [-79.3578, 43.6314] },
  { id: 'centre-island',        name: 'Centre Island',              coordinates: [-79.3784, 43.6224] },
  { id: 'hanlans-point',        name: "Hanlan's Point",             coordinates: [-79.3890, 43.6279] },
  { id: 'billy-bishop-airport', name: 'Billy Bishop Airport',       coordinates: [-79.3964, 43.6274] },
];

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface NearestDockResult {
  dock: ServerDock;
  distanceMeters: number;
}

export function nearestDock(lat: number, lon: number): NearestDockResult {
  let bestDock = DOCKS[0];
  let bestDist = haversineMeters(lat, lon, bestDock.coordinates[1], bestDock.coordinates[0]);
  for (let i = 1; i < DOCKS.length; i++) {
    const d = DOCKS[i];
    const dist = haversineMeters(lat, lon, d.coordinates[1], d.coordinates[0]);
    if (dist < bestDist) {
      bestDist = dist;
      bestDock = d;
    }
  }
  return { dock: bestDock, distanceMeters: bestDist };
}
