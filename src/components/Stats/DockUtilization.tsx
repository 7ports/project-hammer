import { useMemo } from 'react';
import { useAnalytics } from '../../hooks/useAnalytics';
import type { DwellPayload, RangeKey, DwellStat } from '../../types/analytics';
import { DOCK_LOCATIONS } from '../../lib/docks';
import { VESSEL_NAMES } from '../../lib/constants';

interface Props {
  range: RangeKey;
}

function dockLabel(id: string): string {
  return DOCK_LOCATIONS.find((d) => d.id === id)?.name ?? id;
}

function vesselLabel(mmsi: number): string {
  return VESSEL_NAMES[mmsi] ?? `MMSI ${mmsi}`;
}

function fmtSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${(s / 60).toFixed(1)} min`;
}

function aggregateByDock(stats: DwellStat[]): Array<{ dockId: string; median: number; p90: number; samples: number; vessels: number }> {
  const map = new Map<string, { meds: number[]; p90s: number[]; samples: number; vessels: Set<number> }>();
  for (const s of stats) {
    const entry = map.get(s.dockId) ?? { meds: [], p90s: [], samples: 0, vessels: new Set<number>() };
    entry.meds.push(s.medianDwellSec);
    entry.p90s.push(s.p90DwellSec);
    entry.samples += s.sampleSize;
    entry.vessels.add(s.mmsi);
    map.set(s.dockId, entry);
  }
  return Array.from(map.entries()).map(([dockId, e]) => ({
    dockId,
    median: e.meds.reduce((a, b) => a + b, 0) / Math.max(1, e.meds.length),
    p90: e.p90s.reduce((a, b) => a + b, 0) / Math.max(1, e.p90s.length),
    samples: e.samples,
    vessels: e.vessels.size,
  }));
}

export function DockUtilization({ range }: Props) {
  const { data, loading, error } = useAnalytics<DwellPayload>('/api/analytics/dwell', {
    range,
    pollMs: 5 * 60_000,
  });

  const dockRows = useMemo(() => (data ? aggregateByDock(data.stats) : []), [data]);

  if (loading && !data) {
    return (
      <section className="stats-widget" aria-labelledby="dock-h" aria-busy="true">
        <h2 id="dock-h" className="stats-widget__heading">Dock dwell times</h2>
        <p className="stats-widget__loading">Loading…</p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="stats-widget" aria-labelledby="dock-h">
        <h2 id="dock-h" className="stats-widget__heading">Dock dwell times</h2>
        <p className="stats-widget__error" role="status">Unable to load dwell stats{error ? ` (${error})` : ''}.</p>
      </section>
    );
  }

  if (dockRows.length === 0) {
    return (
      <section className="stats-widget" aria-labelledby="dock-h">
        <h2 id="dock-h" className="stats-widget__heading">Dock dwell times</h2>
        <p className="stats-widget__empty">No dwell episodes recorded yet.</p>
      </section>
    );
  }

  return (
    <section className="stats-widget" aria-labelledby="dock-h">
      <h2 id="dock-h" className="stats-widget__heading">Dock dwell times</h2>
      <table className="stats-table">
        <thead>
          <tr>
            <th scope="col">Dock</th>
            <th scope="col">Median dwell</th>
            <th scope="col">p90 dwell</th>
            <th scope="col">Visits</th>
          </tr>
        </thead>
        <tbody>
          {dockRows.map((d) => (
            <tr key={d.dockId}>
              <td>{dockLabel(d.dockId)}</td>
              <td>{fmtSeconds(d.median)}</td>
              <td>{fmtSeconds(d.p90)}</td>
              <td>
                {d.samples} ({d.vessels} vessel{d.vessels === 1 ? '' : 's'})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.stats.length > dockRows.length && (
        <details style={{ marginTop: 'var(--space-3)' }}>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            Per vessel
          </summary>
          <table className="stats-table" style={{ marginTop: 'var(--space-2)' }}>
            <thead>
              <tr>
                <th scope="col">Dock</th>
                <th scope="col">Vessel</th>
                <th scope="col">Median</th>
                <th scope="col">p90</th>
                <th scope="col">N</th>
              </tr>
            </thead>
            <tbody>
              {data.stats.map((s) => (
                <tr key={`${s.dockId}-${s.mmsi}`}>
                  <td>{dockLabel(s.dockId)}</td>
                  <td>{vesselLabel(s.mmsi)}</td>
                  <td>{fmtSeconds(s.medianDwellSec)}</td>
                  <td>{fmtSeconds(s.p90DwellSec)}</td>
                  <td>{s.sampleSize}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
