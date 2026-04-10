/**
 * AISStreamProvider — IAISProvider implementation backed by aisstream.io WebSocket.
 *
 * Handles the raw WebSocket connection, message parsing, and exponential-backoff
 * reconnects. The silence timer (failover trigger) is owned by AISProviderManager,
 * not here — this provider just delivers positions via the onData callback.
 */

import WebSocket from 'ws';
import { AISSTREAM_WS_URL, VESSEL_MMSIS } from '../constants';
import type { VesselMMSI } from '../constants';
import type { VesselPosition } from '../types';
import type { IAISProvider, ProviderDiagnostics, ProviderStatus } from './types';

// ---------------------------------------------------------------------------
// Internal types for raw aisstream.io message shapes
// ---------------------------------------------------------------------------

interface RawPositionReport {
  TrueHeading: number;
  Sog: number;
  Cog: number;
  Latitude: number;
  Longitude: number;
  NavigationalStatus: number;
}

interface RawMetaData {
  MMSI: number;
  ShipName: string;
  latitude: number;
  longitude: number;
  time_utc: string;
}

interface RawAISMessage {
  MessageType: string;
  MetaData: RawMetaData;
  Message: {
    PositionReport?: RawPositionReport;
  };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isVesselMMSI(mmsi: number): mmsi is VesselMMSI {
  return (VESSEL_MMSIS as readonly number[]).includes(mmsi);
}

function isRawAISMessage(value: unknown): value is RawAISMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['MessageType'] === 'string' &&
    typeof v['MetaData'] === 'object' &&
    v['MetaData'] !== null &&
    typeof v['Message'] === 'object' &&
    v['Message'] !== null
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** aisstream.io uses 511 to indicate no true heading data. */
const TRUE_HEADING_UNAVAILABLE = 511;

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

// ---------------------------------------------------------------------------
// AISStreamProvider
// ---------------------------------------------------------------------------

export class AISStreamProvider implements IAISProvider {
  readonly name = 'aisstream';

  private readonly apiKey: string;
  private ws: WebSocket | null = null;
  private reconnectDelay = BACKOFF_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private onDataCallback: ((pos: VesselPosition) => void) | null = null;

  // Diagnostics
  private _status: ProviderStatus = 'idle';
  private _messagesReceived = 0;
  private _positionsDelivered = 0;
  private _lastPositionAt: Date | null = null;
  private _connectedAt: Date | null = null;
  private _errors = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // -------------------------------------------------------------------------
  // IAISProvider implementation
  // -------------------------------------------------------------------------

  start(onData: (pos: VesselPosition) => void): void {
    this.stopped = false;
    this.onDataCallback = onData;
    this._openSocket();
  }

  stop(): void {
    this.stopped = true;
    this._status = 'stopped';
    this.onDataCallback = null;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws !== null) {
      this.ws.terminate();
      this.ws = null;
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
  // Private — socket lifecycle
  // -------------------------------------------------------------------------

  private _openSocket(): void {
    if (this.stopped) return;

    this._status = 'connecting';
    const ws = new WebSocket(AISSTREAM_WS_URL);
    this.ws = ws;

    ws.on('open', () => {
      this._connectedAt = new Date();
      this._status = 'connected';
      const subscription = {
        APIKey: this.apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FiltersShipMMSI: VESSEL_MMSIS.map(String),
      };
      ws.send(JSON.stringify(subscription));
      console.log('[AISStreamProvider] WebSocket connected, subscription sent.');
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const raw: unknown = JSON.parse(data.toString());
        this._handleMessage(raw);
      } catch (err) {
        console.error('[AISStreamProvider] Failed to parse message:', err);
        this._errors++;
      }
    });

    ws.on('error', (err: Error) => {
      console.error('[AISStreamProvider] WebSocket error:', err.message);
      this._errors++;
      this._status = 'error';
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (this.stopped) return;
      this._status = 'error';
      console.error(
        `[AISStreamProvider] Connection closed (code=${code}, reason=${reason.toString() || 'none'}). ` +
          `Reconnecting in ${this.reconnectDelay / 1_000}s…`,
      );
      this._scheduleReconnect();
    });
  }

  private _scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.error(
        `[AISStreamProvider] Attempting reconnect (delay was ${this.reconnectDelay / 1_000}s)…`,
      );
      // Double the backoff for next failure, capped at max.
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, BACKOFF_MAX_MS);
      this._openSocket();
    }, this.reconnectDelay);
  }

  // -------------------------------------------------------------------------
  // Private — message handling
  // -------------------------------------------------------------------------

  private _handleMessage(raw: unknown): void {
    this._messagesReceived++;

    if (!isRawAISMessage(raw)) {
      const preview = JSON.stringify(raw).slice(0, 300);
      console.warn(`[AISStreamProvider] Non-AIS message #${this._messagesReceived}: ${preview}`);
      return;
    }

    if (raw.MessageType !== 'PositionReport') {
      if (this._messagesReceived <= 5 || this._messagesReceived % 100 === 0) {
        console.log(
          `[AISStreamProvider] Message #${this._messagesReceived}: ${raw.MessageType} MMSI=${raw.MetaData.MMSI}`,
        );
      }
      return;
    }

    const report = raw.Message.PositionReport;
    if (!report) return;

    const mmsi = raw.MetaData.MMSI;
    if (!isVesselMMSI(mmsi)) return;

    // TrueHeading 511 = not available; fall back to Cog.
    const heading =
      report.TrueHeading === TRUE_HEADING_UNAVAILABLE
        ? Math.round(report.Cog) % 360
        : report.TrueHeading;

    const position: VesselPosition = {
      mmsi,
      name: raw.MetaData.ShipName.trim(),
      latitude: raw.MetaData.latitude,
      longitude: raw.MetaData.longitude,
      heading,
      sog: report.Sog,
      cog: report.Cog,
      speed: report.Sog,
      timestamp: new Date(raw.MetaData.time_utc + ' UTC').toISOString(),
    };

    this._positionsDelivered++;
    this._lastPositionAt = new Date();

    // Successful parse — reset backoff so next disconnect starts fresh.
    this.reconnectDelay = BACKOFF_INITIAL_MS;

    if (this.onDataCallback !== null) {
      this.onDataCallback(position);
    }
  }
}
