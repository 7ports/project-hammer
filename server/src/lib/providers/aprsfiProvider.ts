/**
 * AprsfiProvider — IAISProvider implementation backed by aprs.fi REST API.
 *
 * Polls aprs.fi at a configurable interval and normalises responses to the
 * shared VesselPosition format. Used as a fallback when aisstream.io is silent.
 */

import { VESSEL_MMSIS, APRSFI_API_BASE } from '../constants';
import type { VesselMMSI } from '../constants';
import type { VesselPosition } from '../types';
import type { IAISProvider, ProviderDiagnostics, ProviderStatus } from './types';

// ---------------------------------------------------------------------------
// aprs.fi response types
// ---------------------------------------------------------------------------

interface AprsfiEntry {
  name: string;
  type: string;
  time: string;
  lasttime: string;
  lat: string;
  lng: string;
  altitude: string;
  course: string;
  speed: string;
  heading?: string;
  comment: string;
  path: string;
  srccall: string;
}

interface AprsfiResponse {
  result: string;
  found: number;
  entries: AprsfiEntry[];
}

function isAprsfiResponse(value: unknown): value is AprsfiResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['result'] === 'string' && Array.isArray(v['entries']);
}

function isVesselMMSI(mmsi: number): mmsi is VesselMMSI {
  return (VESSEL_MMSIS as readonly number[]).includes(mmsi);
}

// ---------------------------------------------------------------------------
// AprsfiProvider
// ---------------------------------------------------------------------------

const DEFAULT_POLLING_INTERVAL_MS = 30_000;
const MAX_CONSECUTIVE_ERRORS = 3;

export class AprsfiProvider implements IAISProvider {
  readonly name = 'aprsfi';

  private readonly apiKey: string;
  private readonly pollingIntervalMs: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private onDataCallback: ((pos: VesselPosition) => void) | null = null;
  private consecutiveErrors = 0;
  private firstPollDone = false;

  // Diagnostics
  private _status: ProviderStatus = 'idle';
  private _messagesReceived = 0;
  private _positionsDelivered = 0;
  private _lastPositionAt: Date | null = null;
  private _connectedAt: Date | null = null;
  private _errors = 0;

  constructor(apiKey: string, pollingIntervalMs: number = DEFAULT_POLLING_INTERVAL_MS) {
    this.apiKey = apiKey;
    this.pollingIntervalMs = pollingIntervalMs;
  }

  // -------------------------------------------------------------------------
  // IAISProvider implementation
  // -------------------------------------------------------------------------

  start(onData: (pos: VesselPosition) => void): void {
    this.onDataCallback = onData;
    this.consecutiveErrors = 0;
    this.firstPollDone = false;
    this._status = 'connecting';

    // Run first poll immediately, then on interval.
    void this._poll();
    this.intervalHandle = setInterval(() => {
      void this._poll();
    }, this.pollingIntervalMs);
  }

  stop(): void {
    this._status = 'stopped';
    this.onDataCallback = null;

    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getStatus(): ProviderStatus {
    return this._status;
  }

  getDiagnostics(): ProviderDiagnostics {
    return {
      name: this.name,
      status: this._status,
      messagesReceived: this._messagesReceived,
      positionsDelivered: this._positionsDelivered,
      lastPositionAt: this._lastPositionAt?.toISOString() ?? null,
      connectedAt: this._connectedAt?.toISOString() ?? null,
      errors: this._errors,
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async _poll(): Promise<void> {
    if (this._status === 'stopped') return;

    const mmsiList = VESSEL_MMSIS.join(',');
    const url =
      `${APRSFI_API_BASE}?name=${mmsiList}&what=loc&apikey=${this.apiKey}&format=json`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const body: unknown = await response.json();
      this._messagesReceived++;

      if (!isAprsfiResponse(body)) {
        console.warn('[AprsfiProvider] Unexpected response shape:', JSON.stringify(body).slice(0, 200));
        this._handleError();
        return;
      }

      if (body.result !== 'ok') {
        console.warn('[AprsfiProvider] API result not ok:', body.result);
        this._handleError();
        return;
      }

      // Successful response — reset error streak.
      this.consecutiveErrors = 0;

      if (!this.firstPollDone) {
        this.firstPollDone = true;
        this._connectedAt = new Date();
        this._status = 'connected';
      }

      for (const entry of body.entries) {
        const pos = this._normalizeEntry(entry);
        if (pos !== null) {
          this._positionsDelivered++;
          this._lastPositionAt = new Date();
          if (this.onDataCallback !== null) {
            this.onDataCallback(pos);
          }
        }
      }
    } catch (err) {
      console.error('[AprsfiProvider] Poll error:', err instanceof Error ? err.message : String(err));
      this._handleError();
    }
  }

  private _handleError(): void {
    this._errors++;
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      this._status = 'error';
    }
  }

  private _normalizeEntry(entry: AprsfiEntry): VesselPosition | null {
    const mmsiNum = parseInt(entry.name, 10);
    if (!isVesselMMSI(mmsiNum)) return null;

    const latitude = parseFloat(entry.lat);
    const longitude = parseFloat(entry.lng);
    const sog = parseFloat(entry.speed);
    const cog = parseFloat(entry.course);
    const lasttime = parseInt(entry.lasttime, 10);

    if (!isFinite(latitude) || !isFinite(longitude) || !isFinite(lasttime)) return null;

    // heading: use field if present and non-zero, otherwise 511 (unavailable).
    const rawHeading = entry.heading !== undefined ? parseInt(entry.heading, 10) : 0;
    const heading = isFinite(rawHeading) && rawHeading !== 0 ? rawHeading : 511;

    const timestamp = new Date(lasttime * 1000).toISOString();
    const name = entry.srccall.trim();

    return {
      mmsi: mmsiNum,
      name,
      latitude,
      longitude,
      heading,
      sog: isFinite(sog) ? sog : 0,
      cog: isFinite(cog) ? cog : 0,
      speed: isFinite(sog) ? sog : 0,
      timestamp,
    };
  }
}
