import { describe, it, expect, vi } from 'vitest';

vi.mock('./config', () => ({
  config: {
    port: 3001,
    aisstreamApiKey: 'test-key',
    corsOrigin: 'http://localhost:5173',
    aprsfiApiKey: null,
    vesselApiKey: null,
    aisProviderOrder: ['aisstream'],
    aisSilenceTimeoutMs: 300_000,
    aisPollingIntervalMs: 30_000,
    ferryStatusPollMs: 30_000,
  },
}));

import { parseTimesFromMessage } from './ferryStatusMonitor';

describe('parseTimesFromMessage', () => {
  it('returns empty array for null input', () => {
    expect(parseTimesFromMessage(null)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseTimesFromMessage('')).toEqual([]);
  });

  it('returns empty array when message contains no times', () => {
    expect(parseTimesFromMessage('Ferry service suspended due to weather.')).toEqual([]);
  });

  it('parses 12-hour times with am/pm separated by space', () => {
    const result = parseTimesFromMessage('Ferries depart at 9:00 am, 11:00 am, 1:00 pm');
    expect(result).toEqual(['09:00', '11:00', '13:00']);
  });

  it('parses 12-hour times with dotted a.m./p.m. notation', () => {
    const result = parseTimesFromMessage('Ferry departs at 9:00 a.m. and 5:30 p.m.');
    expect(result).toEqual(['09:00', '17:30']);
  });

  it('parses 12-hour times without minutes (hour-only)', () => {
    const result = parseTimesFromMessage('Service at 9 am and 9:30 am only');
    expect(result).toEqual(['09:00', '09:30']);
  });

  it('parses 12-hour times with uppercase AM/PM', () => {
    const result = parseTimesFromMessage('10:30 AM, 12:00 PM, 2:30 PM');
    expect(result).toEqual(['10:30', '12:00', '14:30']);
  });

  it('converts 12:00 am to 00:00 and 12:00 pm to 12:00', () => {
    const result = parseTimesFromMessage('From 12:00 am to 12:00 pm');
    expect(result).toEqual(['00:00', '12:00']);
  });

  it('parses 24-hour times', () => {
    const result = parseTimesFromMessage('Reduced service: 09:00, 11:00, 13:00');
    expect(result).toEqual(['09:00', '11:00', '13:00']);
  });

  it('deduplicates equivalent times from 12h and 24h formats', () => {
    const result = parseTimesFromMessage('At 9:00 am, 9 am, 09:00');
    expect(result).toEqual(['09:00']);
  });

  it('returns times sorted ascending regardless of order in message', () => {
    const result = parseTimesFromMessage('4 pm, 8 am, 12 pm');
    expect(result).toEqual(['08:00', '12:00', '16:00']);
  });
});

describe('parseTimesFromMessage — range expressions', () => {
  it('returns [] for the actual live City Beltline message (between...until with a.m./p.m.)', () => {
    const live =
      "Due to ongoing shoreside infrastructure upgrades, Centre Island and Hanlan's Point will operate on a Beltline schedule. A single departing ferry from the city will service both Centre Island and Hanlan's Point on each trip between 8:30 a.m. until 9:15 p.m.";
    expect(parseTimesFromMessage(live)).toEqual([]);
  });

  it('returns [] for "Service runs from 9:00 am to 5:00 pm"', () => {
    expect(parseTimesFromMessage('Service runs from 9:00 am to 5:00 pm')).toEqual([]);
  });

  it('returns [] for "Departures between 8 am and 10 pm"', () => {
    expect(parseTimesFromMessage('Departures between 8 am and 10 pm')).toEqual([]);
  });

  it('returns [] for "Open from 09:00 to 17:00"', () => {
    expect(parseTimesFromMessage('Open from 09:00 to 17:00')).toEqual([]);
  });

  it('strips range from first sentence but preserves departure times in second sentence', () => {
    const result = parseTimesFromMessage('Service from 9 to 5. Departures: 10 am, 12 pm, 2 pm');
    expect(result).toEqual(['10:00', '12:00', '14:00']);
  });

  it('does NOT strip bare "and" — "Service at 9 am and 9:30 am only" returns both times', () => {
    expect(parseTimesFromMessage('Service at 9 am and 9:30 am only')).toEqual(['09:00', '09:30']);
  });

  it('returns all times when no range words present', () => {
    expect(parseTimesFromMessage('Departures at 9 am, 11 am, 1 pm, 3 pm')).toEqual([
      '09:00',
      '11:00',
      '13:00',
      '15:00',
    ]);
  });
});
