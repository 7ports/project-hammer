import type { VesselPosition } from './ais';
import type { DockLocation } from '../lib/docks';

export interface Vessel extends VesselPosition {
  status: 'moving' | 'docked' | 'offline';
  lastSeen: Date;
  nearestDock: DockLocation;         // geometric nearest (used by dock popup vessel lists)
  destination?: DockLocation;         // inferred travel destination (moving vessels only)
  /** Estimated minutes to nearest dock (only when moving and SOG > 0.5 kn) */
  etaMinutes?: number;
  /** The dock this vessel most recently departed from */
  departedFrom?: DockLocation;
  /** ISO timestamp of next scheduled departure from nearestDock */
  nextDepartureAt?: string;
}
