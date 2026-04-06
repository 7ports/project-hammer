import { useState, useEffect } from 'react';

export type BusynessLevel = 'quiet' | 'moderate' | 'busy' | 'very-busy';

export interface BusynessResult {
  level: BusynessLevel;
  label: string;
  description: string;
  indicatorLabel: string;
}

export function useFerryBusyness(dockId: string): BusynessResult {
  const [result, setResult] = useState<BusynessResult>(() => classify(dockId));

  useEffect(() => {
    const timer = setInterval(() => setResult(classify(dockId)), 60_000);
    return () => clearInterval(timer);
  }, [dockId]);

  return result;
}

type DockConfig = {
  indicatorLabel: string;
  descriptions: Record<BusynessLevel, string>;
};

const DOCK_CONFIG: Record<string, DockConfig> = {
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
  'quiet':     'Quiet',
  'moderate':  'Moderate',
  'busy':      'Busy',
  'very-busy': 'Very Busy',
};

function classify(dockId: string): BusynessResult {
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay();
  const month = now.getMonth();
  const isWeekend = dow === 0 || dow === 6;
  const isSummer = month >= 5 && month <= 7;
  const isShoulderSeason = (month >= 3 && month <= 4) || (month >= 8 && month <= 9);
  const isPeakHour = hour >= 10 && hour <= 18;
  const isMidday = hour >= 11 && hour <= 15;
  const isWinter = !isSummer && !isShoulderSeason;

  let level: BusynessLevel;

  if (dockId === 'jack-layton') {
    if (isSummer && isWeekend && isPeakHour) level = 'very-busy';
    else if (isSummer && (isWeekend || isMidday)) level = 'busy';
    else if (isShoulderSeason && isWeekend && isPeakHour) level = 'busy';
    else if (isShoulderSeason && isMidday) level = 'moderate';
    else if (isWinter) level = isWeekend && isMidday ? 'moderate' : 'quiet';
    else level = 'moderate';

  } else if (dockId === 'centre-island') {
    if (isSummer && isWeekend && isPeakHour) level = 'very-busy';
    else if (isSummer && isPeakHour) level = 'busy';
    else if (isSummer) level = 'moderate';
    else if (isShoulderSeason && isWeekend && isPeakHour) level = 'busy';
    else if (isShoulderSeason && isWeekend) level = 'moderate';
    else if (isWinter && isWeekend && isMidday) level = 'quiet';
    else level = 'quiet';

  } else if (dockId === 'wards-island') {
    if (isSummer && isWeekend && isPeakHour) level = 'busy';
    else if (isSummer && isPeakHour) level = 'moderate';
    else if (isShoulderSeason && isWeekend && isPeakHour) level = 'moderate';
    else level = 'quiet';

  } else if (dockId === 'hanlans-point') {
    if (isSummer && isWeekend && isPeakHour) level = 'very-busy';
    else if (isSummer && isWeekend) level = 'busy';
    else if (isSummer && isMidday) level = 'moderate';
    else if (isShoulderSeason && isWeekend && isMidday) level = 'moderate';
    else level = 'quiet';

  } else {
    level = isSummer && isWeekend && isPeakHour ? 'busy' : 'quiet';
  }

  const cfg = DOCK_CONFIG[dockId] ?? DOCK_CONFIG['jack-layton'];

  return {
    level,
    label: LEVEL_LABELS[level],
    description: cfg.descriptions[level],
    indicatorLabel: cfg.indicatorLabel,
  };
}
