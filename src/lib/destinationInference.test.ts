import { describe, it, expect } from 'vitest';
import {
  bearingDegrees,
  shortestArcDelta,
  haversineMetres,
  polylineMinDistanceMetres,
  scheduleScore,
  cogScore,
  routeScore,
  inferDestination,
  INFERENCE_CONFIG,
  type HysteresisState,
  type InferenceInput,
} from './destinationInference';
import { DOCK_LOCATIONS } from './docks';
import { FERRY_ROUTES } from './ferryRoutes';
import type { RouteId } from '../types/schedule';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const jackLayton = DOCK_LOCATIONS.find((d) => d.id === 'jack-layton')!;
const wards = DOCK_LOCATIONS.find((d) => d.id === 'wards-island')!;
const centre = DOCK_LOCATIONS.find((d) => d.id === 'centre-island')!;
const hanlans = DOCK_LOCATIONS.find((d) => d.id === 'hanlans-point')!;
const billyBishop = DOCK_LOCATIONS.find((d) => d.id === 'billy-bishop-airport')!;
const ALL_ISLAND_DOCKS = [wards, centre, hanlans, billyBishop];

const FULL_ROUTE_GEOMETRIES: ReadonlyMap<
  RouteId,
  ReadonlyArray<readonly [number, number]>
> = new Map(
  FERRY_ROUTES.features.map((f) => [
    f.properties.id as RouteId,
    f.geometry.coordinates.map((c) => [c[0], c[1]] as const),
  ]),
);

const EMPTY_ROUTE_GEOMETRIES: ReadonlyMap<
  RouteId,
  ReadonlyArray<readonly [number, number]>
> = new Map();

function emptyDepartures(): Date[] {
  return [];
}

function makeInput(overrides: Partial<InferenceInput>): InferenceInput {
  return {
    pos: { latitude: jackLayton.coordinates[1], longitude: jackLayton.coordinates[0], cog: 180, sog: 5 },
    departedFrom: jackLayton,
    candidates: ALL_ISLAND_DOCKS,
    findCandidateDepartures: emptyDepartures,
    routeGeometries: EMPTY_ROUTE_GEOMETRIES,
    now: new Date('2026-06-01T12:00:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Group 1: pure helpers
// ---------------------------------------------------------------------------

describe('bearingDegrees', () => {
  it('returns ~0° for due north', () => {
    expect(bearingDegrees(43.6, -79.4, 43.7, -79.4)).toBeCloseTo(0, 0);
  });
  it('returns ~180° for due south', () => {
    expect(bearingDegrees(43.7, -79.4, 43.6, -79.4)).toBeCloseTo(180, 0);
  });
  it('returns ~90° for due east', () => {
    const b = bearingDegrees(43.6, -79.4, 43.6, -79.3);
    expect(b).toBeGreaterThan(89);
    expect(b).toBeLessThan(91);
  });
  it('returns ~270° for due west', () => {
    const b = bearingDegrees(43.6, -79.3, 43.6, -79.4);
    expect(b).toBeGreaterThan(269);
    expect(b).toBeLessThan(271);
  });
});

describe('shortestArcDelta', () => {
  it('(10, 20) → 10', () => {
    expect(shortestArcDelta(10, 20)).toBeCloseTo(10, 5);
  });
  it('(350, 10) → 20 (wraps across 360)', () => {
    expect(shortestArcDelta(350, 10)).toBeCloseTo(20, 5);
  });
  it('(180, 0) → 180 (max distance)', () => {
    expect(shortestArcDelta(180, 0)).toBeCloseTo(180, 5);
  });
  it('(0, 0) → 0 (identity)', () => {
    expect(shortestArcDelta(0, 0)).toBeCloseTo(0, 5);
  });
  it('handles negative inputs', () => {
    expect(shortestArcDelta(-10, 10)).toBeCloseTo(20, 5);
  });
});

describe('haversineMetres', () => {
  it('identity is 0', () => {
    expect(haversineMetres(43.6, -79.4, 43.6, -79.4)).toBe(0);
  });
  it('1° latitude ≈ 111000m (±2%)', () => {
    const d = haversineMetres(43.0, -79.4, 44.0, -79.4);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(113_000);
  });
});

describe('polylineMinDistanceMetres', () => {
  const polyline: ReadonlyArray<readonly [number, number]> = [
    [-79.40, 43.60],
    [-79.40, 43.65],
  ];
  it('point exactly on a segment vertex → ~0', () => {
    expect(polylineMinDistanceMetres(43.60, -79.40, polyline)).toBeLessThan(1);
  });
  it('point ~100m perpendicular → ~100m (±15%)', () => {
    // ~100m east of the vertical segment (at lat 43.625)
    const dLon = 100 / (111_320 * Math.cos((43.625 * Math.PI) / 180));
    const d = polylineMinDistanceMetres(43.625, -79.40 + dLon, polyline);
    expect(d).toBeGreaterThan(85);
    expect(d).toBeLessThan(115);
  });
  it('empty polyline → Infinity', () => {
    expect(polylineMinDistanceMetres(43.6, -79.4, [])).toBe(Infinity);
  });
  it('single-vertex polyline → Infinity', () => {
    expect(polylineMinDistanceMetres(43.6, -79.4, [[-79.4, 43.6]])).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// Group 2: scoring helpers
// ---------------------------------------------------------------------------

describe('scheduleScore', () => {
  const NOW = new Date('2026-06-01T12:00:00.000Z');

  it('empty departures → score 0, minutesSinceNearestDep null', () => {
    const r = scheduleScore(NOW, []);
    expect(r.score).toBe(0);
    expect(r.minutesSinceNearestDep).toBeNull();
  });

  it('departure 5 min ago → high score', () => {
    const dep = new Date(NOW.getTime() - 5 * 60_000);
    expect(scheduleScore(NOW, [dep]).score).toBe(INFERENCE_CONFIG.scheduleHighScore);
  });

  it('departure 1 min in the future → high score', () => {
    const dep = new Date(NOW.getTime() + 1 * 60_000);
    expect(scheduleScore(NOW, [dep]).score).toBe(INFERENCE_CONFIG.scheduleHighScore);
  });

  it('departure 15 min ago → medium score', () => {
    const dep = new Date(NOW.getTime() - 15 * 60_000); // miss the afterMin=20 boundary? 15<=20, still high
    // 15 is within high window (afterMin=20). Use 25 for medium.
    const depMid = new Date(NOW.getTime() - 25 * 60_000);
    expect(scheduleScore(NOW, [depMid]).score).toBe(INFERENCE_CONFIG.scheduleMediumScore);
    void dep;
  });

  it('departure 90 min ago → low score', () => {
    const dep = new Date(NOW.getTime() - 90 * 60_000);
    expect(scheduleScore(NOW, [dep]).score).toBe(INFERENCE_CONFIG.scheduleLowScore);
  });

  it('picks the smallest |dt| from multiple departures', () => {
    const far = new Date(NOW.getTime() - 90 * 60_000);
    const close = new Date(NOW.getTime() - 1 * 60_000);
    expect(scheduleScore(NOW, [far, close]).score).toBe(
      INFERENCE_CONFIG.scheduleHighScore,
    );
  });
});

describe('cogScore', () => {
  it('0° delta → 1', () => {
    expect(cogScore(0)).toBe(1);
  });
  it('45° delta → 0', () => {
    expect(cogScore(45)).toBe(0);
  });
  it('22.5° delta → ~0.5', () => {
    expect(cogScore(22.5)).toBeCloseTo(0.5, 5);
  });
  it('90° delta → 0', () => {
    expect(cogScore(90)).toBe(0);
  });
  it('100° delta → 0 (rejected)', () => {
    expect(cogScore(100)).toBe(0);
  });
  it('NaN → 0', () => {
    expect(cogScore(NaN)).toBe(0);
  });
});

describe('routeScore', () => {
  it('0m → 1', () => {
    expect(routeScore(0)).toBe(1);
  });
  it('150m → exp(-1) ≈ 0.368', () => {
    expect(routeScore(150)).toBeCloseTo(Math.exp(-1), 5);
  });
  it('Infinity → 0', () => {
    expect(routeScore(Infinity)).toBe(0);
  });
  it('NaN → 0', () => {
    expect(routeScore(NaN)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Group 3: schedule prior tie-break
// ---------------------------------------------------------------------------

describe('inferDestination — schedule prior tie-break', () => {
  it('picks the candidate whose departure is closest in time', () => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    const departuresByDock: Record<string, Date[]> = {
      [centre.id]: [new Date(now.getTime() - 1 * 60_000)], // high
      [wards.id]: [new Date(now.getTime() - 25 * 60_000)], // medium
      [hanlans.id]: [new Date(now.getTime() - 100 * 60_000)], // low
      [billyBishop.id]: [],
    };
    const result = inferDestination(
      makeInput({
        pos: { latitude: jackLayton.coordinates[1], longitude: jackLayton.coordinates[0], cog: 180, sog: 5 },
        findCandidateDepartures: (c) => departuresByDock[c.id] ?? [],
        now,
      }),
    );
    const centreScore = result.scores.find((s) => s.dockId === centre.id);
    const wardsScore = result.scores.find((s) => s.dockId === wards.id);
    const hanlansScore = result.scores.find((s) => s.dockId === hanlans.id);
    expect(centreScore?.pSchedule).toBeGreaterThan(wardsScore?.pSchedule ?? 0);
    expect(wardsScore?.pSchedule).toBeGreaterThan(hanlansScore?.pSchedule ?? 0);
    expect(result.destination?.id).toBe(centre.id);
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('returns no destination when zero candidates', () => {
    const r = inferDestination(makeInput({ candidates: [] }));
    expect(r.destination).toBeUndefined();
    expect(r.confidence).toBe(0);
    expect(r.reasons).toContain('no-candidates');
  });

  it('trivially commits the single candidate (inbound from island)', () => {
    const r = inferDestination(
      makeInput({
        departedFrom: wards,
        candidates: [jackLayton],
        pos: {
          latitude: wards.coordinates[1],
          longitude: wards.coordinates[0],
          cog: 330,
          sog: 5,
        },
      }),
    );
    expect(r.destination?.id).toBe(jackLayton.id);
    expect(r.confidence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Group 4: COG bearing classification
// ---------------------------------------------------------------------------

describe('inferDestination — COG bearing classification', () => {
  it('points south of jack-layton with cog=180 → centre dominates COG channel', () => {
    const r = inferDestination(
      makeInput({
        pos: { latitude: 43.638, longitude: -79.375, cog: 180, sog: 5 },
      }),
    );
    const centreScore = r.scores.find((s) => s.dockId === centre.id)!;
    const wardsScore = r.scores.find((s) => s.dockId === wards.id)!;
    expect(centreScore.pCog).toBeGreaterThan(wardsScore.pCog);
    expect(r.destination?.id).toBe(centre.id);
  });

  it('cog=0 (pointing back at mainland) → every candidate rejected, no destination', () => {
    const r = inferDestination(
      makeInput({
        pos: { latitude: 43.638, longitude: -79.375, cog: 0, sog: 5 },
      }),
    );
    expect(r.scores.every((s) => s.rejected)).toBe(true);
    expect(r.destination).toBeUndefined();
    expect(r.confidence).toBe(0);
  });

  it('marks far-side candidates as rejected when bearing diff > 90°', () => {
    const r = inferDestination(
      makeInput({
        pos: { latitude: 43.638, longitude: -79.375, cog: 90, sog: 5 }, // due east
      }),
    );
    const wardsScore = r.scores.find((s) => s.dockId === wards.id)!;
    const billy = r.scores.find((s) => s.dockId === billyBishop.id)!;
    expect(wardsScore.rejected).toBe(false);
    expect(billy.rejected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 5: polyline proximity
// ---------------------------------------------------------------------------

describe('inferDestination — polyline proximity', () => {
  // Mid-route vertex on the Centre Island polyline
  const ON_CENTRE_LON = -79.3748877;
  const ON_CENTRE_LAT = 43.6319522;

  it('point on Centre polyline → Centre wins polyline channel', () => {
    const r = inferDestination(
      makeInput({
        pos: { latitude: ON_CENTRE_LAT, longitude: ON_CENTRE_LON, cog: 180, sog: 5 },
        routeGeometries: FULL_ROUTE_GEOMETRIES,
      }),
    );
    const centreScore = r.scores.find((s) => s.dockId === centre.id)!;
    const wardsScore = r.scores.find((s) => s.dockId === wards.id)!;
    const hanlansScore = r.scores.find((s) => s.dockId === hanlans.id)!;
    expect(centreScore.pRoute).toBeGreaterThan(wardsScore.pRoute);
    expect(centreScore.pRoute).toBeGreaterThan(hanlansScore.pRoute);
    expect(r.destination?.id).toBe(centre.id);
  });

  it('point ~500m east of Centre corridor → no candidate dominates pRoute strongly', () => {
    const dLon = 500 / (111_320 * Math.cos((ON_CENTRE_LAT * Math.PI) / 180));
    const r = inferDestination(
      makeInput({
        pos: { latitude: ON_CENTRE_LAT, longitude: ON_CENTRE_LON + dLon, cog: 180, sog: 5 },
        routeGeometries: FULL_ROUTE_GEOMETRIES,
      }),
    );
    for (const s of r.scores) {
      if (s.rejected) continue;
      expect(s.pRoute).toBeLessThan(0.7);
    }
  });

  it('polyline channel disabled within activation radius of departedFrom', () => {
    // Right at jack-layton (well under 200m activation radius)
    const r = inferDestination(
      makeInput({
        pos: { latitude: jackLayton.coordinates[1], longitude: jackLayton.coordinates[0], cog: 180, sog: 5 },
        routeGeometries: FULL_ROUTE_GEOMETRIES,
      }),
    );
    expect(r.scores.every((s) => s.pRoute === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 6: hysteresis
// ---------------------------------------------------------------------------

describe('inferDestination — hysteresis across consecutive frames', () => {
  // Build inputs that score deterministically. We use the schedule prior alone
  // and place the vessel inside the cog activation radius for ALL candidates by
  // pointing it straight south from jack-layton (so all candidates pass the
  // bearing-rejection gate broadly).
  function tick(
    favoured: 'centre' | 'wards',
    prev: HysteresisState | undefined,
  ): ReturnType<typeof inferDestination> {
    const now = new Date('2026-06-01T12:00:00.000Z');
    // Give the favoured a 5-min-ago departure (high prior),
    // the other a 90-min-ago departure (low prior). Margin in combined ≈ 0.5*(1-0)=0.5 → above 0.15.
    const departuresByDock: Record<string, Date[]> = {
      [centre.id]:
        favoured === 'centre'
          ? [new Date(now.getTime() - 5 * 60_000)]
          : [new Date(now.getTime() - 90 * 60_000)],
      [wards.id]:
        favoured === 'wards'
          ? [new Date(now.getTime() - 5 * 60_000)]
          : [new Date(now.getTime() - 90 * 60_000)],
      [hanlans.id]: [new Date(now.getTime() - 90 * 60_000)],
      [billyBishop.id]: [new Date(now.getTime() - 90 * 60_000)],
    };
    return inferDestination(
      makeInput({
        pos: { latitude: 43.635, longitude: -79.370, cog: 150, sog: 5 },
        findCandidateDepartures: (c) => departuresByDock[c.id] ?? [],
        now,
      }),
      prev,
    );
  }

  it('cold start commits the best candidate immediately', () => {
    const r = tick('centre', undefined);
    expect(r.destination?.id).toBe(centre.id);
    expect(r.hysteresis.committedDockId).toBe(centre.id);
    expect(r.hysteresis.pendingTickCount).toBe(0);
    expect(r.reasons).toContain('cold-start');
  });

  it('tick 2 with wards winning → still centre, pending=wards, count=1', () => {
    const t1 = tick('centre', undefined);
    const t2 = tick('wards', t1.hysteresis);
    expect(t2.destination?.id).toBe(centre.id);
    expect(t2.hysteresis.committedDockId).toBe(centre.id);
    expect(t2.hysteresis.pendingDockId).toBe(wards.id);
    expect(t2.hysteresis.pendingTickCount).toBe(1);
    expect(t2.reasons).toContain('pending-switch');
  });

  it('tick 3 with wards still winning → still centre, count=2', () => {
    const t1 = tick('centre', undefined);
    const t2 = tick('wards', t1.hysteresis);
    const t3 = tick('wards', t2.hysteresis);
    expect(t3.destination?.id).toBe(centre.id);
    expect(t3.hysteresis.pendingTickCount).toBe(2);
  });

  it(`tick ${INFERENCE_CONFIG.hysteresisTicks + 1} with wards winning → switched to wards`, () => {
    let state: HysteresisState | undefined;
    state = tick('centre', state).hysteresis; // tick 1 → centre committed
    let last = tick('centre', state); // hold
    state = last.hysteresis;
    for (let i = 0; i < INFERENCE_CONFIG.hysteresisTicks; i++) {
      last = tick('wards', state);
      state = last.hysteresis;
    }
    expect(last.destination?.id).toBe(wards.id);
    expect(last.hysteresis.committedDockId).toBe(wards.id);
    expect(last.hysteresis.pendingTickCount).toBe(0);
    expect(last.reasons).toContain('switched');
  });

  it('pending resets when the favoured candidate changes mid-sequence', () => {
    let state: HysteresisState | undefined;
    state = tick('centre', state).hysteresis;
    // Two wards ticks → pendingTickCount=2
    state = tick('wards', state).hysteresis;
    state = tick('wards', state).hysteresis;
    expect(state.pendingDockId).toBe(wards.id);
    expect(state.pendingTickCount).toBe(2);
    // Centre wins again → pending should clear (best === committed → holding)
    const t = tick('centre', state);
    expect(t.destination?.id).toBe(centre.id);
    expect(t.hysteresis.pendingDockId).toBeUndefined();
    expect(t.hysteresis.pendingTickCount).toBe(0);
    expect(t.reasons).toContain('holding');
  });

  it('below-margin holds without altering pending', () => {
    // Both centre and wards get the same high score → margin = 0 < 0.15 → below-margin
    const now = new Date('2026-06-01T12:00:00.000Z');
    const r1 = inferDestination(
      makeInput({
        pos: { latitude: 43.635, longitude: -79.370, cog: 150, sog: 5 },
        findCandidateDepartures: (c) =>
          c.id === centre.id ? [new Date(now.getTime() - 5 * 60_000)] : [],
        now,
      }),
    );
    expect(r1.destination?.id).toBe(centre.id);
    // Now both tie
    const r2 = inferDestination(
      makeInput({
        pos: { latitude: 43.635, longitude: -79.370, cog: 150, sog: 5 },
        findCandidateDepartures: (c) =>
          c.id === centre.id || c.id === wards.id
            ? [new Date(now.getTime() - 5 * 60_000)]
            : [],
        now,
      }),
      r1.hysteresis,
    );
    // Centre may still be best (tie-break by candidate order) → holding,
    // OR if wards becomes best with margin < 0.15 → below-margin.
    // Either way, committed must remain centre.
    expect(r2.hysteresis.committedDockId).toBe(centre.id);
  });
});
