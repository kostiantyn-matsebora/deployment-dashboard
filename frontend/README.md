# Deployment Dashboard — Frontend (Angular 20)

Modular-monolith Angular 20 workspace producing the SPA that the Read API
serves from `wwwroot`. Implements WBS §1.3 of the architecture doc.

## Workspace layout

```
frontend/
├── dashboard/   # Application — root shell, SSE bootstrap, header, Tailwind entry
├── matrix/      # Feature library — pipeline matrix, 6 box states, stats bar, hover highlight
├── drawer/      # Feature library — history drawer (lazy history fetch)
├── shared/      # Library — Signal Store, API client, SSE service, models, fixtures
├── angular.json
├── tailwind.config.js
└── tsconfig.base.json   # path mappings + dependency boundary
```

Dependency rules (path mappings live in `tsconfig.base.json`):
- `matrix/`, `drawer/` may import only from `@dd/shared`.
- `shared/` imports nothing else in the workspace.
- Only `dashboard/` imports from `@dd/matrix` and `@dd/drawer`.
- Each library exposes a single barrel `public-api.ts`; no deep imports.

## Install

Requires Node 22+ and npm 10+.

```powershell
cd frontend
npm install
```

## Develop

```powershell
npm start
```

Serves at `http://localhost:4200` with `/api/*` proxied to
`http://localhost:8080` (the local Read API). When the API is unreachable the
SPA falls back to the canonical fixture data from `shared/lib/fixtures.ts`,
so you can hack on UI without a backend running.

## Build

```powershell
npm run build
```

Output lands in `frontend/dist/dashboard/`. The Read API Docker image copies
that directory into `wwwroot` at build time — NFR-08 is satisfied because
the browser never sees a bundler.

## Test

```powershell
npm test -- --watch=false --browsers=ChromeHeadlessNoSandbox
```

Covers:
- `DeploymentMatrixStore` patch logic + every derived signal.
- All six box states using the mockup's fixture data.
- `getBoxClass` / `getTooltip` palette assertions.
- Root component smoke test.

E2E (Playwright) tests live in `testing/e2e/` and are owned by qa-engineer.

## Visual contract

`docs/deployment-dashboard.html` is authoritative for layout, palette,
transitions, and the 6 box-state rules. `docs/deployment-dashboard-architecture.md`
is authoritative for data shapes (snake_case wire, camelCase internal) and the
SSE/REST endpoints (`GET /api/stream`, `GET /api/deployments`, `GET
/api/deployments/{s}/{e}/history`, `GET /api/environments`, `GET /api/services`).

## data-testid hooks for QA

| Test ID | Purpose |
|---|---|
| `failures-only-toggle` | Header — failures-only checkbox |
| `search-input` | Header — service name filter |
| `live-indicator` | Header — "Live · updated just now" badge |
| `stat-services` | Stats bar — filtered/total services |
| `stat-failures` | Stats bar — failure count |
| `stat-last-deploy` | Stats bar — relative last deploy |
| `stat-never-prod` | Stats bar — never-reached-prod count |
| `highlight-hint` | Stats bar — "Showing all environments with X" |
| `env-header-{id}` | Environment column headers |
| `pipeline-matrix` | Pipeline matrix container |
| `service-row-{id}` | One row per service |
| `service-name-{id}` | Service label |
| `stage-box-{service}-{env}` | One box per slot; has `data-state` |
| `current-version-{service}-{env}` | Current version text |
| `last-successful-version-{service}-{env}` | Last successful version text |
| `last-successful-section` | Bottom panel inside a split box |
| `prev-failed-badge` | Amber ⚠ prev. failed badge |
| `spinner` | Orange spinner inside in-progress boxes |
| `run-link-current-{service}-{env}` | Run link on the current state |
| `empty-state` | "No services match your filters" block |
| `history-drawer` | Drawer root |
| `drawer-service-name` | Drawer header — service name |
| `drawer-env-label` | Drawer header — environment label |
| `drawer-close` | Drawer close button |
| `drawer-current` | Drawer — current deployment panel |
| `drawer-last-successful` | Drawer — last successful panel (when present) |
| `drawer-history-loading` | Drawer — history loading state |
| `drawer-history-empty` | Drawer — empty history state |
| `drawer-history-list` | Drawer — history list container |

The `data-state` attribute on every stage box reports one of:
`empty | success | failed | failed-with-last | running | running-with-last
| running-prev-failed | running-prev-failed-with-last`.
