# CLAUDE.md — Toronto Island Ferry Tracker v2

> This file is automatically loaded by Claude Code at session start.
> Keep it up to date as your project evolves. Agents read this before acting.

---

## Project Identity

**Project Name:** Toronto Island Ferry Tracker v2 (project-hammer)
**Type:** Full-stack (React SPA + Node.js API)
**Tech Stack:** React 18 + TypeScript, Vite, MapLibre GL JS v5, react-map-gl v8 (frontend) · Node.js 20 + TypeScript, Express 5, ws (backend)
**Node Version:** 20 LTS
**Package Manager:** npm
**Status:** Prototype

**What it does:** Real-time map showing Toronto Island Ferry positions. AIS positions from aisstream.io are proxied via a Fly.io backend and streamed to a React PWA over SSE. The frontend renders ferries gliding across the harbour on a MapTiler Ocean map.

---

## Repository Layout

```
src/
  components/
    Map/          <- FerryMap, VesselLayer, RouteLayer, DockMarkers, WakeTrail
    Panel/        <- VesselCard, ScheduleView, WeatherStrip, TicketCard
    Layout/       <- AppShell, MobileDrawer
    UI/           <- StatusDot, LoadingOverlay, ConnectionIndicator
  hooks/          <- useAISStream, useVesselPositions, useAnimationFrame, etc.
  lib/            <- interpolation, ferryRoutes, schedule, constants
  types/          <- ais.ts, vessel.ts, schedule.ts
  service-worker.ts
server/
  src/
    routes/       <- ais.ts, weather.ts, health.ts (Express route handlers)
    lib/          <- aisProxy.ts, constants.ts (business logic)
    index.ts      <- Express server entry point
  package.json, tsconfig.json, Dockerfile, fly.toml
infra/            <- Terraform modules (S3, CloudFront, ACM, Route53)
public/           <- schedule.json, manifest.json, icons/
scripts/          <- scrape-schedule.ts
.github/workflows/ <- deploy-frontend.yml, deploy-backend.yml
```

---

## Tech Stack Details

### Frontend
| Package | Version | Notes |
|---|---|---|
| React | 18 | |
| TypeScript | 5.x | strict mode |
| Vite | 5.x | |
| react-map-gl | 8.x | MapLibre adapter |
| maplibre-gl | 5.x | Open source maps |
| vite-plugin-pwa | latest | PWA + service worker |

### Backend
| Package | Version | Notes |
|---|---|---|
| Node.js | 20 LTS | |
| Express | 5.x | |
| ws | 8.x | WebSocket to aisstream.io |
| cors | 2.x | |

### Infrastructure
- **Frontend hosting:** AWS S3 + CloudFront (ca-central-1 for S3, global CF distribution)
- **Backend hosting:** Fly.io (region: yyz — Toronto)
- **IaC:** Terraform
- **CI/CD:** GitHub Actions

---

## Environment Variables

| Variable | Where | Secret? | Description |
|---|---|---|---|
| `AISSTREAM_API_KEY` | `.env` / Fly.io secret | Yes | aisstream.io API key (server-side only, never sent to browser) |
| `VITE_MAPTILER_API_KEY` | `.env` / GitHub secret | Yes | MapTiler map tile API key (embedded in frontend bundle) |
| `VITE_API_URL` | `.env` / GitHub secret | No | Backend base URL (`http://localhost:3001` dev, Fly.io URL prod) |
| `PORT` | Fly.io env | No | Server listen port (default 3001) |

**Rule:** Never commit `.env`. Always use `.env.example` with placeholders.

---

## Key Architecture Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-04-04 | SSE over WebSocket for client relay | AIS data is one-directional; EventSource auto-reconnects, no library needed, HTTP/2 compatible |
| 2026-04-04 | Fly.io over AWS Lambda for backend | Lambda doesn't support SSE natively; API Gateway WebSocket requires DynamoDB connection management; Fly.io is simpler at $2-5/mo |
| 2026-04-04 | Backend AIS proxy required | aisstream.io blocks direct browser WebSocket connections (no CORS headers on their end) |
| 2026-04-04 | ca-central-1 for AWS S3 | Toronto users, Canadian data residency; CloudFront caches globally so S3 region only affects cache misses |
| 2026-04-04 | MapLibre GL JS v5 + react-map-gl v8 | Open source, no proprietary token required, Ocean style from MapTiler |
| 2026-04-04 | lerp() + requestAnimationFrame for vessel movement | 60fps smooth GeoJSON interpolation instead of jerky GPS ping jumps (~10s intervals) |

---

## Ferry Vessel MMSIs

| Vessel | MMSI |
|---|---|
| Sam McBride | 316045069 |
| Wm Inglis | 316045081 |
| Thomas Rennie | 316045082 |
| Marilyn Bell I | 316050853 |

These are the ONLY values to filter on in the AIS proxy. Hardcode them only in `server/src/lib/constants.ts` and `src/lib/constants.ts`.

---

## Ferry Ticket Fares

Adult: $9.11 · Senior/Student: $5.86 · Child: $4.29 · Under 2: Free
Valid through Dec 31 of purchase year. Buy via `window.open()` to `secure.toronto.ca` (no public API, no iframe).

---

## Verification Commands

```bash
# Frontend (run from project root)
npm run typecheck       # npx tsc --noEmit
npm run lint            # ESLint
npm run dev             # Vite dev server on :5173
npm run build           # Production build → dist/

# Backend (run from server/)
npm run typecheck       # tsc --noEmit
npm run dev             # tsx watch → :3001
npm run build           # tsc → dist/
npm start               # node dist/index.js
```

---

## Active Work

**Current sprint goal:** Phase 1 — Backend Proxy (critical path — nothing works without this)

**In progress:**
- [ ] —

**Recently completed:**
- [x] Phase 0: Project scaffolded (Vite react-ts, server/ structure, Voltron agents, env files)

**Known issues / tech debt:**
- (none yet)

---

## Agent Team Roles

| Agent | File | Purpose |
|---|---|---|
| `scrum-master` | `scrum-master.md` | Work breakdown, task assignment, sprint coordination |
| `fullstack-dev` | `fullstack-dev.md` | React/TS frontend + Node.js/Express backend |
| `devops-engineer` | `devops-engineer.md` | Terraform, CI/CD, Fly.io, S3/CloudFront |
| `ui-designer` | `ui-designer.md` | Dark maritime theme, glassmorphism, mobile-first PWA |
| `qa-tester` | `qa-tester.md` | Testing, Lighthouse, bundle audit, quality gates |

**Invoke with:** `@agent-scrum-master`, `@agent-fullstack-dev`, `@agent-devops-engineer`, etc.

---

## MCP Tools Available

- **git** — version control operations
- **github** — PR/issue management
- **memory** — persist decisions across sessions
- **project-voltron** — scaffold new agent templates, submit session reflections

---

## Things Claude Should Never Do

- Commit `.env`, API keys, secrets, or credentials
- Push directly to `main` — always feature branches + PRs
- Use `any` type in TypeScript
- Skip error handling on async Express routes
- Hardcode MMSI values outside `server/src/lib/constants.ts` or `src/lib/constants.ts`
- Access `process.env` directly in route handlers — use a config module
- Use `cors({ origin: '*' })` in production

---

## Session Closeout Protocol

Submit a reflection at the end of each working session:

```
mcp__project-voltron__submit_reflection({
  project_name: "toronto-ferry-tracker-v2",
  project_type: "fullstack",
  session_summary: "...",
  agents_used: [...],
  agent_feedback: [...],
  overall_notes: "..."
})
```
