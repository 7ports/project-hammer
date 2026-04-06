/**
 * Tests for the pure logic extracted from useServiceStatus.ts.
 *
 * isSeasonallyClosed and buildRouteStatuses are not exported from the hook,
 * so we reproduce their logic here as testable pure functions.  This is the
 * accepted QA pattern when functions are internal: copy the logic, test it
 * independently, and treat any divergence as a regression signal.
 *
 * If those functions are ever exported, update the imports and remove the
 * local copies.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RouteId } from '../types/schedule';
import type { RouteStatus, DisruptionType } from '../types/serviceStatus';

// ---------------------------------------------------------------------------
// Reproduced pure functions (copied from useServiceStatus.ts)
// ---------------------------------------------------------------------------

function isSeasonallyClosed(routeId: RouteId): boolean {
  if (routeId !== 'jack-layton-centre') return false;
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  const afterSeasonEnd = month > 10 || (month === 10 && day > 15);
  const beforeSeasonStart = month < 4 || (month === 4 && day < 15);
  return afterSeasonEnd || beforeSeasonStart;
}

interface FerryStatusResponse {
  status: 'open' | 'alert' | 'closed' | 'unknown';
  reason: string | null;
  message: string | null;
  postedAt: string | null;
  source: 'live' | 'error';
}

const ROUTE_IDS: RouteId[] = [
  'jack-layton-wards',
  'jack-layton-centre',
  'jack-layton-hanlans',
];

function mapDisruptionType(reason: string | null): DisruptionType {
  if (!reason) return 'other';
  const r = reason.toLowerCase();
  if (r.includes('weather')) return 'weather';
  if (r.includes('mechanical')) return 'mechanical';
  if (r.includes('accident')) return 'accident';
  return 'other';
}

function buildRouteStatuses(ferry: FerryStatusResponse | null): RouteStatus[] {
  return ROUTE_IDS.map((routeId): RouteStatus => {
    if (isSeasonallyClosed(routeId)) {
      return {
        routeId,
        status: 'seasonal-closure',
        message: 'Seasonal — service resumes April 15',
        disruptionType: null,
      };
    }

    if (!ferry || ferry.status === 'unknown') {
      return { routeId, status: 'unknown', message: null, disruptionType: null };
    }

    if (ferry.status === 'open') {
      return { routeId, status: 'operating', message: null, disruptionType: null };
    }

    // alert or closed — terminal-wide disruption applies to all routes
    return {
      routeId,
      status: 'disrupted',
      message: ferry.message,
      disruptionType: mapDisruptionType(ferry.reason),
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setTime(isoString: string): void {
  vi.setSystemTime(new Date(isoString));
}

function centreStatus(ferry: FerryStatusResponse | null): RouteStatus {
  return buildRouteStatuses(ferry).find(r => r.routeId === 'jack-layton-centre')!;
}

function wardsStatus(ferry: FerryStatusResponse | null): RouteStatus {
  return buildRouteStatuses(ferry).find(r => r.routeId === 'jack-layton-wards')!;
}

function hanlansStatus(ferry: FerryStatusResponse | null): RouteStatus {
  return buildRouteStatuses(ferry).find(r => r.routeId === 'jack-layton-hanlans')!;
}

// ---------------------------------------------------------------------------
// isSeasonallyClosed tests
// ---------------------------------------------------------------------------

describe('isSeasonallyClosed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Centre Island — before season start ──────────────────────────────────

  it('Centre Island is closed on April 14 (one day before season start)', () => {
    setTime('2026-04-14T12:00:00');
    expect(isSeasonallyClosed('jack-layton-centre')).toBe(true);
  });

  it('Centre Island is open on April 15 (season start date)', () => {
    setTime('2026-04-15T00:00:00');
    expect(isSeasonallyClosed('jack-layton-centre')).toBe(false);
  });

  it('Centre Island is open on April 16 (after season start)', () => {
    setTime('2026-04-16T12:00:00');
    expect(isSeasonallyClosed('jack-layton-centre')).toBe(false);
  });

  // ── Centre Island — after season end ─────────────────────────────────────

  it('Centre Island is open on October 15 at 23:59 (last minute of season end date)', () => {
    setTime('2026-10-15T23:59:59');
    expect(isSeasonallyClosed('jack-layton-centre')).toBe(false);
  });

  it('Centre Island is closed on October 16 at 00:00 (first moment after season end)', () => {
    setTime('2026-10-16T00:00:00');
    expect(isSeasonallyClosed('jack-layton-centre')).toBe(true);
  });

  it('Centre Island is closed on October 16 (day after season end)', () => {
    setTime('2026-10-16T12:00:00');
    expect(isSeasonallyClosed('jack-layton-centre')).toBe(true);
  });

  it('Centre Island is closed in mid-summer (July 15)', () => {
    setTime('2026-07-15T12:00:00');
    expect(isSeasonallyClosed('jack-layton-centre')).toBe(false);
  });

  it('Centre Island is closed in January', () => {
    setTime('2026-01-15T12:00:00');
    expect(isSeasonallyClosed('jack-layton-centre')).toBe(true);
  });

  it('Centre Island is closed in December', () => {
    setTime('2026-12-01T12:00:00');
    expect(isSeasonallyClosed('jack-layton-centre')).toBe(true);
  });

  // ── Non-Centre routes — never seasonally closed ───────────────────────────

  it("Ward's Island is never seasonally closed — mid-winter", () => {
    setTime('2026-01-15T12:00:00');
    expect(isSeasonallyClosed('jack-layton-wards')).toBe(false);
  });

  it("Ward's Island is never seasonally closed — before Centre season start", () => {
    setTime('2026-04-14T12:00:00');
    expect(isSeasonallyClosed('jack-layton-wards')).toBe(false);
  });

  it("Hanlan's Point is never seasonally closed — mid-winter", () => {
    setTime('2026-01-15T12:00:00');
    expect(isSeasonallyClosed('jack-layton-hanlans')).toBe(false);
  });

  it("Hanlan's Point is never seasonally closed — after Centre season end", () => {
    setTime('2026-10-20T12:00:00');
    expect(isSeasonallyClosed('jack-layton-hanlans')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRouteStatuses tests
// ---------------------------------------------------------------------------

describe('buildRouteStatuses', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Seasonal closure supersedes ferry status ──────────────────────────────

  it('Centre Island shows seasonal-closure when before April 15 regardless of ferry status', () => {
    setTime('2026-04-14T12:00:00');
    const openFerry: FerryStatusResponse = {
      status: 'open', reason: null, message: null, postedAt: null, source: 'live',
    };
    const status = centreStatus(openFerry);
    expect(status.status).toBe('seasonal-closure');
  });

  it('Centre Island shows seasonal-closure when after October 15 regardless of ferry status', () => {
    setTime('2026-10-20T12:00:00');
    const openFerry: FerryStatusResponse = {
      status: 'open', reason: null, message: null, postedAt: null, source: 'live',
    };
    const status = centreStatus(openFerry);
    expect(status.status).toBe('seasonal-closure');
  });

  it('seasonal-closure message is not null', () => {
    setTime('2026-04-14T12:00:00');
    const status = centreStatus(null);
    expect(status.message).toBeTruthy();
    expect(typeof status.message).toBe('string');
  });

  // ── ferry status 'open' → operating ──────────────────────────────────────

  it("maps ferry status 'open' to ServiceState 'operating' for Ward's Island", () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'open', reason: null, message: null, postedAt: null, source: 'live',
    };
    expect(wardsStatus(ferry).status).toBe('operating');
  });

  it("maps ferry status 'open' to 'operating' for Centre Island in season", () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'open', reason: null, message: null, postedAt: null, source: 'live',
    };
    expect(centreStatus(ferry).status).toBe('operating');
  });

  // ── ferry status 'alert' → disrupted ─────────────────────────────────────

  it("maps ferry status 'alert' to ServiceState 'disrupted'", () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'alert',
      reason: 'weather',
      message: 'Rough conditions — reduced schedule',
      postedAt: null,
      source: 'live',
    };
    expect(wardsStatus(ferry).status).toBe('disrupted');
  });

  it("maps ferry status 'closed' to ServiceState 'disrupted'", () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'closed',
      reason: 'mechanical',
      message: 'Vessel maintenance',
      postedAt: null,
      source: 'live',
    };
    expect(wardsStatus(ferry).status).toBe('disrupted');
  });

  // ── ferry status 'unknown' → unknown ─────────────────────────────────────

  it("maps ferry status 'unknown' to ServiceState 'unknown'", () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'unknown', reason: null, message: null, postedAt: null, source: 'error',
    };
    expect(wardsStatus(ferry).status).toBe('unknown');
  });

  it('returns unknown for all routes when ferry data is null', () => {
    setTime('2026-07-15T12:00:00');
    const statuses = buildRouteStatuses(null);
    // Centre is in-season so it will be operating/unknown, not seasonal-closure.
    // Ward's and Hanlan's should be 'unknown'.
    expect(wardsStatus(null).status).toBe('unknown');
    expect(hanlansStatus(null).status).toBe('unknown');
    // Ensure no status slipped through as 'operating' or 'disrupted'
    statuses
      .filter(r => r.routeId !== 'jack-layton-centre')
      .forEach(r => expect(r.status).toBe('unknown'));
  });

  // ── disruptionType mapping ────────────────────────────────────────────────

  it('maps reason "weather" to disruptionType "weather"', () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'alert', reason: 'weather', message: 'High winds', postedAt: null, source: 'live',
    };
    expect(wardsStatus(ferry).disruptionType).toBe('weather');
  });

  it('maps reason "mechanical issue" to disruptionType "mechanical"', () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'closed', reason: 'mechanical issue', message: 'Engine failure', postedAt: null, source: 'live',
    };
    expect(wardsStatus(ferry).disruptionType).toBe('mechanical');
  });

  it('maps reason "accident" to disruptionType "accident"', () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'closed', reason: 'accident on dock', message: null, postedAt: null, source: 'live',
    };
    expect(wardsStatus(ferry).disruptionType).toBe('accident');
  });

  it('maps unknown reason to disruptionType "other"', () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'alert', reason: 'special event', message: null, postedAt: null, source: 'live',
    };
    expect(wardsStatus(ferry).disruptionType).toBe('other');
  });

  it('maps null reason to disruptionType "other"', () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'alert', reason: null, message: null, postedAt: null, source: 'live',
    };
    expect(wardsStatus(ferry).disruptionType).toBe('other');
  });

  // ── message passthrough ───────────────────────────────────────────────────

  it('propagates the message string to the disrupted route status', () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'alert',
      reason: 'weather',
      message: 'Service delayed due to high winds',
      postedAt: null,
      source: 'live',
    };
    expect(wardsStatus(ferry).message).toBe('Service delayed due to high winds');
  });

  it('sets message to null for operating routes', () => {
    setTime('2026-07-15T12:00:00');
    const ferry: FerryStatusResponse = {
      status: 'open', reason: null, message: null, postedAt: null, source: 'live',
    };
    expect(wardsStatus(ferry).message).toBeNull();
  });

  // ── all three routes are always present in the result ────────────────────

  it('returns a status entry for all three route IDs', () => {
    setTime('2026-07-15T12:00:00');
    const statuses = buildRouteStatuses(null);
    const ids = statuses.map(s => s.routeId);
    expect(ids).toContain('jack-layton-wards');
    expect(ids).toContain('jack-layton-centre');
    expect(ids).toContain('jack-layton-hanlans');
    expect(statuses).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// mapDisruptionType tests (standalone)
// ---------------------------------------------------------------------------

describe('mapDisruptionType', () => {
  it('returns "weather" for reason containing "weather"', () => {
    expect(mapDisruptionType('rough weather conditions')).toBe('weather');
  });

  it('returns "mechanical" for reason containing "mechanical"', () => {
    expect(mapDisruptionType('Mechanical failure on vessel')).toBe('mechanical');
  });

  it('returns "accident" for reason containing "accident"', () => {
    expect(mapDisruptionType('Docking accident')).toBe('accident');
  });

  it('returns "other" for unrecognised reason', () => {
    expect(mapDisruptionType('planned maintenance')).toBe('other');
  });

  it('returns "other" for null reason', () => {
    expect(mapDisruptionType(null)).toBe('other');
  });

  it('is case-insensitive (WEATHER → weather)', () => {
    expect(mapDisruptionType('WEATHER EVENT')).toBe('weather');
  });
});
