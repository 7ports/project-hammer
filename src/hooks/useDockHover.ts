import { useState, useMemo, useCallback } from 'react';
import type { Vessel } from '../types/vessel';

export interface UseDockHoverResult {
  /** ID of the dock currently hovered/tapped, or null. */
  hoveredDockId: string | null;
  /** Set the hovered dock (null = clear). */
  setHoveredDock: (dockId: string | null) => void;
  /** Set of vessel MMSIs whose nearestDock or destination matches the hovered dock. */
  highlightedMmsis: ReadonlySet<number>;
  /** Convenience predicate — true when the given MMSI is in the highlight set. */
  isVesselHighlighted: (mmsi: number) => boolean;
}

/**
 * useDockHover — realtime feedback loop for dock-marker hover/tap.
 *
 * Tracks which dock the user is currently interacting with and exposes the
 * set of vessels that are either parked at that dock (nearestDock match) or
 * heading toward it (destination match). Pure: a single useState plus a
 * derived useMemo / useCallback set.
 */
export function useDockHover(vessels: readonly Vessel[]): UseDockHoverResult {
  const [hoveredDockId, setHoveredDockId] = useState<string | null>(null);

  const setHoveredDock = useCallback((dockId: string | null) => {
    setHoveredDockId(dockId);
  }, []);

  const highlightedMmsis = useMemo<ReadonlySet<number>>(() => {
    if (!hoveredDockId) return new Set<number>();
    const out = new Set<number>();
    for (const v of vessels) {
      if (v.nearestDock.id === hoveredDockId) {
        out.add(v.mmsi);
        continue;
      }
      if (v.destination?.id === hoveredDockId) {
        out.add(v.mmsi);
      }
    }
    return out;
  }, [hoveredDockId, vessels]);

  const isVesselHighlighted = useCallback(
    (mmsi: number) => highlightedMmsis.has(mmsi),
    [highlightedMmsis],
  );

  return { hoveredDockId, setHoveredDock, highlightedMmsis, isVesselHighlighted };
}
