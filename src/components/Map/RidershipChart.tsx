import { useEffect, useState } from 'react';
import { config } from '../../lib/config';

interface RidershipRecord {
  timestamp: string;
  redemptions: number;
}

interface RidershipData {
  records: RidershipRecord[];
  dataAgeHours: number | null;
  bucketsLoaded?: number;
}

export function RidershipChart() {
  const [data, setData] = useState<RidershipData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${config.apiUrl}/api/ferry-busyness`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as RidershipData;
        if (!cancelled) { setData(json); setLoading(false); }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="ridership-chart__loading">Loading ridership data…</p>;
  if (!data || data.records.length === 0) return null;

  const max = Math.max(...data.records.map(r => r.redemptions), 1);
  const BAR_W = 6;
  const BAR_GAP = 2;
  const CHART_H = 40;
  const width = data.records.length * (BAR_W + BAR_GAP);

  const ageLabel = data.dataAgeHours != null
    ? `Data from ~${Math.round(data.dataAgeHours)}h ago`
    : 'Historical data';

  const bucketsLoaded = data.bucketsLoaded ?? 0;
  const noteText = bucketsLoaded > 0
    ? `Calibrated from ${Math.round(bucketsLoaded / 100) / 10}k historical records`
    : '15-min intervals · Toronto Open Data';

  return (
    <div className="ridership-chart">
      <p className="ridership-chart__title">
        Recent boardings <span className="ridership-chart__age">({ageLabel})</span>
      </p>
      <svg
        className="ridership-chart__svg"
        width={width}
        height={CHART_H}
        aria-label="Bar chart of recent ferry boardings"
        role="img"
      >
        {data.records.map((rec, i) => {
          const barH = Math.max(2, (rec.redemptions / max) * CHART_H);
          const x = i * (BAR_W + BAR_GAP);
          const y = CHART_H - barH;
          return (
            <rect
              key={rec.timestamp}
              x={x}
              y={y}
              width={BAR_W}
              height={barH}
              fill="#00b4d8"
              opacity={0.7 + 0.3 * (i / data.records.length)}
              rx={1}
            >
              <title>{`${rec.redemptions} boardings`}</title>
            </rect>
          );
        })}
      </svg>
      <p className="ridership-chart__note">{noteText}</p>
    </div>
  );
}
