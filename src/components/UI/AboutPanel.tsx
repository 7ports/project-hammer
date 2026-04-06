import { useEffect, useRef } from 'react';
import type React from 'react';
import './AboutPanel.css';

interface AboutPanelProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export function AboutPanel({ isOpen, onClose, triggerRef }: AboutPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap + Escape key
  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    // Move focus into dialog
    const firstFocusable = dialog.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        triggerRef?.current?.focus();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusables = Array.from(
        dialog!.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled'));

      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="about-backdrop"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="about-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="about-panel__header">
          <h2 className="about-panel__title" id="about-panel-title">
            Toronto Island Ferry Tracker
          </h2>
          <button
            className="about-panel__close"
            type="button"
            aria-label="Close about panel"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* What is this? */}
        <section className="about-panel__section">
          <h3 className="about-panel__section-heading">What is this?</h3>
          <p className="about-panel__body">
            Real-time map showing the four Toronto Island ferries — Sam McBride, Wm Inglis,
            Thomas Rennie, and Marilyn Bell I — as they cross Toronto Harbour between the
            Jack Layton Ferry Terminal and the Toronto Islands. Vessel positions update live
            via AIS (Automatic Identification System) radio signals.
          </p>
        </section>

        {/* How to use */}
        <section className="about-panel__section">
          <h3 className="about-panel__section-heading">How to use</h3>
          <ul className="about-panel__list">
            <li>Click any ferry icon on the map to see its current status, speed, heading, and nearest dock.</li>
            <li>The schedule panel shows upcoming departures for each island route.</li>
            <li>The bottom-left overlay shows the next ferry departure times at a glance.</li>
            <li>On mobile, tap the ⛴ button to open the ferry information drawer.</li>
          </ul>
        </section>

        {/* Routes */}
        <section className="about-panel__section">
          <h3 className="about-panel__section-heading">Routes</h3>
          <table className="about-panel__routes-table">
            <thead>
              <tr>
                <th>Destination</th>
                <th>Service</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ward's Island</td>
                <td>Year-round</td>
              </tr>
              <tr>
                <td>Centre Island</td>
                <td>Seasonal, May–Sep</td>
              </tr>
              <tr>
                <td>Hanlan's Point</td>
                <td>Year-round</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Fares */}
        <section className="about-panel__section">
          <h3 className="about-panel__section-heading">Fares</h3>
          <div className="about-panel__fares">
            <span className="about-panel__fare-chip">Adult $9.11</span>
            <span className="about-panel__fare-chip">Senior/Student $5.86</span>
            <span className="about-panel__fare-chip">Child $4.29</span>
            <span className="about-panel__fare-chip">Under 2 Free</span>
          </div>
          <p className="about-panel__body about-panel__fares-note">
            Purchase at the Jack Layton Ferry Terminal.
          </p>
        </section>

        {/* Footer */}
        <footer className="about-panel__footer">
          AIS data from aisstream.io · Map tiles by MapTiler
        </footer>
      </div>
    </div>
  );
}
