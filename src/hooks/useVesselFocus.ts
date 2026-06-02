import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { RefObject } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { Vessel } from '../types/vessel';

export interface UseVesselFocusOptions {
  /** Ref to the current vessel list (kept off React state for animation perf). */
  vesselPositionsRef: RefObject<Vessel[]>;
  /** MMSI to focus on, or null to release focus. */
  focusedMmsi: number | null;
  /** Milliseconds to keep the camera locked before auto-release (default 8000). */
  durationMs?: number;
  /** Map zoom level to fly to (default 15.5). */
  zoomLevel?: number;
  /** Called when focus releases (timeout or explicit). */
  onRelease?: () => void;
}

export interface UseVesselFocusResult {
  /** True while the camera is in the focused window. */
  isFocused: boolean;
  /** Release focus immediately (clears the auto-release timer and fires onRelease). */
  releaseFocus: () => void;
}

/**
 * useVesselFocus — realtime feedback loop for the user's vessel selection.
 *
 * When focusedMmsi becomes non-null the map smoothly flies to that vessel's
 * current position and stays "focused" for durationMs. Calling releaseFocus(),
 * unmounting, or setting focusedMmsi back to null releases focus early. The
 * hook has no side-effects outside map.flyTo and its internal timer cleanup.
 */
export function useVesselFocus({
  vesselPositionsRef,
  focusedMmsi,
  durationMs = 8000,
  zoomLevel = 15.5,
  onRelease,
}: UseVesselFocusOptions): UseVesselFocusResult {
  const { current: map } = useMap();
  const [isFocused, setIsFocused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReleaseRef = useRef(onRelease);
  // Keep a stable handle to the map so re-renders that swap the MapRef identity
  // (e.g. test mocks that return a fresh object each call) don't retrigger the focus effect.
  const mapRef = useRef(map);
  useLayoutEffect(() => {
    mapRef.current = map;
  }, [map]);
  // mapAvailable is a stable boolean — flips only when the map transitions present/absent.
  const mapAvailable = useMemo(() => map !== null && map !== undefined, [map]);
  // Sync the latest onRelease callback into a ref without writing to refs during render.
  useLayoutEffect(() => {
    onReleaseRef.current = onRelease;
  }, [onRelease]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseFocus = useCallback(() => {
    clearTimer();
    setIsFocused(false);
    onReleaseRef.current?.();
  }, [clearTimer]);

  useEffect(() => {
    clearTimer();
    if (focusedMmsi === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsFocused(false);
      return;
    }
    const currentMap = mapRef.current;
    if (!mapAvailable || !currentMap) return;
    const vessel = vesselPositionsRef.current?.find(v => v.mmsi === focusedMmsi);
    if (!vessel) return;
    currentMap.flyTo({
      center: [vessel.longitude, vessel.latitude],
      zoom: zoomLevel,
      duration: 800,
    });
    setIsFocused(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setIsFocused(false);
      onReleaseRef.current?.();
    }, durationMs);
    return clearTimer;
  }, [focusedMmsi, mapAvailable, zoomLevel, durationMs, vesselPositionsRef, clearTimer]);

  return { isFocused, releaseFocus };
}
