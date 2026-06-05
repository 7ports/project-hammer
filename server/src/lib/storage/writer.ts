/**
 * Storage writers for AIS positions, ferry events, and provider state.
 *
 * Per .voltron/reports/ais-storage.md:
 *   §7.3 — `ais_positions` is batched: flush at 100 rows or after 5s from
 *          the first queued row. Write happens via setImmediate so the SSE
 *          relay event loop tick is never blocked by the synchronous insert.
 *   §7.4 — Storage failure NEVER breaks the relay. Every write is wrapped
 *          in try/catch. The PositionWriter implements a circuit breaker
 *          (open after 10 consecutive failures, 60s cooldown) and an
 *          in-memory buffer capped at 10 000 rows; if the cap is reached
 *          the oldest rows are dropped FIFO with a throttled warning.
 *   §6.2 / §6.3 — `ferry_events` and `provider_state` are immediate
 *          single-row inserts (volume is <100/day combined).
 */
import type { Database, Statement } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Position writer
// ---------------------------------------------------------------------------

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
  /**
   * Max rows held in memory. Once reached, the oldest queued row is dropped
   * to make room for the new one. Default 10 000 (~1 MB). Per §7.4.
   */
  maxBufferSize?: number;
  /**
   * Number of consecutive failed flush attempts before the circuit breaker
   * opens. Default 10.
   */
  circuitBreakerThreshold?: number;
  /**
   * How long the breaker stays open before attempting another flush. Default
   * 60 000 ms (60 s).
   */
  circuitBreakerCooldownMs?: number;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const DEFAULT_MAX_BUFFER_SIZE = 10_000;
const DEFAULT_CIRCUIT_THRESHOLD = 10;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 60_000;

export class PositionWriter {
  private readonly db: Database;
  private readonly insertStmt: Statement;
  private readonly insertMany: (rows: PositionRow[]) => void;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;
  private readonly circuitBreakerThreshold: number;
  private readonly circuitBreakerCooldownMs: number;

  private buffer: PositionRow[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;

  // Circuit breaker state
  private consecutiveFailures = 0;
  private circuitOpen = false;
  private circuitTimer: NodeJS.Timeout | null = null;
  private droppedRowCount = 0;

  constructor(db: Database, options: PositionWriterOptions = {}) {
    this.db = db;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.circuitBreakerThreshold =
      options.circuitBreakerThreshold ?? DEFAULT_CIRCUIT_THRESHOLD;
    this.circuitBreakerCooldownMs =
      options.circuitBreakerCooldownMs ?? DEFAULT_CIRCUIT_COOLDOWN_MS;

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
   * If the buffer is at maxBufferSize, the oldest row is dropped FIFO and
   * the drop is logged (throttled to every 100th drop to avoid spam).
   */
  enqueue(row: PositionRow): void {
    if (this.closed) return;

    if (this.buffer.length >= this.maxBufferSize) {
      this.buffer.shift();
      this.droppedRowCount++;
      // Throttle: log only every 100th drop after the first so a sustained
      // outage doesn't flood stderr.
      if (this.droppedRowCount === 1 || this.droppedRowCount % 100 === 0) {
        console.warn(
          `[storage] PositionWriter buffer at cap (${this.maxBufferSize}); dropped ${this.droppedRowCount} rows total`,
        );
      }
    }

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

  /**
   * Force a synchronous flush of all buffered rows. While the circuit
   * breaker is open this is a no-op — rows stay in the buffer (subject to
   * the cap) and will be retried automatically when the cooldown elapses.
   */
  flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    if (this.circuitOpen) return;

    const rows = this.buffer;
    this.buffer = [];

    try {
      this.insertMany(rows);
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures++;
      console.error(
        `[storage] PositionWriter batch insert failed (${this.consecutiveFailures} consecutive):`,
        err,
      );
      // Requeue the rows at the front so order is preserved. If that pushes
      // the buffer past the cap, drop oldest until back under.
      this.buffer = [...rows, ...this.buffer];
      while (this.buffer.length > this.maxBufferSize) {
        this.buffer.shift();
        this.droppedRowCount++;
      }
      if (this.consecutiveFailures >= this.circuitBreakerThreshold && !this.circuitOpen) {
        this.openCircuit();
      }
    }
  }

  /** Stop accepting new rows, clear any pending timers, and flush buffered rows. */
  close(): void {
    this.closed = true;
    if (this.circuitTimer !== null) {
      clearTimeout(this.circuitTimer);
      this.circuitTimer = null;
    }
    // If the breaker is open at close time, force-close it so the final
    // flush attempt actually runs.
    this.circuitOpen = false;
    this.flush();
  }

  /** Test/diagnostic accessors. */
  getBufferSize(): number {
    return this.buffer.length;
  }

  isCircuitOpen(): boolean {
    return this.circuitOpen;
  }

  getDroppedRowCount(): number {
    return this.droppedRowCount;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  private scheduleImmediateFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    setImmediate(() => this.flush());
  }

  private openCircuit(): void {
    this.circuitOpen = true;
    console.warn(
      `[storage] PositionWriter circuit breaker OPEN after ${this.consecutiveFailures} failures; retrying in ${this.circuitBreakerCooldownMs}ms`,
    );
    this.circuitTimer = setTimeout(() => {
      this.circuitTimer = null;
      this.circuitOpen = false;
      this.consecutiveFailures = 0;
      console.log('[storage] PositionWriter circuit breaker CLOSED — retrying flush');
      this.flush();
    }, this.circuitBreakerCooldownMs);
    this.circuitTimer.unref?.();
  }
}

// ---------------------------------------------------------------------------
// Ferry event writer (immediate, low volume)
// ---------------------------------------------------------------------------

export interface FerryEventRow {
  status: 'open' | 'alert' | 'closed' | 'unknown';
  message: string | null;
  reason: string | null;
  /** Unix ms; from the City API's PostedDate. Null if not supplied. */
  posted_at: number | null;
  /** Unix ms; server clock at detection. */
  detected_at: number;
  /** JSON-encoded array of HH:MM strings; empty array → '[]'. */
  parsed_times: string;
}

export class FerryEventWriter {
  private readonly stmt: Statement;

  constructor(db: Database) {
    this.stmt = db.prepare(
      `INSERT INTO ferry_events
        (status, message, reason, posted_at, detected_at, parsed_times)
       VALUES (@status, @message, @reason, @posted_at, @detected_at, @parsed_times)`,
    );
  }

  record(row: FerryEventRow): void {
    try {
      this.stmt.run(row);
    } catch (err) {
      console.error('[storage] FerryEventWriter insert failed:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Provider state writer (immediate, low volume)
// ---------------------------------------------------------------------------

export interface ProviderStateRow {
  transition: 'providers-down' | 'providers-up' | 'failover';
  from_provider: string | null;
  to_provider: string | null;
  /** Unix ms; server clock at the transition. */
  timestamp: number;
}

export class ProviderStateWriter {
  private readonly stmt: Statement;

  constructor(db: Database) {
    this.stmt = db.prepare(
      `INSERT INTO provider_state
        (transition, from_provider, to_provider, timestamp)
       VALUES (@transition, @from_provider, @to_provider, @timestamp)`,
    );
  }

  record(row: ProviderStateRow): void {
    try {
      this.stmt.run(row);
    } catch (err) {
      console.error('[storage] ProviderStateWriter insert failed:', err);
    }
  }
}
