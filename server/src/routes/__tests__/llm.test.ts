/**
 * /api/llm/* — endpoint tests.
 *
 * The Anthropic SDK is mocked via vi.mock so these tests:
 *  - never make a real network call
 *  - assert the endpoint shape (status, JSON body)
 *  - exercise the in-memory TTL cache (same input → second call cached)
 *  - exercise the 5/sec token bucket (6th call within a second is 429)
 *  - assert the 503 short-circuit when ANTHROPIC_API_KEY is missing
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK before importing anything that touches it.
// ---------------------------------------------------------------------------

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  // Default export is the Anthropic class. Constructor receives { apiKey }.
  class MockAnthropic {
    messages = { create: createMock };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic };
});

// ---------------------------------------------------------------------------
// Module under test — imported after vi.mock so the real SDK is never loaded.
// Re-require per test so config.anthropicApiKey can be flipped via env.
// ---------------------------------------------------------------------------

async function buildAppWithKey(key: string | null): Promise<express.Express> {
  // config.ts requires AISSTREAM_API_KEY at module load — set a dummy so the
  // re-import doesn't throw. We never make a real AIS connection in tests.
  process.env['AISSTREAM_API_KEY'] = 'test-aisstream';
  if (key === null) {
    delete process.env['ANTHROPIC_API_KEY'];
  } else {
    process.env['ANTHROPIC_API_KEY'] = key;
  }
  // Force re-import of config + route so the new env var is picked up.
  vi.resetModules();

  const llmModule = await import('../llm');
  const llmRouter = llmModule.default;
  llmModule._resetLlmRouteState();

  const app = express();
  app.use(express.json());
  app.use('/api/llm', llmRouter);
  return app;
}

/**
 * Minimal raw-HTTP client — supertest hangs on SSE handlers, and we already
 * use raw http elsewhere in this codebase (see CLAUDE.md → Common Pitfalls).
 */
interface RawResponse {
  status: number;
  body: unknown;
  headers: http.IncomingHttpHeaders;
}

function postJson(
  server: http.Server,
  path: string,
  body: unknown,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const addr = server.address() as AddressInfo;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = raw.length > 0 ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({
            status: res.statusCode ?? 0,
            body: parsed,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function listen(app: express.Express): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/llm/vessel-summary', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('returns 503 { error: "LLM disabled" } when ANTHROPIC_API_KEY is missing', async () => {
    const app = await buildAppWithKey(null);
    const server = await listen(app);
    try {
      const res = await postJson(server, '/api/llm/vessel-summary', {
        vessel: { name: 'Sam McBride', status: 'moving', nearestDock: "Hanlan's Point" },
      });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'LLM disabled' });
      expect(createMock).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('returns { summary } on success and calls Claude exactly once', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Sam McBride heading to Hanlan\'s Point at 6.2 kn.' }],
    });

    const app = await buildAppWithKey('test-key');
    const server = await listen(app);
    try {
      const res = await postJson(server, '/api/llm/vessel-summary', {
        vessel: {
          name: 'Sam McBride',
          status: 'moving',
          nearestDock: "Hanlan's Point",
          sog: 6.2,
        },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        summary: "Sam McBride heading to Hanlan's Point at 6.2 kn.",
      });
      expect(res.headers['x-llm-cache']).toBe('MISS');
      expect(createMock).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it('caches by hashed input — second identical request hits cache, Claude called once', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Cached vessel summary text.' }],
    });

    const app = await buildAppWithKey('test-key');
    const server = await listen(app);
    try {
      const payload = {
        vessel: {
          name: 'Thomas Rennie',
          status: 'docked',
          nearestDock: 'Centre Island',
          sog: 0,
        },
      };
      const first = await postJson(server, '/api/llm/vessel-summary', payload);
      const second = await postJson(server, '/api/llm/vessel-summary', payload);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body).toEqual(second.body);
      expect(first.headers['x-llm-cache']).toBe('MISS');
      expect(second.headers['x-llm-cache']).toBe('HIT');
      expect(createMock).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it('returns 429 when the 5-rps token bucket is empty', async () => {
    // Distinct payloads → cache misses every time → all hit the bucket.
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const app = await buildAppWithKey('test-key');
    const server = await listen(app);
    try {
      const responses = [];
      // 5 distinct requests should all succeed (capacity = 5)
      for (let i = 0; i < 5; i += 1) {
        responses.push(
          await postJson(server, '/api/llm/vessel-summary', {
            vessel: {
              name: `Vessel ${i}`,
              status: 'moving',
              nearestDock: "Hanlan's Point",
            },
          }),
        );
      }
      // 6th should be 429 (bucket empty, no time to refill within the same tick)
      const sixth = await postJson(server, '/api/llm/vessel-summary', {
        vessel: { name: 'Vessel 5', status: 'moving', nearestDock: "Hanlan's Point" },
      });

      for (const r of responses) {
        expect(r.status).toBe(200);
      }
      expect(sixth.status).toBe(429);
      expect(sixth.body).toMatchObject({ error: expect.stringContaining('Rate limited') });
    } finally {
      server.close();
    }
  });

  it('returns 400 when the request body is malformed', async () => {
    const app = await buildAppWithKey('test-key');
    const server = await listen(app);
    try {
      const res = await postJson(server, '/api/llm/vessel-summary', { wrong: 'shape' });
      expect(res.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});

describe('POST /api/llm/disruption-narrative', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('returns { narrative } on success', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Service is suspended due to high winds.' }],
    });

    const app = await buildAppWithKey('test-key');
    const server = await listen(app);
    try {
      const res = await postJson(server, '/api/llm/disruption-narrative', {
        disruption: {
          status: 'closed',
          reason: 'Weather',
          message: 'Service suspended due to high winds.',
          parsedTimes: [],
          postedAt: '2026-06-02T15:00:00Z',
        },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        narrative: 'Service is suspended due to high winds.',
      });
      expect(createMock).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it('caches identical disruption payloads', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Cached narrative.' }],
    });

    const app = await buildAppWithKey('test-key');
    const server = await listen(app);
    try {
      const payload = {
        disruption: {
          status: 'alert',
          reason: 'Mechanical',
          message: 'Boat down for repair.',
          parsedTimes: ['09:00', '11:00'],
          postedAt: null,
        },
      };
      const a = await postJson(server, '/api/llm/disruption-narrative', payload);
      const b = await postJson(server, '/api/llm/disruption-narrative', payload);
      expect(a.body).toEqual(b.body);
      expect(b.headers['x-llm-cache']).toBe('HIT');
      expect(createMock).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it('returns 503 when ANTHROPIC_API_KEY is missing', async () => {
    const app = await buildAppWithKey(null);
    const server = await listen(app);
    try {
      const res = await postJson(server, '/api/llm/disruption-narrative', {
        disruption: { status: 'alert', reason: 'Weather', message: 'x', parsedTimes: [], postedAt: null },
      });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'LLM disabled' });
    } finally {
      server.close();
    }
  });

  it('returns 400 when status is neither "alert" nor "closed"', async () => {
    const app = await buildAppWithKey('test-key');
    const server = await listen(app);
    try {
      const res = await postJson(server, '/api/llm/disruption-narrative', {
        disruption: { status: 'open', reason: null, message: null, parsedTimes: [] },
      });
      expect(res.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});
