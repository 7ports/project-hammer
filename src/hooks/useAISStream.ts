import { useEffect, useRef, useState } from 'react';
import type { VesselPosition } from '../types/ais';
import { config } from '../lib/config';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export interface AISStreamResult {
  vessels: Map<number, VesselPosition>;
  connectionStatus: ConnectionStatus;
}

export function useAISStream(): AISStreamResult {
  const [vessels, setVessels] = useState<Map<number, VesselPosition>>(new Map());
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
      // Stay in current status — the first message will set 'connected'
      clearReconnectTimer();
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
