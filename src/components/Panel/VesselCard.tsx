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
  moving:  'Underway',
  docked:  'At dock',
  offline: 'Offline',
};

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
