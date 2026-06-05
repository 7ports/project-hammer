/**
 * Daily schedule snapshot writer.
 *
 * Per .voltron/reports/ais-storage.md §6.5 / §7.5:
 *   - On server start and once every 24h, read public/schedule.json,
 *     compute a sha256 hash of the content, and INSERT OR IGNORE into
 *     `schedule_snapshots` keyed by that hash.
 *   - The UNIQUE constraint on `snapshot_hash` makes dedupe O(1) — repeated
 *     snapshots of an unchanged file are silently skipped.
 *
 * Read failures are logged but never thrown — schedule snapshots are
 * best-effort, never block the relay (§7.4).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import type { Database } from 'better-sqlite3';

export interface ScheduleSnapshotResult {
  inserted: boolean;
  hash: string;
  generatedAt: number;
}

export function runScheduleSnapshot(
  db: Database,
  schedulePath: string,
): ScheduleSnapshotResult | null {
  let content: string;
  try {
    content = fs.readFileSync(schedulePath, 'utf8');
  } catch (err) {
    console.error(`[storage] schedule snapshot read failed (${schedulePath}):`, err);
    return null;
  }

  const hash = crypto.createHash('sha256').update(content).digest('hex');

  let generatedAt = Date.now();
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'generatedAt' in parsed &&
      typeof (parsed as { generatedAt: unknown }).generatedAt === 'string'
    ) {
      const ts = Date.parse((parsed as { generatedAt: string }).generatedAt);
      if (Number.isFinite(ts)) {
        generatedAt = ts;
      }
    }
  } catch {
    // Malformed JSON — keep the file-clock fallback above. We still write
    // the row because the content hash is what matters for dedupe.
  }

  try {
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO schedule_snapshots
          (snapshot_hash, generated_at, captured_at, content)
         VALUES (?, ?, ?, ?)`,
      )
      .run(hash, generatedAt, Date.now(), content);
    return { inserted: result.changes > 0, hash, generatedAt };
  } catch (err) {
    console.error('[storage] schedule snapshot insert failed:', err);
    return null;
  }
}
