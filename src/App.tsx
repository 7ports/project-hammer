import { lazy, Suspense, useCallback, useState } from 'react';
import { ThemeProvider } from './hooks/ThemeProvider';
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

const StatsPage = lazy(() => import('./pages/StatsPage'));

type AppView = 'live' | 'stats';

function readInitialView(): AppView {
  if (typeof window === 'undefined') return 'live';
  const v = new URLSearchParams(window.location.search).get('view');
  return v === 'stats' ? 'stats' : 'live';
}

function readInitialMmsi(): number | null {
  if (typeof window === 'undefined') return null;
  const param = new URLSearchParams(window.location.search).get('vessel');
  const parsed = param ? parseInt(param, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function setViewInUrl(view: AppView): void {
  const url = new URL(window.location.href);
  if (view === 'stats') {
    url.searchParams.set('view', 'stats');
  } else {
    url.searchParams.delete('view');
  }
  window.history.replaceState(null, '', url.toString());
}

function AppContent() {
  const { vessels, vesselPositionsRef, connectionStatus, providerStatus, positionHistory } = useVesselPositions();
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(readInitialMmsi);
  const [view, setView] = useState<AppView>(readInitialView);
  const selectedVessel = vessels.find(v => v.mmsi === selectedMmsi) ?? null;

  function handleVesselSelect(mmsi: number | null): void {
    setSelectedMmsi(mmsi);
    const url = new URL(window.location.href);
    if (mmsi != null) {
      url.searchParams.set('vessel', String(mmsi));
    } else {
      url.searchParams.delete('vessel');
    }
    window.history.replaceState(null, '', url.toString());
  }

  const switchToLive = useCallback(() => {
    setView('live');
    setViewInUrl('live');
  }, []);
  const switchToStats = useCallback(() => {
    setView('stats');
    setViewInUrl('stats');
  }, []);

  if (view === 'stats') {
    return (
      <Suspense
        fallback={
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--ocean-deep)',
              color: 'var(--text-secondary)',
            }}
          >
            Loading statistics…
          </div>
        }
      >
        <StatsPage onBackToLive={switchToLive} />
      </Suspense>
    );
  }

  return (
    <AppShell
      providerStatus={providerStatus}
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
              onVesselClick={handleVesselSelect}
            />
          </FerryMap>
        </MapErrorBoundary>
      }
      overlaySlot={
        <>
          <ConnectionIndicator status={connectionStatus} />
          <ThemeSwitcher />
          <button
            type="button"
            className="stats-nav-btn"
            aria-label="Open statistics page"
            onClick={switchToStats}
          >
            Stats
          </button>
        </>
      }
      panelSlot={({ isSheetOpen, setSheetOpen, sheetId }) => (
        <PanelShell
          vessel={selectedVessel}
          isExpanded={isSheetOpen}
          onExpandedChange={setSheetOpen}
          sheetId={sheetId}
        />
      )}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
