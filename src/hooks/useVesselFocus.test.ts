import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const flyToMock = vi.fn();
vi.mock('react-map-gl/maplibre', () => ({
  useMap: () => ({ current: { flyTo: flyToMock } }),
}));

import { useVesselFocus } from './useVesselFocus';
import type { Vessel } from '../types/vessel';
import type { DockLocation } from '../lib/docks';

const FAKE_DOCK: DockLocation = {
  id: 'jack-layton',
  name: 'Jack Layton Ferry Terminal',
  coordinates: [-79.375, 43.640],
  description: '',
  address: '',
  routes: [],
};

function makeVessel(mmsi: number, lon: number, lat: number): Vessel {
  return {
    mmsi,
    name: 'Test Vessel',
    longitude: lon,
    latitude: lat,
    sog: 0,
    cog: 0,
    speed: 0,
    heading: 0,
    timestamp: '2026-06-02T00:00:00Z',
    status: 'moving',
    lastSeen: new Date('2026-06-02T00:00:00Z'),
    nearestDock: FAKE_DOCK,
  };
}

describe('useVesselFocus', () => {
  beforeEach(() => {
    flyToMock.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flies the map to the vessel coordinates when focusedMmsi is set', () => {
    const ref = { current: [makeVessel(123, -79.4, 43.62)] };
    const { result } = renderHook(() =>
      useVesselFocus({ vesselPositionsRef: ref, focusedMmsi: 123 }),
    );
    expect(flyToMock).toHaveBeenCalledTimes(1);
    expect(flyToMock.mock.calls[0][0]).toMatchObject({
      center: [-79.4, 43.62],
      zoom: 15.5,
    });
    expect(result.current.isFocused).toBe(true);
  });

  it('does not call flyTo when focusedMmsi is null', () => {
    const ref = { current: [makeVessel(123, -79.4, 43.62)] };
    const { result } = renderHook(() =>
      useVesselFocus({ vesselPositionsRef: ref, focusedMmsi: null }),
    );
    expect(flyToMock).not.toHaveBeenCalled();
    expect(result.current.isFocused).toBe(false);
  });

  it('auto-releases focus after durationMs and fires onRelease', () => {
    const ref = { current: [makeVessel(123, -79.4, 43.62)] };
    const onRelease = vi.fn();
    const { result } = renderHook(() =>
      useVesselFocus({
        vesselPositionsRef: ref,
        focusedMmsi: 123,
        durationMs: 1000,
        onRelease,
      }),
    );
    expect(result.current.isFocused).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.isFocused).toBe(false);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('releaseFocus() clears the timer and releases immediately', () => {
    const ref = { current: [makeVessel(123, -79.4, 43.62)] };
    const onRelease = vi.fn();
    const { result } = renderHook(() =>
      useVesselFocus({
        vesselPositionsRef: ref,
        focusedMmsi: 123,
        durationMs: 10_000,
        onRelease,
      }),
    );
    act(() => {
      result.current.releaseFocus();
    });
    expect(result.current.isFocused).toBe(false);
    expect(onRelease).toHaveBeenCalledTimes(1);
    onRelease.mockClear();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('does nothing when the vessel is not present in the ref', () => {
    const ref = { current: [makeVessel(999, -79.4, 43.62)] };
    const { result } = renderHook(() =>
      useVesselFocus({ vesselPositionsRef: ref, focusedMmsi: 123 }),
    );
    expect(flyToMock).not.toHaveBeenCalled();
    expect(result.current.isFocused).toBe(false);
  });
});
