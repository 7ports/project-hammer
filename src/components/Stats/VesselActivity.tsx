import { useAnalytics } from '../../hooks/useAnalytics';
import type { UtilizationPayload, RangeKey } from '../../types/analytics';
import { VESSEL_NAMES } from '../../lib/constants';

interface Props {
  range: RangeKey;
}

function vesselLabel(mmsi: number): string {
  return VESSEL_NAMES[mmsi] ?? `MMSI ${mmsi}`;
}

function fmtHours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

export function VesselActivity({ range }: Props) {
  const { data, loading, error } = useAnalytics<UtilizationPayload>('/api/analytics/utilization', {
    range,
    pollMs: 5 * 60_000,
  });

  if (loading && !data) {
    return (
      <section className="stats-widget" aria-labelledby="vessel-h" aria-busy="true">
        <h2 id="vessel-h" className="stats-widget__heading">Vessel activity</h2>
        <p className="stats-widget__loading">Loading…</p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="stats-widget" aria-labelledby="vessel-h">
        <h2 id="vessel-h" className="stats-widget__heading">Vessel activity</h2>
        <p className="stats-widget__error" role="status">Unable to load utilization{error ? ` (${error})` : ''}.</p>
      </section>
    );
  }

  if (data.vessels.length === 0) {
    return (
      <section className="stats-widget" aria-labelledby="vessel-h">
        <h2 id="vessel-h" className="stats-widget__heading">Vessel activity</h2>
        <p className="stats-widget__empty">No vessel positions in this window.</p>
      </section>
    );
  }

  return (
    <section className="stats-widget" aria-labelledby="vessel-h">
      <h2 id="vessel-h" className="stats-widget__heading">Vessel activity</h2>
      <table className="stats-table">
        <thead>
          <tr>
            <th scope="col">Vessel</th>
            <th scope="col">Active</th>
            <th scope="col">Tracked</th>
            <th scope="col" aria-label="Utilization percent">Utilization</th>
          </tr>
        </thead>
        <tbody>
          {data.vessels.map((v) => (
            <tr key={v.mmsi}>
              <td>{vesselLabel(v.mmsi)}</td>
              <td>{fmtHours(v.activeMs)}</td>
              <td>{fmtHours(v.totalMs)}</td>
              <td style={{ minWidth: 140 }}>
                <div className="util-bar" aria-hidden="true">
                  <div
                    className="util-bar__fill"
                    style={{ width: `${Math.min(100, Math.max(0, v.utilizationPct * 100))}%` }}
                  />
                </div>
                <span style={{ fontSize: 12 }}>{Math.round(v.utilizationPct * 100)}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
