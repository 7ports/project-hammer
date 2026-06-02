/**
 * Batched writer for `ais_positions`.
 *
 * Per .voltron/reports/ais-storage.md §7.3:
 *   - Flush triggers: 100 positions queued OR 5s elapsed since first queued row.
 *   - Write happens inside a transaction via setImmediate so the SSE relay
 *     event loop tick is never blocked by the synchronous write.
 *   - Storage failure NEVER breaks the relay — every error is caught and logged.
 *
 * This module is scaffolding only. Task 5 wires this up to
 * providerManager.onPosition(); for now the writer is exported but not attached.
 */
import type { Database, Statement } from 'better-sqlite3';

export interface PositionRow {
  mmsi: number;
  provider: string;
  /** Unix ms; from the AIS provider's reported timestamp. */
  timestamp: number;
  /** Unix ms; server clock when the row entered the writer. */
  ingested_at: number;
  latitude: number;
  longitude: number;
  /** Speed over ground, knots. */
  sog: number;
  /** Course over ground, degrees 0–359. */
  cog: number;
  /** Heading 0–359, or 511 for unavailable per AIS spec. */
  heading: number;
  /** AIS navigation status; only aisstream supplies this. Null otherwise. */
  nav_status: number | null;
}

export interface PositionWriterOptions {
  /** Max rows queued before forced flush. Default 100. */
  batchSize?: number;
  /** Max ms between flushes once the buffer has any rows. Default 5000. */
  flushIntervalMs?: number;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

export class PositionWriter {
  private readonly db: Database;
  private readonly insertStmt: Statement;
  private readonly insertMany: (rows: PositionRow[]) => void;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  private buffer: PositionRow[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(db: Database, options: PositionWriterOptions = {}) {
    this.db = db;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

    this.insertStmt = this.db.prepare(
      `INSERT INTO ais_positions
        (mmsi, provider, timestamp, ingested_at, latitude, longitude, sog, cog, heading, nav_status)
       VALUES (@mmsi, @provider, @timestamp, @ingested_at, @latitude, @longitude, @sog, @cog, @heading, @nav_status)`,
    );

    this.insertMany = this.db.transaction((rows: PositionRow[]) => {
      for (const row of rows) {
        this.insertStmt.run(row);
      }
    });
  }

  /**
   * Enqueue a position for batched write. Returns immediately.
   * The actual disk write happens on the next setImmediate tick once the
   * buffer hits batchSize, or after flushIntervalMs from the first enqueued row.
   */
  enqueue(row: PositionRow): void {
    if (this.closed) return;

    this.buffer.push(row);

    if (this.buffer.length >= this.batchSize) {
      this.scheduleImmediateFlush();
      return;
    }

    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.scheduleImmediateFlush();
      }, this.flushIntervalMs);
      // unref so the timer never keeps the process alive on its own
      this.flushTimer.unref?.();
    }
  }

  /** Force a synchronous flush of all buffered rows. */
  flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;

    const rows = this.buffer;
    this.buffer = [];

    try {
      this.insertMany(rows);
    } catch (err) {
      console.error('[storage] PositionWriter batch insert failed:', err);
    }
  }

  /** Stop accepting new rows and flush whatever is buffered. */
  close(): void {
    this.closed = true;
    this.flush();
  }

  private scheduleImmediateFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    setImmediate(() => this.flush());
  }
}
