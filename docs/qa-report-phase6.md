# QA Report — Phase 6 Production Validation
**Date:** 2026-04-06
**Environment:** Production (https://ferries.yyz.live)
**Branch:** phase-6/production-hardening

---

## Unit Tests

| Check | Result |
|---|---|
| Tests | **73/73 passed** (3 test files) |
| Typecheck (`tsc -b --noEmit`) | **PASS** — 0 errors |
| Lint (`eslint .`) | **PASS** — 0 errors, 0 warnings |

> Note: Initial `npm test` failed with `Cannot find module '@rolldown/binding-linux-x64-gnu'` — a known npm optional-dependency native binding issue in containerized environments. Fixed with `npm install --legacy-peer-deps` (vite-plugin-pwa requires this flag per CLAUDE.md). All tests passed after reinstall.

---

## Production Endpoint Smoke Tests

| Endpoint | Expected | Actual | Status |
|---|---|---|---|
| `GET /api/health` | `200 {"status":"ok", ...}` | `200` · `{"status":"ok","uptime":1974.6,"timestamp":"2026-04-06T02:44:14.264Z"}` | ✅ |
| `GET /api/ais` (SSE) | `200 text/event-stream` with `data:` lines | `200 text/event-stream` · live vessel positions for Marilyn Bell I and MV Sam McBride received immediately | ✅ |
| `GET /api/weather` | `200` JSON with temp/wind/condition fields | `200` · `temperatureCelsius:1`, `windSpeedKmh:22.3`, `condition:"Unknown"` | ✅ ⚠️ |
| `GET /` (frontend) | `200 text/html` | `200 text/html` | ✅ |
| `GET /sw.js` | `200 application/javascript` | `200 text/javascript` | ✅ |

### Sample AIS data received:
```json
{"mmsi":316050853,"name":"MARILYN BELL I","latitude":43.63317,"longitude":-79.39433,"heading":0,"speed":0.1,"timestamp":"2026-04-06T02:42:39.020Z"}
{"mmsi":316045069,"name":"MV SAM MCBRIDE","latitude":43.63255,"longitude":-79.36322,"heading":110,"speed":8.1,"timestamp":"2026-04-06T02:42:44.000Z"}
```

---

## Bundle Size Audit

| File | Raw Size | Gzipped |
|---|---|---|
| `dist/assets/maplibre-gl-*.js` | 1,025.64 kB | **272.15 kB** |
| `dist/assets/index-*.js` | 235.99 kB | 74.56 kB |
| `dist/assets/index-*.css` | 87.31 kB | 13.68 kB |
| `dist/workbox-*.js` | 22.60 kB | ~8 kB (est.) |
| `dist/sw.js` | 1.95 kB | ~1 kB (est.) |
| `dist/registerSW.js` | 0.13 kB | <1 kB |
| `dist/index.html` | 1.30 kB | 0.61 kB |
| `dist/manifest.webmanifest` | 0.50 kB | <1 kB |
| **Total app JS (gzip)** | | **~361 kB** |

> The `maplibre-gl` chunk (272 kB gzip) exceeds the 1000 kB raw build warning threshold but is **expected and unavoidable** for a map-based PWA — per QA standards, this is not a budget violation. The application JS bundle (`index.js`, 74.56 kB gzip) is well within budget.

---

## Issues Found

### Warnings (non-blocking)

1. **`/api/weather` → `condition: "Unknown"`**
   - `presentWeatherCode: "300"` is not mapped to a human-readable string.
   - The endpoint returns all required fields (`temperatureCelsius`, `windSpeedKmh`, `condition`) so the smoke test passes, but `condition` will render as "Unknown" in the UI for weather code 300 (drizzle).
   - **Recommendation:** Extend the weather condition code map in `server/src/routes/weather.ts` to cover ECCC code ranges 300–399.

2. **`npm install --legacy-peer-deps` required in container**
   - `vite-plugin-pwa@1.2.0` has a peer dep constraint of `vite ^3-7` but the project uses `vite@8`. This is a known issue (noted in CLAUDE.md).
   - No action needed — already documented. CI must use `--legacy-peer-deps`.

3. **Weather `observedAt` timestamp is stale**
   - Response shows `"observedAt":"2026-03-07T00:00:00.000Z"` — approximately one month old.
   - This may indicate the weather data source (Environment Canada) is returning a cached/stale observation rather than a current one. Worth monitoring.

### Blockers
None.

---

## Verdict

**PASS** — Production is healthy. All 73 unit tests pass, typecheck and lint are clean, all 5 production endpoints return expected responses, and the bundle size is within acceptable parameters. Three non-blocking warnings noted above.
