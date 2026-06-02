import { useAnalytics } from '../../hooks/useAnalytics';
import type { DisruptionsPayload, RangeKey } from '../../types/analytics';

interface Props {
  range: RangeKey;
}

function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'ongoing';
  const m = ms / 60_000;
  if (m < 60) return `${Math.round(m)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

function fmtTimestamp(ms: number): string {
  return new Date(ms).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DisruptionsList({ range }: Props) {
  const { data, loading, error } = useAnalytics<DisruptionsPayload>('/api/analytics/disruptions', {
    range,
    pollMs: 60_000,
  });

  if (loading && !data) {
    return (
      <section className="stats-widget" aria-labelledby="disrupt-h" aria-busy="true">
        <h2 id="disrupt-h" className="stats-widget__heading">Service disruptions</h2>
        <p className="stats-widget__loading">Loading…</p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="stats-widget" aria-labelledby="disrupt-h">
        <h2 id="disrupt-h" className="stats-widget__heading">Service disruptions</h2>
        <p className="stats-widget__error" role="status">Unable to load disruptions{error ? ` (${error})` : ''}.</p>
      </section>
    );
  }

  if (data.events.length === 0) {
    return (
      <section className="stats-widget" aria-labelledby="disrupt-h">
        <h2 id="disrupt-h" className="stats-widget__heading">Service disruptions</h2>
        <p className="stats-widget__empty">No alerts or closures in this window.</p>
      </section>
    );
  }

  return (
    <section className="stats-widget" aria-labelledby="disrupt-h">
      <h2 id="disrupt-h" className="stats-widget__heading">
        Service disruptions ({data.count})
      </h2>
      <table className="stats-table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Status</th>
            <th scope="col">Duration</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((e) => (
            <tr key={`${e.detectedAt}-${e.status}`}>
              <td>{fmtTimestamp(e.detectedAt)}</td>
              <td>{e.status}</td>
              <td>{fmtDuration(e.durationMs)}</td>
              <td title={e.message ?? ''}>{e.reason ?? e.message ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
