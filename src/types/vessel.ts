import type { VesselPosition } from './ais';

export interface Vessel extends VesselPosition {
  status: 'moving' | 'docked' | 'offline';
  lastSeen: Date;
}
