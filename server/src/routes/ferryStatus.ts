/**
 * Ferry service status routes.
 *
 * GET /          — REST snapshot of current status (served from monitor cache)
 * GET /stream    — SSE stream; pushes event: ferry-status whenever status changes
 *
 * Mounted at /api/ferry-status in index.ts.
 * Polling of the upstream City API is handled by FerryStatusMonitor (started
 * in index.ts) — this route never fetches the City API directly.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { ferryStatusMonitor } from '../lib/ferryStatusMonitor';
import type { FerryStatusEvent } from '../lib/ferryStatusMonitor';

export interface FerryStatusResponse {
  status: 'open' | 'alert' | 'closed' | 'unknown';
  reason: string | null;
  message: string | null;
  postedAt: string | null;
  source: 'live' | 'error';
  history: FerryStatusEvent[];
}

const KEEP_ALIVE_INTERVAL_MS = 30_000;

const router = Router();

// ---------------------------------------------------------------------------
// REST — current status snapshot
// ---------------------------------------------------------------------------

router.get('/', (_req: Request, res: Response) => {
  const current = ferryStatusMonitor.getCurrentStatus();

  if (!current) {
    const fallback: FerryStatusResponse = {
      status: 'unknown',
      reason: null,
      message: null,
      postedAt: null,
      source: 'error',
      history: [],
    };
    res.json(fallback);
    return;
  }

  const response: FerryStatusResponse = {
    status: current.status,
    reason: current.reason,
    message: current.message,
    postedAt: current.postedAt,
    source: 'live',
    history: ferryStatusMonitor.getHistory(),
  };

  res.set('Cache-Control', 'public, max-age=30');
  res.json(response);
});

// ---------------------------------------------------------------------------
// SSE — live status stream
// ---------------------------------------------------------------------------

router.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current status immediately on connect so the client doesn't wait
  const current = ferryStatusMonitor.getCurrentStatus();
  if (current) {
    const payload = { ...current, history: ferryStatusMonitor.getHistory() };
    res.write(`event: ferry-status\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  // Forward future status changes
  const unsubscribe = ferryStatusMonitor.onStatusChange((event) => {
    const payload = { ...event, history: ferryStatusMonitor.getHistory() };
    res.write(`event: ferry-status\ndata: ${JSON.stringify(payload)}\n\n`);
  });

  // Keep-alive
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), KEEP_ALIVE_INTERVAL_MS);

  req.on('close', () => {
    unsubscribe();
    clearInterval(keepAlive);
  });
});

export default router;
