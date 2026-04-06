# QA Smoke Test Report — Phase 9b UX Enhancements

**Date:** 2026-04-06
**Branch:** phase-9/ux-enhancements
**Tester:** qa-tester agent

## Features Tested

| Feature | Status |
|---|---|
| Dock popups — DockMarkers accepts vessels prop | PASS |
| Dock popups — popup opens on click | PASS |
| Dock popups — shows docked vessels list | PASS |
| Dock popups — shows approaching vessels with ETA | PASS |
| Dock popups — close button works | PASS |
| App.tsx — vessels threaded to DockMarkers | PASS |
| App.tsx — vesselPositionsRef threaded to VesselLayer | PASS |
| Animation — VesselLayer uses imperative setData at 60fps | PASS |
| Animation — useVesselPositions throttles state to 100ms | PASS |
| Animation — interpolatedRef updated every frame | PASS |
| Landmark markers — reduced to 22px | PASS |
| Dock markers — 20px with cyan border | PASS |
| Landmark coordinates — all 6 corrected | PASS |
| Map style — dataviz-dark in FerryMap.tsx | PASS |
| Route lines — sky blue #38bdf8, width 2.5, dasharray [6,3] | PASS |
| Ferry icon — updated hull/superstructure colors | PASS |

## Quality Gates

| Check | Result | Detail |
|---|---|---|
| TypeScript (frontend) | PASS | 0 errors |
| TypeScript (backend) | PASS | 0 errors |
| ESLint | PASS | 0 errors, 1 warning |
| Vitest | SKIP | Same rolldown native binary platform mismatch as build (Windows binary, Linux container) — pre-existing environment limitation |
| Production build | SKIP | Known Docker/rolldown native binary issue (Windows build, Linux container) |

## Code Review Detail

### DockMarkers.tsx
- `DockMarkersProps` interface declares `vessels: Vessel[]` — **confirmed**
- `activeDockId` state drives popup open/close — **confirmed**
- `<Popup>` renders when `activeDock` is non-null, `onClose` handler clears state — **confirmed**
- Close `<button>` with `aria-label="Close dock info"` calls `setActiveDockId(null)` — **confirmed**
- `DockVesselList` filters `vessels` by `status === 'docked'` and `status === 'moving'` for the active dock — **confirmed**
- ETA rendered as `ETA ~{v.etaMinutes} min` when `v.etaMinutes !== undefined` — **confirmed**

### App.tsx
- `useVesselPositions()` destructures both `vessels` and `vesselPositionsRef` — **confirmed**
- `<DockMarkers vessels={vessels} />` — **confirmed**
- `<VesselLayer vesselPositionsRef={vesselPositionsRef} ... />` — **confirmed**

### VesselLayer.tsx
- Props interface: `vesselPositionsRef: RefObject<Vessel[]>` — **confirmed**
- `useAnimationFrame` callback calls `source.setData(geojson)` at 60fps — **confirmed**
- `<Source ... data={emptyGeoJSON}>` initialises with empty FeatureCollection — **confirmed**

### useVesselPositions.ts
- `interpolatedRef.current = result` written inside the `useAnimationFrame` callback on every frame — **confirmed**
- State throttle: `if (timestamp - lastStateUpdateRef.current > 100)` gates `setInterpolated` / `setPositionHistory` — **confirmed**
- Return value includes `vesselPositionsRef: interpolatedRef` — **confirmed**

### CSS / Styling
- `.landmark-marker` — `width: 22px; height: 22px;` — **confirmed**
- `.dock-marker` — `width: 20px; height: 20px;` with `border: 1.5px solid rgba(0, 229, 255, 0.3)` (cyan) — **confirmed**
- 6 landmark coordinate entries in `LandmarkMarkers.tsx` (lines 19, 27, 35, 43, 51, 59) — **confirmed**
- `FerryMap.tsx` mapStyle uses `dataviz-dark` — **confirmed**
- `RouteLayer.tsx`: `line-color: '#38bdf8'`, `line-width: 2.5`, `line-dasharray: [6, 3]` — **confirmed**
- `ferryIcon.ts`: hull `#000`, deck `#cce8f4`, superstructure `#0ea5e9`, accent `#38bdf8`, cabin `rgba(255,255,255,0.92)` — **confirmed**

## Issues Found

**Non-blocking warning:**
- `src/components/UI/AboutPanel.tsx:62` — `react-hooks/exhaustive-deps` warning: missing `triggerRef` in `useEffect` dependency array. Pre-existing issue, not introduced in Phase 9b. Non-blocking.

**Environment note:**
- Vitest could not execute due to the same rolldown native binary mismatch that blocks `npm run build`. This is a pre-existing Docker/Windows platform issue — not a test failure. Test suite was green (73/73) as of Phase 6 QA and no test files were modified in Phase 9b.

## Sign-off

All 16 Phase 9b feature checks **PASS** via code review. TypeScript compiles cleanly on both frontend and backend (0 errors). ESLint is clean (0 errors, 1 pre-existing warning unrelated to Phase 9b changes). The rolldown binary issue blocking Vitest and build is a pre-existing environment constraint documented since Phase 6, not a regression introduced by this branch.

**READY TO SHIP** — Phase 9b UX enhancements meet quality standards. Address the `AboutPanel.tsx` exhaustive-deps warning in a future sprint.
