import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { SummaryCards } from './SummaryCards';
import type { AnalyticsEnvelope, SummaryPayload } from '../../types/analytics';

function mockFetchOnce(envelope: AnalyticsEnvelope<SummaryPayload>, ok = true): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => envelope,
  }));
}

const PAYLOAD: AnalyticsEnvelope<SummaryPayload> = {
  data: {
    range: { key: '7d', days: 7, fromMs: 0, toMs: 1 },
    summary: {
      tripsCount: 142,
      onTimeRate: 0.87,
      medianTripSec: 510,
      avgSogKn: 6.1,
      vesselsOnDuty: 4,
      serviceUptimePct: 0.99,
      alertsCount: 1,
      totalPositions: 9876,
    },
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

describe('SummaryCards', () => {
  it('shows a loading state, then renders the headline metrics', async () => {
    mockFetchOnce(PAYLOAD);
    render(<SummaryCards range="7d" />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByText('142')).toBeInTheDocument());
    expect(screen.getByText(/87%/)).toBeInTheDocument();
    expect(screen.getByText(/6\.1 kn/)).toBeInTheDocument();
  });

  it('renders an accessible error state when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    render(<SummaryCards range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Unable to load/i));
  });
});
