/**
 * Integration tests for the service-health endpoints:
 *   GET /api/analytics/disruptions
 *   GET /api/analytics/data-quality
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
    fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-analytics-svc-')),
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
const HOUR_MS = 60 * 60 * 1_000;
const MIN_MS = 60 * 1_000;

function seedDisruptions(): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO ferry_events (status, message, reason, posted_at, detected_at, parsed_times)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insert.run('open', null, null, null, NOW - 3 * DAY_MS, '[]');
  insert.run('alert', 'Wind delay', 'Weather', null, NOW - 2 * DAY_MS, '["11:30","13:00"]');
  insert.run('open', null, null, null, NOW - 2 * DAY_MS + 2 * HOUR_MS, '[]');
  insert.run('closed', 'Service suspended', 'Mechanical', null, NOW - 1 * DAY_MS, '[]');
  insert.run('open', null, null, null, NOW - 1 * DAY_MS + 3 * HOUR_MS, '[]');
}

function seedPositionsForQuality(): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO ais_positions (mmsi, provider, timestamp, ingested_at, latitude, longitude, sog, cog, heading, nav_status)
     VALUES (?, 'aisstream', ?, ?, 43.64, -79.38, 4.0, 180, 180, 0)`,
  );
  // 30 positions one per minute (gapless)
  for (let i = 0; i < 30; i++) {
    const ts = NOW - 2 * HOUR_MS + i * MIN_MS;
    insert.run(316045069, ts, ts);
  }
  // 10 min gap then 10 more positions
  for (let i = 0; i < 10; i++) {
    const ts = NOW - 2 * HOUR_MS + 40 * MIN_MS + i * MIN_MS;
    insert.run(316045069, ts, ts);
  }

  const insertProv = db.prepare(
    `INSERT INTO provider_state (transition, from_provider, to_provider, timestamp)
     VALUES (?, ?, ?, ?)`,
  );
  insertProv.run('failover', 'aisstream', 'aprsfi', NOW - 1 * HOUR_MS);
  insertProv.run('providers-up', null, 'aisstream', NOW - 30 * MIN_MS);
}

let server: http.Server | null = null;

beforeEach(() => {
  initStorage(tempDbPath());
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => (server as http.Server).close(() => r()));
    server = null;
  }
  closeStorage();
});

describe('GET /api/analytics/disruptions', () => {
  it('returns alert+closed episodes with durations and live cache header', async () => {
    seedDisruptions();
    server = await listen(buildApp());

    const res = await get(server, '/api/analytics/disruptions?range=7d');
    expect(res.status).toBe(200);
    expect(res.cacheControl).toMatch(/max-age=30/);
    const payload = res.body.data as {
      events: Array<{
        status: string;
        durationMs: number | null;
        reason: string | null;
        parsedTimes: string[];
      }>;
      count: number;
    };
    expect(payload.count).toBeGreaterThanOrEqual(2);
    const statuses = payload.events.map((e) => e.status);
    expect(statuses).toContain('alert');
    expect(statuses).toContain('closed');
    const alertEvt = payload.events.find((e) => e.status === 'alert');
    expect(alertEvt?.reason).toBe('Weather');
    expect(alertEvt?.parsedTimes).toEqual(['11:30', '13:00']);
    expect(alertEvt?.durationMs).toBeGreaterThan(0);
  });

  it('returns count=0 with no disruptions seeded', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/disruptions?range=7d');
    const payload = res.body.data as { count: number; events: unknown[] };
    expect(payload.count).toBe(0);
    expect(payload.events).toEqual([]);
  });
});

describe('GET /api/analytics/data-quality', () => {
  it('returns totals, gaps, and provider transitions with live cache header', async () => {
    seedPositionsForQuality();
    server = await listen(buildApp());

    const res = await get(server, '/api/analytics/data-quality?range=7d');
    expect(res.status).toBe(200);
    expect(res.cacheControl).toMatch(/max-age=30/);
    const payload = res.body.data as {
      totalPositions: number;
      longestGapMs: number | null;
      gapCount: number;
      providerTransitions: Array<{ transition: string; from: string | null; to: string | null }>;
      uptimePct: number | null;
    };
    expect(payload.totalPositions).toBe(40);
    expect(payload.providerTransitions.length).toBe(2);
    const failover = payload.providerTransitions.find((t) => t.transition === 'failover');
    expect(failover?.from).toBe('aisstream');
    expect(failover?.to).toBe('aprsfi');
    // 10-minute gap between minute 30 and minute 40 → gapCount=1, longestGapMs >= 10*60*1000
    expect(payload.gapCount).toBeGreaterThanOrEqual(1);
    expect(payload.longestGapMs).toBeGreaterThanOrEqual(10 * 60 * 1_000);
  });

  it('returns zeroed payload with no data seeded', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/data-quality?range=7d');
    const payload = res.body.data as {
      totalPositions: number;
      gapCount: number;
      longestGapMs: number | null;
      providerTransitions: unknown[];
    };
    expect(payload.totalPositions).toBe(0);
    expect(payload.gapCount).toBe(0);
    expect(payload.longestGapMs).toBeNull();
    expect(payload.providerTransitions).toEqual([]);
  });
});
