import { useVesselPositions } from './hooks/useVesselPositions';
import { FerryMap } from './components/Map/FerryMap';
import { VesselLayer } from './components/Map/VesselLayer';
import { DockMarkers } from './components/Map/DockMarkers';
import { RouteLayer } from './components/Map/RouteLayer';
import { MapErrorBoundary } from './components/UI/MapErrorBoundary';
import { AppShell } from './components/Layout/AppShell';
import { ConnectionIndicator } from './components/UI/ConnectionIndicator';

function AppContent() {
  const { vessels, connectionStatus } = useVesselPositions();

  return (
    <AppShell
      mapSlot={
        <FerryMap>
          <RouteLayer />
          <DockMarkers />
          <VesselLayer vessels={vessels} />
        </FerryMap>
      }
      overlaySlot={<ConnectionIndicator status={connectionStatus} />}
    />
  );
}

export default function App() {
  return (
    <MapErrorBoundary>
      <AppContent />
    </MapErrorBoundary>
  );
}
