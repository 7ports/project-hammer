import type { ReactNode } from 'react';
import './MobileDrawer.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MobileDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Called when the user dismisses the drawer (backdrop tap, etc.) */
  onClose: () => void;
  /** Panel content rendered inside the sheet */
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// MobileDrawer
//
// A slide-up bottom sheet for mobile viewports (≤1024px).
// On desktop the component renders nothing — the right-side panel takes over.
//
// CSS transforms on .mobile-drawer__sheet create a new stacking context, which
// re-anchors any position:fixed descendants (e.g. PanelShell--mobile) relative
// to the sheet rather than the viewport. This means the inner panel content
// is correctly contained within the drawer bounds.
// ---------------------------------------------------------------------------

export function MobileDrawer({ isOpen, onClose, children }: MobileDrawerProps) {
  return (
    <>
      {/* Backdrop — clicking it closes the drawer */}
      <div
        className={`mobile-drawer__backdrop${isOpen ? ' is-open' : ''}`}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div
        className={`mobile-drawer__sheet${isOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Ferry information"
        aria-hidden={!isOpen}
      >
        {/* Drag handle pill (decorative — tap-to-close is on the handle row) */}
        <div
          className="mobile-drawer__handle"
          role="button"
          tabIndex={isOpen ? 0 : -1}
          aria-label="Close ferry information"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClose();
            }
          }}
        />

        {/* Scrollable panel content */}
        <div className="mobile-drawer__content">
          {children}
        </div>
      </div>
    </>
  );
}
