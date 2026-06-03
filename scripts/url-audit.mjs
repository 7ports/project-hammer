#!/usr/bin/env node
/**
 * scripts/url-audit.mjs
 *
 * Cross-references frontend `/api/...` URLs (from fetch / EventSource /
 * useAnalytics call sites under src/) against backend Express routes mounted
 * in server/src/index.ts and defined in server/src/routes/*.ts.
 *
 * Exit 0 if every frontend URL has a matching server route.
 * Exit 1 if at least one URL is unmatched.
 *
 * Plain Node ESM — no deps, no transpile.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const SRC_DIR = path.join(ROOT, 'src');
const SERVER_INDEX = path.join(ROOT, 'server', 'src', 'index.ts');
const SERVER_ROUTES_DIR = path.join(ROOT, 'server', 'src', 'routes');

// ---------------------------------------------------------------------------
// Walk helpers
// ---------------------------------------------------------------------------

async function walk(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...(await walk(full, exts)));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function lineNumber(content, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Frontend URL extraction
// ---------------------------------------------------------------------------

// Inferred method from call-site context. fetch() defaults to GET unless a
// `method:` option appears nearby. EventSource is always GET.
function inferMethod(content, idx, callKind) {
  if (callKind === 'eventsource') return 'GET';
  if (callKind === 'useAnalytics') return 'GET';
  // Look in a window after the call site for `method: 'POST'` etc.
  const window = content.slice(idx, idx + 400);
  const m = window.match(/method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/i);
  if (m) return m[1].toUpperCase();
  return 'GET';
}

// Strip ${config.apiUrl} or ${API_BASE} or similar prefix expressions if present
// in template literals — we only want the path starting at /api/.
function extractApiPath(raw) {
  // raw might be like `${config.apiUrl}/api/weather` or `/api/weather`
  const m = raw.match(/\/api\/[^`'"\s)?]+/);
  return m ? m[0] : null;
}

async function collectFrontendUrls() {
  const files = await walk(SRC_DIR, ['.ts', '.tsx']);
  const results = []; // {method, urlPath, file, line}
  const seen = new Set();

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');

    // Pattern 1: fetch(`...`) or fetch('...') or fetch("...")
    const fetchRe = /fetch\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
    let m;
    while ((m = fetchRe.exec(content)) !== null) {
      const raw = m[1].slice(1, -1);
      const apiPath = extractApiPath(raw);
      if (!apiPath) continue;
      const method = inferMethod(content, m.index, 'fetch');
      const key = `${method}::${apiPath}::${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ method, urlPath: apiPath, file, line: lineNumber(content, m.index) });
    }

    // Pattern 2: new EventSource(`...`) or new EventSource(varExpr)
    const esRe = /new\s+EventSource\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
    while ((m = esRe.exec(content)) !== null) {
      const raw = m[1].slice(1, -1);
      const apiPath = extractApiPath(raw);
      if (!apiPath) continue;
      const key = `GET::${apiPath}::${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ method: 'GET', urlPath: apiPath, file, line: lineNumber(content, m.index) });
    }

    // Pattern 2b: EventSource via a `const url = `...`; new EventSource(url)`
    // — already handled by pattern 1's loose fetch sweep? No — handle template
    // literal url= assignments that contain /api/ and feed EventSource.
    const urlAssignRe = /const\s+url\s*=\s*(`[^`]*`)/g;
    while ((m = urlAssignRe.exec(content)) !== null) {
      const raw = m[1].slice(1, -1);
      const apiPath = extractApiPath(raw);
      if (!apiPath) continue;
      // Only count if there's a `new EventSource(url)` nearby.
      const after = content.slice(m.index, m.index + 400);
      if (!/new\s+EventSource\s*\(\s*url\b/.test(after)) continue;
      const key = `GET::${apiPath}::${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ method: 'GET', urlPath: apiPath, file, line: lineNumber(content, m.index) });
    }

    // Pattern 3: useAnalytics<...>('/api/...')  (multi-line tolerant)
    const analyticsRe = /useAnalytics\s*<[^>]+>\s*\(\s*['"]([^'"]+)['"]/g;
    while ((m = analyticsRe.exec(content)) !== null) {
      const apiPath = extractApiPath(m[1]) ?? m[1];
      if (!apiPath.startsWith('/api/')) continue;
      const key = `GET::${apiPath}::${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ method: 'GET', urlPath: apiPath, file, line: lineNumber(content, m.index) });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Server route extraction
// ---------------------------------------------------------------------------

// Map of routerVarName -> source file path it was imported from.
async function parseRouterImports() {
  const content = await fs.readFile(SERVER_INDEX, 'utf8');
  const out = new Map();
  // Matches both `import xRouter from './routes/x'` and `import { xRouter } from './routes/x'`.
  const importRe = /import\s+(?:(\w+)|\{\s*([^}]+)\s*\})\s+from\s+['"](\.\/routes\/[^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    const relPath = m[3];
    const resolved = path.resolve(path.dirname(SERVER_INDEX), `${relPath}.ts`);
    if (m[1]) {
      out.set(m[1], resolved);
    } else if (m[2]) {
      for (const name of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
        // Handle `xRouter as yRouter` aliasing — take the alias if present.
        const alias = name.split(/\s+as\s+/)[1] ?? name;
        out.set(alias, resolved);
      }
    }
  }
  return out;
}

// Parse `app.use('/api/x', xRouter)` -> {prefix, routerVar}
async function parseMounts() {
  const content = await fs.readFile(SERVER_INDEX, 'utf8');
  const out = [];
  const re = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    out.push({ prefix: m[1], routerVar: m[2] });
  }
  return out;
}

// Parse `(router|xRouter).get/post/...('/sub', ...)` from a route file.
async function parseSubroutes(filePath) {
  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  const re = /(?:^|\W)(?:router|\w*Router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    out.push({ method: m[1].toUpperCase(), subpath: m[2] });
  }
  return out;
}

async function collectServerRoutes() {
  const [imports, mounts] = await Promise.all([parseRouterImports(), parseMounts()]);
  const routes = []; // {method, fullPath, mountPrefix, subpath}

  for (const mount of mounts) {
    const sourceFile = imports.get(mount.routerVar);
    if (!sourceFile) continue;
    const subs = await parseSubroutes(sourceFile);
    for (const sub of subs) {
      const fullPath = mount.prefix.replace(/\/$/, '') + sub.subpath;
      routes.push({
        method: sub.method,
        fullPath,
        mountPrefix: mount.prefix,
        subpath: sub.subpath,
      });
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function normalizePath(p) {
  // Strip trailing slash unless the path is just "/".
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p;
}

function pathMatches(frontendPath, serverFullPath) {
  const fp = normalizePath(frontendPath);
  const sp = normalizePath(serverFullPath);
  // Exact match
  if (fp === sp) return true;
  // Express :param substitution — turn `/api/foo/:id` into a regex.
  if (sp.includes(':')) {
    const re = new RegExp(
      '^' + sp.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/') + '$',
    );
    return re.test(fp);
  }
  return false;
}

function findMatch(frontendUrl, serverRoutes) {
  // Strip querystring for matching purposes.
  const cleanPath = frontendUrl.urlPath.split('?')[0];
  for (const route of serverRoutes) {
    if (route.method !== frontendUrl.method) continue;
    if (pathMatches(cleanPath, route.fullPath)) return route;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
  const [frontendUrls, serverRoutes] = await Promise.all([
    collectFrontendUrls(),
    collectServerRoutes(),
  ]);

  // Sort for stable output.
  frontendUrls.sort((a, b) => (a.urlPath + a.method).localeCompare(b.urlPath + b.method));

  const rows = [];
  let matched = 0;
  let missed = 0;

  for (const url of frontendUrls) {
    const match = findMatch(url, serverRoutes);
    if (match) {
      matched++;
      rows.push({
        method: url.method,
        url: url.urlPath,
        match: match.fullPath,
        status: 'OK',
      });
    } else {
      missed++;
      rows.push({
        method: url.method,
        url: url.urlPath,
        match: '(none)',
        status: 'MISS',
      });
    }
  }

  // Print table.
  const widths = {
    method: 8,
    url: Math.max(12, ...rows.map((r) => r.url.length)) + 2,
    match: Math.max(12, ...rows.map((r) => r.match.length)) + 2,
    status: 6,
  };
  console.log(
    pad('METHOD', widths.method) +
      pad('FRONTEND URL', widths.url) +
      pad('SERVER MATCH', widths.match) +
      pad('STATUS', widths.status),
  );
  console.log('-'.repeat(widths.method + widths.url + widths.match + widths.status));
  for (const r of rows) {
    console.log(
      pad(r.method, widths.method) +
        pad(r.url, widths.url) +
        pad(r.match, widths.match) +
        pad(r.status, widths.status),
    );
  }

  console.log('');
  console.log(`${frontendUrls.length} URLs checked, ${matched} matches, ${missed} mismatches`);

  if (missed > 0) {
    console.log('');
    console.log('Server routes discovered:');
    for (const r of serverRoutes) {
      console.log(`  ${r.method} ${r.fullPath}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('url-audit failed:', err);
  process.exit(2);
});
