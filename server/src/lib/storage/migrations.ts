/**
 * Idempotent migration runner backed by SQLite's PRAGMA user_version.
 *
 * Each migration is run inside a transaction and bumps user_version.
 * Adding a new migration: append to MIGRATIONS, set its version to the
 * next integer. Never edit a shipped migration in place — write a new one.
 */
import type { Database } from 'better-sqlite3';
import { SCHEMA_STATEMENTS, SCHEMA_V2_STATEMENTS, SCHEMA_VERSION } from './schema';

interface Migration {
  version: number;
  statements: readonly string[];
}

const MIGRATIONS: readonly Migration[] = [
  { version: 1, statements: SCHEMA_STATEMENTS },
  { version: 2, statements: SCHEMA_V2_STATEMENTS },
];

export function runMigrations(db: Database): { from: number; to: number } {
  const currentRow = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const current = currentRow.user_version;

  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) {
    return { from: current, to: current };
  }

  for (const migration of pending) {
    const apply = db.transaction(() => {
      for (const stmt of migration.statements) {
        db.exec(stmt);
      }
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
    apply();
  }

  const finalVersion = pending[pending.length - 1]!.version;

  if (finalVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Migration drift: final version ${finalVersion} !== SCHEMA_VERSION ${SCHEMA_VERSION}`,
    );
  }

  return { from: current, to: finalVersion };
}
