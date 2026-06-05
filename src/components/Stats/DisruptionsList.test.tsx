import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { DisruptionsList } from './DisruptionsList';
import type { AnalyticsEnvelope, DisruptionsPayload } from '../../types/analytics';

const PAYLOAD: AnalyticsEnvelope<DisruptionsPayload> = {
  data: {
    range: { key: '7d', days: 7, fromMs: 0, toMs: 1 },
    events: [
      {
        status: 'alert',
        reason: 'Weather',
        message: 'High winds reported.',
        detectedAt: Date.UTC(2026, 4, 25, 12, 0, 0),
        durationMs: 45 * 60_000,
        parsedTimes: [],
      },
    ],
    count: 1,
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

describe('DisruptionsList', () => {
  it('renders a row per event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => PAYLOAD }));
    render(<DisruptionsList range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByText(/Weather/i)).toBeInTheDocument());
    expect(screen.getByText('alert')).toBeInTheDocument();
    expect(screen.getByText(/45 min/)).toBeInTheDocument();
  });

  it('shows an empty state when no events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...PAYLOAD, data: { ...PAYLOAD.data, events: [], count: 0 } }),
    }));
    render(<DisruptionsList range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByText(/No alerts or closures/i)).toBeInTheDocument());
  });
});
