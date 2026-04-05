import { Source, Layer } from 'react-map-gl/maplibre';
import type { LineLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { FERRY_ROUTES } from '../../lib/ferryRoutes';

const routeLayer: LineLayerSpecification = {
  id: 'ferry-routes',
  type: 'line',
  source: 'ferry-routes',
  paint: {
    'line-color': '#00e5ff',
    'line-opacity': 0.4,
    'line-width': 2,
    'line-dasharray': [4, 4],
  },
};

export function RouteLayer() {
  return (
    <Source id="ferry-routes" type="geojson" data={FERRY_ROUTES}>
      <Layer {...routeLayer} />
    </Source>
  );
}
