/**
 * Public storage API.
 *
 * Lifecycle:
 *   initStorage(dbPath) — open the DB, set PRAGMAs, run migrations.
 *   getDb()             — get the singleton handle (throws if not initialised).
 *   closeStorage()      — close the handle (used in tests and on shutdown).
 *
 * Per .voltron/reports/ais-storage.md §7.4: callers MUST treat storage as
 * best-effort. initStorage failures should be logged loudly but never crash
 * the SSE relay — the server wires it inside a try/catch in src/index.ts.
 */
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { runMigrations } from './migrations';

export { PositionWriter, type PositionRow, type PositionWriterOptions } from './writer';
export { SCHEMA_VERSION } from './schema';

let dbInstance: DatabaseType | null = null;

export interface InitStorageResult {
  dbPath: string;
  migration: { from: number; to: number };
}

export function initStorage(dbPath: string): InitStorageResult {
  if (dbInstance !== null) {
    throw new Error('initStorage already called; close first or call getDb()');
  }

  const dir = path.dirname(dbPath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // WAL: readers don't block the single writer, and writes survive process kills.
  db.pragma('journal_mode = WAL');
  // NORMAL: durability on commit, OS-level fsync still happens but not on every write.
  db.pragma('synchronous = NORMAL');
  // 5s busy timeout: a backup snapshot briefly holding a lock won't error our writer.
  db.pragma('busy_timeout = 5000');
  // Foreign keys for future relational growth (no FKs today, but cheap to enable).
  db.pragma('foreign_keys = ON');

  const migration = runMigrations(db);

  dbInstance = db;
  return { dbPath, migration };
}

export function getDb(): DatabaseType {
  if (dbInstance === null) {
    throw new Error('Storage not initialised — call initStorage() first');
  }
  return dbInstance;
}

export function isStorageInitialised(): boolean {
  return dbInstance !== null;
}

export function closeStorage(): void {
  if (dbInstance !== null) {
    dbInstance.close();
    dbInstance = null;
  }
}
