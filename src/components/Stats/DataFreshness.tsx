import { useAnalytics } from '../../hooks/useAnalytics';
import type { DataQualityPayload, RangeKey } from '../../types/analytics';

interface Props {
  range: RangeKey;
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function fmtGap(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

function uptimeBucket(pct: number | null): 'good' | 'warn' | 'bad' {
  if (pct === null) return 'warn';
  if (pct >= 0.98) return 'good';
  if (pct >= 0.9) return 'warn';
  return 'bad';
}

export function DataFreshness({ range }: Props) {
  const { data, loading, error, generatedAt } = useAnalytics<DataQualityPayload>(
    '/api/analytics/data-quality',
    { range, pollMs: 60_000 },
  );

  const updatedAt = generatedAt ? new Date(generatedAt).toLocaleTimeString() : '—';

  if (loading && !data) {
    return (
      <section className="stats-widget" aria-labelledby="freshness-h" aria-busy="true">
        <h2 id="freshness-h" className="stats-widget__heading">Data freshness</h2>
        <p className="stats-widget__loading">Loading…</p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="stats-widget" aria-labelledby="freshness-h">
        <h2 id="freshness-h" className="stats-widget__heading">Data freshness</h2>
        <p className="stats-widget__error" role="status">Unable to load data quality{error ? ` (${error})` : ''}.</p>
      </section>
    );
  }

  const bucket = uptimeBucket(data.uptimePct);
  const currentProvider = data.providerTransitions.at(-1)?.to ?? 'unknown';

  return (
    <section className="stats-widget" aria-labelledby="freshness-h">
      <h2 id="freshness-h" className="stats-widget__heading">Data freshness</h2>
      <div className="data-freshness">
        <span className="data-freshness__pill">
          <span className={`data-freshness__dot data-freshness__dot--${bucket}`} aria-hidden="true" />
          Uptime {fmtPct(data.uptimePct)}
        </span>
        <span className="data-freshness__pill">Positions: {data.totalPositions.toLocaleString()}</span>
        <span className="data-freshness__pill">Gaps: {data.gapCount}</span>
        <span className="data-freshness__pill">Longest gap: {fmtGap(data.longestGapMs)}</span>
        <span className="data-freshness__pill">Current provider: {currentProvider}</span>
        <span className="data-freshness__pill">Updated {updatedAt}</span>
      </div>
    </section>
  );
}
