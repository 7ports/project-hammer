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

  useEffect(() => {
    const url = `${config.apiUrl}/api/ais/stream`;
    const es = new EventSource(url);

    const resetOfflineTimer = () => {
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = setTimeout(() => {
        setConnectionStatus('offline');
      }, 30_000);
    };

    es.onopen = () => {
      setConnectionStatus('reconnecting'); // connected after first message
      resetOfflineTimer();
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const position = JSON.parse(event.data as string) as VesselPosition;
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
      setConnectionStatus('reconnecting');
    };

    return () => {
      es.close();
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
  }, []); // empty deps — single connection for component lifetime

  return { vessels, connectionStatus };
}
