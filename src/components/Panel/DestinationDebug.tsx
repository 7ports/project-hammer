import type { Vessel } from '../../types/vessel';
import './DestinationDebug.css';

interface DestinationDebugProps {
  vessel: Vessel;
}

export function DestinationDebug({ vessel }: DestinationDebugProps) {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') !== '1') return null;
  if (
    vessel.destinationConfidence === undefined &&
    (!vessel.destinationReasons || vessel.destinationReasons.length === 0)
  ) {
    return null;
  }

  return (
    <div className="destination-debug" aria-label="Debug: destination inference">
      <div className="destination-debug__title">DEBUG · destination inference</div>
      {vessel.destinationConfidence !== undefined && (
        <div className="destination-debug__row">
          <span className="destination-debug__label">confidence</span>
          <span className="destination-debug__value">
            {vessel.destinationConfidence.toFixed(2)}
          </span>
        </div>
      )}
      {vessel.destinationReasons && vessel.destinationReasons.length > 0 && (
        <ul className="destination-debug__reasons">
          {vessel.destinationReasons.map((r, i) => (
            <li key={`${i}-${r}`} className="destination-debug__reason">
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
