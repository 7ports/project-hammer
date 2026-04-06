import { useEffect, useLayoutEffect, useRef } from 'react';

export function useAnimationFrame(callback: (timestamp: number) => void): void {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    let rafId: number;
    const loop = (timestamp: number) => {
      callbackRef.current(timestamp);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
