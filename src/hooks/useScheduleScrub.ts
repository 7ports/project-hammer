import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ScheduleData, RouteId, DayOfWeek, ScheduleSeason } from '../types/schedule';
import type { Vessel } from '../types/vessel';

export interface ScheduleScrubGap {
  routeId: RouteId;
  /** HH:MM of the next scheduled departure at scrubAt, or null if none today. */
  scheduledTime: string | null;
  scheduledDirection: 'outbound' | 'inbound';
  /** Count of live vessels currently associated with this route's docks. */
  vesselsCurrentlyOnRoute: number;
  /**
   * (scheduled-at-scrubAt) minus (scheduled-now), in minutes. Positive = the
   * scrub preview is ahead of live. Null when either side has no upcoming
   * departure today.
   */
  gapMinutes: number | null;
}

export interface UseScheduleScrubResult {
  /** Minutes offset from now (negative = past preview, positive = future preview). */
  scrubOffsetMin: number;
  /** Update the scrub offset (0 = back to live). */
  setScrubOffsetMin: (mins: number) => void;
  /** The effective preview time = now + scrubOffsetMin. */
  scrubAt: Date;
  /** True when the offset is exactly zero (following the live clock). */
  isLive: boolean;
  /** Reset to live (offset = 0). */
  reset: () => void;
  /** Per-(route, direction) gap snapshot at scrubAt vs now. */
  gaps: ScheduleScrubGap[];
}

const DAY_NAMES: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const ROUTE_IDS: RouteId[] = [
  'jack-layton-wards',
  'jack-layton-centre',
  'jack-layton-hanlans',
  'jack-layton-billy-bishop',
];

const DIRECTIONS: ReadonlyArray<'outbound' | 'inbound'> = ['outbound', 'inbound'];

function findActiveSeason(
  schedule: ScheduleData,
  today: string,
): ScheduleSeason | null {
  if (schedule.seasons.length === 0) return null;
  const exact = schedule.seasons.find(
    s => today >= s.effectiveFrom && today <= s.effectiveUntil,
  );
  if (exact) return exact;
  const past = schedule.seasons
    .filter(s => s.effectiveFrom <= today)
    .sort((a, b) => (a.effectiveFrom > b.effectiveFrom ? -1 : 1));
  return past[0] ?? schedule.seasons[0];
}

function nextDepartureAt(
  schedule: ScheduleData | null,
  routeId: RouteId,
  direction: 'outbound' | 'inbound',
  at: Date,
): string | null {
  if (!schedule) return null;
  const today = at.toISOString().slice(0, 10);
  const season = findActiveSeason(schedule, today);
  if (!season) return null;
  const route = season.routes.find(r => r.routeId === routeId);
  if (!route) return null;
  const day = DAY_NAMES[at.getDay()];
  const mins = at.getHours() * 60 + at.getMinutes();
  let best: { time: string; minutes: number } | null = null;
  for (const d of route.departures) {
    if (d.direction !== direction) continue;
    if (!d.days.includes(day)) continue;
    if (d.peakOnly) continue;
    const [h, m] = d.time.split(':').map(Number);
    const minutes = h * 60 + m;
    if (minutes < mins) continue;
    if (!best || minutes < best.minutes) {
      best = { time: d.time, minutes };
    }
  }
  return best?.time ?? null;
}

function dockIdsForRoute(routeId: RouteId): readonly string[] {
  switch (routeId) {
    case 'jack-layton-wards':
      return ['jack-layton', 'wards-island'];
    case 'jack-layton-centre':
      return ['jack-layton', 'centre-island'];
    case 'jack-layton-hanlans':
      return ['jack-layton', 'hanlans-point'];
    case 'jack-layton-billy-bishop':
      return ['jack-layton', 'billy-bishop-airport'];
  }
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * useScheduleScrub — realtime feedback loop for the schedule timeline.
 *
 * The user moves a slider (or otherwise drives scrubOffsetMin) to preview
 * what the schedule says at an offset from "now". The hook returns the
 * preview time (scrubAt), a "live" flag (offset === 0), a reset action, and a
 * per-(route, direction) gap snapshot comparing scheduled-at-scrubAt vs
 * scheduled-now plus live vessel counts on each route.
 *
 * Side-effects: a 30s ticking interval is created ONLY while isLive is true,
 * to keep scrubAt fresh against the wall clock; it is torn down whenever the
 * user pulls the scrubber off zero. No globals.
 */
export function useScheduleScrub(
  schedule: ScheduleData | null,
  vessels: readonly Vessel[],
): UseScheduleScrubResult {
  const [scrubOffsetMin, setScrubOffsetMinState] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (scrubOffsetMin !== 0) return;
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, [scrubOffsetMin]);

  const setScrubOffsetMin = useCallback((mins: number) => {
    setScrubOffsetMinState(mins);
  }, []);

  const reset = useCallback(() => setScrubOffsetMinState(0), []);

  const scrubAt = useMemo(
    () => new Date(Date.now() + scrubOffsetMin * 60_000),
    // tick is intentionally a dep so live mode refreshes every 30s
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrubOffsetMin, tick],
  );

  const gaps = useMemo<ScheduleScrubGap[]>(() => {
    if (!schedule) return [];
    const now = new Date();
    const out: ScheduleScrubGap[] = [];
    for (const routeId of ROUTE_IDS) {
      for (const direction of DIRECTIONS) {
        const scheduledTime = nextDepartureAt(schedule, routeId, direction, scrubAt);
        if (scheduledTime === null) continue;
        const dockIds = dockIdsForRoute(routeId);
        const vesselsCurrentlyOnRoute = vessels.filter(v => {
          if (dockIds.includes(v.nearestDock.id)) return true;
          if (v.destination && dockIds.includes(v.destination.id)) return true;
          return false;
        }).length;
        const actualNext = nextDepartureAt(schedule, routeId, direction, now);
        const gapMinutes =
          actualNext !== null
            ? hhmmToMinutes(scheduledTime) - hhmmToMinutes(actualNext)
            : null;
        out.push({
          routeId,
          scheduledTime,
          scheduledDirection: direction,
          vesselsCurrentlyOnRoute,
          gapMinutes,
        });
      }
    }
    return out;
  }, [schedule, vessels, scrubAt]);

  return {
    scrubOffsetMin,
    setScrubOffsetMin,
    scrubAt,
    isLive: scrubOffsetMin === 0,
    reset,
    gaps,
  };
}
