import { useRelativeTime } from '../../hooks/useRelativeTime';
import { VESSEL_NAMES } from '../../lib/constants';
import type { Vessel } from '../../types/vessel';
import './VesselCard.css';

interface VesselCardProps {
  vessel: Vessel;
  isSelected: boolean;
  onSelect: (mmsi: number) => void;
}

const STATUS_COLORS: Record<Vessel['status'], string> = {
  moving:  'var(--status-moving)',
  docked:  'var(--status-docked)',
  offline: 'var(--status-offline)',
};

const STATUS_LABELS: Record<Vessel['status'], string> = {
  moving:  'In Transit',
  docked:  'Parked',
  offline: 'Offline',
};

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function headingToCardinal(heading: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  return dirs[Math.round(heading / 45) % 8];
}

export function VesselCard({ vessel, isSelected, onSelect }: VesselCardProps) {
  const lastSeen = useRelativeTime(vessel.lastSeen);
  const name = VESSEL_NAMES[vessel.mmsi] ?? vessel.name;

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(vessel.mmsi);
    }
  }

  return (
    <div
      className={`vessel-card${isSelected ? ' vessel-card--selected' : ''}`}
      onClick={() => onSelect(vessel.mmsi)}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`Select ${name}`}
      onKeyDown={handleKeyDown}
    >
      <div className="vessel-card__name">{name}</div>

      {/* Route intelligence — status-specific dock fields */}
      <dl className="vessel-card__dock-fields">
        {vessel.status === 'moving' && (
          <>
            <div className="vessel-card__dock-row">
              <dt className="vessel-card__dock-label">ORIGIN</dt>
              <dd className="vessel-card__dock-value">{vessel.departedFrom?.name ?? '\u2014'}</dd>
            </div>
            <div className="vessel-card__dock-row">
              <dt className="vessel-card__dock-label">DESTINATION</dt>
              <dd className="vessel-card__dock-value">{vessel.nearestDock.name}</dd>
            </div>
            <div className="vessel-card__dock-row">
              <dt className="vessel-card__dock-label">ETA</dt>
              <dd className={`vessel-card__dock-value${vessel.etaMinutes !== undefined ? ' vessel-card__dock-value--eta' : ''}`}>
                {vessel.etaMinutes !== undefined ? `~${vessel.etaMinutes} min` : '\u2014'}
              </dd>
            </div>
          </>
        )}
        {vessel.status === 'docked' && (
          <>
            <div className="vessel-card__dock-row">
              <dt className="vessel-card__dock-label">DOCKED AT</dt>
              <dd className="vessel-card__dock-value">{vessel.nearestDock.name}</dd>
            </div>
            <div className="vessel-card__dock-row">
              <dt className="vessel-card__dock-label">NEXT DEP</dt>
              <dd className="vessel-card__dock-value">
                {vessel.nextDepartureAt ? formatShortTime(vessel.nextDepartureAt) : '\u2014'}
              </dd>
            </div>
          </>
        )}
        {vessel.status === 'offline' && (
          <div className="vessel-card__dock-row">
            <dt className="vessel-card__dock-label">LAST SEEN</dt>
            <dd className="vessel-card__dock-value">{vessel.nearestDock.name}</dd>
          </div>
        )}
      </dl>

      <div className="vessel-card__status">
        <span
          className="vessel-card__status-dot"
          style={{ background: STATUS_COLORS[vessel.status] }}
          aria-hidden="true"
        />
        <span
          className="vessel-card__status-label"
          aria-label={`Status: ${STATUS_LABELS[vessel.status]}`}
        >
          {STATUS_LABELS[vessel.status]}
        </span>
      </div>

      <div className="vessel-card__stats">
        <div className="vessel-card__stat">
          <span className="vessel-card__stat-label">SOG</span>
          <span className="vessel-card__stat-value">
            {vessel.sog != null ? `${vessel.sog.toFixed(1)} kn` : '\u2014 kn'}
          </span>
        </div>
        <div className="vessel-card__stat">
          <span className="vessel-card__stat-label">COG</span>
          <span className="vessel-card__stat-value">
            {vessel.cog != null ? `${Math.round(vessel.cog)}\u00b0` : '\u2014\u00b0'}
          </span>
        </div>
        <div className="vessel-card__stat">
          <span className="vessel-card__stat-label">Heading</span>
          <span className="vessel-card__stat-value">
            {vessel.heading === 511
              ? '\u2014\u00b0'
              : `${Math.round(vessel.heading)}\u00b0\u00a0${headingToCardinal(vessel.heading)}`}
          </span>
        </div>
        <div className="vessel-card__stat">
          <span className="vessel-card__stat-label">Last seen</span>
          <span className="vessel-card__stat-value">{lastSeen}</span>
        </div>
      </div>
    </div>
  );
}
