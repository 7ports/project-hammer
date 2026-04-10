import { Router } from 'express';
import type { Request, Response } from 'express';
import { aisProxy } from '../lib/aisProxy';

export const aisStatusRouter = Router();

aisStatusRouter.get('/', (_req: Request, res: Response) => {
  const positions = aisProxy.getLatestPositions();
  const diagnostics = aisProxy.getDiagnostics();
  const now = Date.now();
  const vessels = [...positions.entries()].map(([mmsi, pos]) => ({
    mmsi,
    name: pos.name,
    lastReceivedAt: pos.timestamp,
    secondsAgo: Math.round((now - new Date(pos.timestamp).getTime()) / 1000),
  }));
  res.json({
    ...diagnostics,
    vesselCount: vessels.length,
    vessels,
    serverTime: new Date().toISOString(),
  });
});
