/**
 * FerryStatusMonitor — polls the City of Toronto ferry status API on a fixed
 * interval, detects status transitions, and broadcasts changes to subscribers.
 *
 * Singleton exported as `ferryStatusMonitor`. Started in server/src/index.ts
 * alongside aisProxy.connect().
 *
 * City API: https://www.toronto.ca/data/parks/live/ferry.json
 * Location ID for Jack Layton Ferry Terminal: 3789
 * Status codes: 0 = closed, 1 = open, 2 = alert/disruption
 */

import { config } from './config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FerryStatusEvent {
  /** Normalised status string */
  status: 'open' | 'alert' | 'closed' | 'unknown';
  /** Human-readable disruption message from the City (HTML stripped) */
  message: string | null;
  /** Short reason code from the City (e.g. "Weather") */
  reason: string | null;
  /** ISO timestamp the City posted the status update */
  postedAt: string | null;
  /** ISO timestamp we first detected this status (our clock) */
  detectedAt: string;
}

export type FerryStatusListener = (event: FerryStatusEvent) => void;

// ---------------------------------------------------------------------------
// City API shape
// ---------------------------------------------------------------------------

interface CityAsset {
  LocationID: number;
  PostedDate: string;
  Reason: string | null;
  Comments: string | null;
  Status: number;
}

interface CityFerryResponse {
  assets: CityAsset[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FERRY_STATUS_URL = 'https://www.toronto.ca/data/parks/live/ferry.json';
const FERRY_LOCATION_ID = 3789;
const MAX_HISTORY = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function mapStatusCode(code: number): FerryStatusEvent['status'] {
  if (code === 0) return 'closed';
  if (code === 1) return 'open';
  if (code === 2) return 'alert';
  return 'unknown';
}

function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const entry = JSON.stringify({ level, service: 'ferry-status-monitor', event, ts: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.log(entry);
}

// ---------------------------------------------------------------------------
// FerryStatusMonitor
// ---------------------------------------------------------------------------

export class FerryStatusMonitor {
  private _current: FerryStatusEvent | null = null;
  private _history: FerryStatusEvent[] = [];
  private _listeners = new Set<FerryStatusListener>();
  private _timer: ReturnType<typeof setInterval> | null = null;
  private readonly _pollIntervalMs: number;

  constructor(pollIntervalMs = 30_000) {
    this._pollIntervalMs = pollIntervalMs;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  start(): void {
    log('info', 'monitor_start', { poll_interval_ms: this._pollIntervalMs });
    void this._poll(); // immediate first fetch
    this._timer = setInterval(() => void this._poll(), this._pollIntervalMs);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    log('info', 'monitor_stop');
  }

  /** Returns the most recently observed status, or null before first poll. */
  getCurrentStatus(): FerryStatusEvent | null {
    return this._current;
  }

  /** Returns recent status events, newest first. Capped at MAX_HISTORY. */
  getHistory(): FerryStatusEvent[] {
    return [...this._history];
  }

  /**
   * Subscribe to status change events. The callback fires whenever the status
   * transitions (open→alert, alert→closed, etc.).
   * Returns an unsubscribe function.
   */
  onStatusChange(cb: FerryStatusListener): () => void {
    this._listeners.add(cb);
    return () => { this._listeners.delete(cb); };
  }

  // -------------------------------------------------------------------------
  // Private — polling + change detection
  // -------------------------------------------------------------------------

  private async _poll(): Promise<void> {
    try {
      const upstream = await fetch(FERRY_STATUS_URL, {
        headers: { 'User-Agent': 'toronto-ferry-tracker/2.0' },
        signal: AbortSignal.timeout(8_000),
      });

      if (!upstream.ok) {
        throw new Error(`Upstream HTTP ${upstream.status}`);
      }

      const data = (await upstream.json()) as CityFerryResponse;
      const asset = data.assets.find(a => a.LocationID === FERRY_LOCATION_ID);

      const status: FerryStatusEvent['status'] = asset ? mapStatusCode(asset.Status) : 'unknown';
      const message = asset?.Comments ? stripHtml(asset.Comments) : null;
      const reason = asset?.Reason ?? null;
      const postedAt = asset?.PostedDate
        ? new Date(asset.PostedDate.replace(' ', 'T') + '-05:00').toISOString()
        : null;

      this._handlePollResult({ status, message, reason, postedAt });
    } catch (err) {
      log('warn', 'poll_failed', { error: String(err) });
      // Don't overwrite current status on transient network errors
    }
  }

  private _handlePollResult(incoming: Omit<FerryStatusEvent, 'detectedAt'>): void {
    const prev = this._current;

    // Only emit and record if status actually changed (or this is the first poll)
    const isFirstPoll = prev === null;
    const statusChanged = prev !== null && prev.status !== incoming.status;
    // Also re-emit if the message changed on an active outage (City updates the text)
    const messageChanged = prev !== null && prev.status !== 'open' && prev.message !== incoming.message;

    if (!isFirstPoll && !statusChanged && !messageChanged) return;

    const event: FerryStatusEvent = {
      ...incoming,
      detectedAt: new Date().toISOString(),
    };

    this._current = event;
    this._history = [event, ...this._history].slice(0, MAX_HISTORY);

    if (statusChanged || messageChanged) {
      log(incoming.status === 'open' ? 'info' : 'warn', 'status_change', {
        from: prev?.status ?? 'none',
        to: incoming.status,
        message: incoming.message,
        reason: incoming.reason,
      });
    }

    // Notify all SSE subscribers
    for (const cb of this._listeners) {
      try { cb(event); } catch (e) { log('error', 'listener_threw', { error: String(e) }); }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const ferryStatusMonitor = new FerryStatusMonitor(config.ferryStatusPollMs);
