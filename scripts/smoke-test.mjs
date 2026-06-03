#!/usr/bin/env node
/**
 * scripts/smoke-test.mjs
 *
 * Boots the compiled server on a sandbox port, issues GET/POST requests at the
 * major endpoints, and asserts expected HTTP statuses. Confirms route wiring
 * end-to-end without needing real API keys (LLM endpoints assert 503 since
 * ANTHROPIC_API_KEY is intentionally empty).
 *
 * Exit 0 on full success, 1 on any failed assertion.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');

const PORT = process.env.SMOKE_PORT ?? '4321';
const BASE = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 20_000;
const OVERALL_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Build server (one-shot tsc)
// ---------------------------------------------------------------------------

function runBuild() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'build'], {
      cwd: SERVER_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`server build failed (exit ${code}):\n${stderr}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Spawn server
// ---------------------------------------------------------------------------

function startServer() {
  // Build a clean env object — explicitly DROP ANTHROPIC_API_KEY (rather than
  // setting it to ''), because config.ts treats an empty string as a present
  // value and isLlmEnabled() would return true. We want isLlmEnabled() == false
  // so the smoke test can assert 503 on /api/llm/* without supplying a real key.
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  childEnv.PORT = PORT;
  // AISSTREAM_API_KEY must be NON-empty (config.ts requireEnv throws on empty).
  // The AIS proxy will fail to authenticate, but the routes still respond.
  childEnv.AISSTREAM_API_KEY = 'smoke-test-dummy';
  childEnv.NODE_ENV = 'test';
  // Isolate storage from any dev/prod database.
  childEnv.STORAGE_DB_PATH = ':memory:';

  const proc = spawn('node', ['dist/index.js'], {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  });

  let booted = false;
  const bootPromise = new Promise((resolve) => {
    proc.stdout.on('data', (d) => {
      const txt = d.toString();
      if (!booted && txt.includes(`Server listening on port ${PORT}`)) {
        booted = true;
        resolve();
      }
    });
  });

  // Fallback: poll /api/health.
  const pollPromise = (async () => {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${BASE}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (r.ok) {
          booted = true;
          return;
        }
      } catch {
        /* keep polling */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not become healthy within boot timeout');
  })();

  return { proc, ready: Promise.race([bootPromise, pollPromise]) };
}

async function killServer(proc) {
  if (!proc || proc.killed) return;
  proc.kill('SIGTERM');
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      resolve();
    }, 3000);
    proc.on('close', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const results = [];

async function assertStatus(method, urlPath, expectedSet, options = {}) {
  const url = `${BASE}${urlPath}`;
  const init = {
    method,
    signal: AbortSignal.timeout(8000),
  };
  if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  let status = 0;
  let err = null;
  try {
    const res = await fetch(url, init);
    status = res.status;
    // Drain body to free socket.
    try {
      await res.text();
    } catch {
      /* ignore */
    }
  } catch (e) {
    err = e;
  }
  const expected = Array.isArray(expectedSet) ? expectedSet : [expectedSet];
  const pass = err === null && expected.includes(status);
  results.push({ method, urlPath, expected, status, pass, err });
  if (pass) {
    console.log(`PASS [${method} ${urlPath}] -> ${status}`);
  } else if (err) {
    console.log(`FAIL [${method} ${urlPath}] -> network error: ${err.message ?? err}`);
  } else {
    console.log(
      `FAIL [${method} ${urlPath}] -> expected ${expected.join('|')} got ${status}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[smoke] building server...');
  await runBuild();

  console.log(`[smoke] starting server on port ${PORT}...`);
  const { proc, ready } = startServer();

  const overallTimer = setTimeout(() => {
    console.error('[smoke] OVERALL TIMEOUT — killing server');
    killServer(proc).finally(() => process.exit(1));
  }, OVERALL_TIMEOUT_MS);

  try {
    await ready;
    console.log('[smoke] server ready');

    await assertStatus('GET', '/api/health', 200);
    await assertStatus('GET', '/api/ais/status', 200);
    await assertStatus('GET', '/api/ferry-status', 200);
    await assertStatus('GET', '/api/ferry-busyness', [200, 404]);
    await assertStatus('GET', '/api/analytics/summary', 200);
    await assertStatus('GET', '/api/analytics/trips', 200);
    await assertStatus('POST', '/api/llm/vessel-summary', 503, {
      body: { vesselName: 'Test', status: 'docked' },
    });
    await assertStatus('POST', '/api/llm/disruption-narrative', 503, {
      body: { events: [] },
    });
  } finally {
    clearTimeout(overallTimer);
    await killServer(proc);
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log('');
  console.log(`${results.length} endpoints tested, ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('smoke-test fatal:', err);
  process.exit(1);
});
