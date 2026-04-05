import { useState, useEffect, useMemo } from 'react';
import type { ScheduleData, Departure, RouteId, DayOfWeek } from '../types/schedule';

export interface UseScheduleResult {
  schedule: ScheduleData | null;
  loading: boolean;
  error: string | null;
  upcomingDepartures: (routeId: RouteId, direction: 'outbound' | 'inbound', count: number) => Departure[];
}

const DAY_NAMES: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function getUpcoming(
  schedule: ScheduleData | null,
  routeId: RouteId,
  direction: 'outbound' | 'inbound',
  count: number,
): Departure[] {
  if (!schedule) return [];

  const route = schedule.routes.find(r => r.routeId === routeId);
  if (!route) return [];

  const now = new Date();
  const todayDay = DAY_NAMES[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const todaysDepartures = route.departures
    .filter(d => d.direction === direction && d.days.includes(todayDay))
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

  const upcomingDepartures = useMemo(
    () => (routeId: RouteId, direction: 'outbound' | 'inbound', count: number) =>
      getUpcoming(schedule, routeId, direction, count),
    [schedule],
  );

  return { schedule, loading, error, upcomingDepartures };
}
