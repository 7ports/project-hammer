import { useState } from 'react';
import { Marker, Popup } from 'react-map-gl/maplibre';
import { DOCK_LOCATIONS } from '../../lib/docks';
import { VESSEL_NAMES } from '../../lib/constants';
import type { Vessel } from '../../types/vessel';
import './LandmarkMarkers.css';

interface DockMarkersProps {
  vessels: Vessel[];
}

export function DockMarkers({ vessels }: DockMarkersProps) {
  const [activeDockId, setActiveDockId] = useState<string | null>(null);

  const activeDock = DOCK_LOCATIONS.find((d) => d.id === activeDockId) ?? null;

  return (
    <>
      {DOCK_LOCATIONS.map((dock) => (
        <Marker
          key={dock.id}
          longitude={dock.coordinates[0]}
          latitude={dock.coordinates[1]}
          anchor="center"
        >
          <button
            className="landmark-marker dock-marker"
            type="button"
            aria-label={`Show info for ${dock.name}`}
            onClick={() => setActiveDockId(dock.id)}
          >
            ⚓
          </button>
        </Marker>
      ))}

      {activeDock && (
        <Popup
          longitude={activeDock.coordinates[0]}
          latitude={activeDock.coordinates[1]}
          anchor="bottom"
          closeButton={false}
          closeOnClick={false}
          className="landmark-popup dock-popup"
          onClose={() => setActiveDockId(null)}
        >
          <button
            className="landmark-popup__close"
            type="button"
            aria-label="Close dock info"
            onClick={() => setActiveDockId(null)}
          >
            &times;
          </button>
          <p className="landmark-popup__title">{activeDock.name}</p>

          <DockVesselList dockId={activeDock.id} vessels={vessels} />
        </Popup>
      )}
    </>
  );
}

interface DockVesselListProps {
  dockId: string;
  vessels: Vessel[];
}

function DockVesselList({ dockId, vessels }: DockVesselListProps) {
  const dockedVessels = vessels.filter(
    (v) => v.status === 'docked' && v.nearestDock.id === dockId,
  );
  const approachingVessels = vessels.filter(
    (v) => v.status === 'moving' && v.nearestDock.id === dockId,
  );

  if (dockedVessels.length === 0 && approachingVessels.length === 0) {
    return <p className="dock-popup__empty">No vessels currently</p>;
  }

  return (
    <>
      {dockedVessels.length > 0 && (
        <div className="dock-popup__section">
          <p className="dock-popup__section-label">Ferries here:</p>
          <ul className="dock-popup__vessel-list">
            {dockedVessels.map((v) => (
              <li key={v.mmsi} className="dock-popup__vessel-item">
                <span className="dock-popup__status-dot dock-popup__status-dot--docked" />
                <span className="dock-popup__vessel-name">
                  {VESSEL_NAMES[v.mmsi] ?? v.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {approachingVessels.length > 0 && (
        <div className="dock-popup__section">
          <p className="dock-popup__section-label">Approaching:</p>
          <ul className="dock-popup__vessel-list">
            {approachingVessels.map((v) => (
              <li key={v.mmsi} className="dock-popup__vessel-item">
                <span className="dock-popup__status-dot dock-popup__status-dot--moving" />
                <span className="dock-popup__vessel-name">
                  {VESSEL_NAMES[v.mmsi] ?? v.name}
                </span>
                {v.etaMinutes !== undefined && (
                  <span className="dock-popup__eta">&nbsp;· ETA ~{v.etaMinutes} min</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
