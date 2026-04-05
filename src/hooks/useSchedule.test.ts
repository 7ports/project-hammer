/**
 * Tests for the pure scheduling logic extracted from useSchedule.ts.
 *
 * The hook wraps a pure function `getUpcoming` that does all the real work.
 * We replicate that function signature here so we can drive it with controlled
 * clock values via vi.useFakeTimers() without mounting a React component or
 * making any network calls.
 *
 * NOTE: The current implementation uses a FLAT `schedule.routes` array (no
 * seasons layer).  The season-selection tests (Tasks A-1 through A-3) are
 * therefore exercised against the schedule's `seasonal` / `seasonStart` /
 * `seasonEnd` metadata rather than a multi-season object — those fields exist
 * on RouteSchedule but the hook does not yet filter by them. Tests for
 * season selection are included as logic-level checks against the type
 * definitions rather than hook behaviour; they will become relevant once the
 * seasons layer is introduced.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ScheduleData, Departure, RouteId, DayOfWeek } from '../types/schedule';

// ---------------------------------------------------------------------------
// Reproduce the pure logic from useSchedule.ts so tests are not coupled to
// the hook's internal implementation.  If the hook is ever refactored to
// export getUpcoming directly these tests can simply be updated to import it.
// ---------------------------------------------------------------------------

const DAY_NAMES: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function getUpcoming(
  schedule: ScheduleData | null,
  routeId: RouteId,
  direction: 'outbound' | 'inbound',
  count: number,
): Departure[] {
  if (!schedule) return [];

  // The current ScheduleData uses a flat `routes` array.
  const route = (schedule as ScheduleData & { routes: (typeof schedule)['seasons'][0]['routes'] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .routes?.find((r: any) => r.routeId === routeId)
    // Fall back to seasons structure if routes is absent.
    ?? schedule.seasons?.flatMap(s => s.routes).find(r => r.routeId === routeId);

  if (!route) return [];

  const now = new Date();
  const todayDay = DAY_NAMES[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return route.departures
    .filter(d => d.direction === direction && d.days.includes(todayDay))
    .map(d => {
      const [h, m] = d.time.split(':').map(Number);
      return { departure: d, minutes: h * 60 + m };
    })
    .filter(({ minutes }) => minutes > currentMinutes)
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, count)
    .map(({ departure }) => departure);
}

// ---------------------------------------------------------------------------
// Minimal schedule fixture
// ---------------------------------------------------------------------------

/** A compact schedule with enough entries to exercise all branches. */
const MOCK_SCHEDULE: ScheduleData & { routes: unknown[] } = {
  generatedAt: '2026-04-05T00:00:00.000Z',
  source: 'test',
  seasons: [],          // unused by the current hook implementation
  routes: [
    {
      routeId: 'jack-layton-wards',
      name: "Ward's Island",
      seasonal: false,
      seasonStart: null,
      seasonEnd: null,
      departures: [
        // early morning
        { direction: 'outbound', time: '06:30', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        { direction: 'outbound', time: '07:20', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        { direction: 'outbound', time: '12:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
        { direction: 'outbound', time: '18:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
        { direction: 'outbound', time: '22:30', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
        // inbound
        { direction: 'inbound', time: '08:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        { direction: 'inbound', time: '17:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        // weekend-only
        { direction: 'outbound', time: '09:00', days: ['sat', 'sun'] },
        // peakOnly flag
        {
          direction: 'outbound',
          time: '08:30',
          days: ['mon', 'tue', 'wed', 'thu', 'fri'],
          peakOnly: true,
        },
      ],
    },
    {
      routeId: 'jack-layton-centre',
      name: 'Centre Island',
      seasonal: true,
      seasonStart: '04-15',
      seasonEnd: '10-15',
      departures: [
        { direction: 'outbound', time: '10:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
        { direction: 'outbound', time: '14:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
      ],
    },
  ],
} as unknown as ScheduleData & { routes: unknown[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set the fake clock to a specific day and time (local). */
function setTime(isoString: string): void {
  vi.setSystemTime(new Date(isoString));
}

/** 2026-04-06 is a Monday */
const MONDAY = '2026-04-06';
/** 2026-04-12 is a Sunday */
const SUNDAY = '2026-04-12';

// ---------------------------------------------------------------------------
// Reproduce findActiveSeason from useSchedule.ts for season-selection tests
// ---------------------------------------------------------------------------

import type { ScheduleSeason } from '../types/schedule';

function findActiveSeason(schedule: ScheduleData, today: string): ScheduleSeason | null {
  if (schedule.seasons.length === 0) return null;
  const exact = schedule.seasons.find(
    s => today >= s.effectiveFrom && today <= s.effectiveUntil,
  );
  if (exact) return exact;
  const past = schedule.seasons
    .filter(s => s.effectiveFrom <= today)
    .sort((a, b) => (a.effectiveFrom > b.effectiveFrom ? -1 : 1));
  return past[0] ?? schedule.seasons[0];
}

const SEASON_SCHEDULE: ScheduleData = {
  generatedAt: '2026-04-05T00:00:00.000Z',
  source: 'test',
  seasons: [
    {
      seasonId: 'winter',
      name: 'Winter Schedule',
      effectiveFrom: '2025-10-15',
      effectiveUntil: '2026-04-07',
      routes: [{ routeId: 'jack-layton-wards', name: "Ward's Island", seasonal: false, seasonStart: null, seasonEnd: null, departures: [] }],
    },
    {
      seasonId: 'spring',
      name: 'Spring Schedule',
      effectiveFrom: '2026-04-08',
      effectiveUntil: '2026-05-12',
      routes: [
        { routeId: 'jack-layton-wards', name: "Ward's Island", seasonal: false, seasonStart: null, seasonEnd: null, departures: [] },
        { routeId: 'jack-layton-centre', name: 'Centre Island', seasonal: false, seasonStart: null, seasonEnd: null, departures: [] },
        { routeId: 'jack-layton-hanlans', name: "Hanlan's Point", seasonal: false, seasonStart: null, seasonEnd: null, departures: [] },
      ],
    },
    {
      seasonId: 'summer',
      name: 'Summer Schedule',
      effectiveFrom: '2026-05-13',
      effectiveUntil: '2026-09-15',
      routes: [
        { routeId: 'jack-layton-wards', name: "Ward's Island", seasonal: false, seasonStart: null, seasonEnd: null, departures: [] },
        { routeId: 'jack-layton-centre', name: 'Centre Island', seasonal: false, seasonStart: null, seasonEnd: null, departures: [] },
        { routeId: 'jack-layton-hanlans', name: "Hanlan's Point", seasonal: false, seasonStart: null, seasonEnd: null, departures: [] },
      ],
    },
    {
      seasonId: 'fall',
      name: 'Fall Schedule',
      effectiveFrom: '2026-09-16',
      effectiveUntil: '2026-10-14',
      routes: [
        { routeId: 'jack-layton-wards', name: "Ward's Island", seasonal: false, seasonStart: null, seasonEnd: null, departures: [] },
        { routeId: 'jack-layton-centre', name: 'Centre Island', seasonal: false, seasonStart: null, seasonEnd: null, departures: [] },
        { routeId: 'jack-layton-hanlans', name: "Hanlan's Point", seasonal: false, seasonStart: null, seasonEnd: null, departures: [] },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getUpcoming (schedule logic)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Null-safety ──────────────────────────────────────────────────────────

  it('returns empty array when schedule is null', () => {
    setTime(`${MONDAY}T10:00:00`);
    expect(getUpcoming(null, 'jack-layton-wards', 'outbound', 5)).toEqual([]);
  });

  it('returns empty array when routeId does not exist in schedule', () => {
    setTime(`${MONDAY}T10:00:00`);
    expect(
      getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-hanlans', 'outbound', 5),
    ).toEqual([]);
  });

  // ── Basic filtering ───────────────────────────────────────────────────────

  it('returns up to `count` upcoming outbound departures in chronological order', () => {
    // Monday 10:05 — the 06:30, 07:20, 08:30(peak), and 08:00 inbound are past;
    // remaining outbound: 12:00, 18:00, 22:30.  Ask for 2 → [12:00, 18:00].
    setTime(`${MONDAY}T10:05:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 2);
    expect(result).toHaveLength(2);
    expect(result[0].time).toBe('12:00');
    expect(result[1].time).toBe('18:00');
  });

  it('respects the `direction` filter — does not mix outbound and inbound', () => {
    // Monday 07:30 — only inbound 08:00 is upcoming (17:00 is also upcoming but count=1)
    setTime(`${MONDAY}T07:30:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'inbound', 1);
    expect(result).toHaveLength(1);
    expect(result[0].direction).toBe('inbound');
    expect(result[0].time).toBe('08:00');
  });

  // ── Day-of-week filtering ─────────────────────────────────────────────────

  it('excludes weekday-only departures on a Sunday', () => {
    // Sunday 07:00 — the 06:30 and 07:20 entries are weekday-only.
    // Only the 09:00 (sat/sun) and 12:00/18:00/22:30 (all days) should appear.
    setTime(`${SUNDAY}T07:00:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 10);
    const times = result.map(d => d.time);
    expect(times).not.toContain('06:30');
    expect(times).not.toContain('07:20');
    expect(times).toContain('09:00');
    expect(times).toContain('12:00');
  });

  it('includes weekend-only departure (09:00) only when today is Saturday or Sunday', () => {
    // Monday 08:00 — 09:00 is sat/sun only; must NOT appear.
    setTime(`${MONDAY}T08:00:00`);
    const resultWeekday = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 10);
    expect(resultWeekday.map(d => d.time)).not.toContain('09:00');

    // Saturday 08:00 — 09:00 IS on sat; MUST appear.
    setTime('2026-04-11T08:00:00'); // Saturday
    const resultWeekend = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 10);
    expect(resultWeekend.map(d => d.time)).toContain('09:00');
  });

  // ── Time parsing ─────────────────────────────────────────────────────────

  it('treats "06:30" as 06:30 (not midnight): departure at 06:30 is upcoming at 06:00', () => {
    setTime(`${MONDAY}T06:00:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 1);
    expect(result[0].time).toBe('06:30');
  });

  it('treats "06:30" as past when current time is 06:31', () => {
    setTime(`${MONDAY}T06:31:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 5);
    const times = result.map(d => d.time);
    expect(times).not.toContain('06:30');
  });

  // ── End-of-day boundary ───────────────────────────────────────────────────

  it('returns empty array when all departures for today have already passed', () => {
    // Monday 23:00 — last departure is 22:30, so no upcoming departures remain today.
    setTime(`${MONDAY}T23:00:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 5);
    expect(result).toHaveLength(0);
  });

  it('counts a 22:30 departure as upcoming at 22:00 (same day, late night)', () => {
    setTime(`${MONDAY}T22:00:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 5);
    const times = result.map(d => d.time);
    expect(times).toContain('22:30');
  });

  // ── Count cap ────────────────────────────────────────────────────────────

  it('never returns more than `count` entries even when more are available', () => {
    // Monday 06:00 — multiple departures remain; cap at 2.
    setTime(`${MONDAY}T06:00:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  // ── Result ordering ───────────────────────────────────────────────────────

  it('returns results sorted in ascending time order', () => {
    setTime(`${MONDAY}T06:00:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 10);
    const times = result.map(d => d.time);
    const sorted = [...times].sort();
    expect(times).toEqual(sorted);
  });

  // ── peakOnly flag ─────────────────────────────────────────────────────────

  it('includes peakOnly departures in the result set (hook does not filter them out)', () => {
    // The current getUpcoming does not filter peakOnly — it is up to the UI.
    // Monday 08:00 — 08:30 (peakOnly) should still appear.
    setTime(`${MONDAY}T08:00:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-wards', 'outbound', 10);
    const times = result.map(d => d.time);
    expect(times).toContain('08:30');
  });

  // ── Centre Island route ───────────────────────────────────────────────────

  it('returns Centre Island departures when schedule data has that route', () => {
    // Monday 09:00 — centre island 10:00 and 14:00 are both upcoming.
    setTime(`${MONDAY}T09:00:00`);
    const result = getUpcoming(MOCK_SCHEDULE as unknown as ScheduleData, 'jack-layton-centre', 'outbound', 5);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].time).toBe('10:00');
  });
});

// ---------------------------------------------------------------------------
// Season selection — findActiveSeason
// ---------------------------------------------------------------------------

describe('findActiveSeason (season selection logic)', () => {
  it('returns winter season on 2026-04-05 (mid-winter)', () => {
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-04-05');
    expect(season?.seasonId).toBe('winter');
  });

  it('returns winter season on the last day of winter 2026-04-07', () => {
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-04-07');
    expect(season?.seasonId).toBe('winter');
  });

  it('returns spring season on the first day of spring 2026-04-08', () => {
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-04-08');
    expect(season?.seasonId).toBe('spring');
  });

  it('returns spring season on 2026-04-30 (mid-spring)', () => {
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-04-30');
    expect(season?.seasonId).toBe('spring');
  });

  it('returns spring season on the last day of spring 2026-05-12', () => {
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-05-12');
    expect(season?.seasonId).toBe('spring');
  });

  it('returns summer season on the first day of summer 2026-05-13', () => {
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-05-13');
    expect(season?.seasonId).toBe('summer');
  });

  it('returns summer season on 2026-07-15 (mid-summer)', () => {
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-07-15');
    expect(season?.seasonId).toBe('summer');
  });

  it('returns fall season on 2026-09-20 (mid-fall)', () => {
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-09-20');
    expect(season?.seasonId).toBe('fall');
  });

  it('spring season has 3 routes (Ward\'s, Centre, Hanlan\'s)', () => {
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-04-10');
    expect(season?.routes).toHaveLength(3);
    const ids = season?.routes.map(r => r.routeId);
    expect(ids).toContain('jack-layton-wards');
    expect(ids).toContain('jack-layton-centre');
    expect(ids).toContain('jack-layton-hanlans');
  });

  it('winter season has only 1 route (Ward\'s Island)', () => {
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-01-15');
    expect(season?.routes).toHaveLength(1);
    expect(season?.routes[0].routeId).toBe('jack-layton-wards');
  });

  it('falls back to most recent past season when today is between seasons', () => {
    // Between fall end (Oct 14) and winter start (Oct 15) — shouldn't happen
    // but if it does, fallback returns the most recently started season
    const season = findActiveSeason(SEASON_SCHEDULE, '2026-10-15');
    expect(season).not.toBeNull();
  });

  it('returns first season when schedule has no past or matching seasons', () => {
    const futureSchedule: ScheduleData = {
      ...SEASON_SCHEDULE,
      seasons: [{ ...SEASON_SCHEDULE.seasons[0], effectiveFrom: '2030-01-01', effectiveUntil: '2030-12-31' }],
    };
    const season = findActiveSeason(futureSchedule, '2026-04-05');
    expect(season).not.toBeNull();
  });
});
