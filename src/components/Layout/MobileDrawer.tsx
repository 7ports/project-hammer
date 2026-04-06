import { useEffect, useRef } from 'react';
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
  const handleRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus management: move focus into dialog on open, restore on close.
  // Also handles Escape-to-close and Tab focus trap.
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      handleRef.current?.focus();
    } else {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const sheet = handleRef.current?.parentElement;
      if (!sheet) return;
      const focusable = Array.from(
        sheet.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

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
        {/* Drag handle pill — tap/Enter/Space to close */}
        <div
          ref={handleRef}
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
