import { useState, useEffect } from 'react';
import type { ServiceStatus, RouteStatus, DisruptionType } from '../types/serviceStatus';
import type { RouteId } from '../types/schedule';
import { config } from '../lib/config';

interface FerryStatusResponse {
  status: 'open' | 'alert' | 'closed' | 'unknown';
  reason: string | null;
  message: string | null;
  postedAt: string | null;
  source: 'live' | 'error';
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

function buildRouteStatuses(ferry: FerryStatusResponse | null): RouteStatus[] {
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

export function useServiceStatus(): ServiceStatus {
  const [ferryData, setFerryData] = useState<FerryStatusResponse | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${config.apiUrl}/api/ferry-status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as FerryStatusResponse;
        setFerryData(data);
      } catch (err) {
        console.warn('[useServiceStatus] fetch failed:', err);
        setFerryData(null);
      }
    };

    void fetchStatus();
    const id = setInterval(() => void fetchStatus(), 60_000);
    return () => clearInterval(id);
  }, []);

  return {
    routes: buildRouteStatuses(ferryData),
    fetchedAt: ferryData ? new Date() : null,
  };
}
