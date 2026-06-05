import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Vessel } from '../../types/vessel';
import type { DisruptionType } from '../../types/serviceStatus';
import { useServiceStatus } from '../../hooks/useServiceStatus';
import { useAisStatus } from '../../hooks/useAisStatus';
import { useRelativeTime } from '../../hooks/useRelativeTime';
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
  /** Controlled mobile-sheet expansion. If omitted, falls back to internal state. */
  isExpanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
  /** DOM id for aria-controls wiring from an external trigger (FAB). */
  sheetId?: string;
}

// ---------------------------------------------------------------------------
// Provider attribution — derived from /api/ais/status active provider name
// ---------------------------------------------------------------------------

interface ProviderAttribution {
  label: string;
  href: string;
}

const PROVIDER_ATTRIBUTIONS: Record<string, ProviderAttribution> = {
  aisstream: { label: 'aisstream.io', href: 'https://aisstream.io' },
  aprsfi:    { label: 'aprs.fi',     href: 'https://aprs.fi' },
  vesselapi: { label: 'vesselapi',   href: 'https://www.vesselfinder.com' },
};

function resolveAttribution(active: string | null | undefined): ProviderAttribution {
  if (active && PROVIDER_ATTRIBUTIONS[active]) return PROVIDER_ATTRIBUTIONS[active];
  // Fallback to the historical attribution if no provider info has loaded yet
  return PROVIDER_ATTRIBUTIONS.aprsfi;
}

// ---------------------------------------------------------------------------
// Disruption icons
// ---------------------------------------------------------------------------

const DISRUPTION_ICONS: Record<DisruptionType, string> = {
  weather:    '⛈',  // ⛈
  mechanical: '⚙',  // ⚙
  accident:   '⚠',  // ⚠
  other:      '⚠',  // ⚠
};

const DISRUPTION_LABELS: Record<DisruptionType, string> = {
  weather:    'Weather',
  mechanical: 'Mechanical',
  accident:   'Accident',
  other:      'Service alert',
};

// ---------------------------------------------------------------------------
// Disruption banner
// ---------------------------------------------------------------------------

const BANNER_TRUNCATE_THRESHOLD = 120;

interface DisruptionBannerProps {
  message: string;
  disruptionType: DisruptionType | null;
  outagePostedAt: string | null;
  outageReason: string | null;
  onDismiss: () => void;
}

function DisruptionBanner({
  message,
  disruptionType,
  outagePostedAt,
  outageReason,
  onDismiss,
}: DisruptionBannerProps) {
  // Strip any residual HTML tags that may have come through from ferry.json comments
  const cleanMessage = message.replace(/<[^>]*>/g, '');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const canTruncate = cleanMessage.length > BANNER_TRUNCATE_THRESHOLD;

  const icon = disruptionType ? DISRUPTION_ICONS[disruptionType] : '⚠';
  const typeLabel = disruptionType ? DISRUPTION_LABELS[disruptionType] : null;
  // Prefer the City's explicit reason headline; fall back to the inferred type label.
  const reasonHeadline = outageReason ?? typeLabel;
  const postedRelative = useRelativeTime(outagePostedAt ? new Date(outagePostedAt) : null);

  return (
    <div className="disruption-banner" role="alert" aria-live="polite">
      <span
        className="disruption-banner__icon"
        aria-hidden="true"
        title={typeLabel ?? 'Service alert'}
      >
        {icon}
      </span>
      <div className="disruption-banner__body">
        {(reasonHeadline || outagePostedAt) && (
          <div className="disruption-banner__meta">
            {reasonHeadline && (
              <span className="disruption-banner__reason">{reasonHeadline}</span>
            )}
            {outagePostedAt && postedRelative && (
              <span
                className="disruption-banner__posted-at"
                title={`Posted by City of Toronto at ${new Date(outagePostedAt).toLocaleString()}`}
              >
                · posted {postedRelative}
              </span>
            )}
          </div>
        )}
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
// Focus-trap helpers
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );
}

// ---------------------------------------------------------------------------
// PanelShell
// ---------------------------------------------------------------------------

export function PanelShell({
  vessel,
  isExpanded: controlledExpanded,
  onExpandedChange,
  sheetId = 'ferry-panel-sheet',
}: PanelShellProps) {
  const serviceStatus = useServiceStatus();
  const aisStatus = useAisStatus();
  const isDesktop = useIsDesktop();

  const attribution = resolveAttribution(aisStatus?.activeProvider);

  // Mobile sheet state — controlled by parent if props provided, otherwise local fallback
  const [internalExpanded, setInternalExpanded] = useState<boolean>(false);
  const isExpanded = controlledExpanded ?? internalExpanded;
  const setExpanded = useCallback(
    (open: boolean) => {
      onExpandedChange?.(open);
      if (controlledExpanded === undefined) {
        setInternalExpanded(open);
      }
    },
    [controlledExpanded, onExpandedChange],
  );

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

  // -------------------------------------------------------------------------
  // Shared inner content (renders inside both desktop panel and mobile sheet)
  // -------------------------------------------------------------------------
  const panelContent = (
    <>
      {bannerVisible && (
        <DisruptionBanner
          message={disruptionMessage as string}
          disruptionType={firstDisrupted?.disruptionType ?? null}
          outagePostedAt={serviceStatus.outagePostedAt}
          outageReason={serviceStatus.outageReason}
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
          <div className="panel-shell__placeholder" role="status" aria-live="polite" aria-label="No vessel selected">
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

      <div className="panel-shell__attribution">
        AIS via{' '}
        <a
          href={attribution.href}
          target="_blank"
          rel="noopener noreferrer"
          className="panel-shell__attribution-link"
        >
          {attribution.label}
        </a>
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
  // Controlled by external FAB trigger via isExpanded prop.
  // -------------------------------------------------------------------------
  return (
    <MobileSheet
      sheetId={sheetId}
      isExpanded={isExpanded}
      onClose={() => setExpanded(false)}
    >
      {panelContent}
    </MobileSheet>
  );
}

// ---------------------------------------------------------------------------
// MobileSheet — portal + dialog semantics + focus management + ESC
// ---------------------------------------------------------------------------

interface MobileSheetProps {
  sheetId: string;
  isExpanded: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function MobileSheet({ sheetId, isExpanded, onClose, children }: MobileSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasOpenRef = useRef<boolean>(false);

  // ESC closes when open
  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded, onClose]);

  // Focus trap inside the sheet while open
  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const focusables = getFocusableElements(sheetRef.current);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !sheetRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isExpanded]);

  // Move focus into the sheet on open. Focus return to the FAB on close is
  // owned by AppShell (which holds the trigger ref).
  useEffect(() => {
    if (isExpanded && !wasOpenRef.current) {
      headingRef.current?.focus();
      wasOpenRef.current = true;
    } else if (!isExpanded && wasOpenRef.current) {
      wasOpenRef.current = false;
    }
  }, [isExpanded]);

  const sheetClass = [
    'panel-shell',
    'panel-shell--mobile',
    isExpanded ? 'is-expanded' : 'is-collapsed',
  ].join(' ');

  return createPortal(
    <div
      ref={sheetRef}
      id={sheetId}
      className={sheetClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${sheetId}-heading`}
      aria-hidden={!isExpanded}
    >
      <h2
        id={`${sheetId}-heading`}
        ref={headingRef}
        tabIndex={-1}
        className="panel-shell__sr-heading"
      >
        Ferry information panel
      </h2>

      {/* Passive visual cue — pill indicator only, no longer interactive */}
      <div className="panel-shell__handle-bar" aria-hidden="true" />

      {/* Scrollable content */}
      <div className="panel-shell__content">{children}</div>
    </div>,
    document.body,
  );
}
