# Changelog

All notable changes to this project are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [Unreleased]

## [0.9.0] — 2026-06-02 — Phase 9: Analytics & Polish

### Frontend

- feat(stats): `?view=stats` analytics dashboard page consuming all 10 analytics API endpoints (f93de71)
- feat(realtime): 3 feedback-loop hooks — vessel focus, dock hover, schedule scrub (c94a2eb)
- feat(mobile): 72×72 FAB trigger replaces drawer handle for bottom-sheet on mobile (b1d6ccf)
- feat(vessel): destination inference v1 — schedule matching + bearing alignment + polyline projection + hysteresis (899b493)
- feat(panel): P0/P1 audit gaps closed — `detectedAt` binding, weather `observedAt`/visibility, disruption metadata, provider attribution (b89f124)
- feat(ais): navStatus field plumbed from AIS providers through SSE payload to client VesselCard (c69d7aa)
- fix(weather): derive weather condition from AIS position observations instead of raw ECCC code (8922051)

### Backend

- feat(analytics): 10 read-only analytics API endpoints — fleet, vessels, trips, daily rollups, weather snapshots, schedule deviations, LLM cache stats (91a9e8a)
- feat(llm): Claude Haiku 4.5 vessel-summary and disruption-narrative endpoints with token bucket, in-memory cache, prompt caching, and graceful 503 fallback (4066cd3)
- feat(storage): daily position rollups aggregated per vessel per day; weekly VACUUM job on Sunday 03:00 UTC (97cdffb)
- feat(storage): AIS positions, ferry events, provider failovers, and daily schedule snapshots wired through batched ingest into SQLite (9395073)
- feat(storage): SQLite storage layer — 5-table schema (`positions`, `ferry_events`, `trips`, `weather_snapshots`, `schedule_snapshots`) on 3 GB Fly volume (966db60)

### Testing & Quality

- test(audit): Lighthouse CI, bundle-size, and a11y gates added to CI pipeline (11bed90)
- test(integration): URL audit script and endpoint smoke-test scripts added under `scripts/` (6d7e801)

---

## [0.8.0] — 2026-05-xx — Phase 8: Vessel Intelligence

- Nearest-dock Haversine detection
- Dock context in VesselCard
- NextDeparture map overlay

## [0.7.0] — 2026-05-xx — Phase 7: Mobile Experience

- MobileDrawer bottom-sheet
- Weather ECCC codes fix
- VesselCard SOG/COG/heading display
- WCAG 2.1 AA accessibility pass

## [0.6.0] — 2026-05-xx — Phase 6: Production Hardening

- CI pipeline fixes
- Lighthouse CI integration
- QA smoke test (73/73 tests passing)

## [0.5.0] — 2026-04-xx — Phase 5: Production Deployment

- Fly.io backend deployed
- S3/CloudFront frontend deployed
- GitHub Actions CI/CD wired
- ferries.yyz.live live

## [0.4.0] — 2026-04-xx — Phase 4: Production Readiness

- Terraform infra (S3, CloudFront, ACM, Route53)
- PWA service worker
- Weather integration
- Test suite

## [0.3.0] — 2026-04-xx — Phase 3: Information Panel

- Information panel UI
- Live service status
- Vessel interaction (click-to-focus)

## [0.2.0] — 2026-04-04 — Phase 2: Map Foundation

- MapLibre GL JS v5 + react-map-gl v8 integration
- AIS position hooks
- Dark maritime design system (glassmorphism)

## [0.1.0] — 2026-04-04 — Phase 1: Backend AIS Proxy

- Express 5 + ws backend
- SSE stream relay from aisstream.io
- Fly.io deployment config

## [0.0.1] — 2026-04-04 — Phase 0: Scaffold

- Vite react-ts project scaffolded
- server/ directory structure
- Voltron agent team configured
- .env.example files
