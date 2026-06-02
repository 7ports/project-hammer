import { useState, useEffect } from 'react';

export function formatRelativeTime(date: Date): string {
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 30) return 'Just now';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  return `${Math.floor(diffSeconds / 3600)}h ago`;
}

export function useRelativeTime(date: Date): string;
export function useRelativeTime(date: Date | null): string | null;
export function useRelativeTime(date: Date | null): string | null {
  // Tick counter forces a re-render every 10s; display value is derived from
  // `date` during render so it stays in sync without setState-in-effect.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!date) return;
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, [date]);

  return date ? formatRelativeTime(date) : null;
}
