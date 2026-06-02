# Contributing

Thanks for your interest in Deployment Dashboard. This guide covers local setup, the workflow, and the conventions CI enforces.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). For security issues, follow the [Security policy](SECURITY.md) — do **not** open a public issue.

## Project layout

| Path | What |
|---|---|
| `backend/` | .NET 10 services — Write/Read API, Fetcher, shared libs, tests (`Dashboard.slnx`). |
| `frontend/dashboard/` | Angular 20 SPA. `frontend/mock/` is a mock API server. |
| `demo/` | Demo Driver + GitHub Emulator + scenario data (evaluation/CI only). |
| `gateway/` | nginx App Gateway config. |
| `testing/` | `api` (integration) and `e2e` suites. |
| `compose/` | Local-dev Docker Compose stack + `.env.example`. |
| `scripts/` | PowerShell tooling + git hooks. |
| `docs/` | All design + contract documentation (published as the docs site). |

## Local setup

**Prerequisites.** .NET 10 SDK · Node.js 20+ · Docker (Compose v2) · PowerShell 7+ (for scripts).

> **Just want to see it run?** For a quick look at the **released** images (not your local changes), run the zero-config demo — see the [Quickstart](docs/guide/quickstart.md). Everything below runs **your working tree**.

### Run the full stack from your source

`compose/docker-compose.local.yaml` swaps every published image for a local build (`pull_policy: never`), so this runs all of your changes together. Gateway on `http://localhost:8080`; demo panel at `/demo/`.

```bash
docker compose \
  -f compose/docker-compose.yaml \
  -f compose/docker-compose.demo.yaml \
  -f compose/docker-compose.local.yaml \
  --profile demo up --build
```

### Run a component on its own (debug loop)

Run only the part you're changing — outside containers, with native hot-reload and a debugger attached.

**Frontend SPA + mock API — no backend, no database.** The SPA's dev proxy (`frontend/dashboard/proxy.conf.json`) forwards `/api`, `/healthz`, `/readyz` to the **mock server** (`frontend/mock/`, port `3000`) — an in-memory fake of the read API (matrix, deployments, services/environments, fetcher state, the `GET /api/events/stream` SSE feed) with a `/_mock/*` surface to seed data. The SPA runs standalone against realistic data + live SSE; no .NET, no Postgres.

```bash
# Terminal 1 — mock API on http://localhost:3000
cd frontend/mock && npm ci && npm run start:dev

# Terminal 2 — SPA on http://localhost:4200 (hot reload; proxy.conf.json auto-loaded)
cd frontend/dashboard && npm ci && npm start
```

**Backend Write/Read API (.NET) — needs Postgres.** Runs on `http://localhost:5205`; EF Core migrations apply on startup, so an empty database is fine.

```bash
# Terminal 1 — a throwaway Postgres
docker run --rm -p 5432:5432 \
  -e POSTGRES_DB=deployment_dashboard -e POSTGRES_USER=dev -e POSTGRES_PASSWORD=dev \
  postgres:17-alpine

# Terminal 2 — the API (Development env comes from launchSettings.json)
cd backend
ConnectionStrings__Postgres="Host=localhost;Port=5432;Database=deployment_dashboard;Username=dev;Password=dev" \
  dotnet run --project api/Dashboard.Api
```
> PowerShell: set the env var on its own line first — `$env:ConnectionStrings__Postgres = "Host=localhost;Port=5432;Database=deployment_dashboard;Username=dev;Password=dev"` — then `dotnet run --project api/Dashboard.Api`.

To point the **SPA at the real API** instead of the mock, change the `target` in `frontend/dashboard/proxy.conf.json` from `http://localhost:3000` to `http://localhost:5205`.

**Other components** — NestJS via `npm ci && npm run start:dev`, .NET via `dotnet run`:

| Component | From | Runs on | Key env (dev defaults) |
|---|---|---|---|
| Demo Driver | `demo/driver/` | `http://localhost:3001/demo/` | `WRITE_API_URL` (`:3000`), `API_KEY`, `CONTROL_API_KEY`, `GITHUB_EMULATOR_URL` (`:3100`) |
| GitHub Emulator | `demo/github-emulator/` | `http://localhost:3100` | — |
| Fetcher (pull mode) | `backend/` → `dotnet run --project fetcher/Dashboard.Fetcher` | worker (no HTTP port) | `GITHUB__*`, `WRITE_API_URL` — see [Configuration](docs/guide/configuration.md) |

Point a component's `WRITE_API_URL` at the mock (`:3000`) or the real API (`:5205`) as needed.

### Test & build (per area)

**Backend (.NET 10)** — from `backend/`:
```bash
dotnet tool restore
dotnet build Dashboard.slnx -c Release
dotnet test Dashboard.slnx --settings Dashboard.runsettings
dotnet format Dashboard.slnx            # apply formatting (CI runs --verify-no-changes)
```

**Frontend (Angular)** — from `frontend/dashboard/`:
```bash
npm ci
npm test
npm run build -- --configuration production
```

**API integration tests** — spin up the stack, then run from `testing/api/`:
```bash
# from repo root: build & start the stack the tests drive
COMPOSE_FILE=compose/docker-compose.yaml:compose/docker-compose.demo.yaml:compose/docker-compose.local.yaml:compose/docker-compose.test.yaml \
COMPOSE_PROFILES=db,api,demo-driver,gateway,github-emulator,fetcher-host \
  docker compose up -d --build --wait
# then:
cd testing/api && npm ci && npm run test:integration
```

**Scripts (PowerShell + Pester)** — see [Scripts](#scripts) below.

## Workflow

1. **Branch — never push to `main`.** Always branch → commit → PR, regardless of change size. Use a conventional branch name, e.g. `feat/...`, `fix/...`, `docs/...`.
2. **Commit with [Conventional Commits](https://www.conventionalcommits.org/).** Examples from history: `feat: ...`, `perf(api-tests): ...`, `test(api): ...`, `fix(fetcher): ...`, `docs: ...`.
3. **Keep PRs scoped.** One concern per PR; fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
4. **Green CI is required.** Format gate, build, unit/integration tests, script lint+tests, and the docs drift check all gate merge.

## Conventions CI enforces

### Specialist routing

Changes are routed to the area specialist (`api-architect` / `backend-developer` / `frontend-developer` / `deployment-engineer` / `testing-specialist` / `docs-keeper`). See [`docs/engineering-process.md`](docs/engineering-process.md). For API features, [`docs/api/openapi.yaml`](docs/api/openapi.yaml) is the contract source of truth — update it first.

### Scripts

Every script (build / dev tooling / CI helper / automation) **must**:

- Be **PowerShell** (`.ps1` / `.psm1`), targeting **PowerShell 7+** (Core) for cross-platform parity. No `bash`/`sh`/`python` scripts as the primary deliverable (single-line invocations inside CI YAML are exempt).
- Have **Pester v5+** coverage. The suite is a **sibling** file: `scripts/install.ps1` → `scripts/install.Tests.ps1`. No mirror tree.
- Pass **PSScriptAnalyzer** (`scripts/PSScriptAnalyzerSettings.psd1`).

Run locally:
```powershell
Invoke-Pester -Path scripts/
Get-ChildItem scripts/ -Recurse -Filter *.ps1 |
  Where-Object Name -notlike '*.Tests.ps1' |
  ForEach-Object { Invoke-ScriptAnalyzer -Path $_.FullName -Settings scripts/PSScriptAnalyzerSettings.psd1 }
```

### Documentation

Docs follow an **index-first** convention: every directory under `docs/` has an `index.md` whose `children:` front-matter must match the files on disk. A pre-commit hook and the `docs` CI job (`Invoke-DocsKeeperMaintenance.ps1 -DriftOnly`) enforce this. When you add/move/remove a doc, regenerate the affected index (`/docs-index <dir>`) so the drift check stays green.

Authoring rules (binding): concise and LLM-optimized, structure over prose — steps as numbered lists, mappings as tables, "X means Y" as `**X.** Y`. See [`CLAUDE.md`](CLAUDE.md).

## Releasing

To cut a release (maintainers only), follow the end-to-end flow in [RELEASING.md](RELEASING.md): run `New-Release.ps1` to open a changelog PR, merge it, then manually push the annotated tag to trigger the release workflow.

## Reporting bugs & requesting features

Use the issue templates: [bug report](.github/ISSUE_TEMPLATE/bug-report.md) · [feature request](.github/ISSUE_TEMPLATE/feature-request.md).
