import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProviderStatus } from '../../hooks/useAISStream';
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
  /** AIS provider availability — shows outage banner when 'all-down' */
  providerStatus?: ProviderStatus;
}

export function AppShell({ mapSlot, overlaySlot, panelSlot, providerStatus = 'ok' }: AppShellProps) {
  const [isPanelOpen, setPanelOpen] = useState(true);
  const [isAboutOpen, setAboutOpen] = useState(false);
  const aboutBtnRef = useRef<HTMLButtonElement>(null);

  function handleAboutClose() {
    setAboutOpen(false);
    aboutBtnRef.current?.focus();
  }

  return (
    <div className={`app-shell${!isPanelOpen ? ' app-shell--panel-collapsed' : ''}`}>
      {providerStatus === 'all-down' && (
        <div className="outage-banner" role="alert" aria-live="assertive">
          <span className="outage-banner__icon" aria-hidden="true">&#9888;</span>
          All vessel data sources are currently unavailable. Ferry positions shown may be outdated.
        </div>
      )}
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
