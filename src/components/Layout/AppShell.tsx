import type { ReactNode } from 'react';
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
  return (
    <div className="app-shell">
      <div className="app-shell__map">
        {mapSlot}
        {overlaySlot && (
          <div className="app-shell__overlay" aria-live="polite">
            {overlaySlot}
          </div>
        )}
      </div>
      {panelSlot && (
        <aside className="app-shell__panel">{panelSlot}</aside>
      )}
    </div>
  );
}
