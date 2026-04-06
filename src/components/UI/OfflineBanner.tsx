import { useState, useEffect } from 'react';
import './OfflineBanner.css';
import type { ConnectionStatus } from '../../hooks/useAISStream';

interface OfflineBannerProps {
  connectionStatus: ConnectionStatus;
}

const GRACE_PERIOD_MS = 4000;

export function OfflineBanner({ connectionStatus }: OfflineBannerProps) {
  const [showBanner, setShowBanner] = useState(false);

  const isOffline = connectionStatus !== 'connected';

  useEffect(() => {
    if (!isOffline) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowBanner(false);
      return;
    }
    // Only show banner after the grace period to avoid flash on quick reconnects
    const timer = setTimeout(() => setShowBanner(true), GRACE_PERIOD_MS);
    return () => clearTimeout(timer);
  }, [isOffline]);

  if (!showBanner) return null;

  return (
    <div
      className={`offline-banner offline-banner--${connectionStatus}`}
      role="alert"
      aria-live="assertive"
    >
      <span className="offline-banner__icon">&#9888;</span>
      <span className="offline-banner__text">
        {connectionStatus === 'reconnecting'
          ? 'Reconnecting to live feed...'
          : 'AIS data feed offline — positions may be outdated'}
      </span>
    </div>
  );
}
