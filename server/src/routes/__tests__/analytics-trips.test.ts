/**
 * Integration tests for the trip-derived analytics endpoints:
 *   GET /api/analytics/trips
 *   GET /api/analytics/trip-duration
 *   GET /api/analytics/anomalies
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
    fs.mkdtempSync(path.join(os.tmpdir(), 'hammer-analytics-trips-')),
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

function seedTrips(): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO trips (mmsi, from_dock, to_dock, start_at, end_at, duration_s, distance_m, position_count, inferred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // 15 typical Sam McBride jack-layton→centre-island trips, duration ~500s
  for (let i = 0; i < 15; i++) {
    const startAt = NOW - 5 * DAY_MS + i * HOUR_MS;
    insert.run(316045069, 'jack-layton', 'centre-island', startAt, startAt + 500_000, 500, 2200, 60, NOW);
  }
  // 5 typical Wm Inglis jack-layton→wards-island trips, duration ~600s
  for (let i = 0; i < 5; i++) {
    const startAt = NOW - 3 * DAY_MS + i * 2 * HOUR_MS;
    insert.run(316045081, 'jack-layton', 'wards-island', startAt, startAt + 600_000, 600, 2500, 60, NOW);
  }
  // 1 slow outlier (Sam, duration 1500s — well above p90)
  const slowStart = NOW - 1 * DAY_MS;
  insert.run(316045069, 'jack-layton', 'centre-island', slowStart, slowStart + 1_500_000, 1500, 2200, 60, NOW);
}

let server: http.Server | null = null;

beforeEach(() => {
  initStorage(tempDbPath());
  seedTrips();
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => (server as http.Server).close(() => r()));
    server = null;
  }
  closeStorage();
});

describe('GET /api/analytics/trips', () => {
  it('returns time series with day granularity by default and live cache header', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/trips?range=30d');
    expect(res.status).toBe(200);
    expect(res.cacheControl).toMatch(/max-age=30/);
    const payload = res.body.data as {
      granularity: string;
      series: Array<{ bucket: string; count: number }>;
      tripsCount: number;
    };
    expect(payload.granularity).toBe('day');
    expect(payload.tripsCount).toBeGreaterThanOrEqual(20);
    expect(payload.series.length).toBeGreaterThan(0);
    for (const b of payload.series) {
      expect(b.bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof b.count).toBe('number');
    }
  });

  it('switches to hourly granularity with ?granularity=hour', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/trips?range=30d&granularity=hour');
    const payload = res.body.data as { granularity: string; series: Array<{ bucket: string }> };
    expect(payload.granularity).toBe('hour');
    for (const b of payload.series) {
      expect(b.bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    }
  });

  it('filters by mmsi', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/trips?range=30d&mmsi=316045081');
    const payload = res.body.data as { trips: Array<{ mmsi: number }> };
    for (const t of payload.trips) {
      expect(t.mmsi).toBe(316045081);
    }
  });
});

describe('GET /api/analytics/trip-duration', () => {
  it('returns per-route quantiles with rollup cache header', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/trip-duration?range=30d');
    expect(res.status).toBe(200);
    expect(res.cacheControl).toMatch(/max-age=300/);
    const payload = res.body.data as {
      routes: Array<{
        fromDock: string;
        toDock: string;
        p10Sec: number;
        p50Sec: number;
        p90Sec: number;
        sampleSize: number;
      }>;
    };
    expect(payload.routes.length).toBe(2);

    const ci = payload.routes.find((r) => r.toDock === 'centre-island');
    expect(ci?.sampleSize).toBeGreaterThanOrEqual(15);
    expect(ci?.p10Sec).toBeLessThanOrEqual(ci!.p50Sec);
    expect(ci?.p50Sec).toBeLessThanOrEqual(ci!.p90Sec);

    const wi = payload.routes.find((r) => r.toDock === 'wards-island');
    expect(wi?.sampleSize).toBe(5);
    expect(wi?.p50Sec).toBe(600);
  });

  it('filters by route via from_dock + to_dock', async () => {
    server = await listen(buildApp());
    const res = await get(
      server,
      '/api/analytics/trip-duration?range=30d&from_dock=jack-layton&to_dock=wards-island',
    );
    const payload = res.body.data as { routes: Array<{ toDock: string }> };
    expect(payload.routes.length).toBe(1);
    expect(payload.routes[0].toDock).toBe('wards-island');
  });
});

describe('GET /api/analytics/anomalies', () => {
  it('flags the slow Sam McBride trip as an outlier', async () => {
    server = await listen(buildApp());
    const res = await get(server, '/api/analytics/anomalies?range=30d');
    expect(res.status).toBe(200);
    expect(res.cacheControl).toMatch(/max-age=300/);
    const payload = res.body.data as {
      anomalies: Array<{ anomalyType: string; durationSec: number; toDock: string }>;
      count: number;
    };
    expect(payload.count).toBeGreaterThanOrEqual(1);
    const slow = payload.anomalies.find((a) => a.anomalyType === 'slow' && a.durationSec === 1500);
    expect(slow).toBeDefined();
    expect(slow?.toDock).toBe('centre-island');
  });

  it('returns count=0 when there are no qualifying anomalies', async () => {
    server = await listen(buildApp());
    const res = await get(
      server,
      '/api/analytics/anomalies?range=30d&from_dock=jack-layton&to_dock=wards-island',
    );
    const payload = res.body.data as { count: number };
    // Wards-island sample = 5 (below MIN_SAMPLE = 10) — no quantile gate set, so no anomalies.
    expect(payload.count).toBe(0);
  });
});
