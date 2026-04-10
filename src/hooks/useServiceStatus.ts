import { useState, useEffect } from 'react';
import type { ServiceStatus, RouteStatus, DisruptionType } from '../types/serviceStatus';
import type { RouteId } from '../types/schedule';
import { config } from '../lib/config';

interface FerryStatusEvent {
  status: 'open' | 'alert' | 'closed' | 'unknown';
  reason: string | null;
  message: string | null;
  postedAt: string | null;
  detectedAt: string;
  history?: FerryStatusEvent[];
}

const ROUTE_IDS: RouteId[] = [
  'jack-layton-wards',
  'jack-layton-centre',
  'jack-layton-hanlans',
];

function mapDisruptionType(reason: string | null): DisruptionType {
  if (!reason) return 'other';
  const r = reason.toLowerCase();
  if (r.includes('weather')) return 'weather';
  if (r.includes('mechanical')) return 'mechanical';
  if (r.includes('accident')) return 'accident';
  return 'other';
}

function buildRouteStatuses(ferry: FerryStatusEvent | null): RouteStatus[] {
  return ROUTE_IDS.map((routeId): RouteStatus => {
    if (!ferry || ferry.status === 'unknown') {
      return { routeId, status: 'unknown', message: null, disruptionType: null };
    }

    if (ferry.status === 'open') {
      return { routeId, status: 'operating', message: null, disruptionType: null };
    }

    // alert or closed — terminal-wide disruption applies to all routes
    return {
      routeId,
      status: 'disrupted',
      message: ferry.message,
      disruptionType: mapDisruptionType(ferry.reason),
    };
  });
}

export interface ServiceStatusResult extends ServiceStatus {
  /** The raw City status ('open' | 'alert' | 'closed' | 'unknown') */
  ferryStatus: FerryStatusEvent['status'] | null;
  /** The City's human-readable outage message, if any */
  outageMessage: string | null;
  /** Reason code from the City (e.g. 'Weather') */
  outageReason: string | null;
  /** When the City posted the status (ISO string) */
  outagePostedAt: string | null;
  /** Recent status history, newest first */
  outageHistory: Omit<FerryStatusEvent, 'history'>[];
}

export function useServiceStatus(): ServiceStatusResult {
  const [ferryData, setFerryData] = useState<FerryStatusEvent | null>(null);

  useEffect(() => {
    // Initial state via REST (no wait for first SSE message)
    fetch(`${config.apiUrl}/api/ferry-status`)
      .then(r => r.ok ? r.json() as Promise<FerryStatusEvent & { history?: FerryStatusEvent[] }> : Promise.reject())
      .then(data => setFerryData(data))
      .catch(() => { /* stay null */ });

    // Live updates via SSE — replaces the old 60s polling interval
    const es = new EventSource(`${config.apiUrl}/api/ferry-status/stream`);

    es.addEventListener('ferry-status', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as FerryStatusEvent;
        setFerryData(data);
      } catch {
        // ignore malformed
      }
    });

    es.onerror = () => {
      // SSE will auto-reconnect; no state update needed on transient errors
    };

    return () => es.close();
  }, []);

  const history = (ferryData as (FerryStatusEvent & { history?: FerryStatusEvent[] }) | null)
    ?.history ?? [];

  return {
    routes: buildRouteStatuses(ferryData),
    fetchedAt: ferryData ? new Date(ferryData.detectedAt) : null,
    ferryStatus: ferryData?.status ?? null,
    outageMessage: ferryData?.status !== 'open' ? (ferryData?.message ?? null) : null,
    outageReason: ferryData?.status !== 'open' ? (ferryData?.reason ?? null) : null,
    outagePostedAt: ferryData?.status !== 'open' ? (ferryData?.postedAt ?? null) : null,
    outageHistory: history.map((e) => ({
      status: e.status,
      reason: e.reason,
      message: e.message,
      postedAt: e.postedAt,
      detectedAt: e.detectedAt,
    })),
  };
}
