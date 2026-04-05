import { useRef, useCallback } from 'react';
import Map, { type MapRef } from 'react-map-gl/maplibre';
import type { MapLibreEvent } from 'maplibre-gl';
import { config } from '../../lib/config';
import { HARBOUR_CENTER, DEFAULT_ZOOM } from '../../lib/constants';
import { loadFerryIcon } from '../../lib/ferryIcon';
import 'maplibre-gl/dist/maplibre-gl.css';

interface FerryMapProps {
  children?: React.ReactNode;
}

export function FerryMap({ children }: FerryMapProps) {
  const mapRef = useRef<MapRef>(null);

  const handleMapLoad = useCallback((event: MapLibreEvent) => {
    void loadFerryIcon(event.target);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: HARBOUR_CENTER.lng,
          latitude: HARBOUR_CENTER.lat,
          zoom: DEFAULT_ZOOM,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={`https://api.maptiler.com/maps/ocean/style.json?key=${config.maptilerApiKey}`}
        onLoad={handleMapLoad}
        attributionControl={{}}
      >
        {children}
      </Map>
    </div>
  );
}
