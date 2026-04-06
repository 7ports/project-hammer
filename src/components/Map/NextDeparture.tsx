import { useMemo } from 'react';
import { useSchedule } from '../../hooks/useSchedule';
import type { RouteId } from '../../types/schedule';
import './NextDeparture.css';

interface NextDepartureProps {
  className?: string;
}

const TWO_HOURS_MINUTES = 120;

/** Format HH:MM 24h time string to a compact 12h display e.g. "6:30 am" */
function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'am' : 'pm';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

export function NextDeparture({ className }: NextDepartureProps) {
  const { activeSeason, upcomingDepartures, loading, error } = useSchedule();

  const routeDepartures = useMemo(() => {
    if (!activeSeason) return [];

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const cutoffMinutes = currentMinutes + TWO_HOURS_MINUTES;

    return activeSeason.routes
      .map(route => {
        const upcoming = upcomingDepartures(route.routeId as RouteId, 'outbound', 2).filter(d => {
          const [h, m] = d.time.split(':').map(Number);
          return h * 60 + m <= cutoffMinutes;
        });
        return { routeId: route.routeId, name: route.name, times: upcoming.map(d => d.time) };
      })
      .filter(r => r.times.length > 0);
  }, [activeSeason, upcomingDepartures]);

  const nextAnyDeparture = useMemo(() => {
    if (!activeSeason || routeDepartures.length > 0) return null;
    let earliest: string | null = null;
    for (const route of activeSeason.routes) {
      const deps = upcomingDepartures(route.routeId as RouteId, 'outbound', 50);
      if (deps.length > 0 && (earliest === null || deps[0].time < earliest)) {
        earliest = deps[0].time;
      }
    }
    return earliest;
  }, [activeSeason, routeDepartures, upcomingDepartures]);

  const asideClass = ['next-departure', className].filter(Boolean).join(' ');

  if (loading) {
    return (
      <aside className={asideClass} role="complementary" aria-label="Next ferry departures">
        <div className="next-departure__label">Next departures</div>
        <p className="next-departure__empty">Loading schedule…</p>
      </aside>
    );
  }

  if (error) {
    return (
      <aside className={asideClass} role="complementary" aria-label="Next ferry departures">
        <div className="next-departure__label">Next departures</div>
        <p className="next-departure__empty">Schedule unavailable</p>
      </aside>
    );
  }

  if (routeDepartures.length === 0) {
    return (
      <aside className={asideClass} role="complementary" aria-label="Next ferry departures">
        <div className="next-departure__label">Next departures</div>
        <p className="next-departure__empty">
          {nextAnyDeparture
            ? `No service now — next at ${formatTime(nextAnyDeparture)}`
            : 'No service today'}
        </p>
      </aside>
    );
  }

  return (
    <aside className={asideClass} role="complementary" aria-label="Next ferry departures">
      <div className="next-departure__label">Next departures</div>
      <ul className="next-departure__list">
        {routeDepartures.map(({ routeId, name, times }) => (
          <li key={routeId} className="next-departure__row">
            <span className="next-departure__route">{name}</span>
            <span className="next-departure__times">
              {times.map(formatTime).join('  ')}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
