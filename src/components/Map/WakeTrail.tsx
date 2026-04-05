import { Source, Layer } from 'react-map-gl/maplibre';
import type { LineLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Vessel } from '../../types/vessel';
import type { VesselPosition } from '../../types/ais';
import type { FeatureCollection, LineString } from 'geojson';

interface WakeTrailProps {
  vessels: Vessel[];
  positionHistory: Map<number, VesselPosition[]>;
}

export function WakeTrail({ vessels, positionHistory }: WakeTrailProps) {
  const geojson: FeatureCollection<LineString> = {
    type: 'FeatureCollection',
    features: vessels
      .filter(v => v.status === 'moving')
      .map(v => {
        const history = positionHistory.get(v.mmsi) ?? [];
        const coords = history.map(p => [p.longitude, p.latitude]);
        return {
          type: 'Feature' as const,
          properties: { mmsi: v.mmsi },
          geometry: { type: 'LineString' as const, coordinates: coords },
        };
      })
      .filter(f => f.geometry.coordinates.length >= 2),
  };

  const wakeLayer: LineLayerSpecification = {
    id: 'wake-trail-line',
    type: 'line',
    source: 'wake-trails',
    paint: {
      'line-color': '#22d3ee',
      'line-width': 2,
      'line-blur': 1,
      'line-gradient': [
        'interpolate',
        ['linear'],
        ['line-progress'],
        0, 'rgba(34, 211, 238, 0)',
        1, 'rgba(34, 211, 238, 0.6)',
      ],
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  };

  return (
    <Source id="wake-trails" type="geojson" data={geojson} lineMetrics={true}>
      <Layer {...wakeLayer} />
    </Source>
  );
}
