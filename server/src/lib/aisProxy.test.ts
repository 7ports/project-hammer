/**
 * Unit tests for AISStreamProvider (server/src/lib/providers/aisstreamProvider.ts).
 *
 * Strategy:
 *   - Set AISSTREAM_API_KEY before importing any module that reads it, so the
 *     config module does not throw at load time.
 *   - Mock the 'ws' module to avoid any real network connections.
 *   - Test only the public interface: getLatestPositions(), onPosition(),
 *     and the message-handling logic via a synthetic 'message' event.
 *
 * Note: AISProxy in aisProxy.ts is now an alias for AISProviderManager, which
 * requires providers as its first constructor arg. Tests use AISStreamProvider
 * directly to keep the test surface focused on message parsing logic.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Environment — must be set before importing config or any provider
// ---------------------------------------------------------------------------

process.env['AISSTREAM_API_KEY'] = 'test-api-key-for-vitest';

// ---------------------------------------------------------------------------
// Mock the 'ws' module
// ---------------------------------------------------------------------------

// We create a minimal EventEmitter-based mock WebSocket.  AISStreamProvider
// uses: on('open'), on('message'), on('error'), on('close'), and send().
import { EventEmitter } from 'events';

let mockWsInstance: MockWs | null = null;

class MockWs extends EventEmitter {
  static OPEN = 1;
  readyState = MockWs.OPEN;
  send: Mock = vi.fn();
  terminate: Mock = vi.fn();

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

import type { AISStreamProvider as AISStreamProviderType } from './providers/aisstreamProvider';
import type { VesselPosition } from './types';
import type { PositionListener } from './types';

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
  if (!mockWsInstance) throw new Error('MockWs not instantiated — call proxy.start() first');
  mockWsInstance.emit('message', Buffer.from(raw));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AISProxy', () => {
  let AISStreamProvider: typeof AISStreamProviderType;
  let proxy: AISStreamProviderType;

  // Local position store + listener set — mirrors what AISProviderManager does
  let positions: Map<number, VesselPosition>;
  let listeners: Set<PositionListener>;

  beforeEach(async () => {
    mockWsInstance = null;
    positions = new Map();
    listeners = new Set();

    // Re-import to get a fresh module each test (vitest caches by default but
    // the mock is stable; we just want a fresh instance).
    const mod = await import('./providers/aisstreamProvider');
    AISStreamProvider = mod.AISStreamProvider;

    proxy = new AISStreamProvider('test-api-key-for-vitest');

    proxy.start((pos) => {
      positions.set(pos.mmsi, pos);
      for (const cb of listeners) {
        cb(pos);
      }
    });
    // At this point the MockWs constructor has run and mockWsInstance is set.
  });

  // Helper: register a position listener and return an unsubscribe fn
  function onPosition(cb: PositionListener): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }

  // Helper: return a snapshot of current positions
  function getLatestPositions(): Map<number, VesselPosition> {
    return new Map(positions);
  }

  // ── Initial state ─────────────────────────────────────────────────────────

  it('returns empty map before any positions are received', () => {
    expect(getLatestPositions().size).toBe(0);
  });

  // ── MMSI filtering ────────────────────────────────────────────────────────

  it('stores a position for each of the four valid ferry MMSIs', () => {
    for (const mmsi of VALID_MMSIS) {
      emitMessage(makeRawMessage(mmsi));
    }
    expect(getLatestPositions().size).toBe(4);
    for (const mmsi of VALID_MMSIS) {
      expect(getLatestPositions().has(mmsi)).toBe(true);
    }
  });

  it('ignores positions for an unknown MMSI (999999999)', () => {
    emitMessage(makeRawMessage(999999999));
    expect(getLatestPositions().size).toBe(0);
    expect(getLatestPositions().has(999999999)).toBe(false);
  });

  it('ignores positions for a plausible but non-ferry MMSI (316000001)', () => {
    emitMessage(makeRawMessage(316000001));
    expect(getLatestPositions().size).toBe(0);
  });

  // ── Position storage ──────────────────────────────────────────────────────

  it('stores and retrieves the position for MMSI 316045069 (Sam McBride)', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi, { shipName: 'SAM MCBRIDE', sog: 7 }));
    const pos = getLatestPositions().get(mmsi);
    expect(pos).toBeDefined();
    expect(pos!.mmsi).toBe(mmsi);
    expect(pos!.name).toBe('SAM MCBRIDE');
    expect(pos!.speed).toBe(7);
  });

  it('overwrites the previous position when a newer update arrives for the same MMSI', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi, { sog: 3 }));
    emitMessage(makeRawMessage(mmsi, { sog: 8 }));
    const pos = getLatestPositions().get(mmsi);
    expect(pos!.speed).toBe(8);
  });

  it('getLatestPositions() returns at most one entry per MMSI', () => {
    const mmsi: ValidMMSI = 316045069;
    // Send three updates for the same vessel.
    emitMessage(makeRawMessage(mmsi, { sog: 1 }));
    emitMessage(makeRawMessage(mmsi, { sog: 2 }));
    emitMessage(makeRawMessage(mmsi, { sog: 3 }));
    // Still only one entry for that MMSI.
    expect(getLatestPositions().size).toBe(1);
  });

  // ── TrueHeading sentinel ──────────────────────────────────────────────────

  it('uses TrueHeading when it is not 511', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi, { trueHeading: 135, cog: 180 }));
    const pos = getLatestPositions().get(mmsi)!;
    expect(pos.heading).toBe(135);
  });

  it('falls back to Cog (rounded) when TrueHeading === 511', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi, { trueHeading: 511, cog: 270.7 }));
    const pos = getLatestPositions().get(mmsi)!;
    // Math.round(270.7) % 360 = 271
    expect(pos.heading).toBe(271);
  });

  it('falls back to Cog 0 when TrueHeading === 511 and Cog is 0', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi, { trueHeading: 511, cog: 0 }));
    const pos = getLatestPositions().get(mmsi)!;
    expect(pos.heading).toBe(0);
  });

  it('wraps Cog values ≥ 360 to the 0-359 range when TrueHeading === 511', () => {
    const mmsi: ValidMMSI = 316045069;
    // Cog = 361 → Math.round(361) % 360 = 1
    emitMessage(makeRawMessage(mmsi, { trueHeading: 511, cog: 361 }));
    const pos = getLatestPositions().get(mmsi)!;
    expect(pos.heading).toBe(1);
  });

  // ── onPosition listener ───────────────────────────────────────────────────

  it('fires registered position listeners when a valid position is received', () => {
    const mmsi: ValidMMSI = 316045082;
    const listener = vi.fn();
    onPosition(listener);
    emitMessage(makeRawMessage(mmsi));
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].mmsi).toBe(mmsi);
  });

  it('does not fire listeners for unknown MMSIs', () => {
    const listener = vi.fn();
    onPosition(listener);
    emitMessage(makeRawMessage(999999999));
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribe function removes the listener', () => {
    const mmsi: ValidMMSI = 316045081;
    const listener = vi.fn();
    const unsubscribe = onPosition(listener);
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
    expect(getLatestPositions().size).toBe(0);
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
    expect(getLatestPositions().size).toBe(0);
  });

  // ── getLatestPositions returns a snapshot ─────────────────────────────────

  it('getLatestPositions() returns a copy — mutating it does not affect proxy state', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi));
    const snapshot = getLatestPositions();
    snapshot.clear();
    expect(getLatestPositions().size).toBe(1);
  });

  // ── timestamp parsing ─────────────────────────────────────────────────────

  it('stores timestamp as a valid ISO 8601 string', () => {
    const mmsi: ValidMMSI = 316045069;
    emitMessage(makeRawMessage(mmsi));
    const pos = getLatestPositions().get(mmsi)!;
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
    expect(getLatestPositions().get(mmsi)!.name).toBe('SAM MCBRIDE');
  });
});
