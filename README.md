# Deployment Dashboard

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
| `backend/` | .NET 10 API — Write (API-key gated) + Read (unauthenticated) endpoints, SSE fan-out |
| `frontend/` | Angular 20 SPA — static files served by nginx, no build step required at runtime |
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

Compose files live in [`compose/`](compose/). Copy `compose/.env.example` to `compose/.env` and fill in the required vars before running.

| Profile | What starts | Required env vars | Command |
|---|---|---|---|
| `demo` | Gateway + Frontend + API + Demo Driver + PostgreSQL. Zero-config local evaluation. | _(none — insecure defaults applied by the demo override)_ | `docker compose -f compose/docker-compose.yaml -f compose/docker-compose.demo.yaml --profile demo up` |
| `full` | Gateway + Frontend + API + managed PostgreSQL (Docker volume). | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | `docker compose -f compose/docker-compose.yaml --profile full up` |
| `standalone` | Gateway + Frontend + API. Connects to an external PostgreSQL instance. | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST` | `docker compose -f compose/docker-compose.yaml --profile standalone up` |

> The gateway is the only published port (default `:8080`). Frontend, API, and PostgreSQL are internal-only.

### Running from local source

`compose/docker-compose.local.yaml` swaps all published images for locally built ones (`pull_policy: never`). Stack it on top of the base + demo overrides.

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

Full specification in [`docs/`](docs/index.md) — architecture (SAD), API contracts, frontend requirements, fetcher, mock server, and demo driver.
