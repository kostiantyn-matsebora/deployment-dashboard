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
| `scripts/` | Python tooling + git hooks. |
| `docs/` | All design + contract documentation (published as the docs site). |

## Local setup

**Prerequisites.** .NET 10 SDK · Node.js 20+ · Docker (Compose v2) · Python 3.11+ with `pytest`, `ruff`, and `jsonschema` (for scripts).

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

**Frontend SPA + mock API — no backend, no database.** The SPA's dev proxy (`frontend/dashboard/proxy.conf.json`) forwards `/api`, `/healthz`, `/readyz` to the **mock server** (`frontend/mock/`, port `3002`) — an in-memory fake of the read API (matrix, deployments, services/environments, fetcher state, the `GET /api/events/stream` SSE feed) with a `/_mock/*` surface to seed data. The SPA runs standalone against realistic data + live SSE; no .NET, no Postgres.

```bash
# Terminal 1 — mock API on http://localhost:3002
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
POSTGRES_HOST=localhost POSTGRES_USER=dev POSTGRES_PASSWORD=dev \
  dotnet run --project api/Dashboard.Api
```
> The API assembles its connection from `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` (defaults: `postgres` / `5432` / `deployment_dashboard`).
> Shell: export them first — `export POSTGRES_HOST=localhost POSTGRES_USER=dev POSTGRES_PASSWORD=dev` — then `dotnet run --project api/Dashboard.Api`.

To point the **SPA at the real API** instead of the mock, change the `target` in `frontend/dashboard/proxy.conf.json` from `http://localhost:3002` to `http://localhost:5205`.

**Other components** — NestJS via `npm ci && npm run start:dev`, .NET via `dotnet run`:

| Component | From | Runs on | Key env (dev defaults) |
|---|---|---|---|
| Demo Driver | `demo/driver/` | `http://localhost:3001/demo/` | `WRITE_API_URL` (`:3002`), `API_KEY`, `CONTROL_API_KEY`, `GITHUB_EMULATOR_URL` (`:3100`) |
| GitHub Emulator | `demo/github-emulator/` | `http://localhost:3100` | — |
| Fetcher (pull mode) | `backend/` → `dotnet run --project fetcher/Dashboard.Fetcher` | worker (no HTTP port) | `GITHUB_*`, `WRITE_API_URL` — see [Configuration](docs/guide/configuration.md) |

Point a component's `WRITE_API_URL` at the mock (`:3002`) or the real API (`:5205`) as needed.

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

**Scripts (Python + pytest)** — see [Scripts](#scripts) below.

## Workflow

1. **Branch — never push to `main`.** Always branch → commit → PR, regardless of change size. Use a conventional branch name, e.g. `feat/...`, `fix/...`, `docs/...`.
2. **Commit with [Conventional Commits](https://www.conventionalcommits.org/).** Examples from history: `feat: ...`, `perf(api-tests): ...`, `test(api): ...`, `fix(fetcher): ...`, `docs: ...`.
3. **Keep PRs scoped.** One concern per PR; fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
4. **Green CI is required.** Format gate, build, unit/integration tests, script lint+tests, and the docs drift check all gate merge.

## Conventions CI enforces

### Specialist routing

Changes are routed to the area specialist (`api-architect` / `backend-developer` / `frontend-developer` / `deployment-engineer` / `testing-specialist` / `docs-keeper`). See [`.claude/team-process/process.md`](.claude/team-process/process.md). The `docs-keeper` specialist is **plugin-provided (opt-in)** — install the docs-keeper plugin to staff the docs role; without it, doc work falls back to the orchestrator's assignment. For API features, [`docs/api/openapi.yaml`](docs/api/openapi.yaml) is the contract source of truth — update it first.

### Scripts

Every script (build / dev tooling / CI helper / automation) **must**:

- Be **Python 3** (stdlib-only runtime), cross-platform. Invocation form: `python3 <path>.py --kebab-flags`. No bash/sh scripts as the primary deliverable (single-line CI YAML invocations and the bash bootstrap exception in `scripts/hooks/install-dependencies.sh` are exempt).
- Have **pytest** coverage. The suite is a **sibling** file: `scripts/foo.py` → `scripts/foo_test.py`. No mirror tree. The `jsonschema` package is available for team-mode guard tests.
- Pass **ruff** lint (`scripts/pyproject.toml`).

Run locally:
```bash
python3 -m pytest scripts/
ruff check scripts/
```

### Documentation

Docs follow an **index-first** convention: every directory under `docs/` has an `index.md` whose `children:` front-matter must match the files on disk. The `docs` CI job enforces this via the **docs-keeper** plugin's neutral core drift gate (`core/engine/cli.py --drift-only`, run from a pinned checkout); when the plugin is installed it also runs as a commit-time hook. When you add/move/remove a doc, regenerate the affected index with `/docs-keeper:docs-index <dir>` so the drift check stays green.

Authoring rules (binding): concise and LLM-optimized, structure over prose — steps as numbered lists, mappings as tables, "X means Y" as `**X.** Y`. See [`CLAUDE.md`](CLAUDE.md).

## Releasing

To cut a release (maintainers only), follow the end-to-end flow in [RELEASING.md](RELEASING.md): run `new_release.py` to open a changelog PR, merge it, then manually push the annotated tag to trigger the release workflow.

## Reporting bugs & requesting features

Use the issue templates: [bug report](.github/ISSUE_TEMPLATE/bug-report.md) · [feature request](.github/ISSUE_TEMPLATE/feature-request.md).
