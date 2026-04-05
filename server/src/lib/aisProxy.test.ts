/**
 * Unit tests for AISProxy (server/src/lib/aisProxy.ts).
 *
 * Strategy:
 *   - Set AISSTREAM_API_KEY before importing any module that reads it, so the
 *     config module does not throw at load time.
 *   - Mock the 'ws' module to avoid any real network connections.
 *   - Test only the public interface: getLatestPositions(), onPosition(),
 *     and the message-handling logic via a synthetic 'message' event.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Environment — must be set before importing config or aisProxy
// ---------------------------------------------------------------------------

process.env['AISSTREAM_API_KEY'] = 'test-api-key-for-vitest';

// ---------------------------------------------------------------------------
// Mock the 'ws' module
// ---------------------------------------------------------------------------

// We create a minimal EventEmitter-based mock WebSocket.  The AISProxy only
// uses: on('open'), on('message'), on('error'), on('close'), and send().
import { EventEmitter } from 'events';

let mockWsInstance: MockWs | null = null;

class MockWs extends EventEmitter {
  static OPEN = 1;
  readyState = MockWs.OPEN;
  send: Mock = vi.fn();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_url: string) {
    super();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    mockWsInstance = this;
  }
}

vi.mock('ws', () => {
  return { default: MockWs };
});

// ---------------------------------------------------------------------------
// Import the module under test AFTER the mock is in place
// ---------------------------------------------------------------------------

// Dynamic import is needed inside describe/it blocks to ensure the mock is
// active before the module resolves its dependencies.  We use a module-level
// variable and populate it in beforeEach.

import type { AISProxy as AISProxyType } from './aisProxy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_MMSIS = [316045069, 316045081, 316045082, 316050853] as const;
type ValidMMSI = typeof VALID_MMSIS[number];

function makeRawMessage(mmsi: number, overrides: {
  trueHeading?: number;
  cog?: number;
  sog?: number;
  shipName?: string;
} = {}): string {
  return JSON.stringify({
    MessageType: 'PositionReport',
    MetaData: {
      MMSI: mmsi,
      ShipName: overrides.shipName ?? 'Test Vessel',
      latitude: 43.63,
      longitude: -79.38,
      time_utc: '2026-04-05 12:00:00',
    },
    Message: {
      PositionReport: {
        TrueHeading: overrides.trueHeading ?? 90,
        Cog: overrides.cog ?? 45,
        Sog: overrides.sog ?? 5,
        Latitude: 43.63,
        Longitude: -79.38,
        NavigationalStatus: 0,
      },
    },
  });
}

/** Emit a synthetic AIS message to the mock WebSocket instance. */
function emitMessage(raw: string): void {
  if (!mockWsInstance) throw new Error('MockWs not instantiated — call proxy.connect() first');
  mockWsInstance.emit('message', Buffer.from(raw));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AISProxy', () => {
  let AISProxy: typeof AISProxyType;
  let proxy: AISProxyType;

  beforeEach(async () => {
    mockWsInstance = null;
    // Re-import to get a fresh class (the singleton is not used in tests;
    // we instantiate our own AISProxy).
    const mod = await import('./aisProxy');
    AISProxy = mod.AISProxy;
    proxy = new AISProxy();
    proxy.connect();
    // At this point the MockWs constructor has run and mockWsInstance is set.
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it('returns empty map before any positions are received', () => {
    const positions = proxy.getLatestPositions();
    expect(positions.size).toBe(0);
  });

  // ── MMSI filtering ────────────────────────────────────────────────────────

  it('stores a position for each of the four valid ferry MMSIs', () => {
    for (const mmsi of VALID_MMSIS) {
      emitMessage(makeRawMessage(mmsi));
    }
    const positions = proxy.getLatestPositions();
    expect(positions.size).toBe(4);
    for (const mmsi of VALID_MMSIS) {
      expect(positions.has(mmsi)).toBe(true);
    }
  });

  it('ignores positions for an unknown MMSI (999999999)', () => {
    emitMessage(makeRawMessage(999999999));
    const positions = proxy.getLatestPositions();
    expect(positions.size).toBe(0);
    expect(positions.has(999999999)).toBe(false);
  });

  it('ignores positions for a plausible but non-ferry MMSI (316000001)', () => {
    emitMessage(makeRawMessage(316000001));
    expect(proxy.getLatestPositions().size).toBe(0);
  });

  // ── Position storage ──────────────────────────────────────────────────────

  it('stores and retrieves the position for MMSI 316045069 (Sam McBride)', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi, { shipName: 'SAM MCBRIDE', sog: 7 }));
    const pos = proxy.getLatestPositions().get(mmsi);
    expect(pos).toBeDefined();
    expect(pos!.mmsi).toBe(mmsi);
    expect(pos!.name).toBe('SAM MCBRIDE');
    expect(pos!.speed).toBe(7);
  });

  it('overwrites the previous position when a newer update arrives for the same MMSI', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi, { sog: 3 }));
    emitMessage(makeRawMessage(mmsi, { sog: 8 }));
    const pos = proxy.getLatestPositions().get(mmsi);
    expect(pos!.speed).toBe(8);
  });

  it('getLatestPositions() returns at most one entry per MMSI', () => {
    const mmsi: ValidMMSI = 316045069;
    // Send three updates for the same vessel.
    emitMessage(makeRawMessage(mmsi, { sog: 1 }));
    emitMessage(makeRawMessage(mmsi, { sog: 2 }));
    emitMessage(makeRawMessage(mmsi, { sog: 3 }));
    const positions = proxy.getLatestPositions();
    // Still only one entry for that MMSI.
    expect(positions.size).toBe(1);
  });

  // ── TrueHeading sentinel ──────────────────────────────────────────────────

  it('uses TrueHeading when it is not 511', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi, { trueHeading: 135, cog: 180 }));
    const pos = proxy.getLatestPositions().get(mmsi)!;
    expect(pos.heading).toBe(135);
  });

  it('falls back to Cog (rounded) when TrueHeading === 511', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi, { trueHeading: 511, cog: 270.7 }));
    const pos = proxy.getLatestPositions().get(mmsi)!;
    // Math.round(270.7) % 360 = 271
    expect(pos.heading).toBe(271);
  });

  it('falls back to Cog 0 when TrueHeading === 511 and Cog is 0', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi, { trueHeading: 511, cog: 0 }));
    const pos = proxy.getLatestPositions().get(mmsi)!;
    expect(pos.heading).toBe(0);
  });

  it('wraps Cog values ≥ 360 to the 0-359 range when TrueHeading === 511', () => {
    const mmsi: ValidMMSI = 316045069;
    // Cog = 361 → Math.round(361) % 360 = 1
    emitMessage(makeRawMessage(mmsi, { trueHeading: 511, cog: 361 }));
    const pos = proxy.getLatestPositions().get(mmsi)!;
    expect(pos.heading).toBe(1);
  });

  // ── onPosition listener ───────────────────────────────────────────────────

  it('fires registered position listeners when a valid position is received', () => {
    const mmsi: ValidMMSI = 316045082;
    const listener = vi.fn();
    proxy.onPosition(listener);
    emitMessage(makeRawMessage(mmsi));
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].mmsi).toBe(mmsi);
  });

  it('does not fire listeners for unknown MMSIs', () => {
    const listener = vi.fn();
    proxy.onPosition(listener);
    emitMessage(makeRawMessage(999999999));
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribe function removes the listener', () => {
    const mmsi: ValidMMSI = 316045081;
    const listener = vi.fn();
    const unsubscribe = proxy.onPosition(listener);
    unsubscribe();
    emitMessage(makeRawMessage(mmsi));
    expect(listener).not.toHaveBeenCalled();
  });

  // ── Non-PositionReport messages are ignored ───────────────────────────────

  it('ignores messages with MessageType other than PositionReport', () => {
    const raw = JSON.stringify({
      MessageType: 'VoyageData',
      MetaData: { MMSI: VALID_MMSIS[0], ShipName: 'Sam McBride', latitude: 43.63, longitude: -79.38, time_utc: '2026-04-05 12:00:00' },
      Message: {},
    });
    emitMessage(raw);
    expect(proxy.getLatestPositions().size).toBe(0);
  });

  // ── Malformed messages ────────────────────────────────────────────────────

  it('does not throw when an invalid JSON message is received', () => {
    expect(() => emitMessage('not valid json {')).not.toThrow();
  });

  it('does not throw when Message.PositionReport is missing', () => {
    const raw = JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: VALID_MMSIS[0], ShipName: 'Sam McBride', latitude: 43.63, longitude: -79.38, time_utc: '2026-04-05 12:00:00' },
      Message: {},
    });
    expect(() => emitMessage(raw)).not.toThrow();
    expect(proxy.getLatestPositions().size).toBe(0);
  });

  // ── getLatestPositions returns a snapshot ─────────────────────────────────

  it('getLatestPositions() returns a copy — mutating it does not affect proxy state', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi));
    const snapshot = proxy.getLatestPositions();
    snapshot.clear();
    expect(proxy.getLatestPositions().size).toBe(1);
  });

  // ── timestamp parsing ─────────────────────────────────────────────────────

  it('stores timestamp as a valid ISO 8601 string', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi));
    const pos = proxy.getLatestPositions().get(mmsi)!;
    expect(() => new Date(pos.timestamp)).not.toThrow();
    expect(new Date(pos.timestamp).toISOString()).toBe(pos.timestamp);
  });

  // ── ShipName trimming ─────────────────────────────────────────────────────

  it('trims leading/trailing whitespace from ShipName', () => {
    const mmsi: ValidMMSI = 316045069;
    const raw = JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: {
        MMSI: mmsi,
        ShipName: '  SAM MCBRIDE  ',
        latitude: 43.63,
        longitude: -79.38,
        time_utc: '2026-04-05 12:00:00',
      },
      Message: {
        PositionReport: {
          TrueHeading: 90, Cog: 90, Sog: 5,
          Latitude: 43.63, Longitude: -79.38, NavigationalStatus: 0,
        },
      },
    });
    emitMessage(raw);
    expect(proxy.getLatestPositions().get(mmsi)!.name).toBe('SAM MCBRIDE');
  });
});
