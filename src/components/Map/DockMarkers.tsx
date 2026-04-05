import { Marker } from 'react-map-gl/maplibre';
import { DOCK_LOCATIONS } from '../../lib/docks';

export function DockMarkers() {
  return (
    <>
      {DOCK_LOCATIONS.map(dock => (
        <Marker
          key={dock.id}
          longitude={dock.coordinates[0]}
          latitude={dock.coordinates[1]}
          anchor="center"
        >
          <div
            title={dock.name}
            aria-label={dock.name}
            style={{
              fontSize: '18px',
              cursor: 'default',
              lineHeight: 1,
            }}
          >
            ⚓
          </div>
        </Marker>
      ))}
    </>
  );
}
