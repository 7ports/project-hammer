import { Source, Layer } from 'react-map-gl/maplibre';
import type { LineLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { FERRY_ROUTES } from '../../lib/ferryRoutes';

const routeLayer: LineLayerSpecification = {
  id: 'ferry-routes',
  type: 'line',
  source: 'ferry-routes',
  paint: {
    'line-color': '#38bdf8',
    'line-opacity': 0.55,
    'line-width': 2.5,
    'line-dasharray': [6, 3],
    'line-blur': 0.5,
  },
};

export function RouteLayer() {
  return (
    <Source id="ferry-routes" type="geojson" data={FERRY_ROUTES}>
      <Layer {...routeLayer} />
    </Source>
  );
}
