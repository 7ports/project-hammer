import { useState, useEffect } from 'react';

export function formatRelativeTime(date: Date): string {
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 30) return 'Just now';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  return `${Math.floor(diffSeconds / 3600)}h ago`;
}

export function useRelativeTime(date: Date): string {
  const [display, setDisplay] = useState(() => formatRelativeTime(date));

  useEffect(() => {
    const id = setInterval(() => {
      setDisplay(formatRelativeTime(date));
    }, 10_000);
    return () => clearInterval(id);
  }, [date]);

  return display;
}
