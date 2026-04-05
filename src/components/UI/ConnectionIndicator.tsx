import type { ConnectionStatus } from '../../hooks/useAISStream';

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
}

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Live',
  reconnecting: 'Connecting',
  offline: 'Offline',
};

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connected: 'var(--status-moving)',
  reconnecting: 'var(--status-docked)',
  offline: 'var(--status-offline)',
};

export function ConnectionIndicator({ status }: ConnectionIndicatorProps) {
  return (
    <div
      role="status"
      aria-label={`AIS stream: ${STATUS_LABELS[status]}`}
      className="connection-indicator"
    >
      <span
        className="connection-indicator__dot"
        style={{ background: STATUS_COLORS[status] }}
      />
      <span className="connection-indicator__label">{STATUS_LABELS[status]}</span>
    </div>
  );
}
