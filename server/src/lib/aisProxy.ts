/**
 * AIS WebSocket proxy for aisstream.io.
 *
 * Maintains a persistent connection to aisstream.io, parses incoming
 * PositionReport messages for the four Toronto Island Ferry vessels, and
 * delivers them to registered listeners. Auto-reconnects with exponential
 * backoff (1s → 2s → 4s … capped at 30s; resets to 1s on each valid message).
 */

import WebSocket from 'ws';
import { config } from './config';
import { AISSTREAM_WS_URL, VESSEL_MMSIS } from './constants';
import type { VesselMMSI } from './constants';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VesselPosition {
  mmsi: VesselMMSI;
  name: string;
  latitude: number;
  longitude: number;
  /** Normalised heading: TrueHeading when available, else Math.round(Cog) % 360. */
  heading: number;
  /** Speed over ground in knots (raw Sog from AIS). */
  sog: number;
  /** Course over ground in degrees (raw Cog from AIS). */
  cog: number;
  /** @deprecated use sog — kept for short-term backwards compat */
  speed: number;
  /** ISO 8601 timestamp from the AIS stream. */
  timestamp: string;
}

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
// AISProxy class
// ---------------------------------------------------------------------------

/** TRUE_HEADING_UNAVAILABLE — aisstream.io uses 511 to indicate no heading data. */
const TRUE_HEADING_UNAVAILABLE = 511;

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

type PositionListener = (pos: VesselPosition) => void;
type Unsubscribe = () => void;

export class AISProxy {
  private ws: WebSocket | null = null;
  private reconnectDelay = BACKOFF_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private readonly positions = new Map<number, VesselPosition>();
  private readonly listeners = new Set<PositionListener>();

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Opens a WebSocket connection to aisstream.io and begins receiving data. */
  connect(): void {
    if (this.destroyed) return;
    this._openSocket();
  }

  /**
   * Returns a snapshot of the most recently received position for each vessel.
   * The map is keyed by MMSI.
   */
  getLatestPositions(): Map<number, VesselPosition> {
    return new Map(this.positions);
  }

  /**
   * Registers a callback that fires whenever a new VesselPosition is parsed.
   * Returns an unsubscribe function that removes the listener.
   */
  onPosition(cb: PositionListener): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // -------------------------------------------------------------------------
  // Private — socket lifecycle
  // -------------------------------------------------------------------------

  private _openSocket(): void {
    if (this.destroyed) return;

    const ws = new WebSocket(AISSTREAM_WS_URL);
    this.ws = ws;

    ws.on('open', () => {
      const subscription = {
        APIKey: config.aisstreamApiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FiltersShipMMSI: VESSEL_MMSIS.map(String),
      };
      ws.send(JSON.stringify(subscription));
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const raw: unknown = JSON.parse(data.toString());
        this._handleMessage(raw);
      } catch (err) {
        console.error('[AISProxy] Failed to parse message:', err);
      }
    });

    ws.on('error', (err: Error) => {
      console.error('[AISProxy] WebSocket error:', err.message);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (this.destroyed) return;
      console.error(
        `[AISProxy] Connection closed (code=${code}, reason=${reason.toString() || 'none'}). ` +
          `Reconnecting in ${this.reconnectDelay / 1_000}s…`,
      );
      this._scheduleReconnect();
    });
  }

  private _scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer !== null) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.error(
        `[AISProxy] Attempting reconnect (delay was ${this.reconnectDelay / 1_000}s)…`,
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
    if (!isRawAISMessage(raw)) return;
    if (raw.MessageType !== 'PositionReport') return;

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

    this.positions.set(mmsi, position);

    // Successful parse — reset backoff so next disconnect starts fresh.
    this.reconnectDelay = BACKOFF_INITIAL_MS;

    this._emit(position);
  }

  private _emit(position: VesselPosition): void {
    for (const listener of this.listeners) {
      try {
        listener(position);
      } catch (err) {
        console.error('[AISProxy] Listener threw an error:', err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

/** Shared AISProxy instance. Call `aisProxy.connect()` once at server startup. */
export const aisProxy = new AISProxy();
