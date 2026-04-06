import { useState } from 'react';
import type { ReactNode } from 'react';
import { MobileDrawer } from './MobileDrawer';
import { NextDeparture } from '../Map/NextDeparture';
import './AppShell.css';

interface AppShellProps {
  /** Full-bleed map content */
  mapSlot: ReactNode;
  /** Overlay widgets rendered top-right above the map (e.g. ConnectionIndicator) */
  overlaySlot?: ReactNode;
  /** Right panel — hidden on mobile, 360px column on desktop */
  panelSlot?: ReactNode;
}

export function AppShell({ mapSlot, overlaySlot, panelSlot }: AppShellProps) {
  const [isMobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  return (
    <div className="app-shell">
      <div className="app-shell__map">
        {mapSlot}
        <NextDeparture />
        {overlaySlot && (
          <div className="app-shell__overlay" aria-live="polite">
            {overlaySlot}
          </div>
        )}
      </div>

      {/* Desktop right panel — visible only at ≥1024px via CSS */}
      {panelSlot && (
        <aside className="app-shell__panel">{panelSlot}</aside>
      )}

      {/* Mobile: FAB toggle + slide-up drawer — hidden on desktop via CSS */}
      {panelSlot && (
        <>
          <button
            className="mobile-drawer-fab"
            type="button"
            aria-label={isMobileDrawerOpen ? 'Close ferry information' : 'Open ferry information'}
            aria-expanded={isMobileDrawerOpen}
            onClick={() => setMobileDrawerOpen(true)}
          >
            ⛴
          </button>

          <MobileDrawer
            isOpen={isMobileDrawerOpen}
            onClose={() => setMobileDrawerOpen(false)}
          >
            {panelSlot}
          </MobileDrawer>
        </>
      )}
    </div>
  );
}
