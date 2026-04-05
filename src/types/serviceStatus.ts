import type { RouteId } from './schedule';

export type DisruptionType = 'weather' | 'mechanical' | 'accident' | 'other';

export type ServiceState = 'operating' | 'seasonal-closure' | 'disrupted' | 'unknown';

export interface RouteStatus {
  routeId: RouteId;
  status: ServiceState;
  message: string | null;
  disruptionType: DisruptionType | null;
}

export interface ServiceStatus {
  routes: RouteStatus[];
  fetchedAt: Date | null;
}
