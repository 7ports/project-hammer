#!/usr/bin/env node
// Bundle size audit. Walks dist/assets and asserts per-chunk budgets.
// Budgets are tuned for the project's current chunk shape:
//   - Main app chunk (index-*.js)            : 320 KB raw
//   - MapLibre vendor chunk (maplibre-gl-*)  : 1100 KB raw (CLAUDE.md exemption)
//   - StatsPage code-split chunk             : 60 KB raw
//   - Any other chunk                        : 80 KB raw

import { readdirSync, statSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DIST_ASSETS = join(REPO_ROOT, 'dist', 'assets');
const BASELINE_PATH = join(REPO_ROOT, '.audit-baseline-bundle.json');

const BUDGETS = [
  { pattern: /^maplibre-gl-.*\.js$/, label: 'maplibre vendor', raw: 1100 * 1024, gz: 320 * 1024 },
  { pattern: /^StatsPage-.*\.js$/,   label: 'stats page',     raw:   60 * 1024, gz:  20 * 1024 },
  { pattern: /^index-.*\.js$/,       label: 'main app',       raw:  320 * 1024, gz: 100 * 1024 },
  { pattern: /^chunk-.*\.js$/,       label: 'shared chunk',   raw:   80 * 1024, gz:  25 * 1024 },
];

function classify(name) {
  return BUDGETS.find((b) => b.pattern.test(name));
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try { return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch { return null; }
}

function fmt(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}

function main() {
  if (!existsSync(DIST_ASSETS)) {
    console.error('FAIL: dist/assets does not exist. Run `npm run build` first.');
    process.exit(1);
  }

  const files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'));
  const baseline = loadBaseline();
  const baselineByLabel = baseline ? Object.fromEntries(baseline.chunks.map((c) => [c.label, c])) : {};

  const writeBaseline = process.argv.includes('--update-baseline');
  const verbose = process.argv.includes('--verbose');

  const results = [];
  let blockers = 0;
  let warnings = 0;

  for (const file of files) {
    const fullPath = join(DIST_ASSETS, file);
    const raw = statSync(fullPath).size;
    const buf = readFileSync(fullPath);
    const gz = gzipSync(buf).length;
    const br = brotliCompressSync(buf).length;
    const budget = classify(file);
    const label = budget?.label ?? 'unclassified';

    const baselineEntry = baselineByLabel[label];
    const deltaRaw = baselineEntry ? raw - baselineEntry.raw : null;
    const deltaGz  = baselineEntry ? gz  - baselineEntry.gz  : null;

    let status = 'PASS';
    const issues = [];

    if (!budget) {
      issues.push('no budget category matched');
      warnings++;
      status = 'WARN';
    } else {
      if (raw > budget.raw) { issues.push(`raw ${fmt(raw)} > ${fmt(budget.raw)}`); blockers++; status = 'FAIL'; }
      if (gz  > budget.gz ) { issues.push(`gz ${fmt(gz)} > ${fmt(budget.gz)}`);    blockers++; status = 'FAIL'; }
      // Delta gate: main app chunk delta must be ≤ +5KB gzipped vs baseline.
      if (label === 'main app' && deltaGz !== null && deltaGz > 5 * 1024) {
        issues.push(`main chunk gz delta +${fmt(deltaGz)} > +5 KB`);
        blockers++;
        status = 'FAIL';
      }
    }

    results.push({ file, label, raw, gz, br, deltaRaw, deltaGz, status, issues });
  }

  // Pretty report.
  const lines = [];
  lines.push('Bundle Size Audit');
  lines.push('=================');
  for (const r of results) {
    const deltaPart = r.deltaGz !== null
      ? ` (Δgz ${r.deltaGz >= 0 ? '+' : ''}${fmt(r.deltaGz)})`
      : '';
    lines.push(`[${r.status}] ${r.label.padEnd(15)} ${r.file}`);
    lines.push(`        raw ${fmt(r.raw).padStart(9)}   gz ${fmt(r.gz).padStart(8)}   br ${fmt(r.br).padStart(8)}${deltaPart}`);
    for (const issue of r.issues) lines.push(`        • ${issue}`);
  }
  lines.push('');
  lines.push(`Summary: ${results.length} chunks · ${blockers} blocker(s) · ${warnings} warning(s)`);

  if (verbose || baseline) {
    console.log(lines.join('\n'));
  } else {
    console.log(lines.slice(0, 2).concat(
      results.map((r) => `[${r.status}] ${r.label.padEnd(15)} raw ${fmt(r.raw).padStart(9)} gz ${fmt(r.gz).padStart(8)}`),
    ).concat([`Summary: ${results.length} chunks · ${blockers} blocker(s) · ${warnings} warning(s)`]).join('\n'));
  }

  if (writeBaseline) {
    const snapshot = {
      generatedAt: new Date().toISOString(),
      chunks: results.map((r) => ({ label: r.label, file: r.file, raw: r.raw, gz: r.gz, br: r.br })),
    };
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(snapshot, null, 2) + '\n');
    console.log(`\nBaseline updated: ${basename(BASELINE_PATH)}`);
  }

  if (blockers > 0) process.exit(1);
}

main();
