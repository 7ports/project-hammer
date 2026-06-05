import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useScheduleScrub } from './useScheduleScrub';
import type { ScheduleData } from '../types/schedule';

const SCHED: ScheduleData = {
  generatedAt: '2026-04-01T00:00:00Z',
  source: 'test',
  seasons: [
    {
      seasonId: 'spring',
      name: 'Spring',
      effectiveFrom: '2026-01-01',
      effectiveUntil: '2026-12-31',
      routes: [
        {
          routeId: 'jack-layton-wards',
          name: "Ward's Island",
          seasonal: false,
          seasonStart: null,
          seasonEnd: null,
          departures: [
            { direction: 'outbound', time: '09:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
            { direction: 'outbound', time: '10:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
            { direction: 'inbound', time: '09:30', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
          ],
        },
        {
          routeId: 'jack-layton-centre',
          name: 'Centre Island',
          seasonal: false,
          seasonStart: null,
          seasonEnd: null,
          departures: [
            { direction: 'outbound', time: '11:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
          ],
        },
      ],
    },
  ],
};

describe('useScheduleScrub', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-04-15 is a Wednesday; 08:30 local
    vi.setSystemTime(new Date('2026-04-15T08:30:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at live: offset=0, isLive=true', () => {
    const { result } = renderHook(() => useScheduleScrub(SCHED, []));
    expect(result.current.scrubOffsetMin).toBe(0);
    expect(result.current.isLive).toBe(true);
  });

  it('setScrubOffsetMin updates scrubAt and flips isLive off', () => {
    const { result } = renderHook(() => useScheduleScrub(SCHED, []));
    act(() => {
      result.current.setScrubOffsetMin(60);
    });
    expect(result.current.scrubOffsetMin).toBe(60);
    expect(result.current.isLive).toBe(false);
    // 08:30 + 60min = 09:30
    expect(result.current.scrubAt.getHours()).toBe(9);
    expect(result.current.scrubAt.getMinutes()).toBe(30);
  });

  it('reset() returns to live', () => {
    const { result } = renderHook(() => useScheduleScrub(SCHED, []));
    act(() => {
      result.current.setScrubOffsetMin(30);
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.scrubOffsetMin).toBe(0);
    expect(result.current.isLive).toBe(true);
  });

  it('computes scheduled-vs-actual gap minutes for wards outbound', () => {
    const { result } = renderHook(() => useScheduleScrub(SCHED, []));
    act(() => {
      result.current.setScrubOffsetMin(35); // scrubAt = 09:05
    });
    const gap = result.current.gaps.find(
      g => g.routeId === 'jack-layton-wards' && g.scheduledDirection === 'outbound',
    );
    expect(gap).toBeDefined();
    // At now (08:30) next outbound = 09:00; at scrubAt (09:05) next = 10:00 → 60 min ahead
    expect(gap!.scheduledTime).toBe('10:00');
    expect(gap!.gapMinutes).toBe(60);
  });

  it('returns empty gaps when schedule is null', () => {
    const { result } = renderHook(() => useScheduleScrub(null, []));
    expect(result.current.gaps).toEqual([]);
  });
});
