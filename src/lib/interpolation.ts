import type { VesselPosition } from '../types/ais';

/** Linear interpolation between two numbers */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smoothstep easing — smooth start and end, ideal for position interpolation */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Interpolate between two angles (degrees, 0-359), taking the shortest arc.
 * Handles wraparound correctly (e.g. 350° → 10° goes via 360°/0°, not backwards through 180°).
 */
export function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180; // shortest arc, range -180..180
  return (a + delta * t + 360) % 360;
}

/**
 * Interpolate between two VesselPosition snapshots.
 * Returns a new VesselPosition with interpolated lat/lng/heading.
 * speed and timestamp are taken from `to` (the target snapshot).
 */
export function lerpPosition(
  from: VesselPosition,
  to: VesselPosition,
  t: number,
): VesselPosition {
  return {
    ...to,
    latitude: lerp(from.latitude, to.latitude, t),
    longitude: lerp(from.longitude, to.longitude, t),
    heading: lerpAngle(from.heading, to.heading, t),
  };
}
