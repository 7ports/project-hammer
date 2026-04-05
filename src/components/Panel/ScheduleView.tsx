import { useState, useEffect } from 'react';
import { useSchedule } from '../../hooks/useSchedule';
import { useServiceStatus } from '../../hooks/useServiceStatus';
import type { RouteId } from '../../types/schedule';
import type { ServiceState } from '../../types/serviceStatus';
import './ScheduleView.css';

const ROUTE_DISPLAY: { id: RouteId; label: string }[] = [
  { id: 'jack-layton-wards', label: "Ward's Island" },
  { id: 'jack-layton-centre', label: 'Centre Island' },
  { id: 'jack-layton-hanlans', label: "Hanlan's Point" },
];

const STATUS_LABELS: Record<ServiceState, string> = {
  operating: 'Operating',
  'seasonal-closure': 'Seasonal closure',
  disrupted: 'Disrupted',
  unknown: 'Status unknown',
};

const STATUS_CSS_CLASS: Record<ServiceState, string> = {
  operating: 'status--operating',
  'seasonal-closure': 'status--seasonal',
  disrupted: 'status--disrupted',
  unknown: 'status--unknown',
};

// Countdown timer for the next imminent departure (within 10 minutes)
function useCountdown(targetTime: string | null): string | null {
  const [countdown, setCountdown] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      if (!targetTime) { setCountdown(null); return; }
      const [h, m] = targetTime.split(':').map(Number);
      const now = new Date();
      const target = new Date(now);
      target.setHours(h, m, 0, 0);
      const diffMs = target.getTime() - now.getTime();
      if (diffMs < 0 || diffMs > 10 * 60 * 1000) { setCountdown(null); return; }
      const mins = Math.floor(diffMs / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      setCountdown(`${mins}m ${secs}s`);
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [targetTime]);

  return countdown;
}

interface RouteRowProps {
  routeId: RouteId;
  label: string;
}

function RouteRow({ routeId, label }: RouteRowProps) {
  const { loading, error, upcomingDepartures, activeSeason } = useSchedule();
  const { routes } = useServiceStatus();
  const routeStatus = routes.find(r => r.routeId === routeId);
  const state = routeStatus?.status ?? 'unknown';

  // Only show departures for routes that exist in the active season
  const routeInSeason = activeSeason?.routes.some(r => r.routeId === routeId) ?? false;
  const next4 = routeInSeason ? upcomingDepartures(routeId, 'outbound', 4) : [];
  const firstTime = next4[0]?.time ?? null;
  const countdown = useCountdown(firstTime);

  if (loading) {
    return (
      <div className="schedule-route" aria-busy="true">
        <div className="schedule-route__header">
          <span className="schedule-route__name">{label}</span>
        </div>
        <div className="schedule-route__skeleton" aria-label="Loading schedule..." />
        <div className="schedule-route__skeleton schedule-route__skeleton--sm" />
        <div className="schedule-route__skeleton schedule-route__skeleton--sm" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="schedule-route">
        <div className="schedule-route__header">
          <span className="schedule-route__name">{label}</span>
        </div>
        <p className="schedule-route__notice schedule-route__notice--error">Unable to load schedule</p>
      </div>
    );
  }

  // Route not operating in the active season (e.g. Centre/Hanlans in winter)
  if (!routeInSeason && state !== 'disrupted') {
    return (
      <div className="schedule-route">
        <div className="schedule-route__header">
          <span className="schedule-route__name">{label}</span>
          <span
            className={`schedule-route__status ${STATUS_CSS_CLASS['seasonal-closure']}`}
            aria-label={`${label}: ${STATUS_LABELS['seasonal-closure']}`}
          >
            {STATUS_LABELS['seasonal-closure']}
          </span>
        </div>
        <p className="schedule-route__notice">Not operating this season</p>
      </div>
    );
  }

  return (
    <div className="schedule-route">
      <div className="schedule-route__header">
        <span className="schedule-route__name">{label}</span>
        <span
          className={`schedule-route__status ${STATUS_CSS_CLASS[state]}`}
          aria-label={`${label}: ${STATUS_LABELS[state]}`}
        >
          {STATUS_LABELS[state]}
        </span>
      </div>

      {state === 'operating' ? (
        <div className="schedule-route__departures" aria-label={`Upcoming departures for ${label}`}>
          {next4.length === 0 ? (
            <p className="schedule-route__notice">No more departures today</p>
          ) : (
            next4.map((dep, i) => (
              <div key={`${dep.time}-${i}`} className="schedule-route__departure">
                <span className="schedule-route__time">{dep.time}</span>
                {i === 0 && countdown && (
                  <span className="schedule-route__countdown" aria-live="polite">
                    in {countdown}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <p
          className={`schedule-route__notice${state === 'disrupted' ? ' schedule-route__notice--disrupted' : ''}`}
          role={state === 'disrupted' ? 'alert' : undefined}
        >
          {routeStatus?.message ?? (state === 'seasonal-closure' ? 'Not operating this season' : 'Status unavailable')}
        </p>
      )}
    </div>
  );
}

export function ScheduleView() {
  const { activeSeason, loading } = useSchedule();

  const seasonBadge = !loading && activeSeason ? (
    <div className="schedule-view__season">
      <span className="schedule-view__season-name">{activeSeason.name} Schedule</span>
      {activeSeason.note && (
        <p className="schedule-view__season-note">{activeSeason.note}</p>
      )}
    </div>
  ) : null;

  return (
    <section className="schedule-view" aria-label="Ferry departure schedule">
      <h3 className="schedule-view__title">Departures</h3>
      {seasonBadge}
      {ROUTE_DISPLAY.map(({ id, label }) => (
        <RouteRow key={id} routeId={id} label={label} />
      ))}
    </section>
  );
}
