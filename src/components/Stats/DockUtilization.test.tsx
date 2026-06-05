import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { DockUtilization } from './DockUtilization';
import type { AnalyticsEnvelope, DwellPayload } from '../../types/analytics';

const PAYLOAD: AnalyticsEnvelope<DwellPayload> = {
  data: {
    range: { key: '7d', days: 7, fromMs: 0, toMs: 1 },
    stats: [
      { dockId: 'jack-layton', mmsi: 316045069, medianDwellSec: 180, p90DwellSec: 320, sampleSize: 14 },
      { dockId: 'centre-island', mmsi: 316045069, medianDwellSec: 65, p90DwellSec: 110, sampleSize: 11 },
    ],
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

describe('DockUtilization', () => {
  it('renders an aggregated row per dock', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => PAYLOAD }));
    render(<DockUtilization range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByText(/Jack Layton/i)).toBeInTheDocument());
    expect(screen.getByText(/Centre Island/i)).toBeInTheDocument();
  });

  it('shows an empty state when nothing is recorded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...PAYLOAD, data: { ...PAYLOAD.data, stats: [] } }),
    }));
    render(<DockUtilization range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByText(/No dwell episodes/i)).toBeInTheDocument());
  });
});
