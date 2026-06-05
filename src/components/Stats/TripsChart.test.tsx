import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { TripsChart } from './TripsChart';
import type { AnalyticsEnvelope, TripsPayload } from '../../types/analytics';

const PAYLOAD: AnalyticsEnvelope<TripsPayload> = {
  data: {
    range: { key: '7d', days: 7, fromMs: 0, toMs: 1 },
    granularity: 'day',
    series: [
      { bucket: '2026-05-25', count: 32 },
      { bucket: '2026-05-26', count: 28 },
      { bucket: '2026-05-27', count: 41 },
    ],
    tripsCount: 101,
    trips: [],
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

describe('TripsChart', () => {
  it('renders a chart with one rect per series point', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => PAYLOAD }));
    render(<TripsChart range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    const img = await waitFor(() => screen.getByRole('img'));
    expect(img.querySelectorAll('rect')).toHaveLength(3);
    expect(screen.getByText(/101 trips/i)).toBeInTheDocument();
  });

  it('renders an empty state when the series is empty', async () => {
    const empty = { ...PAYLOAD, data: { ...PAYLOAD.data, series: [], tripsCount: 0 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => empty }));
    render(<TripsChart range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByText(/No trips inferred yet/i)).toBeInTheDocument());
  });
});
