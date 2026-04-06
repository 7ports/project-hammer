import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NextDeparture } from '../Map/NextDeparture';
import { AboutPanel } from '../UI/AboutPanel';
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
  const [isPanelOpen, setPanelOpen] = useState(true);
  const [isAboutOpen, setAboutOpen] = useState(false);
  const aboutBtnRef = useRef<HTMLButtonElement>(null);

  function handleAboutClose() {
    setAboutOpen(false);
    aboutBtnRef.current?.focus();
  }

  return (
    <div className={`app-shell${!isPanelOpen ? ' app-shell--panel-collapsed' : ''}`}>
      <div className="app-shell__map">
        {mapSlot}
        <NextDeparture />

        <button
          ref={aboutBtnRef}
          className="about-btn"
          type="button"
          aria-label="About this app"
          onClick={() => setAboutOpen(true)}
        >
          ?
        </button>

        {overlaySlot && (
          <div className="app-shell__overlay" aria-live="polite">
            {overlaySlot}
          </div>
        )}

        <AboutPanel isOpen={isAboutOpen} onClose={handleAboutClose} triggerRef={aboutBtnRef} />

        {/* Desktop panel toggle button — visible only at ≥1024px */}
        {panelSlot && (
          <button
            className="panel-toggle-btn"
            type="button"
            aria-label={isPanelOpen ? 'Collapse information panel' : 'Expand information panel'}
            aria-expanded={isPanelOpen}
            onClick={() => setPanelOpen((prev) => !prev)}
          >
            {isPanelOpen ? '›' : '‹'}
          </button>
        )}
      </div>

      {/* Right panel — visible only at ≥1024px via CSS */}
      {panelSlot && isPanelOpen && (
        <aside className="app-shell__panel">{panelSlot}</aside>
      )}
    </div>
  );
}
