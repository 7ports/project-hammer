import { useState } from 'react';
import './OutageBanner.css';

interface OutageEvent {
  status: 'open' | 'alert' | 'closed' | 'unknown';
  message: string | null;
  reason: string | null;
  postedAt: string | null;
  detectedAt: string;
}

interface OutageBannerProps {
  status: 'open' | 'alert' | 'closed' | 'unknown' | null;
  message: string | null;
  reason: string | null;
  postedAt: string | null;
  history: OutageEvent[];
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-CA', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Toronto',
    });
  } catch {
    return '';
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-CA', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Toronto',
    });
  } catch {
    return '';
  }
}

export function OutageBanner({ status, message, reason, postedAt, history }: OutageBannerProps) {
  const [expanded, setExpanded] = useState(false);

  // Only show for active outages
  if (!status || status === 'open' || status === 'unknown') return null;

  const isClosed = status === 'closed';
  const bannerClass = `outage-service-banner outage-service-banner--${isClosed ? 'closed' : 'alert'}`;

  // History entries that represent a real change (exclude first-poll 'open' entries)
  const historyEntries = history.filter(e => e.status !== 'open').slice(0, 3);

  return (
    <div className={bannerClass} role="alert" aria-live="assertive">
      <div className="outage-service-banner__main">
        <span className="outage-service-banner__icon" aria-hidden="true">
          {isClosed ? '⛔' : '⚠'}
        </span>
        <div className="outage-service-banner__body">
          <span className="outage-service-banner__label">
            {isClosed ? 'Service Closed' : 'Service Alert'}
            {reason && <span className="outage-service-banner__reason"> · {reason}</span>}
          </span>
          {message && (
            <p className="outage-service-banner__message">{message}</p>
          )}
          {postedAt && (
            <span className="outage-service-banner__time">
              Posted {formatTime(postedAt)} ET
            </span>
          )}
        </div>
        {historyEntries.length > 1 && (
          <button
            className="outage-service-banner__toggle"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? 'Less' : `History (${historyEntries.length})`}
          </button>
        )}
      </div>

      {expanded && historyEntries.length > 1 && (
        <ul className="outage-service-banner__history" aria-label="Recent outage history">
          {historyEntries.slice(1).map((e, i) => (
            <li key={i} className="outage-service-banner__history-item">
              <span className="outage-service-banner__history-time">{formatDateTime(e.detectedAt)}</span>
              <span className="outage-service-banner__history-status">{e.status}</span>
              {e.message && <span className="outage-service-banner__history-msg">{e.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
