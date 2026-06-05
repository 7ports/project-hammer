import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  closeStorage,
  getDb,
  initStorage,
  isStorageInitialised,
  PositionWriter,
  SCHEMA_VERSION,
  type PositionRow,
} from './index';

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-storage-test-')),
    'hammer.db',
  );
}

afterEach(() => {
  closeStorage();
});

describe('initStorage', () => {
  it('creates parent dirs, opens DB, runs migrations from 0 to current', () => {
    const dbPath = tempDbPath();
    const result = initStorage(dbPath);

    expect(result.dbPath).toBe(dbPath);
    expect(result.migration.from).toBe(0);
    expect(result.migration.to).toBe(SCHEMA_VERSION);
    expect(isStorageInitialised()).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('is idempotent — second init on the same DB is a no-op migration', () => {
    const dbPath = tempDbPath();
    initStorage(dbPath);
    closeStorage();

    const second = initStorage(dbPath);
    expect(second.migration.from).toBe(SCHEMA_VERSION);
    expect(second.migration.to).toBe(SCHEMA_VERSION);
  });

  it('creates all five tables from schema §6', () => {
    initStorage(tempDbPath());
    const tables = getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    for (const expected of [
      'ais_positions',
      'daily_rollups',
      'ferry_events',
      'provider_state',
      'schedule_snapshots',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('enables WAL journal mode', () => {
    initStorage(tempDbPath());
    const mode = getDb().pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
  });
});

describe('PositionWriter', () => {
  function makeRow(overrides: Partial<PositionRow> = {}): PositionRow {
    return {
      mmsi: 316045069,
      provider: 'aisstream',
      timestamp: 1_700_000_000_000,
      ingested_at: 1_700_000_000_500,
      latitude: 43.638,
      longitude: -79.378,
      sog: 5.2,
      cog: 180.0,
      heading: 180,
      nav_status: 0,
      ...overrides,
    };
  }

  it('flushes synchronously on demand and writes rows', () => {
    initStorage(tempDbPath());
    const writer = new PositionWriter(getDb());

    writer.enqueue(makeRow({ mmsi: 316045069 }));
    writer.enqueue(makeRow({ mmsi: 316045081 }));
    writer.flush();

    const rows = getDb().prepare('SELECT mmsi FROM ais_positions ORDER BY mmsi').all();
    expect(rows).toEqual([{ mmsi: 316045069 }, { mmsi: 316045081 }]);
  });

  it('triggers an immediate flush once batchSize is reached', async () => {
    initStorage(tempDbPath());
    const writer = new PositionWriter(getDb(), { batchSize: 3, flushIntervalMs: 60_000 });

    writer.enqueue(makeRow({ timestamp: 1 }));
    writer.enqueue(makeRow({ timestamp: 2 }));
    writer.enqueue(makeRow({ timestamp: 3 }));

    await new Promise((resolve) => setImmediate(resolve));

    const count = getDb().prepare('SELECT COUNT(*) as c FROM ais_positions').get() as { c: number };
    expect(count.c).toBe(3);
  });

  it('close() flushes any remaining rows', () => {
    initStorage(tempDbPath());
    const writer = new PositionWriter(getDb());

    writer.enqueue(makeRow());
    writer.close();

    const count = getDb().prepare('SELECT COUNT(*) as c FROM ais_positions').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('persists nullable nav_status', () => {
    initStorage(tempDbPath());
    const writer = new PositionWriter(getDb());
    writer.enqueue(makeRow({ nav_status: null }));
    writer.flush();

    const row = getDb().prepare('SELECT nav_status FROM ais_positions').get() as {
      nav_status: number | null;
    };
    expect(row.nav_status).toBeNull();
  });
});
