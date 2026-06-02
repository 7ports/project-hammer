/**
 * Storage ingest wiring.
 *
 * Subscribes to the manager's position / status / failover events and the
 * ferry status monitor's status-change event, persisting each into the
 * matching table. Every callback is wrapped in try/catch so a storage
 * fault NEVER bubbles back into the SSE relay (.voltron/reports/ais-storage.md §7.4).
 *
 * The ingest layer accepts structural interfaces rather than concrete classes
 * so tests can attach fakes without importing the real provider manager.
 */
import type { Database } from 'better-sqlite3';
import type { PositionListener, Unsubscribe, VesselPosition } from '../types';
import type { FerryStatusEvent, FerryStatusListener } from '../ferryStatusMonitor';
import type {
  FailoverCallback,
  FailoverEvent,
  StatusChangeCallback,
} from '../providerManager';
import {
  FerryEventWriter,
  PositionWriter,
  ProviderStateWriter,
  type PositionWriterOptions,
} from './writer';
import { runScheduleSnapshot } from './scheduleSnapshot';

// ---------------------------------------------------------------------------
// Structural source interfaces — both the real classes and the test fakes
// satisfy these. Avoids coupling ingest wiring to constructor shape.
// ---------------------------------------------------------------------------

export interface PositionSource {
  onPosition(cb: PositionListener): Unsubscribe;
  onStatusChange(cb: StatusChangeCallback): Unsubscribe;
  onFailover(cb: FailoverCallback): Unsubscribe;
  getActiveProviderName(): string;
}

export interface FerryEventSource {
  onStatusChange(cb: FerryStatusListener): () => void;
}

// ---------------------------------------------------------------------------
// Options + handle
// ---------------------------------------------------------------------------

const DEFAULT_SCHEDULE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export interface AttachIngestOptions {
  db: Database;
  providerManager: PositionSource;
  ferryStatusMonitor: FerryEventSource;
  /**
   * Absolute path to public/schedule.json. If omitted, no schedule snapshots
   * are taken (useful in unit tests). Missing file → logs and skips.
   */
  schedulePath?: string;
  /**
   * Interval between schedule snapshot attempts. Default 24h.
   * Tests can override to verify the cron.
   */
  scheduleSnapshotIntervalMs?: number;
  positionWriterOptions?: PositionWriterOptions;
}

export interface IngestHandle {
  detach(): void;
  positionWriter: PositionWriter;
  ferryEventWriter: FerryEventWriter;
  providerStateWriter: ProviderStateWriter;
}

// ---------------------------------------------------------------------------
// attachIngest
// ---------------------------------------------------------------------------

export function attachIngest(opts: AttachIngestOptions): IngestHandle {
  const { db, providerManager, ferryStatusMonitor } = opts;

  const positionWriter = new PositionWriter(db, opts.positionWriterOptions);
  const ferryEventWriter = new FerryEventWriter(db);
  const providerStateWriter = new ProviderStateWriter(db);

  const unsubscribers: Array<() => void> = [];

  // Position ingest — high frequency, batched.
  unsubscribers.push(
    providerManager.onPosition((pos: VesselPosition) => {
      try {
        const tsMs = Date.parse(pos.timestamp);
        positionWriter.enqueue({
          mmsi: pos.mmsi,
          provider: providerManager.getActiveProviderName(),
          timestamp: Number.isFinite(tsMs) ? tsMs : Date.now(),
          ingested_at: Date.now(),
          latitude: pos.latitude,
          longitude: pos.longitude,
          sog: pos.sog,
          cog: pos.cog,
          heading: pos.heading,
          nav_status: pos.navStatus ?? null,
        });
      } catch (err) {
        console.error('[storage] position ingest threw — relay continues:', err);
      }
    }),
  );

  // Ferry events — low frequency, immediate.
  unsubscribers.push(
    ferryStatusMonitor.onStatusChange((evt: FerryStatusEvent) => {
      try {
        ferryEventWriter.record({
          status: evt.status,
          message: evt.message,
          reason: evt.reason,
          posted_at: evt.postedAt ? Date.parse(evt.postedAt) || null : null,
          detected_at: Date.parse(evt.detectedAt) || Date.now(),
          parsed_times: JSON.stringify(evt.parsedTimes),
        });
      } catch (err) {
        console.error('[storage] ferry event ingest threw — relay continues:', err);
      }
    }),
  );

  // Provider health flips (providers-down / providers-up).
  unsubscribers.push(
    providerManager.onStatusChange((status) => {
      try {
        providerStateWriter.record({
          transition: status,
          from_provider: null,
          to_provider: providerManager.getActiveProviderName(),
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error('[storage] provider status ingest threw — relay continues:', err);
      }
    }),
  );

  // Failover events — newly emitted by AISProviderManager.
  unsubscribers.push(
    providerManager.onFailover((evt: FailoverEvent) => {
      try {
        providerStateWriter.record({
          transition: 'failover',
          from_provider: evt.from,
          to_provider: evt.to,
          timestamp: evt.timestamp.getTime(),
        });
      } catch (err) {
        console.error('[storage] failover ingest threw — relay continues:', err);
      }
    }),
  );

  // Daily schedule snapshot. Run once immediately, then on a 24h timer.
  let scheduleTimer: NodeJS.Timeout | null = null;
  if (opts.schedulePath) {
    const intervalMs = opts.scheduleSnapshotIntervalMs ?? DEFAULT_SCHEDULE_INTERVAL_MS;
    runScheduleSnapshot(db, opts.schedulePath);
    scheduleTimer = setInterval(() => {
      if (opts.schedulePath) {
        runScheduleSnapshot(db, opts.schedulePath);
      }
    }, intervalMs);
    scheduleTimer.unref?.();
  }

  return {
    positionWriter,
    ferryEventWriter,
    providerStateWriter,
    detach() {
      for (const unsub of unsubscribers) {
        try {
          unsub();
        } catch (err) {
          console.error('[storage] unsubscribe threw:', err);
        }
      }
      if (scheduleTimer !== null) {
        clearInterval(scheduleTimer);
      }
      positionWriter.close();
    },
  };
}
