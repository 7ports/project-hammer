import type { DockLocation } from './docks';
import type { RouteId } from '../types/schedule';

export const INFERENCE_CONFIG = {
  weights: { schedule: 0.5, cog: 0.3, route: 0.2 },
  cogRejectDeltaDeg: 90,
  cogScaleDeg: 45,
  polylineActivationMetres: 200,
  polylineScaleMetres: 150,
  scheduleHighWindow: { beforeMin: 2, afterMin: 20 },
  scheduleMediumWindow: { beforeMin: 10, afterMin: 30 },
  scheduleHighScore: 0.7,
  scheduleMediumScore: 0.3,
  scheduleLowScore: 0.05,
  hysteresisMargin: 0.15,
  hysteresisTicks: 3,
} as const;

export interface InferencePos {
  latitude: number;
  longitude: number;
  cog: number;
  sog: number;
}

export interface CandidateScore {
  dockId: string;
  pSchedule: number;
  pCog: number;
  pRoute: number;
  combined: number;
  rejected: boolean;
}

export interface HysteresisState {
  committedDockId?: string;
  pendingDockId?: string;
  pendingTickCount: number;
}

export interface InferenceResult {
  destination: DockLocation | undefined;
  confidence: number;
  reasons: string[];
  scores: CandidateScore[];
  hysteresis: HysteresisState;
}

export interface InferenceInput {
  pos: InferencePos;
  departedFrom: DockLocation | undefined;
  candidates: DockLocation[];
  findCandidateDepartures: (candidate: DockLocation) => Date[];
  routeGeometries: ReadonlyMap<RouteId, ReadonlyArray<readonly [number, number]>>;
  now: Date;
}

const DEG = Math.PI / 180;
const EARTH_R_M = 6_371_000;
const M_PER_DEG_LAT = 111_320;

export function bearingDegrees(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number {
  const phi1 = fromLat * DEG;
  const phi2 = toLat * DEG;
  const dLambda = (toLon - fromLon) * DEG;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x) / DEG;
  return (theta + 360) % 360;
}

export function shortestArcDelta(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

export function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return EARTH_R_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function perpendicularDistanceMetres(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const cosRef = Math.cos(pLat * DEG);
  const px = pLon * M_PER_DEG_LAT * cosRef;
  const py = pLat * M_PER_DEG_LAT;
  const ax = aLon * M_PER_DEG_LAT * cosRef;
  const ay = aLat * M_PER_DEG_LAT;
  const bx = bLon * M_PER_DEG_LAT * cosRef;
  const by = bLat * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function polylineMinDistanceMetres(
  lat: number,
  lon: number,
  polyline: ReadonlyArray<readonly [number, number]>,
): number {
  if (!polyline || polyline.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const [aLon, aLat] = polyline[i];
    const [bLon, bLat] = polyline[i + 1];
    const d = perpendicularDistanceMetres(lat, lon, aLat, aLon, bLat, bLon);
    if (d < min) min = d;
  }
  return min;
}

export function scheduleScore(
  now: Date,
  departures: Date[],
): { score: number; minutesSinceNearestDep: number | null } {
  if (departures.length === 0) return { score: 0, minutesSinceNearestDep: null };
  let nearestMs = Infinity;
  for (const d of departures) {
    const dt = now.getTime() - d.getTime();
    if (Math.abs(dt) < Math.abs(nearestMs)) nearestMs = dt;
  }
  const m = nearestMs / 60_000;
  const {
    scheduleHighWindow,
    scheduleMediumWindow,
    scheduleHighScore,
    scheduleMediumScore,
    scheduleLowScore,
  } = INFERENCE_CONFIG;
  let score: number;
  if (m >= -scheduleHighWindow.beforeMin && m <= scheduleHighWindow.afterMin) {
    score = scheduleHighScore;
  } else if (
    m >= -scheduleMediumWindow.beforeMin &&
    m <= scheduleMediumWindow.afterMin
  ) {
    score = scheduleMediumScore;
  } else {
    score = scheduleLowScore;
  }
  return { score, minutesSinceNearestDep: m };
}

export function cogScore(deltaDeg: number): number {
  if (!Number.isFinite(deltaDeg)) return 0;
  if (deltaDeg > INFERENCE_CONFIG.cogRejectDeltaDeg) return 0;
  return Math.max(0, 1 - deltaDeg / INFERENCE_CONFIG.cogScaleDeg);
}

export function routeScore(distMetres: number): number {
  if (!Number.isFinite(distMetres)) return 0;
  return Math.exp(-distMetres / INFERENCE_CONFIG.polylineScaleMetres);
}

interface RawSignal {
  dockId: string;
  rawSchedule: number;
  rawCog: number;
  rawRoute: number;
  cogDelta: number;
  rejected: boolean;
  routeDistMetres: number | null;
}

function trivialCommit(c: DockLocation): InferenceResult {
  return {
    destination: c,
    confidence: 1,
    reasons: ['single-candidate'],
    scores: [
      { dockId: c.id, pSchedule: 0, pCog: 0, pRoute: 0, combined: 1, rejected: false },
    ],
    hysteresis: { committedDockId: c.id, pendingTickCount: 0 },
  };
}

export function inferDestination(
  input: InferenceInput,
  prev?: HysteresisState,
): InferenceResult {
  const {
    pos,
    departedFrom,
    candidates,
    findCandidateDepartures,
    routeGeometries,
    now,
  } = input;

  if (candidates.length === 0) {
    return {
      destination: undefined,
      confidence: 0,
      reasons: ['no-candidates'],
      scores: [],
      hysteresis: { committedDockId: prev?.committedDockId, pendingTickCount: 0 },
    };
  }

  if (candidates.length === 1) {
    return trivialCommit(candidates[0]);
  }

  const polylineActivated =
    departedFrom !== undefined &&
    haversineMetres(
      pos.latitude,
      pos.longitude,
      departedFrom.coordinates[1],
      departedFrom.coordinates[0],
    ) > INFERENCE_CONFIG.polylineActivationMetres;

  const raws: RawSignal[] = candidates.map((c) => {
    const departures = findCandidateDepartures(c);
    const rawSchedule = scheduleScore(now, departures).score;

    const bearingToDock = bearingDegrees(
      pos.latitude,
      pos.longitude,
      c.coordinates[1],
      c.coordinates[0],
    );
    const cogDelta = shortestArcDelta(pos.cog, bearingToDock);
    const rejected = cogDelta > INFERENCE_CONFIG.cogRejectDeltaDeg;
    const rawCog = rejected ? 0 : cogScore(cogDelta);

    let rawRoute = 0;
    let routeDistMetres: number | null = null;
    if (polylineActivated) {
      let minDist = Infinity;
      for (const r of c.routes) {
        const poly = routeGeometries.get(r.routeId);
        if (!poly) continue;
        const d = polylineMinDistanceMetres(pos.latitude, pos.longitude, poly);
        if (d < minDist) minDist = d;
      }
      if (Number.isFinite(minDist)) {
        routeDistMetres = minDist;
        rawRoute = routeScore(minDist);
      }
    }

    return {
      dockId: c.id,
      rawSchedule,
      rawCog,
      rawRoute,
      cogDelta,
      rejected,
      routeDistMetres,
    };
  });

  const totalSched = raws.reduce((s, r) => s + (r.rejected ? 0 : r.rawSchedule), 0);
  const totalCog = raws.reduce((s, r) => s + (r.rejected ? 0 : r.rawCog), 0);
  const totalRoute = raws.reduce((s, r) => s + (r.rejected ? 0 : r.rawRoute), 0);

  const scores: CandidateScore[] = raws.map((r) => {
    if (r.rejected) {
      return {
        dockId: r.dockId,
        pSchedule: 0,
        pCog: 0,
        pRoute: 0,
        combined: 0,
        rejected: true,
      };
    }
    const pSchedule = totalSched > 0 ? r.rawSchedule / totalSched : 0;
    const pCog = totalCog > 0 ? r.rawCog / totalCog : 0;
    const pRoute = totalRoute > 0 ? r.rawRoute / totalRoute : 0;
    const { weights } = INFERENCE_CONFIG;
    const combined =
      weights.schedule * pSchedule + weights.cog * pCog + weights.route * pRoute;
    return { dockId: r.dockId, pSchedule, pCog, pRoute, combined, rejected: false };
  });

  let bestIdx = -1;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i].rejected) continue;
    if (bestIdx === -1 || scores[i].combined > scores[bestIdx].combined) bestIdx = i;
  }

  const reasons: string[] = [];
  for (const s of scores) {
    if (s.rejected) continue;
    if (s.pSchedule > 0) reasons.push(`schedule:${s.dockId}:${s.pSchedule.toFixed(2)}`);
  }
  for (const r of raws) {
    if (!r.rejected) reasons.push(`cog:${r.dockId}:Δ${r.cogDelta.toFixed(0)}°`);
  }
  for (const r of raws) {
    if (r.routeDistMetres !== null) {
      reasons.push(`route:${r.dockId}:${r.routeDistMetres.toFixed(0)}m`);
    }
  }

  if (bestIdx === -1) {
    reasons.push('all-rejected');
    return {
      destination: undefined,
      confidence: 0,
      reasons: reasons.slice(0, 12),
      scores,
      hysteresis: { committedDockId: prev?.committedDockId, pendingTickCount: 0 },
    };
  }

  const best = scores[bestIdx];
  const prevCommittedId = prev?.committedDockId;
  let hysteresis: HysteresisState;
  let action: string;
  if (!prevCommittedId || !candidates.some((c) => c.id === prevCommittedId)) {
    hysteresis = { committedDockId: best.dockId, pendingTickCount: 0 };
    action = 'cold-start';
  } else if (best.dockId === prevCommittedId) {
    hysteresis = { committedDockId: prevCommittedId, pendingTickCount: 0 };
    action = 'holding';
  } else {
    const committedScore =
      scores.find((s) => s.dockId === prevCommittedId)?.combined ?? 0;
    const margin = best.combined - committedScore;
    if (margin < INFERENCE_CONFIG.hysteresisMargin) {
      hysteresis = { committedDockId: prevCommittedId, pendingTickCount: 0 };
      action = 'below-margin';
    } else {
      const sameAsPending = prev?.pendingDockId === best.dockId;
      const newTickCount = sameAsPending ? (prev?.pendingTickCount ?? 0) + 1 : 1;
      if (newTickCount >= INFERENCE_CONFIG.hysteresisTicks) {
        hysteresis = { committedDockId: best.dockId, pendingTickCount: 0 };
        action = 'switched';
      } else {
        hysteresis = {
          committedDockId: prevCommittedId,
          pendingDockId: best.dockId,
          pendingTickCount: newTickCount,
        };
        action = 'pending-switch';
      }
    }
  }
  reasons.push(action);

  const totalCombined = scores.reduce((s, sc) => s + sc.combined, 0);
  const confidence = totalCombined > 1e-9 ? best.combined / totalCombined : 0;

  const destination = candidates.find((c) => c.id === hysteresis.committedDockId);

  return {
    destination,
    confidence,
    reasons: reasons.slice(0, 12),
    scores,
    hysteresis,
  };
}
