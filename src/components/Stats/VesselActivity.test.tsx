import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { VesselActivity } from './VesselActivity';
import type { AnalyticsEnvelope, UtilizationPayload } from '../../types/analytics';

const PAYLOAD: AnalyticsEnvelope<UtilizationPayload> = {
  data: {
    range: { key: '7d', days: 7, fromMs: 0, toMs: 1 },
    vessels: [
      { mmsi: 316045069, activeMs: 3 * 3_600_000, totalMs: 5 * 3_600_000, utilizationPct: 0.6, sampleSize: 120 },
      { mmsi: 316045081, activeMs: 1 * 3_600_000, totalMs: 4 * 3_600_000, utilizationPct: 0.25, sampleSize: 80 },
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

describe('VesselActivity', () => {
  it('renders a row per vessel with utilization percent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => PAYLOAD }));
    render(<VesselActivity range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 data rows
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('renders an empty state when no vessels report', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...PAYLOAD, data: { ...PAYLOAD.data, vessels: [] } }),
    }));
    render(<VesselActivity range="7d" />);
    await vi.runOnlyPendingTimersAsync();
    await waitFor(() => expect(screen.getByText(/No vessel positions/i)).toBeInTheDocument());
  });
});
