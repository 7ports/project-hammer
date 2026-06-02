import { useState, useEffect } from 'react';
import { config } from '../lib/config';

export interface AisStatusVessel {
  mmsi: number;
  name: string;
  lastReceivedAt: string;
  secondsAgo: number;
}

export interface AisStatusProviderDetail {
  name: string;
  status: 'idle' | 'connecting' | 'connected' | 'error' | 'stopped';
  messagesReceived: number;
  positionsDelivered: number;
  lastPositionAt: string | null;
  connectedAt: string | null;
  errors: number;
}

export interface AisStatusResponse {
  activeProvider: string;
  providerDetails: AisStatusProviderDetail[];
  vesselCount: number;
  vessels: AisStatusVessel[];
  serverTime: string;
}

const POLL_INTERVAL_MS = 60_000; // 1 minute — provider state changes infrequently

export function useAisStatus(): AisStatusResponse | null {
  const [status, setStatus] = useState<AisStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${config.apiUrl}/api/ais/status`);
        if (!res.ok) return;
        const data = (await res.json()) as AisStatusResponse;
        if (!cancelled) setStatus(data);
      } catch {
        /* keep last known status — provider attribution is non-critical */
      }
    };

    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}
