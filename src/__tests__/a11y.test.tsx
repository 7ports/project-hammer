/**
 * Accessibility audit — runs axe-core against the components surfaced by
 * the task acceptance criteria for project-hammer-b03.
 *
 * Targets:
 *  - SheetTrigger (mobile FAB) — accessible name, button role, keyboard reachable
 *  - PanelShell mobile bottom-sheet — role=dialog, aria-modal, heading wiring
 *  - StatsPage — heading hierarchy, landmark structure
 *
 * Why component-level (not the prod HTML)?
 *  The shipped index.html is an empty React shell — axe against it sees only the
 *  document chrome. Running axe against the same components React renders in prod
 *  exercises the actual a11y surface. axe-core runs natively in jsdom so this
 *  test executes locally without a headless browser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import axe, { type AxeResults } from 'axe-core';
import { useRef } from 'react';
import { SheetTrigger } from '../components/Layout/SheetTrigger';
import { PanelShell } from '../components/Panel/PanelShell';
import StatsPage from '../pages/StatsPage';
import type { AnalyticsEnvelope, SummaryPayload } from '../types/analytics';

// axe rules disabled with justification (color-contrast can't be evaluated in
// jsdom because the stylesheet's computed colors are not applied; we run that
// rule via Lighthouse / pa11y in CI where chrome paints the page).
const AXE_DISABLED_RULES = ['color-contrast', 'meta-viewport', 'document-title', 'html-has-lang', 'landmark-one-main', 'region'];

async function runAxe(container: HTMLElement): Promise<AxeResults> {
  return axe.run(container, {
    rules: Object.fromEntries(AXE_DISABLED_RULES.map((r) => [r, { enabled: false }])),
    resultTypes: ['violations'],
  });
}

function formatViolations(results: AxeResults): string {
  return results.violations
    .map((v) => `[${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`)
    .join('\n');
}

const SUMMARY_FIXTURE: AnalyticsEnvelope<SummaryPayload> = {
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

function FabHarness({ isOpen = false }: { isOpen?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <SheetTrigger ref={ref} isOpen={isOpen} onToggle={() => undefined} controls="sheet-id" />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a11y — mobile FAB (SheetTrigger)', () => {
  it('has no axe violations when closed', async () => {
    const { container } = render(<FabHarness isOpen={false} />);
    const results = await runAxe(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('has no axe violations when open', async () => {
    const { container } = render(<FabHarness isOpen />);
    const results = await runAxe(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('exposes accessible name, aria-expanded, aria-controls, aria-haspopup', () => {
    render(<FabHarness isOpen={false} />);
    const btn = screen.getByRole('button', { name: /open ferry information panel/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveAttribute('aria-controls', 'sheet-id');
    expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
  });
});

describe('a11y — PanelShell mobile bottom-sheet', () => {
  beforeEach(() => {
    // Force the mobile branch of PanelShell (matchMedia mock — desktop SSR fallback).
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: !query.includes('min-width'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }));
  });

  it('expanded dialog has role=dialog, aria-modal, accessible name, no axe violations', async () => {
    render(
      <PanelShell vessel={null} sheetId="test-sheet" isExpanded onExpandedChange={() => undefined} />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'test-sheet-heading');
    const results = await runAxe(document.body);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });
});

describe('a11y — StatsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      // Return per-resource shapes so each Stats widget renders its empty/no-data branch
      // without crashing on `.length` / `.map` of undefined.
      const generatedAt = '2026-06-01T00:00:00Z';
      const range = { key: '7d', days: 7, fromMs: 0, toMs: 1 };
      let data: unknown = {};
      if (url.includes('/api/analytics/summary')) return { ok: true, status: 200, json: async () => SUMMARY_FIXTURE } as Response;
      if (url.includes('/api/analytics/trips')) data = { range, granularity: 'day', series: [], tripsCount: 0, trips: [] };
      else if (url.includes('/api/analytics/utilization')) data = { range, vessels: [] };
      else if (url.includes('/api/analytics/dwell')) data = { range, stats: [] };
      else if (url.includes('/api/analytics/disruptions')) data = { range, events: [], count: 0 };
      else if (url.includes('/api/analytics/data-quality')) data = { range, totalPositions: 0, longestGapMs: null, gapCount: 0, providerTransitions: [], uptimePct: null };
      return { ok: true, status: 200, json: async () => ({ data, generatedAt, cached: false }) } as Response;
    }));
  });

  it('has h1, range selector, back button, and no axe violations on initial render', async () => {
    const { container } = render(<StatsPage onBackToLive={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.getByLabelText(/range:/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /live map/i })).toBeInTheDocument();
    const results = await runAxe(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });
});
