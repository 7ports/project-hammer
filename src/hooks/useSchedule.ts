import { useState, useEffect, useMemo } from 'react';
import type { ScheduleData, ScheduleSeason, Departure, RouteId, DayOfWeek } from '../types/schedule';

export interface UseScheduleResult {
  schedule: ScheduleData | null;
  activeSeason: ScheduleSeason | null;
  routes: ScheduleSeason['routes'];
  loading: boolean;
  error: string | null;
  upcomingDepartures: (routeId: RouteId, direction: 'outbound' | 'inbound', count: number) => Departure[];
}

const DAY_NAMES: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Find the active season for a given date (YYYY-MM-DD string).
 * Looks for the season where effectiveFrom <= today <= effectiveUntil.
 * Falls back to the most recent past season if none match today.
 */
function findActiveSeason(schedule: ScheduleData, today: string): ScheduleSeason | null {
  if (schedule.seasons.length === 0) return null;

  // First: exact range match
  const exact = schedule.seasons.find(
    s => today >= s.effectiveFrom && today <= s.effectiveUntil,
  );
  if (exact) return exact;

  // Fallback: most recent season whose effectiveFrom is in the past
  const past = schedule.seasons
    .filter(s => s.effectiveFrom <= today)
    .sort((a, b) => (a.effectiveFrom > b.effectiveFrom ? -1 : 1));

  return past[0] ?? schedule.seasons[0];
}

function getUpcoming(
  activeSeason: ScheduleSeason | null,
  routeId: RouteId,
  direction: 'outbound' | 'inbound',
  count: number,
): Departure[] {
  if (!activeSeason) return [];

  const route = activeSeason.routes.find(r => r.routeId === routeId);
  if (!route) return [];

  const now = new Date();
  const todayDay = DAY_NAMES[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const todaysDepartures = route.departures
    .filter(d =>
      d.direction === direction &&
      d.days.includes(todayDay) &&
      !d.peakOnly,
    )
    .map(d => {
      const [h, m] = d.time.split(':').map(Number);
      return { departure: d, minutes: h * 60 + m };
    })
    .filter(({ minutes }) => minutes > currentMinutes)
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, count)
    .map(({ departure }) => departure);

  return todaysDepartures;
}

export function useSchedule(): UseScheduleResult {
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/schedule.json')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load schedule: ${r.status}`);
        return r.json() as Promise<ScheduleData>;
      })
      .then(data => {
        if (!cancelled) {
          setSchedule(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  const activeSeason = useMemo((): ScheduleSeason | null => {
    if (!schedule) return null;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return findActiveSeason(schedule, today);
  }, [schedule]);

  const routes = useMemo(
    () => activeSeason?.routes ?? [],
    [activeSeason],
  );

  const upcomingDepartures = useMemo(
    () => (routeId: RouteId, direction: 'outbound' | 'inbound', count: number) =>
      getUpcoming(activeSeason, routeId, direction, count),
    [activeSeason],
  );

  return { schedule, activeSeason, routes, loading, error, upcomingDepartures };
}
