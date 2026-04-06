import { describe, it, expect } from 'vitest';
import { lerp, lerpAngle, lerpPosition } from './interpolation';
import type { VesselPosition } from '../types/ais';

// ---------------------------------------------------------------------------
// lerp
// ---------------------------------------------------------------------------
describe('lerp', () => {
  it('returns start value at t=0', () => {
    expect(lerp(0, 10, 0)).toBe(0);
  });

  it('returns end value at t=1', () => {
    expect(lerp(0, 10, 1)).toBe(10);
  });

  it('interpolates midpoint at t=0.5', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('interpolates midpoint correctly when range spans negative to positive', () => {
    expect(lerp(-5, 5, 0.5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lerpAngle
// ---------------------------------------------------------------------------
describe('lerpAngle', () => {
  it('returns midpoint angle for simple case (no wraparound)', () => {
    expect(lerpAngle(0, 90, 0.5)).toBe(45);
  });

  it('takes the shortest arc when crossing 360°/0° (350° → 10°)', () => {
    // Shortest arc is 20°; midpoint should be 0° (360°)
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 5);
  });

  it('takes the shortest arc in reverse (10° → 350°)', () => {
    // Shortest arc goes backwards through 0°; midpoint should be 0° (or 360°)
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0, 5);
  });

  it('picks the negative arc when delta is exactly 180° (0° → 180° ties to 270°)', () => {
    // delta = ((180 - 0 + 540) % 360) - 180 = -180 (negative tie-break)
    // result = (0 + (-180 * 0.5) + 360) % 360 = 270
    expect(lerpAngle(0, 180, 0.5)).toBe(270);
  });
});

// ---------------------------------------------------------------------------
// lerpPosition
// ---------------------------------------------------------------------------

const makeVessel = (overrides: Partial<VesselPosition>): VesselPosition => ({
  mmsi: 316045069,
  name: 'Sam McBride',
  latitude: 43.63,
  longitude: -79.38,
  heading: 0,
  speed: 5,
  timestamp: '2026-04-05T12:00:00Z',
  ...overrides,
});

describe('lerpPosition', () => {
  const from = makeVessel({ latitude: 43.63, longitude: -79.38, heading: 0 });
  const to = makeVessel({ latitude: 43.64, longitude: -79.37, heading: 90 });

  it('returns from coordinates at t=0', () => {
    const result = lerpPosition(from, to, 0);
    expect(result.latitude).toBe(from.latitude);
    expect(result.longitude).toBe(from.longitude);
    expect(result.heading).toBe(from.heading);
  });

  it('returns to coordinates at t=1', () => {
    const result = lerpPosition(from, to, 1);
    expect(result.latitude).toBe(to.latitude);
    expect(result.longitude).toBe(to.longitude);
    expect(result.heading).toBe(to.heading);
  });

  it('returns midpoint lat/lng at t=0.5', () => {
    const result = lerpPosition(from, to, 0.5);
    expect(result.latitude).toBeCloseTo((from.latitude + to.latitude) / 2, 10);
    expect(result.longitude).toBeCloseTo((from.longitude + to.longitude) / 2, 10);
  });
});
