import { Source, Layer } from 'react-map-gl/maplibre';
import type { CircleLayerSpecification, SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection, Point } from 'geojson';
import type { Vessel } from '../../types/vessel';

interface VesselLayerProps {
  vessels: Vessel[];
}

const STATUS_COLORS: Record<Vessel['status'], string> = {
  moving: '#4caf50',
  docked: '#ff9800',
  offline: '#f44336',
};

export function VesselLayer({ vessels }: VesselLayerProps) {
  const geojson: FeatureCollection<Point> = {
    type: 'FeatureCollection',
    features: vessels.map(v => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
      properties: {
        mmsi: v.mmsi,
        name: v.name,
        heading: v.heading,
        status: v.status,
        color: STATUS_COLORS[v.status],
      },
    })),
  };

  const circleLayer: CircleLayerSpecification = {
    id: 'vessels-circle',
    type: 'circle',
    source: 'vessels',
    paint: {
      'circle-radius': 8,
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.85,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
    },
  };

  const symbolLayer: SymbolLayerSpecification = {
    id: 'vessels-symbol',
    type: 'symbol',
    source: 'vessels',
    layout: {
      'icon-image': 'ferry-icon',
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-size': 1,
    },
  };

  return (
    <Source id="vessels" type="geojson" data={geojson}>
      <Layer {...circleLayer} />
      <Layer {...symbolLayer} />
    </Source>
  );
}
