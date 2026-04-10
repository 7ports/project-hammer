/**
 * Provider interface types for the AIS multi-provider system.
 *
 * IAISProvider is the contract all AIS data sources must implement.
 * The AISProviderManager drives them and handles failover.
 */

import type { VesselPosition } from '../types';

export type ProviderStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'stopped';

export interface ProviderDiagnostics {
  name: string;
  status: ProviderStatus;
  messagesReceived: number;
  positionsDelivered: number;
  lastPositionAt: string | null;
  connectedAt: string | null;
  errors: number;
}

export interface IAISProvider {
  readonly name: string;
  start(onData: (pos: VesselPosition) => void): void;
  stop(): void;
  getStatus(): ProviderStatus;
  getDiagnostics(): ProviderDiagnostics;
}
