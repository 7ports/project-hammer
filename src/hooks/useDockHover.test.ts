import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useDockHover } from './useDockHover';
import type { Vessel } from '../types/vessel';
import type { DockLocation } from '../lib/docks';
import { DOCK_LOCATIONS } from '../lib/docks';

const wards = DOCK_LOCATIONS.find(d => d.id === 'wards-island')!;
const centre = DOCK_LOCATIONS.find(d => d.id === 'centre-island')!;
const jackLayton = DOCK_LOCATIONS.find(d => d.id === 'jack-layton')!;

function makeVessel(
  mmsi: number,
  nearest: DockLocation,
  destination?: DockLocation,
): Vessel {
  return {
    mmsi,
    name: 'Test',
    longitude: -79.4,
    latitude: 43.62,
    sog: 5,
    cog: 0,
    speed: 5,
    heading: 0,
    timestamp: '2026-06-02T00:00:00Z',
    status: 'moving',
    lastSeen: new Date('2026-06-02T00:00:00Z'),
    nearestDock: nearest,
    destination,
  };
}

describe('useDockHover', () => {
  it('starts with no hovered dock and an empty highlight set', () => {
    const { result } = renderHook(() => useDockHover([]));
    expect(result.current.hoveredDockId).toBeNull();
    expect(result.current.highlightedMmsis.size).toBe(0);
  });

  it('highlights vessels whose nearestDock matches the hovered dock', () => {
    const vessels = [makeVessel(100, wards), makeVessel(200, centre)];
    const { result } = renderHook(() => useDockHover(vessels));
    act(() => {
      result.current.setHoveredDock('wards-island');
    });
    expect(result.current.hoveredDockId).toBe('wards-island');
    expect(result.current.highlightedMmsis.has(100)).toBe(true);
    expect(result.current.highlightedMmsis.has(200)).toBe(false);
    expect(result.current.isVesselHighlighted(100)).toBe(true);
  });

  it('highlights vessels whose destination matches the hovered dock', () => {
    // Vessel currently near Centre but heading to Wards
    const vessels = [makeVessel(300, centre, wards)];
    const { result } = renderHook(() => useDockHover(vessels));
    act(() => {
      result.current.setHoveredDock('wards-island');
    });
    expect(result.current.isVesselHighlighted(300)).toBe(true);
  });

  it('clears highlights when hoveredDockId is set back to null', () => {
    const vessels = [makeVessel(100, jackLayton)];
    const { result } = renderHook(() => useDockHover(vessels));
    act(() => {
      result.current.setHoveredDock('jack-layton');
    });
    expect(result.current.highlightedMmsis.size).toBe(1);
    act(() => {
      result.current.setHoveredDock(null);
    });
    expect(result.current.hoveredDockId).toBeNull();
    expect(result.current.highlightedMmsis.size).toBe(0);
  });

  it('returns an empty set when no dock is hovered, regardless of vessels', () => {
    const vessels = [
      makeVessel(1, wards),
      makeVessel(2, centre, jackLayton),
    ];
    const { result } = renderHook(() => useDockHover(vessels));
    expect(result.current.highlightedMmsis.size).toBe(0);
    expect(result.current.isVesselHighlighted(1)).toBe(false);
    expect(result.current.isVesselHighlighted(2)).toBe(false);
  });
});
