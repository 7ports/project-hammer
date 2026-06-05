import { forwardRef } from 'react';
import './SheetTrigger.css';

interface SheetTriggerProps {
  isOpen: boolean;
  onToggle: () => void;
  /** id of the controlled sheet (for aria-controls) */
  controls: string;
}

/**
 * Mobile-only 72x72 floating-action-button that opens/closes the bottom sheet.
 * Hidden on desktop (≥1024px) via CSS media query.
 */
export const SheetTrigger = forwardRef<HTMLButtonElement, SheetTriggerProps>(
  function SheetTrigger({ isOpen, onToggle, controls }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className="sheet-trigger"
        aria-label={isOpen ? 'Close ferry information panel' : 'Open ferry information panel'}
        aria-expanded={isOpen}
        aria-controls={controls}
        aria-haspopup="dialog"
        onClick={onToggle}
      >
        <span className="sheet-trigger__icon" aria-hidden="true">
          {isOpen ? '✕' : '▲'}
        </span>
      </button>
    );
  },
);
