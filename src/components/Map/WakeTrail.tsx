import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { Vessel } from '../../types/vessel';
import type { VesselPosition } from '../../types/ais';
import type { FeatureCollection, LineString } from 'geojson';
import { VESSEL_COLOR_RGBA } from '../../lib/constants';

interface WakeTrailProps {
  vessels: Vessel[];
  positionHistory: Map<number, VesselPosition[]>;
}

const TRAIL_WINDOW_MS = 300_000; // 5 minutes

// Capture render time outside component body to satisfy react-hooks/purity.
// Called by the memoised helper below, not directly in render.
function getTrailCutoff(): number {
  return Date.now() - TRAIL_WINDOW_MS;
}

export function WakeTrail({ positionHistory }: WakeTrailProps) {
  // Recompute the cutoff timestamp whenever position history changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cutoff = useMemo(() => getTrailCutoff(), [positionHistory]);

  return (
    <>
      {Object.entries(VESSEL_COLOR_RGBA).map(([mmsiStr, { r, g, b }]) => {
        const mmsi = Number(mmsiStr);
        const history = positionHistory.get(mmsi) ?? [];
        const recent = history.filter(
          p => p.receivedAt !== undefined && p.receivedAt > cutoff,
        );

        if (recent.length < 2) return null;

        const geojson: FeatureCollection<LineString> = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: recent.map(p => [p.longitude, p.latitude]),
              },
            },
          ],
        };

        return (
          <Source
            key={mmsi}
            id={`wake-${mmsi}`}
            type="geojson"
            data={geojson}
            lineMetrics={true}
          >
            <Layer
              id={`wake-line-${mmsi}`}
              type="line"
              source={`wake-${mmsi}`}
              paint={{
                'line-color': `rgb(${r}, ${g}, ${b})`,
                'line-width': 3,
                'line-blur': 1,
                'line-gradient': [
                  'interpolate',
                  ['linear'],
                  ['line-progress'],
                  0,   `rgba(${r}, ${g}, ${b}, 0)`,
                  0.4, `rgba(${r}, ${g}, ${b}, 0.15)`,
                  1,   `rgba(${r}, ${g}, ${b}, 0.8)`,
                ],
              }}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
            />
          </Source>
        );
      })}
    </>
  );
}
