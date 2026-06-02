/**
 * Pure trip-inference function.
 *
 * Walks a vessel's position stream in time order and detects completed trips
 * — dock-leave → dock-arrive transitions where the arrival dock differs from
 * the departure dock. The pure-function shape (positions in, trips out) keeps
 * the inference logic trivially testable with fixtures.
 *
 * Algorithm (v1):
 *   - State 1: `at_dock(d)` — within DOCK_RADIUS_M of dock d AND sog < AT_DOCK_SOG_MAX_KN.
 *   - State 2: `in_transit(from)` — everything else, with `from` set to the
 *     last observed dock.
 *   - Trip = (transit_start, transit_end) where transit_end re-enters
 *     state at_dock(d') with d' !== from.
 *
 * Re-arrivals at the same origin are not trips — the transit state resets.
 * Incomplete trips (still in transit at end of input) are not emitted; they
 * surface on the next scan once a dock arrival lands in the data.
 */

import { DOCKS, haversineMeters, nearestDock, type ServerDock } from '../docks';

export const TRIP_INFERENCE_CONFIG = {
  /** Max distance from a dock to be considered "at" it, meters. */
  dockRadiusMeters: 150,
  /** Max SOG (knots) to be considered idle at a dock. Ferries rock slightly while moored. */
  atDockSogMaxKnots: 0.5,
} as const;

export interface InferenceInputPosition {
  /** Unix milliseconds. */
  timestamp: number;
  latitude: number;
  longitude: number;
  /** Speed over ground, knots. */
  sog: number;
}

export interface InferredTrip {
  mmsi: number;
  fromDock: string;
  toDock: string;
  /** Unix ms of the first transit position after the vessel left fromDock. */
  startAt: number;
  /** Unix ms of the arrival position at toDock. */
  endAt: number;
  durationSeconds: number;
  distanceMeters: number;
  positionCount: number;
}

interface NearestDockEntry {
  dock: ServerDock;
  distance: number;
}

function classify(pos: InferenceInputPosition): { atDock: boolean; nearest: NearestDockEntry } {
  const { dock, distanceMeters } = nearestDock(pos.latitude, pos.longitude);
  const atDock =
    distanceMeters < TRIP_INFERENCE_CONFIG.dockRadiusMeters &&
    pos.sog < TRIP_INFERENCE_CONFIG.atDockSogMaxKnots;
  return { atDock, nearest: { dock, distance: distanceMeters } };
}

/**
 * Walk a vessel's position stream and emit completed trips.
 *
 * The mmsi is passed through verbatim to each output row — the function
 * itself does no per-vessel grouping. Callers handle that.
 */
export function inferTripsFromPositions(
  positions: readonly InferenceInputPosition[],
  mmsi: number,
): InferredTrip[] {
  if (positions.length === 0) return [];

  const trips: InferredTrip[] = [];

  let currentDock: string | null = null;
  let transitStart: InferenceInputPosition | null = null;
  let transitDistance = 0;
  let transitPositionCount = 0;
  let prevPos: InferenceInputPosition | null = null;

  for (const pos of positions) {
    const { atDock, nearest } = classify(pos);

    if (transitStart !== null && prevPos !== null) {
      transitDistance += haversineMeters(
        prevPos.latitude,
        prevPos.longitude,
        pos.latitude,
        pos.longitude,
      );
      transitPositionCount++;
    }

    if (atDock) {
      if (
        currentDock !== null &&
        nearest.dock.id !== currentDock &&
        transitStart !== null
      ) {
        trips.push({
          mmsi,
          fromDock: currentDock,
          toDock: nearest.dock.id,
          startAt: transitStart.timestamp,
          endAt: pos.timestamp,
          durationSeconds: Math.max(
            0,
            Math.round((pos.timestamp - transitStart.timestamp) / 1000),
          ),
          distanceMeters: Math.round(transitDistance),
          positionCount: transitPositionCount,
        });
      }
      currentDock = nearest.dock.id;
      transitStart = null;
      transitDistance = 0;
      transitPositionCount = 0;
    } else if (currentDock !== null && transitStart === null) {
      transitStart = pos;
      transitDistance = 0;
      transitPositionCount = 1;
    }

    prevPos = pos;
  }

  return trips;
}

/** Re-export so callers don't need to import docks.ts directly. */
export const ALL_DOCK_IDS: readonly string[] = DOCKS.map((d) => d.id);
