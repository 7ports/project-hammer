import type { RouteId } from './schedule';

export type DisruptionType = 'weather' | 'mechanical' | 'accident' | 'other';

export type ServiceState = 'operating' | 'seasonal-closure' | 'disrupted' | 'suspended' | 'unknown';

export interface RouteStatus {
  routeId: RouteId;
  status: ServiceState;
  message: string | null;
  disruptionType: DisruptionType | null;
  /** Departure times parsed from the City disruption message (HH:MM 24h, sorted, deduped). Empty when none found. */
  parsedTimes: string[];
}

export interface ServiceStatus {
  routes: RouteStatus[];
  fetchedAt: Date | null;
}
