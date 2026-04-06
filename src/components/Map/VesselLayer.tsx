import { useEffect } from 'react';
import type { RefObject } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { CircleLayerSpecification, SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { MapLayerMouseEvent, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { Vessel } from '../../types/vessel';
import { useAnimationFrame } from '../../hooks/useAnimationFrame';

interface VesselLayerProps {
  vesselPositionsRef: RefObject<Vessel[]>;
  selectedMmsi: number | null;
  onVesselClick: (mmsi: number) => void;
}

const STATUS_COLORS: Record<Vessel['status'], string> = {
  moving: '#00e676',
  docked: '#ffc400',
  offline: '#ff5252',
};

const emptyGeoJSON: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };

export function VesselLayer({ vesselPositionsRef, selectedMmsi, onVesselClick }: VesselLayerProps) {
  const { current: map } = useMap();

  // Imperatively push vessel positions to MapLibre on every animation frame —
  // bypasses React reconciliation entirely for the hot animation path.
  useAnimationFrame(() => {
    if (!map) return;
    const source = map.getSource('vessels') as GeoJSONSource | undefined;
    if (!source) return;
    const vessels = vesselPositionsRef.current ?? [];
    const geojson: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: vessels.map(v => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
        properties: {
          mmsi: v.mmsi,
          name: v.name,
          heading: v.heading,
          iconRotation: v.heading !== 511 ? v.heading : (v.cog ?? 0),
          status: v.status,
          color: STATUS_COLORS[v.status],
        },
      })),
    };
    source.setData(geojson);
  });

  const circleLayer: CircleLayerSpecification = {
    id: 'vessels-circle',
    type: 'circle',
    source: 'vessels',
    paint: {
      'circle-radius': 10,
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.85,
      'circle-blur': 0,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  };

  const selectionRingLayer: CircleLayerSpecification = {
    id: 'vessels-selection-ring',
    type: 'circle',
    source: 'vessels',
    filter: ['==', ['get', 'mmsi'], selectedMmsi ?? -1] as FilterSpecification,
    paint: {
      'circle-radius': 18,
      'circle-color': 'transparent',
      'circle-opacity': 1,
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#00e5ff',
      'circle-stroke-opacity': 0.6,
    },
  };

  const symbolLayer: SymbolLayerSpecification = {
    id: 'vessels-symbol',
    type: 'symbol',
    source: 'vessels',
    layout: {
      'icon-image': 'ferry-icon',
      'icon-rotate': ['get', 'iconRotation'],
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
    <Source id="vessels" type="geojson" data={emptyGeoJSON}>
      <Layer {...circleLayer} />
      <Layer {...selectionRingLayer} />
      <Layer {...symbolLayer} />
    </Source>
  );
}
