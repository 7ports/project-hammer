import { useAnalytics } from '../../hooks/useAnalytics';
import type { TripsPayload, RangeKey } from '../../types/analytics';

interface Props {
  range: RangeKey;
}

const VIEW_W = 600;
const VIEW_H = 180;
const PAD_L = 32;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 28;

export function TripsChart({ range }: Props) {
  const { data, loading, error } = useAnalytics<TripsPayload>('/api/analytics/trips', {
    range,
    params: { granularity: 'day' },
    pollMs: 5 * 60_000,
  });

  if (loading && !data) {
    return (
      <section className="stats-widget" aria-labelledby="trips-h" aria-busy="true">
        <h2 id="trips-h" className="stats-widget__heading">Trip volume per day</h2>
        <p className="stats-widget__loading">Loading…</p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="stats-widget" aria-labelledby="trips-h">
        <h2 id="trips-h" className="stats-widget__heading">Trip volume per day</h2>
        <p className="stats-widget__error" role="status">Unable to load trip series{error ? ` (${error})` : ''}.</p>
      </section>
    );
  }

  const series = data.series;

  if (series.length === 0) {
    return (
      <section className="stats-widget" aria-labelledby="trips-h">
        <h2 id="trips-h" className="stats-widget__heading">Trip volume per day</h2>
        <p className="stats-widget__empty">No trips inferred yet for this range.</p>
      </section>
    );
  }

  const max = Math.max(1, ...series.map((b) => b.count));
  const innerW = VIEW_W - PAD_L - PAD_R;
  const innerH = VIEW_H - PAD_T - PAD_B;
  const slot = innerW / series.length;
  const barW = Math.max(2, slot * 0.7);

  return (
    <section className="stats-widget" aria-labelledby="trips-h">
      <h2 id="trips-h" className="stats-widget__heading">Trip volume per day</h2>
      <svg
        className="trips-chart"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Trip counts per day over the last ${data.range.days ?? '?'} days, total ${data.tripsCount} trips`}
      >
        {/* y-axis ticks: 0, max */}
        <text x={4} y={PAD_T + 8} className="trips-chart__axis">{max}</text>
        <text x={4} y={VIEW_H - PAD_B} className="trips-chart__axis">0</text>

        {series.map((b, i) => {
          const h = (b.count / max) * innerH;
          const x = PAD_L + i * slot + (slot - barW) / 2;
          const y = VIEW_H - PAD_B - h;
          const label = b.bucket.slice(5); // MM-DD
          return (
            <g key={b.bucket}>
              <rect
                className="trips-chart__bar"
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={2}
              >
                <title>{`${b.bucket}: ${b.count} trips`}</title>
              </rect>
              {(i === 0 || i === series.length - 1) && (
                <text
                  x={x + barW / 2}
                  y={VIEW_H - 8}
                  className="trips-chart__axis"
                  textAnchor="middle"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="stats-widget__empty" style={{ paddingTop: 0 }}>
        {data.tripsCount} trip{data.tripsCount === 1 ? '' : 's'} across the window.
      </p>
    </section>
  );
}
