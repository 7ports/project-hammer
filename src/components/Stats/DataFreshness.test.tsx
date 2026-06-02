import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { DataFreshness } from './DataFreshness';
import type { AnalyticsEnvelope, DataQualityPayload } from '../../types/analytics';

const PAYLOAD: AnalyticsEnvelope<DataQualityPayload> = {
  data: {
    range: { key: '7d', days: 7, fromMs: 0, toMs: 1 },
    totalPositions: 12_345,
    longestGapMs: 4 * 60_000,
    gapCount: 3,
    providerTransitions: [
      { transition: 'switch', from: 'backup', to: 'aisstream', timestamp: Date.UTC(2026, 4, 30, 12, 0, 0) },
    ],
    uptimePct: 0.992,
  },
  generatedAt: new Date(2026, 5, 1).toISOString(),
  cached: false,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DataFreshness', () => {
  it('renders uptime, gaps, and current provider pills', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => PAYLOAD }));
    render(<DataFreshness range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByText(/Uptime/i)).toBeInTheDocument());
    expect(screen.getByText(/99\.2%/)).toBeInTheDocument();
    expect(screen.getByText(/aisstream/)).toBeInTheDocument();
    expect(screen.getByText(/Gaps: 3/)).toBeInTheDocument();
  });

  it('renders an error state when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        data: null,
        generatedAt: new Date().toISOString(),
        cached: false,
        error: 'STORAGE_UNAVAILABLE',
      }),
    }));
    render(<DataFreshness range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Unable to load/));
  });
});
