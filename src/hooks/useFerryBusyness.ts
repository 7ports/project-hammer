import { useState, useEffect } from 'react';

export type BusynessLevel = 'quiet' | 'moderate' | 'busy' | 'very-busy';

export interface BusynessResult {
  level: BusynessLevel;
  label: string;
  description: string;
}

export function useFerryBusyness(): BusynessResult {
  const [result, setResult] = useState<BusynessResult>(classify());

  useEffect(() => {
    const timer = setInterval(() => setResult(classify()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return result;
}

function classify(): BusynessResult {
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay();     // 0=Sun, 6=Sat
  const month = now.getMonth(); // 0=Jan
  const isWeekend = dow === 0 || dow === 6;
  const isSummer = month >= 5 && month <= 7;         // Jun–Aug
  const isShoulderSeason = (month >= 3 && month <= 4) || (month >= 8 && month <= 9);
  const isPeakHour = hour >= 10 && hour <= 18;
  const isMidday = hour >= 11 && hour <= 15;

  let level: BusynessLevel;
  if (isSummer && isWeekend && isPeakHour) {
    level = 'very-busy';
  } else if (isSummer && (isWeekend || isMidday)) {
    level = 'busy';
  } else if (isShoulderSeason && isWeekend && isPeakHour) {
    level = 'busy';
  } else if (isShoulderSeason && isMidday) {
    level = 'moderate';
  } else if (!isSummer && !isShoulderSeason) {
    level = isWeekend && isMidday ? 'moderate' : 'quiet';
  } else {
    level = 'moderate';
  }

  const labels: Record<BusynessLevel, string> = {
    'quiet': 'Quiet',
    'moderate': 'Moderate',
    'busy': 'Busy',
    'very-busy': 'Very Busy',
  };
  const descriptions: Record<BusynessLevel, string> = {
    'quiet': 'Short wait expected',
    'moderate': 'Moderate queue likely',
    'busy': 'Busy — arrive early',
    'very-busy': 'Very busy — expect long wait',
  };

  return { level, label: labels[level], description: descriptions[level] };
}
