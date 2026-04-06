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

  if (loading || error || routeDepartures.length === 0) return null;

  return (
    <aside
      className={['next-departure', className].filter(Boolean).join(' ')}
      role="complementary"
      aria-label="Next ferry departures"
    >
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
