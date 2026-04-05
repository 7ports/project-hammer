import { useState } from 'react';
import { useVesselPositions } from './hooks/useVesselPositions';
import { FerryMap } from './components/Map/FerryMap';
import { VesselLayer } from './components/Map/VesselLayer';
import { DockMarkers } from './components/Map/DockMarkers';
import { RouteLayer } from './components/Map/RouteLayer';
import { MapErrorBoundary } from './components/UI/MapErrorBoundary';
import { AppShell } from './components/Layout/AppShell';
import { ConnectionIndicator } from './components/UI/ConnectionIndicator';
import { PanelShell } from './components/Panel/PanelShell';

function AppContent() {
  const { vessels, connectionStatus } = useVesselPositions();
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const selectedVessel = vessels.find(v => v.mmsi === selectedMmsi) ?? null;

  return (
    <AppShell
      mapSlot={
        <FerryMap>
          <RouteLayer />
          <DockMarkers />
          <VesselLayer
            vessels={vessels}
            selectedMmsi={selectedMmsi}
            onVesselClick={setSelectedMmsi}
          />
        </FerryMap>
      }
      overlaySlot={<ConnectionIndicator status={connectionStatus} />}
      panelSlot={<PanelShell vessel={selectedVessel} />}
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
