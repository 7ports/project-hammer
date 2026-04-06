import { useRef, useState } from 'react';
import type { Vessel } from '../types/vessel';
import type { VesselPosition } from '../types/ais';
import type { DockLocation } from '../lib/docks';
import type { RouteId } from '../types/schedule';
import { useAISStream } from './useAISStream';
import type { ConnectionStatus } from './useAISStream';
import { useAnimationFrame } from './useAnimationFrame';
import { useSchedule } from './useSchedule';
import { lerpPosition } from '../lib/interpolation';
import { nearestDock, etaMinutesToDock } from '../lib/docks';

const OFFLINE_THRESHOLD_MS = 60_000; // 60 seconds
const DOCKED_SPEED_KNOTS = 0.5;
const AIS_UPDATE_INTERVAL_MS = 10_000; // ~10 s between AIS pings
const MAX_HISTORY_LENGTH = 8;
const NEXT_DEPARTURE_LOOKAHEAD_MS = 3 * 60 * 60 * 1000; // 3 hours

// Maps dock ID → routes that depart FROM that dock
const DOCK_OUTBOUND_ROUTES: Record<string, Array<{ routeId: RouteId; direction: 'outbound' | 'inbound' }>> = {
  'jack-layton': [
    { routeId: 'jack-layton-wards', direction: 'outbound' },
    { routeId: 'jack-layton-centre', direction: 'outbound' },
    { routeId: 'jack-layton-hanlans', direction: 'outbound' },
  ],
  'wards-island': [{ routeId: 'jack-layton-wards', direction: 'inbound' }],
  'centre-island': [{ routeId: 'jack-layton-centre', direction: 'inbound' }],
  'hanlans-point': [{ routeId: 'jack-layton-hanlans', direction: 'inbound' }],
};

export interface VesselPositionsResult {
  vessels: Vessel[];
  connectionStatus: ConnectionStatus;
  positionHistory: Map<number, VesselPosition[]>;
}

export function useVesselPositions(): VesselPositionsResult {
  const { vessels: rawVessels, connectionStatus } = useAISStream();
  const { upcomingDepartures } = useSchedule();

  // Keep upcomingDepartures accessible inside the rAF closure without a stale reference
  const upcomingDeparturesRef = useRef(upcomingDepartures);
  upcomingDeparturesRef.current = upcomingDepartures;

  const fromRef = useRef<Map<number, VesselPosition>>(new Map());
  const targetRef = useRef<Map<number, VesselPosition>>(new Map());
  const animStartRef = useRef<Map<number, number>>(new Map());
  const positionHistoryRef = useRef<Map<number, VesselPosition[]>>(new Map());
  // Tracks previous status to detect docked→moving transitions
  const prevStatusRef = useRef<Map<number, Vessel['status']>>(new Map());
  // Stores the last confirmed dock position per vessel
  const lastDockedRef = useRef<Map<number, DockLocation>>(new Map());

  const [interpolated, setInterpolated] = useState<Vessel[]>([]);
  const [positionHistory, setPositionHistory] = useState<Map<number, VesselPosition[]>>(new Map());

  useAnimationFrame((timestamp) => {
    const now = Date.now();
    const result: Vessel[] = [];

    rawVessels.forEach((current, mmsi) => {
      const prevTarget = targetRef.current.get(mmsi);

      if (prevTarget === undefined || prevTarget.timestamp !== current.timestamp) {
        if (prevTarget !== undefined) {
          fromRef.current.set(mmsi, prevTarget);
        } else {
          fromRef.current.set(mmsi, current);
        }
        targetRef.current.set(mmsi, current);
        animStartRef.current.set(mmsi, timestamp);
      }

      const animStart = animStartRef.current.get(mmsi) ?? timestamp;
      const t = Math.min((timestamp - animStart) / AIS_UPDATE_INTERVAL_MS, 1);
      const from = fromRef.current.get(mmsi) ?? current;
      const interpolatedPos = lerpPosition(from, current, t);

      const lastSeenMs = now - new Date(current.timestamp).getTime();
      const status: Vessel['status'] =
        lastSeenMs > OFFLINE_THRESHOLD_MS
          ? 'offline'
          : current.speed < DOCKED_SPEED_KNOTS
            ? 'docked'
            : 'moving';

      const dock = nearestDock(interpolatedPos.latitude, interpolatedPos.longitude);

      // Track last confirmed dock (set whenever vessel is docked)
      if (status === 'docked') {
        lastDockedRef.current.set(mmsi, dock);
      }
      prevStatusRef.current.set(mmsi, status);

      if (status === 'moving') {
        const history = positionHistoryRef.current.get(mmsi) ?? [];
        const updated = [...history, interpolatedPos].slice(-MAX_HISTORY_LENGTH);
        positionHistoryRef.current.set(mmsi, updated);
      }

      // ETA to nearest dock (only when moving)
      const etaMinutes =
        status === 'moving' && interpolatedPos.sog != null
          ? etaMinutesToDock(interpolatedPos.latitude, interpolatedPos.longitude, dock, interpolatedPos.sog)
          : undefined;

      // Departed-from: the dock last seen at, surfaced only while underway
      const departedFrom = status === 'moving' ? lastDockedRef.current.get(mmsi) : undefined;

      // Next scheduled departure from this dock (when not underway)
      let nextDepartureAt: string | undefined;
      if (status !== 'moving') {
        const routes = DOCK_OUTBOUND_ROUTES[dock.id] ?? [];
        const nowDate = new Date(now);
        let earliest: Date | undefined;

        for (const { routeId, direction } of routes) {
          const departures = upcomingDeparturesRef.current(routeId, direction, 6);
          for (const dep of departures) {
            const [h, m] = dep.time.split(':').map(Number);
            const candidate = new Date(nowDate);
            candidate.setHours(h, m, 0, 0);
            if (candidate.getTime() <= now) candidate.setDate(candidate.getDate() + 1);
            if (candidate.getTime() - now <= NEXT_DEPARTURE_LOOKAHEAD_MS) {
              if (earliest === undefined || candidate < earliest) earliest = candidate;
            }
          }
        }
        if (earliest !== undefined) nextDepartureAt = earliest.toISOString();
      }

      result.push({
        ...interpolatedPos,
        status,
        lastSeen: new Date(current.timestamp),
        nearestDock: dock,
        etaMinutes,
        departedFrom,
        nextDepartureAt,
      });
    });

    setInterpolated(result);
    setPositionHistory(new Map(positionHistoryRef.current));
  });

  return { vessels: interpolated, connectionStatus, positionHistory };
}
