/**
 * Integration tests for position-derived endpoints:
 *   GET /api/analytics/utilization
 *   GET /api/analytics/heatmap-dock-presence
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { closeStorage, getDb, initStorage } from '../../lib/storage';
import analyticsRouter from '../analytics';

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-analytics-util-')),
    'hammer.db',
  );
}

interface Response {
  status: number;
  body: { data: unknown; generatedAt: string; cached: boolean };
  cacheControl: string | undefined;
}

function get(server: http.Server, p: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as AddressInfo;
    http
      .get({ hostname: '127.0.0.1', port: addr.port, path: p }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            body: raw.length > 0 ? JSON.parse(raw) : { data: null, generatedAt: '', cached: false },
            cacheControl: typeof res.headers['cache-control'] === 'string' ? res.headers['cache-control'] : undefined,
          });
        });
      })
      .on('error', reject);
  });
}

async function listen(app: express.Express): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function buildApp(): express.Express {
  const app = express();
  app.use('/api/analytics', analyticsRouter);
  return app;
}

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1_000;
const MIN_MS = 60 * 1_000;

const JACK_LAYTON: [number, number] = [-79.3750, 43.6402];
const CENTRE_ISLAND: [number, number] = [-79.3784, 43.6224];

function seedPositions(): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO ais_positions (mmsi, provider, timestamp, ingested_at, latitude, longitude, sog, cog, heading, nav_status)
     VALUES (?, 'aisstream', ?, ?, ?, ?, ?, 180, 180, 0)`,
  );
  // 60 positions at Jack Layton dock (sog=0, idle)
  for (let i = 0; i < 60; i++) {
    const ts = NOW - 2 * DAY_MS + i * MIN_MS;
    insert.run(316045069, ts, ts, JACK_LAYTON[1], JACK_LAYTON[0], 0.1);
  }
  // 60 positions underway (sog=6 kn)
  for (let i = 0; i < 60; i++) {
    const ts = NOW - 2 * DAY_MS + 60 * MIN_MS + i * MIN_MS;
    const frac = i / 60;
    const lat = JACK_LAYTON[1] + frac * (CENTRE_ISLAND[1] - JACK_LAYTON[1]);
    const lon = JACK_LAYTON[0] + frac * (CENTRE_ISLAND[0] - JACK_LAYTON[0]);
    insert.run(316045069, ts, ts, lat, lon, 6.0);
  }
  // 30 positions at Centre Island dock (sog=0)
  for (let i = 0; i < 30; i++) {
    const ts = NOW - 2 * DAY_MS + 120 * MIN_MS + i * MIN_MS;
    insert.run(316045069, ts, ts, CENTRE_ISLAND[1], CENTRE_ISLAND[0], 0.1);
  }
}

let server: http.Server | null = null;

beforeEach(() => {
  initStorage(tempDbPath());
  seedPositions();
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => (server as http.Server).close(() => r()));
    server = null;
  }
  closeStorage();
});

describe('GET /api/analytics/utilization', () => {
  it('returns per-vessel hours active vs in service with rollup cache header', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/utilization?range=30d');
    expect(res.status).toBe(200);
    expect(res.cacheControl).toMatch(/max-age=300/);
    const payload = res.body.data as {
      vessels: Array<{
        mmsi: number;
        activeMs: number;
        totalMs: number;
        utilizationPct: number;
        sampleSize: number;
      }>;
    };
    expect(payload.vessels.length).toBe(1);
    const v = payload.vessels[0];
    expect(v.mmsi).toBe(316045069);
    expect(v.sampleSize).toBeGreaterThanOrEqual(120);
    // 60 underway min / 150 total min ≈ 0.4
    expect(v.utilizationPct).toBeGreaterThan(0.3);
    expect(v.utilizationPct).toBeLessThan(0.6);
    expect(v.activeMs).toBeGreaterThan(0);
    expect(v.totalMs).toBeGreaterThan(v.activeMs);
  });

  it('filters by mmsi', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/utilization?range=30d&mmsi=99999999');
    const payload = res.body.data as { vessels: unknown[] };
    expect(payload.vessels.length).toBe(0);
  });
});

describe('GET /api/analytics/heatmap-dock-presence', () => {
  it('returns dock-presence cells keyed by mmsi+dock+hour', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/heatmap-dock-presence?range=30d');
    expect(res.status).toBe(200);
    expect(res.cacheControl).toMatch(/max-age=300/);
    const payload = res.body.data as {
      cells: Array<{
        mmsi: number;
        dockId: string;
        hour: number;
        pctTime: number;
        sampleSize: number;
      }>;
    };
    expect(payload.cells.length).toBeGreaterThan(0);

    const dockIds = new Set(payload.cells.map((c) => c.dockId));
    expect(dockIds.has('jack-layton')).toBe(true);
    expect(dockIds.has('centre-island')).toBe(true);

    for (const c of payload.cells) {
      expect(c.pctTime).toBeGreaterThan(0);
      expect(c.pctTime).toBeLessThanOrEqual(1);
      expect(c.hour).toBeGreaterThanOrEqual(0);
      expect(c.hour).toBeLessThan(24);
    }
  });

  it('filters by mmsi', async () => {
    server = await listen(buildApp());
    const res = await get(
      server,
      '/api/analytics/heatmap-dock-presence?range=30d&mmsi=99999999',
    );
    const payload = res.body.data as { cells: unknown[] };
    expect(payload.cells.length).toBe(0);
  });
});
