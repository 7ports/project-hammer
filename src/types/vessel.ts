import type { VesselPosition } from './ais';
import type { DockLocation } from '../lib/docks';

export interface Vessel extends VesselPosition {
  status: 'moving' | 'docked' | 'offline';
  lastSeen: Date;
  nearestDock: DockLocation;
}
