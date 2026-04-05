import { useState, useRef, useEffect, useCallback } from 'react';
import type { Vessel } from '../../types/vessel';
import { useServiceStatus } from '../../hooks/useServiceStatus';
import { VesselCard } from './VesselCard';
import { ScheduleView } from './ScheduleView';
import { TicketCard } from './TicketCard';
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

interface DisruptionBannerProps {
  message: string;
  onDismiss: () => void;
}

function DisruptionBanner({ message, onDismiss }: DisruptionBannerProps) {
  return (
    <div className="disruption-banner" role="alert" aria-live="polite">
      <span className="disruption-banner__message">{message}</span>
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
// Drag hook — pointer-based, refs-only during drag (no render on every pixel)
// ---------------------------------------------------------------------------

interface UseDragSheetOptions {
  isExpanded: boolean;
  onSnap: (expanded: boolean) => void;
  sheetRef: React.RefObject<HTMLDivElement | null>;
  prefersReducedMotion: boolean;
}

function useDragSheet({
  isExpanded,
  onSnap,
  sheetRef,
  prefersReducedMotion,
}: UseDragSheetOptions) {
  const startYRef = useRef<number>(0);
  const draggingRef = useRef<boolean>(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (prefersReducedMotion) return;
      startYRef.current = e.clientY;
      draggingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [prefersReducedMotion],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current || !sheetRef.current) return;

      const delta = e.clientY - startYRef.current;

      // Clamp based on current state:
      // Collapsed → only allow dragging up (negative delta)
      // Expanded  → only allow dragging down (positive delta)
      let clamped: number;
      if (!isExpanded) {
        clamped = Math.min(delta, 0); // only up
      } else {
        clamped = Math.max(delta, 0); // only down
      }

      sheetRef.current.style.transform = `translateY(${clamped}px)`;
    },
    [isExpanded, sheetRef],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current || !sheetRef.current) return;
      draggingRef.current = false;

      const delta = e.clientY - startYRef.current;

      // Clear inline transform — CSS class-based transform takes over
      sheetRef.current.style.transform = '';

      // Snap decision: threshold of 50px
      if (!isExpanded && delta < -50) {
        onSnap(true); // collapsed → expanded
      } else if (isExpanded && delta > 50) {
        onSnap(false); // expanded → collapsed
      } else {
        // Snap back to current state (no-op on state, but force a class refresh)
        onSnap(isExpanded);
      }
    },
    [isExpanded, onSnap, sheetRef],
  );

  return { handlePointerDown, handlePointerMove, handlePointerUp };
}

// ---------------------------------------------------------------------------
// Reduced motion detection hook
// ---------------------------------------------------------------------------

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
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
  const prefersReducedMotion = usePrefersReducedMotion();
  const isDesktop = useIsDesktop();
  const sheetRef = useRef<HTMLDivElement>(null);

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

  const handleSnap = useCallback((expanded: boolean) => {
    setIsExpanded(expanded);
  }, []);

  const { handlePointerDown, handlePointerMove, handlePointerUp } = useDragSheet({
    isExpanded,
    onSnap: handleSnap,
    sheetRef,
    prefersReducedMotion,
  });

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
  // Mobile: draggable bottom sheet
  // -------------------------------------------------------------------------
  const sheetClass = [
    'panel-shell',
    'panel-shell--mobile',
    isExpanded ? 'is-expanded' : 'is-collapsed',
  ].join(' ');

  return (
    <div
      ref={sheetRef}
      className={sheetClass}
      role="complementary"
      aria-label="Ferry information panel"
    >
      {/* Drag handle */}
      <div
        className="panel-shell__handle-bar"
        role="button"
        tabIndex={0}
        aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
        aria-expanded={isExpanded}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded((prev) => !prev);
          }
        }}
      />

      {/* Collapsed strip summary */}
      <div
        className="panel-shell__collapsed-summary"
        aria-hidden={isExpanded}
      >
        {collapsedLabel}
      </div>

      {/* Scrollable content */}
      <div className="panel-shell__content">{panelContent}</div>
    </div>
  );
}
