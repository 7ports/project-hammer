import { useAnalytics } from '../../hooks/useAnalytics';
import type { SummaryPayload, RangeKey } from '../../types/analytics';

interface Props {
  range: RangeKey;
}

function fmtNumber(n: number, digits = 0): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtMinutes(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const m = seconds / 60;
  return `${m.toFixed(1)} min`;
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

export function SummaryCards({ range }: Props) {
  const { data, loading, error } = useAnalytics<SummaryPayload>('/api/analytics/summary', {
    range,
    pollMs: 60_000,
  });

  if (loading && !data) {
    return (
      <section className="stats-widget" aria-labelledby="summary-h" aria-busy="true">
        <h2 id="summary-h" className="stats-widget__heading">Headline metrics</h2>
        <p className="stats-widget__loading">Loading…</p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="stats-widget" aria-labelledby="summary-h">
        <h2 id="summary-h" className="stats-widget__heading">Headline metrics</h2>
        <p className="stats-widget__error" role="status">Unable to load summary{error ? ` (${error})` : ''}.</p>
      </section>
    );
  }

  const s = data.summary;

  return (
    <section className="stats-widget" aria-labelledby="summary-h">
      <h2 id="summary-h" className="stats-widget__heading">Headline metrics</h2>
      <ul className="summary-grid">
        <li className="summary-card">
          <span className="summary-card__label">Trips</span>
          <span className="summary-card__value">{fmtNumber(s.tripsCount)}</span>
          <span className="summary-card__sub">last {data.range.days ?? '?'}d</span>
        </li>
        <li className="summary-card">
          <span className="summary-card__label">On-time</span>
          <span className="summary-card__value">{fmtPct(s.onTimeRate)}</span>
          <span className="summary-card__sub">±3 min of schedule</span>
        </li>
        <li className="summary-card">
          <span className="summary-card__label">Median trip</span>
          <span className="summary-card__value">{fmtMinutes(s.medianTripSec)}</span>
          <span className="summary-card__sub">dock to dock</span>
        </li>
        <li className="summary-card">
          <span className="summary-card__label">Avg SOG</span>
          <span className="summary-card__value">{s.avgSogKn !== null ? `${s.avgSogKn.toFixed(1)} kn` : '—'}</span>
          <span className="summary-card__sub">fleet underway</span>
        </li>
        <li className="summary-card">
          <span className="summary-card__label">Vessels active</span>
          <span className="summary-card__value">{fmtNumber(s.vesselsOnDuty)}</span>
          <span className="summary-card__sub">distinct MMSIs</span>
        </li>
        <li className="summary-card">
          <span className="summary-card__label">Service uptime</span>
          <span className="summary-card__value">{fmtPct(s.serviceUptimePct)}</span>
          <span className="summary-card__sub">{s.alertsCount} alert{s.alertsCount === 1 ? '' : 's'}</span>
        </li>
      </ul>
    </section>
  );
}
