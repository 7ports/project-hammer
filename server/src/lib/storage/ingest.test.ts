/**
 * Ingest wiring tests.
 *
 * We attach the ingest to *fake* event sources rather than the real
 * AISProviderManager / FerryStatusMonitor so the tests don't need network
 * access, ws mocks, or an AISSTREAM_API_KEY. The fakes implement the same
 * structural interface the ingest depends on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  attachIngest,
  closeStorage,
  getDb,
  initStorage,
  PositionWriter,
  runScheduleSnapshot,
  type FerryEventSource,
  type PositionSource,
} from './index';
import type { PositionListener, Unsubscribe, VesselPosition } from '../types';
import type {
  FerryStatusEvent,
  FerryStatusListener,
} from '../ferryStatusMonitor';
import type {
  FailoverCallback,
  FailoverEvent,
  StatusChangeCallback,
} from '../providerManager';
import type { VesselMMSI } from '../constants';

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-ingest-test-')),
    'hammer.db',
  );
}

afterEach(() => {
  closeStorage();
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeProviderManager implements PositionSource {
  private positionListeners = new Set<PositionListener>();
  private statusListeners = new Set<StatusChangeCallback>();
  private failoverListeners = new Set<FailoverCallback>();
  private activeProvider = 'aisstream';

  onPosition(cb: PositionListener): Unsubscribe {
    this.positionListeners.add(cb);
    return () => {
      this.positionListeners.delete(cb);
    };
  }
  onStatusChange(cb: StatusChangeCallback): Unsubscribe {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }
  onFailover(cb: FailoverCallback): Unsubscribe {
    this.failoverListeners.add(cb);
    return () => {
      this.failoverListeners.delete(cb);
    };
  }
  getActiveProviderName(): string {
    return this.activeProvider;
  }

  // Drivers
  setActive(name: string): void {
    this.activeProvider = name;
  }
  emitPosition(pos: VesselPosition): void {
    for (const cb of this.positionListeners) cb(pos);
  }
  emitStatus(status: 'providers-down' | 'providers-up'): void {
    for (const cb of this.statusListeners) cb(status);
  }
  emitFailover(evt: FailoverEvent): void {
    for (const cb of this.failoverListeners) cb(evt);
  }
}

class FakeFerryStatusMonitor implements FerryEventSource {
  private listeners = new Set<FerryStatusListener>();
  onStatusChange(cb: FerryStatusListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  emit(evt: FerryStatusEvent): void {
    for (const cb of this.listeners) cb(evt);
  }
}

function makePosition(overrides: Partial<VesselPosition> = {}): VesselPosition {
  return {
    mmsi: 316045069 as VesselMMSI,
    name: 'SAM MCBRIDE',
    latitude: 43.638,
    longitude: -79.378,
    heading: 180,
    sog: 5.2,
    cog: 180,
    speed: 5.2,
    timestamp: '2026-05-01T12:00:00.000Z',
    navStatus: 0,
    ...overrides,
  };
}

function makeFerryEvent(overrides: Partial<FerryStatusEvent> = {}): FerryStatusEvent {
  return {
    status: 'alert',
    message: 'Service suspended due to weather.',
    reason: 'Weather',
    postedAt: '2026-05-01T11:30:00.000Z',
    detectedAt: '2026-05-01T11:35:00.000Z',
    parsedTimes: ['09:00', '12:00'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Position ingest
// ---------------------------------------------------------------------------

describe('attachIngest — positions', () => {
  it('persists positions emitted by the provider manager', () => {
    initStorage(tempDbPath());
    const pm = new FakeProviderManager();
    const fsm = new FakeFerryStatusMonitor();

    const handle = attachIngest({ db: getDb(), providerManager: pm, ferryStatusMonitor: fsm });

    pm.emitPosition(makePosition({ mmsi: 316045069 as VesselMMSI }));
    pm.emitPosition(makePosition({ mmsi: 316045081 as VesselMMSI }));
    handle.positionWriter.flush();

    const rows = getDb()
      .prepare(
        'SELECT mmsi, provider, latitude, longitude, sog, nav_status FROM ais_positions ORDER BY mmsi',
      )
      .all() as Array<{
      mmsi: number;
      provider: string;
      latitude: number;
      longitude: number;
      sog: number;
      nav_status: number | null;
    }>;

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      mmsi: 316045069,
      provider: 'aisstream',
      latitude: 43.638,
      longitude: -79.378,
      sog: 5.2,
      nav_status: 0,
    });
    expect(rows[1].mmsi).toBe(316045081);

    handle.detach();
  });

  it('falls back to Date.now() for an unparseable timestamp', () => {
    initStorage(tempDbPath());
    const pm = new FakeProviderManager();
    const fsm = new FakeFerryStatusMonitor();
    const handle = attachIngest({ db: getDb(), providerManager: pm, ferryStatusMonitor: fsm });

    const before = Date.now();
    pm.emitPosition(makePosition({ timestamp: 'not-a-date' }));
    handle.positionWriter.flush();
    const after = Date.now();

    const row = getDb().prepare('SELECT timestamp FROM ais_positions').get() as {
      timestamp: number;
    };
    expect(row.timestamp).toBeGreaterThanOrEqual(before);
    expect(row.timestamp).toBeLessThanOrEqual(after);

    handle.detach();
  });

  it('records nav_status as NULL when the provider omits it', () => {
    initStorage(tempDbPath());
    const pm = new FakeProviderManager();
    const fsm = new FakeFerryStatusMonitor();
    const handle = attachIngest({ db: getDb(), providerManager: pm, ferryStatusMonitor: fsm });

    pm.emitPosition(makePosition({ navStatus: undefined }));
    handle.positionWriter.flush();

    const row = getDb().prepare('SELECT nav_status FROM ais_positions').get() as {
      nav_status: number | null;
    };
    expect(row.nav_status).toBeNull();
    handle.detach();
  });
});

// ---------------------------------------------------------------------------
// Ferry event ingest
// ---------------------------------------------------------------------------

describe('attachIngest — ferry events', () => {
  it('persists ferry status changes immediately', () => {
    initStorage(tempDbPath());
    const pm = new FakeProviderManager();
    const fsm = new FakeFerryStatusMonitor();
    const handle = attachIngest({ db: getDb(), providerManager: pm, ferryStatusMonitor: fsm });

    fsm.emit(makeFerryEvent());

    const rows = getDb()
      .prepare(
        'SELECT status, message, reason, posted_at, detected_at, parsed_times FROM ferry_events',
      )
      .all() as Array<{
      status: string;
      message: string | null;
      reason: string | null;
      posted_at: number | null;
      detected_at: number;
      parsed_times: string;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('alert');
    expect(rows[0].reason).toBe('Weather');
    expect(rows[0].posted_at).toBe(Date.parse('2026-05-01T11:30:00.000Z'));
    expect(rows[0].detected_at).toBe(Date.parse('2026-05-01T11:35:00.000Z'));
    expect(JSON.parse(rows[0].parsed_times)).toEqual(['09:00', '12:00']);

    handle.detach();
  });

  it('stores null posted_at when the City API did not include one', () => {
    initStorage(tempDbPath());
    const pm = new FakeProviderManager();
    const fsm = new FakeFerryStatusMonitor();
    const handle = attachIngest({ db: getDb(), providerManager: pm, ferryStatusMonitor: fsm });

    fsm.emit(makeFerryEvent({ postedAt: null }));
    const row = getDb().prepare('SELECT posted_at FROM ferry_events').get() as {
      posted_at: number | null;
    };
    expect(row.posted_at).toBeNull();
    handle.detach();
  });
});

// ---------------------------------------------------------------------------
// Provider state ingest
// ---------------------------------------------------------------------------

describe('attachIngest — provider state', () => {
  it('persists failover events with from/to providers', () => {
    initStorage(tempDbPath());
    const pm = new FakeProviderManager();
    const fsm = new FakeFerryStatusMonitor();
    const handle = attachIngest({ db: getDb(), providerManager: pm, ferryStatusMonitor: fsm });

    const failoverAt = new Date('2026-05-01T12:30:00.000Z');
    pm.emitFailover({
      from: 'aisstream',
      to: 'aprsfi',
      reason: 'silence_timeout',
      timestamp: failoverAt,
      failoverCount: 1,
    });

    const row = getDb()
      .prepare('SELECT transition, from_provider, to_provider, timestamp FROM provider_state')
      .get() as {
      transition: string;
      from_provider: string | null;
      to_provider: string | null;
      timestamp: number;
    };

    expect(row.transition).toBe('failover');
    expect(row.from_provider).toBe('aisstream');
    expect(row.to_provider).toBe('aprsfi');
    expect(row.timestamp).toBe(failoverAt.getTime());

    handle.detach();
  });

  it('persists providers-down / providers-up health transitions', () => {
    initStorage(tempDbPath());
    const pm = new FakeProviderManager();
    const fsm = new FakeFerryStatusMonitor();
    const handle = attachIngest({ db: getDb(), providerManager: pm, ferryStatusMonitor: fsm });

    pm.emitStatus('providers-down');
    pm.setActive('aprsfi');
    pm.emitStatus('providers-up');

    const rows = getDb()
      .prepare('SELECT transition, to_provider FROM provider_state ORDER BY id')
      .all() as Array<{ transition: string; to_provider: string | null }>;

    expect(rows).toHaveLength(2);
    expect(rows[0].transition).toBe('providers-down');
    expect(rows[1].transition).toBe('providers-up');
    expect(rows[1].to_provider).toBe('aprsfi');

    handle.detach();
  });
});

// ---------------------------------------------------------------------------
// Resilience — storage failure must not bubble back
// ---------------------------------------------------------------------------

describe('attachIngest — resilience (§7.4)', () => {
  it('a throwing position-source listener does not bubble back to the emitter', () => {
    initStorage(tempDbPath());
    const pm = new FakeProviderManager();
    const fsm = new FakeFerryStatusMonitor();
    const handle = attachIngest({ db: getDb(), providerManager: pm, ferryStatusMonitor: fsm });

    // Close the DB out from under the writer, forcing the next flush to throw.
    closeStorage();

    // Emitting should not throw, even though the underlying write will fail
    // when we flush.
    expect(() => pm.emitPosition(makePosition())).not.toThrow();

    // The flush itself must catch and log — never throw.
    expect(() => handle.positionWriter.flush()).not.toThrow();

    handle.detach();
  });

  it('detach() unsubscribes all listeners and closes the writer', () => {
    initStorage(tempDbPath());
    const pm = new FakeProviderManager();
    const fsm = new FakeFerryStatusMonitor();
    const handle = attachIngest({ db: getDb(), providerManager: pm, ferryStatusMonitor: fsm });

    handle.detach();

    // After detach, emitting should be a no-op (no rows written, no throws).
    pm.emitPosition(makePosition());
    fsm.emit(makeFerryEvent());

    const positionCount = (
      getDb().prepare('SELECT COUNT(*) as c FROM ais_positions').get() as { c: number }
    ).c;
    const ferryCount = (
      getDb().prepare('SELECT COUNT(*) as c FROM ferry_events').get() as { c: number }
    ).c;
    expect(positionCount).toBe(0);
    expect(ferryCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PositionWriter circuit breaker + buffer cap (§7.4)
// ---------------------------------------------------------------------------

describe('PositionWriter — buffer cap', () => {
  function makeRow(timestamp: number) {
    return {
      mmsi: 316045069,
      provider: 'aisstream',
      timestamp,
      ingested_at: timestamp,
      latitude: 43.6,
      longitude: -79.4,
      sog: 5,
      cog: 90,
      heading: 90,
      nav_status: 0,
    };
  }

  it('drops oldest row FIFO when buffer is at maxBufferSize', () => {
    initStorage(tempDbPath());
    const writer = new PositionWriter(getDb(), {
      maxBufferSize: 3,
      batchSize: 100,
      flushIntervalMs: 60_000,
    });

    writer.enqueue(makeRow(1));
    writer.enqueue(makeRow(2));
    writer.enqueue(makeRow(3));
    expect(writer.getBufferSize()).toBe(3);

    writer.enqueue(makeRow(4));
    expect(writer.getBufferSize()).toBe(3);
    expect(writer.getDroppedRowCount()).toBe(1);

    writer.enqueue(makeRow(5));
    expect(writer.getDroppedRowCount()).toBe(2);

    writer.flush();
    const timestamps = (
      getDb().prepare('SELECT timestamp FROM ais_positions ORDER BY timestamp').all() as Array<{
        timestamp: number;
      }>
    ).map((r) => r.timestamp);
    expect(timestamps).toEqual([3, 4, 5]);

    writer.close();
  });
});

describe('PositionWriter — circuit breaker', () => {
  it('opens after N consecutive failures and skips writes while open', () => {
    initStorage(tempDbPath());
    const db = getDb();
    const writer = new PositionWriter(db, {
      batchSize: 100,
      flushIntervalMs: 60_000,
      circuitBreakerThreshold: 3,
      circuitBreakerCooldownMs: 60_000,
    });

    // Drop the underlying table so every insert throws.
    db.exec('DROP TABLE ais_positions');

    for (let i = 0; i < 3; i++) {
      writer.enqueue({
        mmsi: 316045069,
        provider: 'aisstream',
        timestamp: i,
        ingested_at: i,
        latitude: 0,
        longitude: 0,
        sog: 0,
        cog: 0,
        heading: 0,
        nav_status: null,
      });
      // Force a flush attempt for each row.
      writer.flush();
    }

    expect(writer.isCircuitOpen()).toBe(true);
    expect(writer.getConsecutiveFailures()).toBeGreaterThanOrEqual(3);

    // While open, flush is a no-op — rows stay buffered, no further attempt.
    const bufferBefore = writer.getBufferSize();
    writer.flush();
    expect(writer.getBufferSize()).toBe(bufferBefore);

    writer.close();
  });
});

// ---------------------------------------------------------------------------
// Schedule snapshot — dedupe by sha256
// ---------------------------------------------------------------------------

describe('runScheduleSnapshot', () => {
  it('inserts on first call and dedupes by hash on the second', () => {
    initStorage(tempDbPath());

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-schedule-'));
    const schedulePath = path.join(tmpDir, 'schedule.json');
    fs.writeFileSync(
      schedulePath,
      JSON.stringify({ generatedAt: '2026-05-01T00:00:00.000Z', seasons: [] }),
    );

    const first = runScheduleSnapshot(getDb(), schedulePath);
    expect(first).not.toBeNull();
    expect(first!.inserted).toBe(true);
    expect(first!.generatedAt).toBe(Date.parse('2026-05-01T00:00:00.000Z'));

    const second = runScheduleSnapshot(getDb(), schedulePath);
    expect(second).not.toBeNull();
    expect(second!.inserted).toBe(false);
    expect(second!.hash).toBe(first!.hash);

    const count = (
      getDb().prepare('SELECT COUNT(*) as c FROM schedule_snapshots').get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it('inserts a second row when the content changes (hash differs)', () => {
    initStorage(tempDbPath());

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-schedule-'));
    const schedulePath = path.join(tmpDir, 'schedule.json');

    fs.writeFileSync(schedulePath, JSON.stringify({ generatedAt: '2026-05-01', n: 1 }));
    runScheduleSnapshot(getDb(), schedulePath);

    fs.writeFileSync(schedulePath, JSON.stringify({ generatedAt: '2026-05-02', n: 2 }));
    runScheduleSnapshot(getDb(), schedulePath);

    const count = (
      getDb().prepare('SELECT COUNT(*) as c FROM schedule_snapshots').get() as { c: number }
    ).c;
    expect(count).toBe(2);
  });

  it('returns null and logs when the file is missing', () => {
    initStorage(tempDbPath());
    const result = runScheduleSnapshot(getDb(), '/nonexistent/schedule.json');
    expect(result).toBeNull();
  });
});
