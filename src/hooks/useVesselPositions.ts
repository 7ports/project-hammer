import { useRef, useState } from 'react';
import type { Vessel } from '../types/vessel';
import type { VesselPosition } from '../types/ais';
import { useAISStream } from './useAISStream';
import type { ConnectionStatus } from './useAISStream';
import { useAnimationFrame } from './useAnimationFrame';
import { lerpPosition } from '../lib/interpolation';

const OFFLINE_THRESHOLD_MS = 60_000; // 60 seconds
const DOCKED_SPEED_KNOTS = 0.5;
const AIS_UPDATE_INTERVAL_MS = 10_000; // ~10 s between AIS pings

export interface VesselPositionsResult {
  vessels: Vessel[];
  connectionStatus: ConnectionStatus;
}

export function useVesselPositions(): VesselPositionsResult {
  const { vessels: rawVessels, connectionStatus } = useAISStream();

  // fromRef: the snapshot at the START of the current lerp segment
  const fromRef = useRef<Map<number, VesselPosition>>(new Map());
  // targetRef: the latest snapshot received from the SSE stream
  const targetRef = useRef<Map<number, VesselPosition>>(new Map());
  // animStartRef: rAF timestamp when the current lerp segment began
  const animStartRef = useRef<Map<number, number>>(new Map());

  const [interpolated, setInterpolated] = useState<Vessel[]>([]);

  useAnimationFrame((timestamp) => {
    const now = Date.now();
    const result: Vessel[] = [];

    rawVessels.forEach((current, mmsi) => {
      const prevTarget = targetRef.current.get(mmsi);

      // New AIS ping arrived — advance the lerp window
      if (prevTarget === undefined || prevTarget.timestamp !== current.timestamp) {
        // The old target becomes the new lerp origin
        if (prevTarget !== undefined) {
          fromRef.current.set(mmsi, prevTarget);
        } else {
          // First ever ping: lerp origin = current (t will be 1 immediately)
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

      result.push({
        ...interpolatedPos,
        status,
        lastSeen: new Date(current.timestamp),
      });
    });

    setInterpolated(result);
  });

  return { vessels: interpolated, connectionStatus };
}
