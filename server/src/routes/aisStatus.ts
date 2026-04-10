import { Router } from 'express';
import { aisProxy } from '../lib/aisProxy';

export const aisStatusRouter = Router();

aisStatusRouter.get('/', (_req, res) => {
  const positions = aisProxy.getLatestPositions();
  const now = Date.now();
  const vessels = [...positions.entries()].map(([mmsi, pos]) => ({
    mmsi,
    name: pos.name,
    lastReceivedAt: pos.timestamp,
    secondsAgo: Math.round((now - new Date(pos.timestamp).getTime()) / 1000),
  }));
  res.json({
    wsStatus: aisProxy.getWsStatus(),
    vesselCount: vessels.length,
    vessels,
    serverTime: new Date().toISOString(),
  });
});
