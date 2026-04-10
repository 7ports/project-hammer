/**
 * VesselApiProvider — IAISProvider implementation backed by vesselapi.com REST API.
 *
 * Makes one request per MMSI per poll cycle. Used as a last-resort fallback
 * when both aisstream.io and aprs.fi are unavailable.
 */

import { VESSEL_MMSIS, VESSELAPI_BASE } from '../constants';
import type { VesselMMSI } from '../constants';
import type { VesselPosition } from '../types';
import type { IAISProvider, ProviderDiagnostics, ProviderStatus } from './types';

// ---------------------------------------------------------------------------
// vesselapi.com response types
// ---------------------------------------------------------------------------

interface VesselApiPosition {
  latitude: number | null;
  longitude: number | null;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  timestamp: string | null;
}

interface VesselApiResponse {
  mmsi?: number;
  name?: string;
  position?: VesselApiPosition;
  // Allow extra fields from the API.
  [key: string]: unknown;
}

function isVesselApiResponse(value: unknown): value is VesselApiResponse {
  return typeof value === 'object' && value !== null;
}

function isVesselMMSI(mmsi: number): mmsi is VesselMMSI {
  return (VESSEL_MMSIS as readonly number[]).includes(mmsi);
}

// ---------------------------------------------------------------------------
// VesselApiProvider
// ---------------------------------------------------------------------------

const DEFAULT_POLLING_INTERVAL_MS = 3_600_000; // 1 hour — rate-limit friendly
const MAX_CONSECUTIVE_ERRORS = 3;

export class VesselApiProvider implements IAISProvider {
  readonly name = 'vesselapi';

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
    void this._pollAll();
    this.intervalHandle = setInterval(() => {
      void this._pollAll();
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

  private async _pollAll(): Promise<void> {
    if (this._status === 'stopped') return;

    let cycleErrors = 0;

    for (const mmsi of VESSEL_MMSIS) {
      const pos = await this._fetchVessel(mmsi);
      if (pos !== null) {
        this._positionsDelivered++;
        this._lastPositionAt = new Date();
        if (this.onDataCallback !== null) {
          this.onDataCallback(pos);
        }
      } else {
        cycleErrors++;
      }
    }

    if (cycleErrors === VESSEL_MMSIS.length) {
      // All requests failed.
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        this._status = 'error';
      }
    } else {
      this.consecutiveErrors = 0;
      if (!this.firstPollDone) {
        this.firstPollDone = true;
        this._connectedAt = new Date();
        this._status = 'connected';
      }
    }
  }

  private async _fetchVessel(mmsi: VesselMMSI): Promise<VesselPosition | null> {
    if (!isVesselMMSI(mmsi)) return null;

    const url = `${VESSELAPI_BASE}/${mmsi}/position?filter.idType=mmsi`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        console.warn(`[VesselApiProvider] HTTP ${response.status} for MMSI ${mmsi}`);
        this._errors++;
        return null;
      }

      const body: unknown = await response.json();
      this._messagesReceived++;

      if (!isVesselApiResponse(body)) {
        this._errors++;
        return null;
      }

      return this._normalize(mmsi, body);
    } catch (err) {
      console.error(
        `[VesselApiProvider] Fetch error for MMSI ${mmsi}:`,
        err instanceof Error ? err.message : String(err),
      );
      this._errors++;
      return null;
    }
  }

  private _normalize(mmsi: VesselMMSI, body: VesselApiResponse): VesselPosition | null {
    const position = body.position;
    if (!position) return null;

    const latitude = position.latitude ?? null;
    const longitude = position.longitude ?? null;

    if (latitude === null || longitude === null) return null;
    if (!isFinite(latitude) || !isFinite(longitude)) return null;

    const sog = position.sog ?? 0;
    const cog = position.cog ?? 0;
    const rawHeading = position.heading ?? null;
    const heading = rawHeading !== null && isFinite(rawHeading) ? rawHeading : 511;
    const timestamp =
      position.timestamp !== null && position.timestamp !== undefined
        ? new Date(position.timestamp).toISOString()
        : new Date().toISOString();
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';

    return {
      mmsi,
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
