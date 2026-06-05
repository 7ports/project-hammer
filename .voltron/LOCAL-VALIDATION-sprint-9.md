# Sprint 9 — Local Validation Guide

A step-by-step manual walk-through of every Sprint 9 commit on the
`feat/sprint-9-analytics-polish` branch. Run from the project root
(`/workspace`) unless noted otherwise. Sprint 9 baseline commit: `428bc8d`.

This guide assumes you can use a terminal, Chrome DevTools, and `curl`. It
does NOT assume you know the codebase.

---

## Prerequisites

Install dependencies (frontend + backend):

```bash
npm install
cd server && npm install && cd ..
```

Create a working `.env` at the project root with these values:

| Variable | Required? | Purpose |
|---|---|---|
| `AISSTREAM_API_KEY` | Yes (mock OK) | aisstream.io WebSocket key. A placeholder like `dev-test-key` lets the server boot and the SSE endpoint stay open; real ferry positions will NOT stream without a real key. |
| `VITE_MAPTILER_API_KEY` | Yes | MapTiler tile key for the Ocean basemap. Without it the map renders blank. |
| `STORAGE_DB_PATH` | Yes | Path to SQLite DB file, e.g. `./data/hammer.db`. The server creates the file + schema on first run. |
| `PORT` | No | Server listen port. Defaults to 3001. |
| `ANTHROPIC_API_KEY` | No | Enables Claude Haiku LLM summaries. If unset, LLM endpoints return HTTP 503 by design. |
| `VITE_LLM_FEATURES` | No | Set to `true` to enable LLM UI affordances in the React client. |

Example shell export:

```bash
export AISSTREAM_API_KEY=dev-test-key
export VITE_MAPTILER_API_KEY=<your-maptiler-key>
export STORAGE_DB_PATH=./data/hammer.db
# optional
export ANTHROPIC_API_KEY=<your-key>
export VITE_LLM_FEATURES=true
```

Create the storage directory:

```bash
mkdir -p ./data
```

---

## Startup

Open two terminals.

Terminal 1 (backend):

```bash
cd server
npm run dev
```

Expected first-load output includes `listening on :3001`, `storage: opened
sqlite at ./data/hammer.db`, and `sse stream ready`. The aisstream connection
will log `connecting` and may log `auth failed` if you used the mock key —
that is acceptable for this guide.

Terminal 2 (frontend):

```bash
npm run dev
```

Expected: Vite reports `Local: http://localhost:5173/`. Open that URL in
Chrome. You should see the dark maritime map of Toronto Harbour with the four
dock markers and (if you have a real AIS key) animated ferry icons.

---

## 8922051 — fix(weather): derive condition from observations not single ECCC code

**What to test:** Weather strip shows a sensible condition string derived
from multiple observations, not a literal raw ECCC code number.

**Steps**
1. Open http://localhost:5173 in Chrome.
2. Locate the weather strip in the panel (top of the info panel).
3. Note the condition text and inspect the network call to `/api/weather`.

**Expected result:** Condition reads as words (e.g. "Light rain", "Cloudy"),
not a bare integer. The `observedAt` timestamp is present and recent.

**Red flags:** Numeric code shown verbatim, missing condition, or
`observedAt` missing.

---

## b1d6ccf — feat(mobile): replace drawer handle with dedicated 72x72 FAB trigger

**What to test:** The mobile bottom drawer is opened by a circular FAB, not
the old slim handle.

**Steps**
1. Open http://localhost:5173 in Chrome.
2. Open DevTools → toggle device toolbar → select iPhone 12 Pro.
3. Reload. Look at the bottom-right corner.
4. Tap the round FAB button.

**Expected result:** A circular button roughly 72x72 px sits bottom-right.
Tapping it slides the drawer up smoothly. Tapping again (or scrim) closes it.

**Red flags:** Old thin drawer handle still visible, FAB smaller than ~64 px,
no haptic-style press animation, drawer fails to open.

---

## 966db60 — feat(storage): scaffold SQLite storage layer with 5-table schema on Fly volume

**What to test:** SQLite DB file is created on server boot with all 5 tables.

**Steps**
1. Stop and restart `cd server && npm run dev`.
2. From project root, run: `ls -lh ./data/hammer.db`
3. Inspect schema: `sqlite3 ./data/hammer.db ".tables"`

**Expected result:** File exists with non-zero size. `.tables` lists at least
5 tables (positions, events, failovers, schedule snapshots, rollups or
similarly named).

**Red flags:** DB file missing, zero size after 30 s, schema empty, or
`STORAGE_DB_PATH` ignored.

---

## c69d7aa — feat(ais): plumb navStatus from providers through SSE to client

**What to test:** SSE stream events carry a `navStatus` field, surfaced in
the vessel card.

**Steps**
1. In a new terminal: `curl -N http://localhost:3001/api/ais/stream | head -40`
2. Open http://localhost:5173, click any vessel marker.

**Expected result:** Streamed JSON event objects include a `navStatus` key
(e.g. `"under way using engine"`, `"moored"`). Vessel card displays this
status as readable text.

**Red flags:** `navStatus` absent from SSE payload or rendered as raw integer.

---

## 899b493 — feat(vessel): destination inference v1 (schedule + bearing + polyline + hysteresis)

**What to test:** Each moving vessel shows an inferred destination dock that
does not flicker.

**Steps**
1. Open http://localhost:5173 with a real AIS key (otherwise nothing moves).
2. Click an active vessel.
3. Watch the destination field for 60 seconds.

**Expected result:** Destination dock name appears (e.g. "Hanlan's Point").
Does not flap between docks every tick; hysteresis keeps it stable.

**Red flags:** Destination flips on every position update, shows null for
clearly moving vessels, or shows a dock the vessel just left.

---

## b89f124 — feat(panel): close P0/P1 audit gaps (detectedAt, observedAt, visibility, disruption metadata, provider attribution)

**What to test:** Panel widgets display freshness timestamps and provider
attribution.

**Steps**
1. Open http://localhost:5173.
2. Inspect the weather strip — note `observedAt` and visibility fields.
3. Open the disruptions section (if any) — note provider attribution.
4. Vessel card — check for a "detected at" or last-seen timestamp.

**Expected result:** Every data card shows when it was observed plus the
source provider name. Visibility (km) appears in weather strip.

**Red flags:** Timestamps missing, provider attribution missing, visibility
absent.

---

## 9395073 — feat(storage): wire AIS positions, ferry events, provider failovers, and daily schedule snapshots through batched ingest

**What to test:** Rows accumulate in SQLite as the server runs.

**Steps**
1. Let the backend run for 3 minutes.
2. Run: `sqlite3 ./data/hammer.db "SELECT COUNT(*) FROM positions;"`
3. Run the same for events, failovers, schedule snapshots tables.

**Expected result:** Position row count grows (will be 0 with a mock AIS
key — that is OK, but the table must exist and a `SELECT *` against schedule
snapshots should return at least one row).

**Red flags:** Tables missing, write errors in server log, ingestion never
flushes.

---

## 4066cd3 — feat(llm): Claude Haiku-powered vessel summaries and disruption narratives

**What to test:** LLM endpoints respond 200 with `ANTHROPIC_API_KEY` set, and
503 without it.

**Steps**
1. Without `ANTHROPIC_API_KEY`: `curl -i http://localhost:3001/api/llm/vessel-summary?mmsi=316045069`
2. Set `ANTHROPIC_API_KEY=<real key>` and restart server. Repeat.

**Expected result:** First call returns HTTP 503 with a JSON error body
mentioning LLM disabled. Second call returns HTTP 200 with a short summary
string and cache headers.

**Red flags:** 500 instead of 503 when unset, no token-bucket rate limiting
applied, every request hits Anthropic with no cache.

---

## 04688e1 — feat(analytics): infer trips from positions + capture weather snapshots at trip boundaries

**What to test:** A trips table exists and weather snapshots are linked.

**Steps**
1. `sqlite3 ./data/hammer.db ".schema trips"`
2. `sqlite3 ./data/hammer.db "SELECT * FROM trips LIMIT 5;"`

**Expected result:** Schema includes columns like `from_dock`, `to_dock`,
`departed_at`, `arrived_at`, plus a weather snapshot reference. With real AIS
data, rows accumulate.

**Red flags:** Schema missing weather columns, no trips inferred after 30 min
with real positions.

---

## 97cdffb — feat(storage): daily position rollups + weekly VACUUM job

**What to test:** Rollup job runs and a `position_daily` (or similar) table
is created.

**Steps**
1. `sqlite3 ./data/hammer.db ".tables"` — confirm rollup table present.
2. Search backend logs for `rollup` and `vacuum`.

**Expected result:** Rollup job logs a daily cadence; VACUUM job logs weekly
schedule on startup. Table exists.

**Red flags:** No mention of rollup or vacuum in logs, table missing.

---

## 91a9e8a — feat(analytics): expose 10 read-only API endpoints for storage-backed analytics

**What to test:** All 10 endpoints under `/api/analytics/` respond.

**Steps**
1. Curl each endpoint:
```bash
for ep in summary trips trip-duration adherence dwell utilization \
          disruptions data-quality heatmap-dock-presence anomalies; do
  echo "== $ep =="
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/api/analytics/$ep"
done
```

**Expected result:** Every endpoint returns HTTP 200 with JSON. Empty arrays
are acceptable on a fresh DB.

**Red flags:** Any 404, 500, or non-JSON response.

---

## c94a2eb — feat(realtime): add 3 feedback-loop hooks (vessel focus, dock hover, schedule scrub)

**What to test:** User interaction surfaces immediate visual feedback.

**Steps**
1. Open http://localhost:5173.
2. Click a vessel — map should pan and the card should highlight.
3. Hover any dock marker — tooltip / halo appears.
4. Open the schedule view and drag the scrubber — preview updates live.

**Expected result:** All three interactions produce instant feedback (<100
ms) without page reload.

**Red flags:** Click does nothing, hover is silent, scrub requires a reload.

---

## f93de71 — feat(stats): add ?view=stats analytics page consuming /api/analytics/* endpoints

**What to test:** The stats page renders charts from the 10 analytics
endpoints.

**Steps**
1. Open http://localhost:5173/?view=stats in Chrome.
2. Open DevTools → Network → filter `analytics`.

**Expected result:** Page loads with a grid of stat cards / charts. Network
panel shows 10 requests to `/api/analytics/*`, all 200. No console errors.

**Red flags:** Blank page, any 4xx/5xx in network panel, React error
overlay, missing chart sections.

---

## 6d7e801 — test(integration): URL audit + endpoint smoke test scripts

**What to test:** Both scripts exit 0.

**Steps**
1. `npm run url-audit`
2. `npm run smoke`

**Expected result:** Both finish with exit code 0 and a green summary line.

**Red flags:** Any failing URL, any endpoint returning unexpected status,
non-zero exit.

---

## 11bed90 — test(audit): add Lighthouse CI, bundle-size, and a11y gates

**What to test:** The combined audit run passes thresholds.

**Steps**
1. `npm run build`
2. `npm run audit`

**Expected result:** Lighthouse scores meet the project baseline, bundle
budget is green, axe / a11y reports zero new violations.

**Red flags:** Lighthouse performance below baseline, bundle over budget, any
serious or critical a11y violations.

---

## 8a893fd — docs: sprint 9 closeout (CLAUDE.md Active Work, CHANGELOG, ADRs 0001 & 0002, PR body)

**What to test:** Documentation artifacts are present and accurate.

**Steps**
1. `ls docs/adr/ | grep -E '0001|0002'`
2. Read `CHANGELOG.md` head — confirm Sprint 9 entry.
3. Open `CLAUDE.md` — confirm Phase 9 marked complete under Active Work.

**Expected result:** Both ADRs exist, CHANGELOG mentions Sprint 9 features,
CLAUDE.md Active Work lists all 14 commits.

**Red flags:** Missing ADRs, stale CHANGELOG, CLAUDE.md still says Phase 9 in
progress.

---

## Cross-cutting checks

Run from the project root.

```bash
# Quality gates
npm run typecheck && npm test && npm run build

# Integration scripts
npm run url-audit && npm run smoke

# Full audit (Lighthouse + bundle + a11y)
npm run audit

# SQLite durability — let server run 5 min, then:
ls -lh ./data/hammer.db
```

The DB file size must be > 0 and visibly larger than the post-boot size after
five minutes of server uptime with a real AIS key.

---

## Deployment readiness checklist

- [ ] All 16 feature sections pass
- [ ] No console errors in browser DevTools
- [ ] No untracked changes in `git status` other than test artifacts I created
- [ ] LLM endpoint shape verified (200 with summary if `ANTHROPIC_API_KEY` set, 503 if not)
- [ ] SQLite DB at ./data/hammer.db has grown beyond 0 bytes
- [ ] `npm run audit` Lighthouse scores meet project baseline
- [ ] Bundle size within budget
- [ ] Accessibility audit zero new violations
