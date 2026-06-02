import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProviderStatus } from '../../hooks/useAISStream';
import { useServiceStatus } from '../../hooks/useServiceStatus';
import { NextDeparture } from '../Map/NextDeparture';
import { AboutPanel } from '../UI/AboutPanel';
import { OutageBanner } from '../UI/OutageBanner';
import { SheetTrigger } from './SheetTrigger';
import './AppShell.css';

interface PanelSlotState {
  isSheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  sheetId: string;
}

interface AppShellProps {
  /** Full-bleed map content */
  mapSlot: ReactNode;
  /** Overlay widgets rendered top-right above the map (e.g. ConnectionIndicator) */
  overlaySlot?: ReactNode;
  /**
   * Right panel — hidden on mobile, 360px column on desktop.
   * Render-prop form receives mobile sheet state so the panel can run controlled.
   */
  panelSlot?: ((state: PanelSlotState) => ReactNode) | ReactNode;
  /** AIS provider availability — shows outage banner when 'all-down' */
  providerStatus?: ProviderStatus;
}

const SHEET_ID = 'ferry-panel-sheet';

export function AppShell({ mapSlot, overlaySlot, panelSlot, providerStatus = 'ok' }: AppShellProps) {
  const [isPanelOpen, setPanelOpen] = useState(true);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const [isAboutOpen, setAboutOpen] = useState(false);
  const aboutBtnRef = useRef<HTMLButtonElement>(null);
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);
  const sheetWasOpenRef = useRef<boolean>(false);
  const {
    ferryStatus,
    outageMessage,
    outageReason,
    outagePostedAt,
    outageParsedTimes,
    outageHistory,
  } = useServiceStatus();

  function handleAboutClose() {
    setAboutOpen(false);
    aboutBtnRef.current?.focus();
  }

  const handleSheetToggle = useCallback(() => {
    setSheetOpen(prev => !prev);
  }, []);

  // Restore focus to the FAB whenever the sheet transitions open → closed.
  // Avoids focusing on the very first render (sheet starts closed).
  useEffect(() => {
    if (isSheetOpen) {
      sheetWasOpenRef.current = true;
    } else if (sheetWasOpenRef.current) {
      sheetTriggerRef.current?.focus();
      sheetWasOpenRef.current = false;
    }
  }, [isSheetOpen]);

  const panelNode =
    typeof panelSlot === 'function'
      ? panelSlot({
          isSheetOpen,
          setSheetOpen,
          sheetId: SHEET_ID,
        })
      : panelSlot;

  return (
    <div className={`app-shell${!isPanelOpen ? ' app-shell--panel-collapsed' : ''}`}>
      <OutageBanner
        status={ferryStatus}
        message={outageMessage}
        reason={outageReason}
        postedAt={outagePostedAt}
        parsedTimes={outageParsedTimes}
        history={outageHistory}
      />
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
        {panelNode && (
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

      {/* Mobile FAB — opens/closes the bottom-sheet. Hidden on desktop via CSS. */}
      {panelNode && (
        <SheetTrigger
          ref={sheetTriggerRef}
          isOpen={isSheetOpen}
          onToggle={handleSheetToggle}
          controls={SHEET_ID}
        />
      )}

      {/* Right panel — visible only at ≥1024px via CSS */}
      {panelNode && isPanelOpen && (
        <aside className="app-shell__panel">{panelNode}</aside>
      )}
    </div>
  );
}
