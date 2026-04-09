import { useRef, useCallback } from 'react';
import Map, { type MapRef } from 'react-map-gl/maplibre';
import type { MapLibreEvent } from 'maplibre-gl';
import { config } from '../../lib/config';
import { HARBOUR_CENTER, DEFAULT_ZOOM } from '../../lib/constants';
import { loadFerryIcon } from '../../lib/ferryIcon';
import { useTheme, getMapStyleUrl } from '../../hooks/useTheme';
import 'maplibre-gl/dist/maplibre-gl.css';

interface FerryMapProps {
  children?: React.ReactNode;
}

// SW corner, NE corner — Toronto harbour + island area
const HARBOUR_BOUNDS: [[number, number], [number, number]] = [
  [-79.45, 43.60],
  [-79.32, 43.67],
];

export function FerryMap({ children }: FerryMapProps) {
  const mapRef = useRef<MapRef>(null);
  const { theme } = useTheme();
  const mapStyle = getMapStyleUrl(theme, config.maptilerApiKey);

  const handleMapLoad = useCallback((event: MapLibreEvent) => {
    loadFerryIcon(event.target);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Map
        key={theme}
        ref={mapRef}
        initialViewState={{
          longitude: HARBOUR_CENTER.lng,
          latitude: HARBOUR_CENTER.lat,
          zoom: DEFAULT_ZOOM,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        onLoad={handleMapLoad}
        attributionControl={{}}
        minZoom={12}
        maxZoom={18}
        maxBounds={HARBOUR_BOUNDS}
      >
        {children}
      </Map>
    </div>
  );
}
