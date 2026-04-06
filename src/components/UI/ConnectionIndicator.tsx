import { useEffect, useRef, useState } from 'react';
import type { ConnectionStatus } from '../../hooks/useAISStream';

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
}

const DOT_COLORS: Record<ConnectionStatus, string> = {
  connected: 'var(--status-moving)',
  reconnecting: 'var(--status-docked)',
  offline: 'var(--status-offline)',
};

const STATUS_MESSAGES: Record<ConnectionStatus, string> = {
  connected: 'Live',
  reconnecting: 'Reconnecting\u2026',
  offline: 'Offline \u2014 positions may be outdated',
};

// Grace period before surfacing a non-connected state — suppresses brief flashes
const GRACE_PERIOD_MS = 5_000;

export function ConnectionIndicator({ status }: ConnectionIndicatorProps) {
  // visibleStatus transitions away from 'connected' only after the grace period.
  // When status returns to 'connected' it snaps back immediately.
  const [visibleStatus, setVisibleStatus] = useState<ConnectionStatus>(status);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending grace timer whenever status changes
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }

    if (status === 'connected') {
      // Snap back immediately — put in a timer callback to satisfy the linter
      graceTimerRef.current = setTimeout(() => {
        graceTimerRef.current = null;
        setVisibleStatus('connected');
      }, 0);
    } else {
      // Non-connected: only surface the status after the grace period
      graceTimerRef.current = setTimeout(() => {
        graceTimerRef.current = null;
        setVisibleStatus(status);
      }, GRACE_PERIOD_MS);
    }

    return () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };
  }, [status]);

  const isExpanded = visibleStatus !== 'connected';

  return (
    <div
      role="status"
      aria-label={`AIS stream: ${STATUS_MESSAGES[visibleStatus]}`}
      className={`connection-indicator${isExpanded ? ` connection-indicator--${visibleStatus}` : ''}`}
    >
      <span
        className="connection-indicator__dot"
        style={{ background: DOT_COLORS[visibleStatus] }}
      />
      <span className="connection-indicator__label">
        {STATUS_MESSAGES[visibleStatus]}
      </span>
    </div>
  );
}
