import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Vessel } from '../../types/vessel';
import { useServiceStatus } from '../../hooks/useServiceStatus';
import { VesselCard } from './VesselCard';
import { ScheduleView } from './ScheduleView';
import { TicketCard } from './TicketCard';
import { WeatherStrip } from './WeatherStrip';
import './PanelShell.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PanelShellProps {
  vessel: Vessel | null;
  onVesselSelect?: never; // reserved — not used yet
}

// ---------------------------------------------------------------------------
// Disruption banner
// ---------------------------------------------------------------------------

const BANNER_TRUNCATE_THRESHOLD = 120;

interface DisruptionBannerProps {
  message: string;
  onDismiss: () => void;
}

function DisruptionBanner({ message, onDismiss }: DisruptionBannerProps) {
  // Strip any residual HTML tags that may have come through from ferry.json comments
  const cleanMessage = message.replace(/<[^>]*>/g, '');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const canTruncate = cleanMessage.length > BANNER_TRUNCATE_THRESHOLD;

  return (
    <div className="disruption-banner" role="alert" aria-live="polite">
      <div className="disruption-banner__body">
        <span
          className={
            canTruncate && !isExpanded
              ? 'disruption-banner__message disruption-banner__message--clamped'
              : 'disruption-banner__message'
          }
        >
          {cleanMessage}
        </span>
        {canTruncate && (
          <button
            className="disruption-banner__toggle"
            type="button"
            onClick={() => setIsExpanded(prev => !prev)}
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      <button
        className="disruption-banner__dismiss"
        type="button"
        aria-label="Dismiss disruption alert"
        onClick={onDismiss}
      >
        &#x2715;
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop breakpoint detection hook
// ---------------------------------------------------------------------------

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 1024px)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isDesktop;
}

// ---------------------------------------------------------------------------
// PanelShell
// ---------------------------------------------------------------------------

export function PanelShell({ vessel }: PanelShellProps) {
  const serviceStatus = useServiceStatus();
  const isDesktop = useIsDesktop();

  // Mobile sheet state
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Disruption banner state — dismissed flag is keyed to the specific message
  // so a new message always re-shows the banner without needing a useEffect reset.
  const firstDisrupted = serviceStatus.routes.find(r => r.status === 'disrupted');
  const disruptionMessage = firstDisrupted?.message ?? null;
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  // Banner is visible when there is a message AND the user has not dismissed that
  // exact message text. A new message text automatically re-shows the banner.
  const bannerVisible =
    disruptionMessage !== null && disruptionMessage !== dismissedMessage;

  const handleDismissBanner = useCallback(() => {
    setDismissedMessage(disruptionMessage);
  }, [disruptionMessage]);

  // Count active (non-offline) vessels for the collapsed summary
  // We don't have the full vessel list here — vessel prop is the selected one.
  // The summary shows a generic label; the parent could pass a count later.
  // For now: show "Ferry tracker" when no selection, vessel name when selected.
  const collapsedLabel = vessel ? vessel.name : 'Ferries live';

  // -------------------------------------------------------------------------
  // Shared inner content (renders inside both desktop panel and mobile sheet)
  // -------------------------------------------------------------------------
  const panelContent = (
    <>
      {bannerVisible && (
        <DisruptionBanner
          message={disruptionMessage as string}
          onDismiss={handleDismissBanner}
        />
      )}

      <div className="panel-shell__section panel-shell__section--weather">
        <WeatherStrip />
      </div>

      <div className="panel-shell__section">
        {vessel !== null ? (
          <VesselCard
            vessel={vessel}
            isSelected={true}
            onSelect={() => {
              /* selection managed by parent */
            }}
          />
        ) : (
          <div className="panel-shell__placeholder" aria-label="No vessel selected">
            Tap a ferry to see details
          </div>
        )}
      </div>

      <div className="panel-shell__section">
        <ScheduleView />
      </div>

      <div className="panel-shell__section">
        <TicketCard />
      </div>
    </>
  );

  // -------------------------------------------------------------------------
  // Desktop: static panel (AppShell handles the column + overflow-y)
  // -------------------------------------------------------------------------
  if (isDesktop) {
    return (
      <div className="panel-shell panel-shell--desktop">
        <div className="panel-shell__content">{panelContent}</div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Mobile: tap-to-expand bottom sheet (no drag gesture)
  // -------------------------------------------------------------------------
  const sheetClass = [
    'panel-shell',
    'panel-shell--mobile',
    isExpanded ? 'is-expanded' : 'is-collapsed',
  ].join(' ');

  return createPortal(
    <div
      className={sheetClass}
      role="complementary"
      aria-label="Ferry information panel"
    >
      {/* Handle bar — tap target when collapsed, shows collapse button when expanded */}
      <div
        className="panel-shell__handle-bar"
        onClick={!isExpanded ? () => setIsExpanded(true) : undefined}
        role={!isExpanded ? 'button' : undefined}
        tabIndex={!isExpanded ? 0 : undefined}
        aria-label={!isExpanded ? 'Expand ferry information' : undefined}
        onKeyDown={!isExpanded ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(true);
          }
        } : undefined}
      >
        {isExpanded && (
          <button
            className="panel-shell__collapse-btn"
            type="button"
            aria-label="Collapse panel"
            onClick={() => setIsExpanded(false)}
          >
            ▼
          </button>
        )}
      </div>

      {/* Collapsed strip summary — tap to expand */}
      <div
        className="panel-shell__collapsed-summary"
        aria-hidden={isExpanded}
        onClick={() => setIsExpanded(true)}
        role="button"
        tabIndex={isExpanded ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(true);
          }
        }}
      >
        <span>{collapsedLabel}</span>
        <span className="panel-shell__expand-icon" aria-hidden="true">▲</span>
      </div>

      {/* Scrollable content */}
      <div className="panel-shell__content">{panelContent}</div>
    </div>,
    document.body,
  );
}
