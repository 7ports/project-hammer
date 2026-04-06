import { useState } from 'react';
import { useVesselPositions } from './hooks/useVesselPositions';
import { FerryMap } from './components/Map/FerryMap';
import { VesselLayer } from './components/Map/VesselLayer';
import { WakeTrail } from './components/Map/WakeTrail';
import { DockMarkers } from './components/Map/DockMarkers';
import { RouteLayer } from './components/Map/RouteLayer';
import { MapErrorBoundary } from './components/UI/MapErrorBoundary';
import { AppShell } from './components/Layout/AppShell';
import { ConnectionIndicator } from './components/UI/ConnectionIndicator';
import { ThemeSwitcher } from './components/UI/ThemeSwitcher';
import { PanelShell } from './components/Panel/PanelShell';

function AppContent() {
  const { vessels, vesselPositionsRef, connectionStatus, positionHistory } = useVesselPositions();
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const selectedVessel = vessels.find(v => v.mmsi === selectedMmsi) ?? null;

  return (
    <AppShell
      mapSlot={
        <MapErrorBoundary>
          <FerryMap>
            <RouteLayer />
            <DockMarkers vessels={vessels} />
            {/* WakeTrail renders behind vessels */}
            <WakeTrail vessels={vessels} positionHistory={positionHistory} />
            <VesselLayer
              vesselPositionsRef={vesselPositionsRef}
              selectedMmsi={selectedMmsi}
              onVesselClick={setSelectedMmsi}
            />
          </FerryMap>
        </MapErrorBoundary>
      }
      overlaySlot={
        <>
          <ConnectionIndicator status={connectionStatus} />
          <ThemeSwitcher />
        </>
      }
      panelSlot={<PanelShell vessel={selectedVessel} />}
    />
  );
}

export default function App() {
  return <AppContent />;
}
