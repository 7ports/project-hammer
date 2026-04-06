import { useState, useEffect, useRef } from 'react';
import { config } from '../lib/config';

export type BusynessLevel = 'quiet' | 'moderate' | 'busy' | 'very-busy';

export interface BusynessResult {
  level: BusynessLevel;
  label: string;
  description: string;
  indicatorLabel: string;
  source: 'api' | 'heuristic';
}

// Per-dock display config (label + descriptions stay dock-specific even though
// the underlying busyness level is aggregate across all routes)
const DOCK_CONFIG: Record<string, { indicatorLabel: string; descriptions: Record<BusynessLevel, string> }> = {
  'jack-layton': {
    indicatorLabel: 'Queue',
    descriptions: {
      'quiet':     'Short wait expected',
      'moderate':  'Moderate queue likely',
      'busy':      'Busy — arrive early',
      'very-busy': 'Very busy — expect long wait',
    },
  },
  'centre-island': {
    indicatorLabel: 'Crowd',
    descriptions: {
      'quiet':     'Easy access, low crowds',
      'moderate':  'Moderately busy island',
      'busy':      'Busy — popular destination today',
      'very-busy': 'Very crowded — peak island day',
    },
  },
  'wards-island': {
    indicatorLabel: 'Crowd',
    descriptions: {
      'quiet':     'Peaceful, low traffic',
      'moderate':  'Some visitors expected',
      'busy':      'Busier than usual',
      'very-busy': "Busy for Ward's Island",
    },
  },
  'hanlans-point': {
    indicatorLabel: 'Crowd',
    descriptions: {
      'quiet':     'Open beach, low crowds',
      'moderate':  'Moderate beach traffic',
      'busy':      'Popular beach day',
      'very-busy': 'Very busy beach conditions',
    },
  },
};

const LEVEL_LABELS: Record<BusynessLevel, string> = {
  'quiet': 'Quiet',
  'moderate': 'Moderate',
  'busy': 'Busy',
  'very-busy': 'Very Busy',
};

function buildResult(dockId: string, level: BusynessLevel, source: 'api' | 'heuristic'): BusynessResult {
  const cfg = DOCK_CONFIG[dockId] ?? DOCK_CONFIG['jack-layton'];
  return {
    level,
    label: LEVEL_LABELS[level],
    description: cfg.descriptions[level],
    indicatorLabel: cfg.indicatorLabel,
    source,
  };
}

// Heuristic fallback (matches backend logic — used client-side when API is unreachable)
function heuristicLevel(): BusynessLevel {
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay();
  const month = now.getMonth();
  const isWeekend = dow === 0 || dow === 6;
  const isSummer = month >= 5 && month <= 7;
  const isShoulderSeason = (month >= 3 && month <= 4) || (month >= 8 && month <= 9);
  const isPeakHour = hour >= 10 && hour <= 18;
  const isMidday = hour >= 11 && hour <= 15;
  if (isSummer && isWeekend && isPeakHour) return 'very-busy';
  if (isSummer && (isWeekend || isMidday)) return 'busy';
  if (isShoulderSeason && isWeekend && isPeakHour) return 'busy';
  if (isShoulderSeason && isMidday) return 'moderate';
  if (!isSummer && !isShoulderSeason) return isWeekend && isMidday ? 'moderate' : 'quiet';
  return 'moderate';
}

export function useFerryBusyness(dockId: string): BusynessResult {
  const [result, setResult] = useState<BusynessResult>(() =>
    buildResult(dockId, heuristicLevel(), 'heuristic')
  );
  const dockIdRef = useRef(dockId);
  dockIdRef.current = dockId;

  useEffect(() => {
    let cancelled = false;

    async function fetchAndUpdate(): Promise<void> {
      try {
        const res = await fetch(`${config.apiUrl}/api/ferry-busyness`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { level: BusynessLevel; source: 'api' | 'heuristic' };
        if (!cancelled) {
          setResult(buildResult(dockIdRef.current, data.level, data.source));
        }
      } catch {
        if (!cancelled) {
          setResult(buildResult(dockIdRef.current, heuristicLevel(), 'heuristic'));
        }
      }
    }

    void fetchAndUpdate();
    // Re-fetch every 15 minutes (backend cache refreshes every 15 min too)
    const timer = setInterval(() => void fetchAndUpdate(), 15 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []); // intentionally empty — dockId changes handled via ref

  return result;
}
