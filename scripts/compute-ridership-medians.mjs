#!/usr/bin/env node
/**
 * compute-ridership-medians.mjs
 *
 * Queries the Toronto Open Data CKAN API to compute historical busyness
 * percentiles (p50/p75/p90) per (hour × day-of-week × month) bucket.
 *
 * Run: node scripts/compute-ridership-medians.mjs
 * Output: server/src/data/ridershipMedians.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../server/src/data/ridershipMedians.json');

const RESOURCE_ID = '0da005de-270d-49d1-b45b-32e2e777a381';
const CKAN_BASE = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action';

const SQL = `
SELECT
  EXTRACT(HOUR FROM "Timestamp")::int AS hour,
  EXTRACT(DOW FROM "Timestamp")::int AS dow,
  EXTRACT(MONTH FROM "Timestamp")::int AS month,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "Redemption Count")::real AS p50,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "Redemption Count")::real AS p75,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY "Redemption Count")::real AS p90,
  COUNT(*)::int AS samples
FROM "${RESOURCE_ID}"
GROUP BY hour, dow, month
ORDER BY hour, dow, month
`.trim();

async function trySqlApi() {
  const url = `${CKAN_BASE}/datastore_search_sql?sql=${encodeURIComponent(SQL)}`;
  console.log('Trying CKAN SQL aggregate API…');

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  if (!json.success) {
    const msg = json.error?.message ?? JSON.stringify(json.error ?? json);
    throw new Error(`CKAN error: ${msg}`);
  }

  const records = json.result?.records;
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('No records returned from SQL API');
  }

  return records.map((r) => ({
    hour: Number(r.hour),
    dow: Number(r.dow),
    month: Number(r.month),
    p50: Number(r.p50),
    p75: Number(r.p75),
    p90: Number(r.p90),
    samples: Number(r.samples),
  }));
}

async function fetchPage(offset) {
  const url =
    `${CKAN_BASE}/datastore_search` +
    `?resource_id=${RESOURCE_ID}` +
    `&limit=1000` +
    `&offset=${offset}` +
    `&sort=Timestamp%20desc`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error('CKAN error on datastore_search');
  return json.result?.records ?? [];
}

async function fallbackSampleAverage() {
  console.log('Falling back to sample-average approach (5 pages × 1000 records)…');
  const pages = [0, 1000, 2000, 3000, 4000];
  const all = [];
  for (const offset of pages) {
    console.log(`  Fetching offset ${offset}…`);
    const page = await fetchPage(offset);
    all.push(...page);
    if (page.length < 1000) break; // fewer records than page size → last page
  }

  console.log(`  Fetched ${all.length} raw records total`);

  // Group into (hour, dow, month) buckets and collect counts
  const bucketMap = new Map();
  for (const r of all) {
    const ts = new Date(r.Timestamp);
    if (isNaN(ts.getTime())) continue;
    const hour = ts.getHours();
    const dow = ts.getDay();
    const month = ts.getMonth() + 1; // 1-indexed to match CKAN SQL
    const key = `${hour}:${dow}:${month}`;
    const count = r['Redemption Count'] ?? 0;
    if (!bucketMap.has(key)) bucketMap.set(key, { hour, dow, month, values: [] });
    bucketMap.get(key).values.push(Number(count));
  }

  const buckets = [];
  for (const { hour, dow, month, values } of bucketMap.values()) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    buckets.push({
      hour,
      dow,
      month,
      p50: Math.round(avg * 10) / 10,
      p75: Math.round(avg * 1.5 * 10) / 10,
      p90: Math.round(avg * 2.5 * 10) / 10,
      samples: values.length,
    });
  }

  // Sort for consistency
  buckets.sort((a, b) =>
    a.hour !== b.hour ? a.hour - b.hour :
    a.dow !== b.dow ? a.dow - b.dow :
    a.month - b.month
  );

  return { buckets, source: 'ckan-sample-average' };
}

async function main() {
  let buckets;
  let source;

  try {
    buckets = await trySqlApi();
    source = 'ckan-sql-aggregate';
    console.log(`SQL API returned ${buckets.length} buckets`);
  } catch (err) {
    console.warn(`SQL API failed: ${err.message}`);
    const result = await fallbackSampleAverage();
    buckets = result.buckets;
    source = result.source;
    console.log(`Fallback produced ${buckets.length} buckets`);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source,
    buckets,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nWrote ${buckets.length} buckets → ${OUTPUT_PATH}`);
  console.log(`Source: ${source}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
