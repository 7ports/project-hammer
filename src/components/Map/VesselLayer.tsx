import { useEffect } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { CircleLayerSpecification, SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { MapLayerMouseEvent } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { Vessel } from '../../types/vessel';

interface VesselLayerProps {
  vessels: Vessel[];
  selectedMmsi: number | null;
  onVesselClick: (mmsi: number) => void;
}

const STATUS_COLORS: Record<Vessel['status'], string> = {
  moving: '#4caf50',
  docked: '#ff9800',
  offline: '#f44336',
};

export function VesselLayer({ vessels, selectedMmsi, onVesselClick }: VesselLayerProps) {
  const { current: map } = useMap();

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

  const selectionRingLayer: CircleLayerSpecification = {
    id: 'vessels-selection-ring',
    type: 'circle',
    source: 'vessels',
    filter: ['==', ['get', 'mmsi'], selectedMmsi ?? -1] as FilterSpecification,
    paint: {
      'circle-radius': 16,
      'circle-color': 'transparent',
      'circle-opacity': 1,
      'circle-stroke-width': 3,
      'circle-stroke-color': '#00e5ff',
      'circle-stroke-opacity': 0.4,
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

  useEffect(() => {
    if (!map) return;

    const handleClick = (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (feature?.properties) {
        onVesselClick(feature.properties.mmsi as number);
      }
    };

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    map.on('click', 'vessels-circle', handleClick);
    map.on('mouseenter', 'vessels-circle', handleMouseEnter);
    map.on('mouseleave', 'vessels-circle', handleMouseLeave);

    return () => {
      map.off('click', 'vessels-circle', handleClick);
      map.off('mouseenter', 'vessels-circle', handleMouseEnter);
      map.off('mouseleave', 'vessels-circle', handleMouseLeave);
    };
  }, [map, onVesselClick]);

  return (
    <Source id="vessels" type="geojson" data={geojson}>
      <Layer {...circleLayer} />
      <Layer {...selectionRingLayer} />
      <Layer {...symbolLayer} />
    </Source>
  );
}
