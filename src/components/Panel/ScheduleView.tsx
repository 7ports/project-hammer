import { useState, useEffect } from 'react';
import { useSchedule } from '../../hooks/useSchedule';
import { useScheduleScrub, type UseScheduleScrubResult } from '../../hooks/useScheduleScrub';
import { useServiceStatus } from '../../hooks/useServiceStatus';
import type { RouteId } from '../../types/schedule';
import type { ServiceState } from '../../types/serviceStatus';
import './ScheduleView.css';

const ROUTE_DISPLAY: { id: RouteId; label: string }[] = [
  { id: 'jack-layton-wards', label: "Ward's Island" },
  { id: 'jack-layton-centre', label: 'Centre Island' },
  { id: 'jack-layton-hanlans', label: "Hanlan's Point" },
  { id: 'jack-layton-billy-bishop', label: 'Billy Bishop Airport' },
];

const STATUS_LABELS: Record<ServiceState, string> = {
  operating: 'Operating',
  'seasonal-closure': 'Seasonal closure',
  disrupted: 'Disrupted',
  suspended: 'No service',
  unknown: 'Status unknown',
};

const STATUS_CSS_CLASS: Record<ServiceState, string> = {
  operating: 'status--operating',
  'seasonal-closure': 'status--seasonal',
  disrupted: 'status--disrupted',
  suspended: 'status--suspended',
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
  const { loading, error, upcomingDepartures, routes: activeRoutes } = useSchedule();
  const { routes } = useServiceStatus();
  const routeStatus = routes.find(r => r.routeId === routeId);
  const state = routeStatus?.status ?? 'unknown';

  // Only show departures for routes active in the current season (respects seasonStart/seasonEnd)
  const routeInSeason = activeRoutes.some(r => r.routeId === routeId);
  const next4 = routeInSeason ? upcomingDepartures(routeId, 'outbound', 4) : [];

  // Disrupted state: if the City posted specific times, filter to upcoming and show those.
  // Otherwise fall through to the regular schedule with a caveat.
  const parsedTimes = routeStatus?.parsedTimes ?? [];
  const upcomingParsedTimes = (() => {
    if (state !== 'disrupted' || parsedTimes.length === 0) return [];
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return parsedTimes
      .filter(t => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m > currentMinutes;
      })
      .slice(0, 4);
  })();
  const showParsedTimes = state === 'disrupted' && upcomingParsedTimes.length > 0;
  // Choose the times to display (chips). Each item just needs a `time` string.
  const departuresToShow: { time: string }[] = showParsedTimes
    ? upcomingParsedTimes.map(t => ({ time: t }))
    : next4;

  const firstTime = departuresToShow[0]?.time ?? null;
  const countdown = useCountdown(firstTime);

  const isScheduleInferred = state === 'unknown' && next4.length > 0;
  const effectiveState: ServiceState = isScheduleInferred ? 'operating' : state;

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
  if (!routeInSeason && state !== 'disrupted' && state !== 'suspended') {
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

  const nextInbound = (routeInSeason && (effectiveState === 'operating' || effectiveState === 'unknown'))
    ? upcomingDepartures(routeId, 'inbound', 1)
    : [];

  return (
    <div className="schedule-route">
      <div className="schedule-route__header">
        <span className="schedule-route__name">{label}</span>
        <span
          className={`schedule-route__status ${STATUS_CSS_CLASS[effectiveState]}`}
          aria-label={`${label}: ${STATUS_LABELS[effectiveState]}`}
          title={isScheduleInferred ? 'Based on published schedule — live status unavailable' : undefined}
        >
          {STATUS_LABELS[effectiveState]}
        </span>
      </div>

      {effectiveState === 'suspended' ? (
        <p
          className="schedule-route__notice schedule-route__notice--suspended"
          role="alert"
        >
          {routeStatus?.message ?? 'No service today'}
        </p>
      ) : effectiveState === 'operating' || effectiveState === 'unknown' || effectiveState === 'disrupted' ? (
        <>
          <div className="schedule-route__departures" aria-label={`Upcoming departures for ${label}`}>
            {departuresToShow.length === 0 ? (
              <p className="schedule-route__notice">No more departures today</p>
            ) : (
              departuresToShow.map((dep, i) => (
                <div
                  key={`${dep.time}-${i}`}
                  className={`schedule-route__departure${i === 0 ? ' schedule-route__departure--next' : ''}${effectiveState === 'disrupted' ? ' schedule-route__departure--disrupted' : ''}`}
                >
                  {i === 0 && <span className="schedule-route__next-pill">NEXT</span>}
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

          {effectiveState === 'disrupted' && routeStatus?.message && (
            <p
              className="schedule-route__notice schedule-route__notice--disrupted-info"
              role="alert"
            >
              {routeStatus.message}
              {!showParsedTimes && next4.length > 0 && (
                <span className="schedule-route__notice-caveat"> — Times based on regular schedule and may not be accurate.</span>
              )}
            </p>
          )}

          {effectiveState !== 'disrupted' && routeInSeason && (
            <div
              className="schedule-route__arrival"
              aria-label={`Next arrival at Jack Layton for ${label}`}
            >
              <span className="schedule-route__arrival-label">↓ Next arrival</span>
              {nextInbound.length > 0 ? (
                <span className="schedule-route__arrival-time">{nextInbound[0].time}</span>
              ) : (
                <span className="schedule-route__arrival-none">No more arrivals today</span>
              )}
            </div>
          )}
        </>
      ) : (
        <p
          className="schedule-route__notice"
        >
          {routeStatus?.message ?? (state === 'seasonal-closure' ? 'Not operating this season' : 'Status unavailable')}
        </p>
      )}
    </div>
  );
}

export function ScheduleView() {
  const { activeSeason, loading, schedule } = useSchedule();
  const scrub = useScheduleScrub(schedule, []);

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
      <ScheduleScrubBar scrub={scrub} />
      {ROUTE_DISPLAY.map(({ id, label }) => (
        <RouteRow key={id} routeId={id} label={label} />
      ))}
    </section>
  );
}

interface ScheduleScrubBarProps {
  scrub: UseScheduleScrubResult;
}

function ScheduleScrubBar({ scrub }: ScheduleScrubBarProps) {
  const offsetLabel = scrub.isLive
    ? 'Live'
    : `Preview ${scrub.scrubOffsetMin > 0 ? '+' : ''}${scrub.scrubOffsetMin}m`;
  return (
    <div className="schedule-scrub" aria-label="Schedule timeline scrubber">
      <label htmlFor="schedule-scrub-slider" className="schedule-scrub__label">
        {offsetLabel}
      </label>
      <input
        id="schedule-scrub-slider"
        type="range"
        min={-60}
        max={60}
        step={5}
        value={scrub.scrubOffsetMin}
        onChange={(e) => scrub.setScrubOffsetMin(Number(e.target.value))}
        aria-label="Scrub schedule timeline"
        className="schedule-scrub__slider"
      />
      {!scrub.isLive && (
        <button
          type="button"
          onClick={scrub.reset}
          className="schedule-scrub__reset"
          aria-label="Reset schedule scrubber to live"
        >
          Reset
        </button>
      )}
    </div>
  );
}
