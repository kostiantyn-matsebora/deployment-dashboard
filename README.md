<p align="center">
  <img src="docs/design/logo/logo-512.png" alt="Deployment Dashboard" width="120" height="120" />
</p>

<h1 align="center">Deployment Dashboard</h1>

Real-time services × environments deployment matrix sourced from CI/CD pipeline events.

**Core question it answers:** *What version of service X is running in environment Y right now — and did the last deployment succeed?*

## What it does

- Displays a live deployment matrix — one row per service, one column per environment
- Each slot shows: version, status (success / in-progress / failure), actor, elapsed time, CI/CD run link
- Streams live updates to all connected browser clients via SSE — no page reload
- Stores full deployment history per slot (90-day minimum retention)
- Accepts events from any CI/CD tool via a single `POST /api/deployments` step — no pipeline changes beyond adding that one step

## Architecture

```
CI/CD tool  ──POST /api/deployments──►  App Gateway (nginx)
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                         Frontend         API (.NET 10)    Fetcher*
                      (Angular + nginx)  Write + Read     (optional)
                                              │
                                              ▼
                                         PostgreSQL
                                        LISTEN/NOTIFY
```

`*` Dashboard.Fetcher is an optional pull-mode adapter that polls a CI/CD API and posts events using the same push endpoint.

## Components

| Path | Role |
|---|---|
| `backend/` | .NET 10 API — Write (API-key gated) + Read (unauthenticated) endpoints, SSE fan-out, plus the optional Fetcher |
| `frontend/` | Angular 20 SPA — static files served by nginx, no build step required at runtime (+ a mock API server) |
| `gateway/` | nginx App Gateway — the single public surface |
| `demo/` | Demo Driver + GitHub Emulator + scenario data (zero-config evaluation / CI) |
| `compose/` | Docker Compose stack (profiles) + `.env.example` |
| `scripts/` | PowerShell tooling, git hooks, and the release helper |
| `testing/` | E2E and integration test suites |
| `docs/` | Architecture spec, API contracts, frontend requirements |

## Key constraints

| Constraint | Detail |
|---|---|
| Stack | Angular 20+ frontend · .NET 10 backend · PostgreSQL |
| Hosting | Azure only · ≤ $30/month |
| Stateless backend | any number of instances behind a load balancer, no sticky sessions |
| Internal only | not publicly accessible; SPA contains no secrets |

## Running with Docker Compose

No clone, no build — all images are published to GHCR. Fetch the compose file(s) into a working directory and start the stack.

Two deployment shapes, each with a pull-mode variant. Ingestion is push-first (CI/CD posts to `POST /api/deployments`); the **`-pull`** variants add the optional Fetcher, which polls a source and posts via the same endpoint.

- **`standalone`** — cloud / distributed setup: PostgreSQL is a managed/external service, the app tier scales horizontally behind the gateway.
- **`full`** — single-VM / all-in-one setup: the stack owns its PostgreSQL (Docker volume) on the same host.

**Get the compose file(s):**

```bash
# Base file (all profiles)
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/docker-compose.yaml

# Demo overlay (demo profile only)
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/docker-compose.demo.yaml
```

To pin to a specific release, replace `main` in the URLs with the release tag (e.g. `.../v0.1.0/compose/...`) and set `DASHBOARD_VERSION` to the matching version — see [Releases](#releases).

| Profile | What starts | Required env vars | Command |
|---|---|---|---|
| `standalone` | Gateway + Frontend + API. External PostgreSQL, push-only. | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST` | `docker compose --profile standalone up` |
| `standalone-pull` | `standalone` + Fetcher (pull-mode ingestion). | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST` (+ `GITHUB_REPOS` / `GITHUB_TOKEN` for the Fetcher) | `docker compose --profile standalone-pull up` |
| `full` | Gateway + Frontend + API + managed PostgreSQL (Docker volume). Push-only. | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | `docker compose --profile full up` |
| `full-pull` | `full` + Fetcher (pull-mode ingestion). | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (+ `GITHUB_REPOS` / `GITHUB_TOKEN` for the Fetcher) | `docker compose --profile full-pull up` |
| `demo` | Gateway + Frontend + API + Demo Driver + GitHub Emulator + Fetcher + PostgreSQL. Zero-config local evaluation. | _(none — insecure defaults applied by the demo override)_ | `docker compose -f docker-compose.yaml -f docker-compose.demo.yaml --profile demo up` |

> The gateway is the only published port (default `:8080`). Frontend, API, and PostgreSQL are internal-only.

### Running from local source (contributors / building from a clone)

If you have cloned the repo and want to build images locally, `compose/docker-compose.local.yaml` swaps all published images for locally built ones (`pull_policy: never`). Stack it on top of the base + demo overrides.

**1. Build all images:**

```powershell
docker compose `
  -f compose/docker-compose.yaml `
  -f compose/docker-compose.demo.yaml `
  -f compose/docker-compose.local.yaml `
  --profile demo build
```

**2. Run:**

```powershell
docker compose `
  -f compose/docker-compose.yaml `
  -f compose/docker-compose.demo.yaml `
  -f compose/docker-compose.local.yaml `
  --profile demo up
```

Or build and start in one step:

```powershell
docker compose `
  -f compose/docker-compose.yaml `
  -f compose/docker-compose.demo.yaml `
  -f compose/docker-compose.local.yaml `
  --profile demo up --build
```

Open `http://localhost:8080` for the dashboard and `http://localhost:8080/demo/` for the Demo Driver control panel.

## Docs

📖 **Documentation site:** <https://kostiantyn-matsebora.github.io/deployment-dashboard/>

New here? Start with the adopter guides:

- [Quickstart](docs/guide/quickstart.md) — run the whole stack locally, zero config.
- [Install & deploy](docs/guide/install.md) · [Configuration](docs/guide/configuration.md)
- [Integrate your CI/CD](docs/guide/send-events.md) — send deployments from any pipeline (one step).
- [Architecture overview](docs/guide/architecture-overview.md) · [FAQ & troubleshooting](docs/guide/faq.md)

Development & reference (the full specification) lives under [`docs/`](docs/index.md) — architecture (SAD), API contract, frontend requirements, fetcher, mock server, and demo driver.

## Releases

Each tagged release publishes versioned images for all services to GHCR (`ghcr.io/kostiantyn-matsebora/deployment-dashboard-*`). Pin a deployment by setting `DASHBOARD_VERSION` in `compose/.env` (e.g. `0.1.0` — no leading `v`); it defaults to `latest`.

See [RELEASING.md](RELEASING.md) for the release process and [Install & deploy](docs/guide/install.md#pinning-a-release-version) for pinning a version.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, the branch → PR workflow, and the conventions CI enforces. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: follow the [Security policy](SECURITY.md).
