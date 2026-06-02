import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Bridge for @testing-library/dom — it gates waitFor's fake-timer-aware code path
// on a global `jest` with advanceTimersByTime. Vitest provides equivalent fake
// timers but uses a different global, so we shim a minimal jest-shaped object
// that delegates to vi. Without this, waitFor + vi.useFakeTimers() deadlocks.
type JestShim = {
  advanceTimersByTime: (ms: number) => void;
};
const jestShim: JestShim = {
  advanceTimersByTime: (ms: number) => {
    vi.advanceTimersByTime(ms);
  },
};
(globalThis as unknown as { jest: JestShim }).jest = jestShim;
