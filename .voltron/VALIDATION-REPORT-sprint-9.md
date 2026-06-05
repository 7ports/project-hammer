# Sprint 9 Validation Report

Run by qa-tester in `/workspace` on 2026-06-05 against commit `480ed51bf6a86ad2466e4a3c3eb9b82c25920b1c` (branch: `master`).

Source guide: `.voltron/LOCAL-VALIDATION-sprint-9.md`. Dependencies already installed in `node_modules/` and `server/node_modules/`; `npm ci` skipped to save wall-clock — re-run if results are suspect.

## Automated gates summary

| Gate | Pass? | Notes |
|------|-------|-------|
| typecheck (root) | PASS | `tsc -b --noEmit` exit 0 |
| typecheck (server) | PASS | `tsc --noEmit` exit 0 |
| lint | PASS | `eslint .` exit 0, no warnings |
| tests (root) | FAIL | 149/151 passed; 2 failed in `src/__tests__/a11y.test.tsx` |
| tests (server) | PASS | 160/160 passed across 16 test files |
| build (root) | PASS | main `index-*.js` raw 282.10 KB / gz 87.13 KB; maplibre vendor chunk raw 1025.64 KB / gz 272.15 KB; CSS raw 107.94 KB / gz 17.25 KB; StatsPage chunk raw 17.60 KB / gz 3.86 KB |
| build (server) | PASS | `tsc` exit 0 |
| url-audit | PASS | 14 URLs checked, 14 matches, 0 mismatches |
| smoke | PASS | 8 endpoints tested, 8 passed, 0 failed (health, ais/status, ferry-status, ferry-busyness, analytics/summary, analytics/trips, llm/vessel-summary→503, llm/disruption-narrative→503) |
| audit (Lighthouse) | SKIP | No launchable Chrome binary in sandbox — CI-only per `.github/workflows/audit.yml` |
| audit (bundle delta) | PASS | 4 chunks reported, 0 blockers, 0 warnings |
| audit (a11y) | FAIL | 1/5 axe tests failed in audit run; the broader root test run surfaces both regressions |
| audit (pa11y) | SKIP | No launchable Chrome binary in sandbox — CI-only |

### Failure details

**Failure 1 — `src/__tests__/a11y.test.tsx > a11y — PanelShell mobile bottom-sheet > expanded dialog has role=dialog, aria-modal, accessible name, no axe violations`**
Originates at `src/hooks/useServiceStatus.ts:90` during commitPassiveMount. Likely network/fetch effect throwing during test render. The hook is on the pre-existing-dirty list (it was modified outside Sprint 9), so this failure may be uncovered tech-debt rather than a Sprint 9 regression.

**Failure 2 — `src/__tests__/a11y.test.tsx > a11y — StatsPage > has h1, range selector, back button, and no axe violations on initial render`**
`TypeError: Cannot read properties of undefined (reading 'length')` at `src/components/Stats/VesselActivity.tsx:41:20` (`data.vessels.length`). The component assumes `data.vessels` is defined but the fixture/mock returns a payload without that field. Direct Sprint 9 regression introduced by f93de71 (`?view=stats` analytics page).

Note: the audit-only invocation of the a11y suite shows the StatsPage test passing with an unhandled error (axe doesn't fail the assertion, the unhandled exception fails the test file), while the broader `npm test` run captures both failures. Either way both gates are red.

## Per-feature spot checks

| Check | Result |
|-------|--------|
| `src/lib/destinationInference.ts` exists | YES, 54 occurrences of schedule/polyline/bearing/hysteresis terms |
| `navStatus` plumbed through server lib (`aisstreamProvider`, `aprsfiProvider`, `vesselApiProvider`, `storage/ingest`) | YES |
| `server/src/lib/storage/schema.ts` exists with ≥5 `CREATE TABLE` | YES, 8 tables |
| ADRs 0001 (sqlite-only-storage) + 0002 (llm-claude-haiku-scope) present in `docs/adr/` | YES |
| `CHANGELOG.md` mentions Sprint 9 / Phase 9 / 2026-06 | YES, line 11: `## [0.9.0] — 2026-06-02 — Phase 9: Analytics & Polish` |
| FAB mobile trigger present (`SheetTrigger.css`, AppShell.tsx) | YES |
| Panel polish files (PanelShell, WeatherStrip) present | YES |
| LLM library scaffold (`server/src/lib/llm/`: cache, client, prompts, tokenBucket, vesselSummary, disruptionNarrative) | YES |
| 3 realtime hooks (`useVesselFocus`, `useDockHover`, `useScheduleScrub`) with tests | YES |
| Analytics route file (`server/src/routes/analytics.ts`) + LLM route (`server/src/routes/llm.ts`) | YES |
| StatsPage component (`src/pages/StatsPage.tsx`) | YES |

## What I CANNOT validate (user must verify in browser/manually)

- Mobile FAB visual (load /, resize to mobile, tap FAB, panel opens, FAB regains focus on close, ESC closes)
- Panel polish UI (load /, click a vessel, see detectedAt, observedAt, visibility, disruption metadata, provider attribution rendered)
- Destination inference debug overlay (load /?debug=1, see confidence + reasons appear on selected vessel)
- `?view=stats` analytics page (load /?view=stats in Chrome, see widgets render with data — note widget likely crashes today per Failure 2)
- 3 realtime hooks live behaviour (tap a vessel — focus follows; hover a dock — vessels highlight; scrub schedule — gap visualization)
- LLM endpoints with real key (if `ANTHROPIC_API_KEY` set, POST /api/llm/vessel-summary returns prose; if absent returns 503 — smoke gate already confirms the 503 path)
- SQLite ingest (run backend for 5 min with real AIS data, check `./data/hammer.db` grows past initial schema size)
- Lighthouse perf/a11y/best/PWA scores (re-run `npm run audit` in CI where Chrome is present, or run locally on a machine with Chrome installed)
- Pa11y violations (same Chrome dependency)

## Deployment readiness verdict

**FAIL.**

Two automated gates are red:

1. **a11y test for StatsPage** — `VesselActivity` reads `data.vessels.length` without guarding for an undefined `vessels` field. This is a Sprint 9 regression (`f93de71`). Smallest fix: add a defensive `data?.vessels?.length ?? 0` (or fix the loading-state branch above line 41) in `src/components/Stats/VesselActivity.tsx`. Re-run `npm test`.
2. **a11y test for PanelShell mobile bottom-sheet** — `useServiceStatus.ts:90` throws during the test's passive-effect commit. The hook is on the pre-existing-dirty file list, so this may be a pre-Sprint-9 regression now caught by the new a11y assertions. Verify by running `git stash --keep-index -- src/hooks/useServiceStatus.ts` and re-running just this test; if it then passes, the fault is in the uncommitted edit, not Sprint 9 code.

Lighthouse + Pa11y are SKIP not FAIL — they require Chrome which is not on PATH in this sandbox. The CI workflow at `.github/workflows/audit.yml` is the appropriate place to enforce those gates.

Once both a11y failures are fixed and `npm test` is green, this branch is ready to ship.
