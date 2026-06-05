#!/usr/bin/env node
/**
 * Runs the three audit gates for project-hammer:
 *   1. Bundle size      (always — pure Node, no browser)
 *   2. A11y (axe-core)  (always — jsdom via vitest)
 *   3. Lighthouse CI    (skipped if chrome can't launch — runs in CI)
 *   4. Pa11y CI         (skipped if chrome can't launch — runs in CI)
 *
 * Exit code: 0 if all *runnable* gates pass; non-zero if any gate fails.
 * Skipped gates are reported but do not fail the run — they are CI-only.
 *
 * Flags:
 *   --no-skip   Treat skip-due-to-chrome as failure (use in CI).
 *   --verbose   Stream all child output instead of summarizing.
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const NO_SKIP = process.argv.includes('--no-skip');
const VERBOSE = process.argv.includes('--verbose');

function header(name) {
  const bar = '─'.repeat(60);
  console.log(`\n${bar}\n  ${name}\n${bar}`);
}

function run(label, cmd, args, opts = {}) {
  header(label);
  const result = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: VERBOSE ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...opts,
  });
  if (!VERBOSE) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return { status: result.status ?? 1, signal: result.signal };
}

function canLaunchChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 5000 });
        return true;
      } catch { /* fall through */ }
    }
  }
  // Try to load chrome via chrome-launcher if available.
  try {
    const out = execFileSync('node', ['-e', "import('chrome-launcher').then(m=>console.log(m.Launcher.getInstallations().length>0?'1':'0')).catch(()=>console.log('0'))"], { encoding: 'utf8', timeout: 8000 });
    if (out.trim().endsWith('1')) return true;
  } catch { /* ignore */ }
  return false;
}

const gates = [];

// 1. Bundle size — runs always.
{
  const r = run('1/4 · Bundle size', 'node', ['scripts/check-bundle-size.mjs']);
  gates.push({ name: 'bundle', status: r.status, skipped: false });
}

// 2. A11y (axe via vitest) — runs always.
{
  const r = run('2/4 · A11y (axe-core in jsdom)', 'npx', ['--no-install', 'vitest', 'run', 'src/__tests__/a11y.test.tsx', '--reporter=default']);
  gates.push({ name: 'a11y-axe', status: r.status, skipped: false });
}

// 3. Lighthouse CI — runs only if a chrome binary is launchable.
{
  const haveChrome = canLaunchChrome();
  if (!haveChrome && !NO_SKIP) {
    header('3/4 · Lighthouse CI');
    console.log('SKIP: no launchable chrome binary on PATH or via puppeteer cache.');
    console.log('      Lighthouse runs in CI (see .github/workflows/audit.yml).');
    gates.push({ name: 'lighthouse', status: 0, skipped: true });
  } else {
    const r = run('3/4 · Lighthouse CI', 'npx', ['--no-install', 'lhci', 'autorun', '--config=lighthouserc.json']);
    gates.push({ name: 'lighthouse', status: r.status, skipped: false });
  }
}

// 4. Pa11y CI — runs only if chrome is launchable AND the preview server is reachable.
{
  const haveChrome = canLaunchChrome();
  if (!haveChrome && !NO_SKIP) {
    header('4/4 · Pa11y CI');
    console.log('SKIP: no launchable chrome binary on PATH or via puppeteer cache.');
    console.log('      Pa11y runs in CI (see .github/workflows/audit.yml).');
    gates.push({ name: 'pa11y', status: 0, skipped: true });
  } else {
    const r = run('4/4 · Pa11y CI', 'npx', ['--no-install', 'pa11y-ci', '--config', '.pa11yci.json']);
    gates.push({ name: 'pa11y', status: r.status, skipped: false });
  }
}

// Final summary.
header('Audit summary');
let exitCode = 0;
for (const g of gates) {
  if (g.skipped) {
    console.log(`  SKIP ${g.name.padEnd(12)} (CI-only — chrome unavailable locally)`);
  } else if (g.status === 0) {
    console.log(`  PASS ${g.name.padEnd(12)}`);
  } else {
    console.log(`  FAIL ${g.name.padEnd(12)} (exit ${g.status})`);
    exitCode = exitCode || g.status;
  }
}
console.log('');
process.exit(exitCode);
