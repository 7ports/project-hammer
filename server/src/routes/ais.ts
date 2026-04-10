/**
 * SSE endpoint that streams real-time ferry positions to browser clients.
 *
 * Mounted at /api/ais in index.ts — the single GET / handler:
 *   1. Immediately flushes all known positions so the client has a full
 *      picture on connect, without waiting for the next AIS ping.
 *   2. Registers a listener with aisProxy to forward every new position.
 *   3. Sends a keep-alive comment every 15 s so intermediary proxies do not
 *      close idle connections.
 *   4. On connect, sends the current provider status if all providers are down.
 *   5. Forwards status change events (providers-down / providers-up) as named
 *      SSE events so the frontend can show an outage message.
 *   6. Cleans up the listener and interval on client disconnect — no leaks.
 */

import { Router, Request, Response } from 'express';
import { aisProxy } from '../lib/aisProxy';

export const aisRouter = Router();

const KEEP_ALIVE_INTERVAL_MS = 15_000;

aisRouter.get('/', (req: Request, res: Response) => {
  // -------------------------------------------------------------------------
  // SSE setup
  // -------------------------------------------------------------------------
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  aisProxy.clientConnected();

  // -------------------------------------------------------------------------
  // Flush current positions immediately
  // -------------------------------------------------------------------------
  const currentPositions = aisProxy.getLatestPositions();
  for (const pos of currentPositions.values()) {
    res.write(`data: ${JSON.stringify(pos)}\n\n`);
  }

  // -------------------------------------------------------------------------
  // Send current provider status on connect if all providers are down
  // -------------------------------------------------------------------------
  if (aisProxy.areAllProvidersDown()) {
    res.write(`event: status\ndata: ${JSON.stringify({ type: 'providers-down' })}\n\n`);
  }

  // -------------------------------------------------------------------------
  // Forward ongoing position updates
  // -------------------------------------------------------------------------
  const unsubscribePosition = aisProxy.onPosition((pos) => {
    res.write(`data: ${JSON.stringify(pos)}\n\n`);
  });

  // -------------------------------------------------------------------------
  // Forward provider status change events
  // -------------------------------------------------------------------------
  const unsubscribeStatus = aisProxy.onStatusChange((status) => {
    res.write(`event: status\ndata: ${JSON.stringify({ type: status })}\n\n`);
  });

  // -------------------------------------------------------------------------
  // Keep-alive: send a comment every 15 s
  // -------------------------------------------------------------------------
  const keepAliveTimer = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, KEEP_ALIVE_INTERVAL_MS);

  // -------------------------------------------------------------------------
  // Cleanup on client disconnect
  // -------------------------------------------------------------------------
  req.on('close', () => {
    unsubscribePosition();
    unsubscribeStatus();
    clearInterval(keepAliveTimer);
    aisProxy.clientDisconnected();
  });
});
