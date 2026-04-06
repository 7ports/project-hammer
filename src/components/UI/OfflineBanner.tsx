import './OfflineBanner.css';
import type { ConnectionStatus } from '../../hooks/useAISStream';

interface OfflineBannerProps {
  connectionStatus: ConnectionStatus;
}

export function OfflineBanner({ connectionStatus }: OfflineBannerProps) {
  if (connectionStatus === 'connected') return null;

  return (
    <div
      className={`offline-banner offline-banner--${connectionStatus}`}
      role="status"
      aria-live="polite"
    >
      {connectionStatus === 'reconnecting'
        ? 'Reconnecting to live feed...'
        : 'No live data — map may be outdated'}
    </div>
  );
}
