import { useState } from 'react';
import type { RangeKey } from '../types/analytics';
import { SummaryCards } from '../components/Stats/SummaryCards';
import { TripsChart } from '../components/Stats/TripsChart';
import { VesselActivity } from '../components/Stats/VesselActivity';
import { DockUtilization } from '../components/Stats/DockUtilization';
import { DisruptionsList } from '../components/Stats/DisruptionsList';
import { DataFreshness } from '../components/Stats/DataFreshness';
import '../components/Stats/Stats.css';
import './StatsPage.css';

interface Props {
  onBackToLive: () => void;
}

const RANGES: Array<{ value: RangeKey; label: string }> = [
  { value: '1d', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

export default function StatsPage({ onBackToLive }: Props) {
  const [range, setRange] = useState<RangeKey>('7d');

  return (
    <main className="stats-page" aria-labelledby="stats-page-title">
      <header className="stats-page__header">
        <div>
          <h1 id="stats-page-title" className="stats-page__title">
            Toronto Island Ferry — Statistics
          </h1>
          <p className="stats-page__subtitle">
            Aggregated from live AIS positions. Data may take 24 h to populate after the inference job runs.
          </p>
        </div>
        <div className="stats-page__filters">
          <label htmlFor="stats-range">Range:</label>
          <select
            id="stats-range"
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKey)}
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <button type="button" className="stats-page__back" onClick={onBackToLive}>
            ← Live map
          </button>
        </div>
      </header>

      <div className="stats-page__grid">
        <div className="stats-page__full">
          <SummaryCards range={range} />
        </div>
        <div className="stats-page__full">
          <TripsChart range={range} />
        </div>
        <VesselActivity range={range} />
        <DockUtilization range={range} />
        <DisruptionsList range={range} />
        <DataFreshness range={range} />
      </div>
    </main>
  );
}
