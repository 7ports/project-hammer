import { useEffect, useRef, useState } from 'react';
import type { VesselPosition } from '../types/ais';
import { config } from '../lib/config';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

const LS_KEY = 'ferry_vessel_cache_v1';

function loadCachedVessels(): Map<number, VesselPosition> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as VesselPosition[];
    return new Map(arr.map(v => [v.mmsi, v]));
  } catch {
    return new Map();
  }
}

function saveVesselsToCache(vessels: Map<number, VesselPosition>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...vessels.values()]));
  } catch {
    // quota exceeded or private browsing — ignore
  }
}

export interface AISStreamResult {
  vessels: Map<number, VesselPosition>;
  connectionStatus: ConnectionStatus;
}

export function useAISStream(): AISStreamResult {
  const [vessels, setVessels] = useState<Map<number, VesselPosition>>(() => loadCachedVessels());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce onerror: only surface 'reconnecting' if the error persists beyond 3s
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const url = `${config.apiUrl}/api/ais`;
    const es = new EventSource(url);

    const resetOfflineTimer = () => {
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = setTimeout(() => {
        setConnectionStatus('offline');
      }, 30_000);
    };

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    es.onopen = () => {
      clearReconnectTimer();
      setConnectionStatus('connected');
      resetOfflineTimer();
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const position = JSON.parse(event.data as string) as VesselPosition;
        // Message received — connection is healthy; cancel any pending reconnect surfacing
        clearReconnectTimer();
        setConnectionStatus('connected');
        resetOfflineTimer();
        setVessels(prev => {
          const next = new Map(prev);
          next.set(position.mmsi, position);
          saveVesselsToCache(next);
          return next;
        });
      } catch {
        // malformed message — ignore
      }
    };

    es.onerror = () => {
      // Only surface 'reconnecting' if the error persists beyond 3s.
      // Sub-3s reconnects are invisible to the user.
      if (reconnectTimerRef.current) return; // already pending
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        setConnectionStatus('reconnecting');
      }, 3_000);
    };

    return () => {
      es.close();
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      clearReconnectTimer();
    };
  }, []); // empty deps — single connection for component lifetime

  return { vessels, connectionStatus };
}
