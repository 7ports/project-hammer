/**
 * AISProviderManager — orchestrates one or more IAISProvider instances.
 *
 * Drives the active provider, monitors for silence, and fails over to the
 * next provider in priority order when data stops flowing. Exposes the same
 * public API as the old AISProxy so existing callers (routes, tests) need
 * no changes.
 */

import { config } from './config';
import type { VesselPosition, AISProxyDiagnostics, PositionListener, Unsubscribe } from './types';
import type { IAISProvider, ProviderDiagnostics } from './providers/types';
import { AISStreamProvider } from './providers/aisstreamProvider';
import { AprsfiProvider } from './providers/aprsfiProvider';
import { VesselApiProvider } from './providers/vesselApiProvider';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ProviderManagerOptions {
  /** Milliseconds without data before triggering a failover. Default: 5 min. */
  silenceTimeoutMs?: number;
}

export type StatusChangeCallback = (status: 'providers-down' | 'providers-up') => void;

// Cooldown delays between successive failovers: 60s, 120s, 300s (cap).
const FAILOVER_COOLDOWNS_MS = [60_000, 120_000, 300_000];

const HEALTH_CHECK_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// AISProviderManager
// ---------------------------------------------------------------------------

export class AISProviderManager {
  private readonly providers: IAISProvider[];
  private readonly silenceTimeoutMs: number;

  private activeIndex = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private failoverCooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private failoverInProgress = false;
  private _activeClients = 0;
  private _healthCheckTimer: ReturnType<typeof setInterval>;

  // Canonical position store
  private readonly positions = new Map<number, VesselPosition>();
  private readonly listeners = new Set<PositionListener>();

  // Status change listeners
  private readonly _statusListeners = new Set<StatusChangeCallback>();
  private _allProvidersDown = false;

  // Manager-level diagnostics
  private _totalMessages = 0;
  private _positionReports = 0;
  private _matchedVessels = 0;
  private _failoverCount = 0;
  private _startedAt: Date | null = null;
  private _lastMessageAt: Date | null = null;
  private _lastNonPositionMessage: string | null = null;
  private _lastFailoverAt: Date | null = null;
  private _activeProviderConnectedAt: Date | null = null;

  constructor(providers: IAISProvider[], options: ProviderManagerOptions = {}) {
    this.providers = providers;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? config.aisSilenceTimeoutMs;

    this._healthCheckTimer = setInterval(() => {
      this._checkProviderHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  // -------------------------------------------------------------------------
  // Public API (same shape as old AISProxy)
  // -------------------------------------------------------------------------

  /** Starts the active provider. */
  connect(): void {
    if (this.providers.length === 0) {
      console.warn('[AISProviderManager] No providers configured.');
      return;
    }
    this._startedAt = new Date();
    this._startProvider(this.activeIndex);
  }

  /** Returns a snapshot of the most recently received positions (keyed by MMSI). */
  getLatestPositions(): Map<number, VesselPosition> {
    return new Map(this.positions);
  }

  /** Maps the active provider's status to the legacy wsStatus string. */
  getWsStatus(): 'connected' | 'disconnected' | 'connecting' {
    if (this.providers.length === 0) return 'disconnected';
    const status = this.providers[this.activeIndex]?.getStatus() ?? 'idle';
    if (status === 'connected') return 'connected';
    if (status === 'connecting') return 'connecting';
    return 'disconnected';
  }

  /** Returns full diagnostics including per-provider details. */
  getDiagnostics(): AISProxyDiagnostics {
    const activeProvider = this.providers[this.activeIndex];
    const providerDetails: ProviderDiagnostics[] = this.providers.map((p) => p.getDiagnostics());

    return {
      wsStatus: this.getWsStatus(),
      totalMessages: this._totalMessages,
      positionReports: this._positionReports,
      matchedVessels: this._matchedVessels,
      reconnects: this._failoverCount,
      connectedAt: this._activeProviderConnectedAt?.toISOString() ?? null,
      lastMessageAt: this._lastMessageAt?.toISOString() ?? null,
      lastNonPositionMessage: this._lastNonPositionMessage,
      activeProvider: activeProvider?.name ?? 'none',
      providerDetails,
      failoverCount: this._failoverCount,
      lastFailoverAt: this._lastFailoverAt?.toISOString() ?? null,
    };
  }

  /**
   * Call when an SSE client connects. Resumes polling if this is the first client.
   */
  clientConnected(): void {
    this._activeClients++;
    if (this._activeClients === 1) {
      const provider = this.providers[this.activeIndex];
      if (provider?.resume) {
        provider.resume();
      }
    }
  }

  /**
   * Call when an SSE client disconnects. Pauses polling when no clients remain.
   */
  clientDisconnected(): void {
    this._activeClients = Math.max(0, this._activeClients - 1);
    if (this._activeClients === 0) {
      const provider = this.providers[this.activeIndex];
      if (provider?.pause) {
        provider.pause();
      }
    }
  }

  /**
   * Registers a callback that fires whenever a new VesselPosition arrives.
   * Returns an unsubscribe function.
   */
  onPosition(cb: PositionListener): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * Registers a callback that fires when all providers go down or come back up.
   * Returns an unsubscribe function.
   */
  onStatusChange(cb: StatusChangeCallback): Unsubscribe {
    this._statusListeners.add(cb);
    return () => {
      this._statusListeners.delete(cb);
    };
  }

  /** Returns true if all providers are currently in error or stopped state. */
  areAllProvidersDown(): boolean {
    return this._allProvidersDown;
  }

  // -------------------------------------------------------------------------
  // Private — provider lifecycle
  // -------------------------------------------------------------------------

  private _startProvider(index: number): void {
    const provider = this.providers[index];
    if (!provider) {
      console.error('[AISProviderManager] No provider at index', index);
      return;
    }

    this.activeIndex = index;
    this._activeProviderConnectedAt = new Date();
    console.log(`[AISProviderManager] Starting provider: ${provider.name}`);

    provider.start((pos) => {
      this._onData(pos);
    });

    this._resetSilenceTimer();
  }

  private _stopProvider(index: number): void {
    const provider = this.providers[index];
    if (!provider) return;
    console.log(`[AISProviderManager] Stopping provider: ${provider.name}`);
    provider.stop();
  }

  private _onData(pos: VesselPosition): void {
    this._totalMessages++;
    this._positionReports++;
    this._lastMessageAt = new Date();

    const isNew = !this.positions.has(pos.mmsi);
    this.positions.set(pos.mmsi, pos);

    if (isNew) {
      this._matchedVessels++;
    }

    this._resetSilenceTimer();
    this._emit(pos);
    this._checkProviderHealth();
  }

  private _emit(pos: VesselPosition): void {
    for (const listener of this.listeners) {
      try {
        listener(pos);
      } catch (err) {
        console.error('[AISProviderManager] Listener threw:', err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private — provider health / status events
  // -------------------------------------------------------------------------

  private _checkProviderHealth(): void {
    const allDown = this.providers.every((p) => {
      const s = p.getStatus();
      return s === 'error' || s === 'stopped';
    });

    if (allDown === this._allProvidersDown) return;

    this._allProvidersDown = allDown;
    const event: 'providers-down' | 'providers-up' = allDown ? 'providers-down' : 'providers-up';
    console.log(`[AISProviderManager] Status change: ${event}`);

    for (const cb of this._statusListeners) {
      try {
        cb(event);
      } catch (err) {
        console.error('[AISProviderManager] Status listener threw:', err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private — silence timer + failover
  // -------------------------------------------------------------------------

  private _resetSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
    }
    this.silenceTimer = setTimeout(() => {
      this._triggerFailover();
    }, this.silenceTimeoutMs);
  }

  private _clearSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private _triggerFailover(): void {
    if (this.failoverInProgress) return;
    this.failoverInProgress = true;
    this._clearSilenceTimer();

    const prevIndex = this.activeIndex;
    const nextIndex = (prevIndex + 1) % this.providers.length;
    const cooldownMs =
      FAILOVER_COOLDOWNS_MS[Math.min(this._failoverCount, FAILOVER_COOLDOWNS_MS.length - 1)] ??
      FAILOVER_COOLDOWNS_MS[FAILOVER_COOLDOWNS_MS.length - 1] ??
      300_000;

    this._failoverCount++;
    this._lastFailoverAt = new Date();

    const prevName = this.providers[prevIndex]?.name ?? 'unknown';
    const nextName = this.providers[nextIndex]?.name ?? 'unknown';

    console.error(
      `[AISProviderManager] Silence timeout — failing over from '${prevName}' to '${nextName}' ` +
        `(failover #${this._failoverCount}, cooldown ${cooldownMs / 1_000}s)`,
    );

    this._stopProvider(prevIndex);
    this._checkProviderHealth();

    // Wait for the cooldown before starting the next provider.
    this.failoverCooldownTimer = setTimeout(() => {
      this.failoverCooldownTimer = null;
      this.failoverInProgress = false;
      this._startProvider(nextIndex);
    }, cooldownMs);
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createProviderManager(): AISProviderManager {
  const providers: IAISProvider[] = [];

  for (const name of config.aisProviderOrder) {
    if (name === 'aisstream') {
      providers.push(new AISStreamProvider(config.aisstreamApiKey));
    } else if (name === 'aprsfi' && config.aprsfiApiKey !== null) {
      providers.push(new AprsfiProvider(config.aprsfiApiKey, config.aisPollingIntervalMs));
    } else if (name === 'vesselapi' && config.vesselApiKey !== null) {
      providers.push(new VesselApiProvider(config.vesselApiKey));
    } else {
      console.warn(`[AIS] Unknown or unconfigured provider: ${name}`);
    }
  }

  if (providers.length === 0) {
    console.warn('[AIS] No providers configured — falling back to aisstream');
    providers.push(new AISStreamProvider(config.aisstreamApiKey));
  }

  return new AISProviderManager(providers, { silenceTimeoutMs: config.aisSilenceTimeoutMs });
}
