/**
 * Integration tests for GET /api/analytics/summary.
 *
 * Seeds an in-memory storage instance with trips, positions, and a couple of
 * ferry events, then asserts the summary envelope shape, range parsing, and
 * cache headers. Uses raw http.request per CLAUDE.md pitfall list.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  closeStorage,
  getDb,
  initStorage,
} from '../../lib/storage';
import analyticsRouter from '../analytics';

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-analytics-summary-')),
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

function seedSummary(): void {
  const db = getDb();
  const insertTrip = db.prepare(
    `INSERT INTO trips (mmsi, from_dock, to_dock, start_at, end_at, duration_s, distance_m, position_count, inferred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < 20; i++) {
    const startAt = NOW - 3 * DAY_MS + i * 30 * 60 * 1_000;
    insertTrip.run(316045069, 'jack-layton', 'centre-island', startAt, startAt + 500_000, 500, 2000, 50, NOW);
  }
  const insertPos = db.prepare(
    `INSERT INTO ais_positions (mmsi, provider, timestamp, ingested_at, latitude, longitude, sog, cog, heading, nav_status)
     VALUES (?, 'aisstream', ?, ?, 43.64, -79.38, ?, 180, 180, 0)`,
  );
  for (let i = 0; i < 100; i++) {
    const ts = NOW - 2 * DAY_MS + i * 60_000;
    insertPos.run(316045069, ts, ts, 4.0);
  }
}

let server: http.Server | null = null;

beforeEach(() => {
  initStorage(tempDbPath());
  seedSummary();
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => (server as http.Server).close(() => r()));
    server = null;
  }
  closeStorage();
});

describe('GET /api/analytics/summary', () => {
  it('returns 200 with envelope { data, generatedAt, cached }', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/summary');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('generatedAt');
    expect(res.body).toHaveProperty('cached', false);
    expect(typeof res.body.generatedAt).toBe('string');
    expect(Number.isFinite(Date.parse(res.body.generatedAt))).toBe(true);
  });

  it('sets Cache-Control max-age=30 (live data)', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/summary');
    expect(res.cacheControl).toMatch(/max-age=30/);
    expect(res.cacheControl).toMatch(/public/);
  });

  it('includes range metadata and computed summary fields', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/summary?range=7d');
    const payload = res.body.data as {
      range: { key: string; days: number; fromMs: number; toMs: number };
      summary: {
        tripsCount: number;
        medianTripSec: number | null;
        vesselsOnDuty: number;
        totalPositions: number;
        avgSogKn: number | null;
      };
    };
    expect(payload.range.key).toBe('7d');
    expect(payload.range.days).toBe(7);
    expect(payload.summary.tripsCount).toBeGreaterThanOrEqual(20);
    expect(payload.summary.totalPositions).toBeGreaterThanOrEqual(100);
    expect(payload.summary.vesselsOnDuty).toBeGreaterThanOrEqual(1);
  });

  it('falls back to 7d when range is invalid', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/summary?range=garbage');
    const payload = res.body.data as { range: { key: string; days: number } };
    expect(payload.range.key).toBe('7d');
    expect(payload.range.days).toBe(7);
  });

  it('accepts 30d and 90d ranges', async () => {
    server = await listen(buildApp());
    const a = await get(server, '/api/analytics/summary?range=30d');
    const b = await get(server, '/api/analytics/summary?range=90d');
    expect((a.body.data as { range: { days: number } }).range.days).toBe(30);
    expect((b.body.data as { range: { days: number } }).range.days).toBe(90);
  });
});

describe('GET /api/analytics/summary — storage uninitialised', () => {
  it('returns 503 STORAGE_UNAVAILABLE when storage is closed', async () => {
    closeStorage();
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/summary');
    expect(res.status).toBe(503);
    const body = res.body as unknown as { error: string };
    expect(body.error).toBe('STORAGE_UNAVAILABLE');
  });
});
