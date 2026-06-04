# Install & deploy

How to run Deployment Dashboard for a real team. For a zero-config local trial, see the [Quickstart](./quickstart.md).

## Concepts in one minute

- **Ingestion is push-first.** Your CI/CD pipeline `POST`s a deployment event to `POST /api/deployments` — one extra step ([Integrate your CI/CD](./send-events.md)).
- **Pull mode is optional.** The Fetcher can poll a CI/CD API (GitHub Actions today) and post through the same endpoint — see [Pull mode](#pull-mode-fetcher).
- **The gateway is the only published port** (`:8080`). API, frontend, and PostgreSQL stay internal.
- **The backend is stateless.** Scale API instances behind the gateway; SSE fan-out works across them via PostgreSQL `LISTEN/NOTIFY`.

## Deployment shapes (Compose profiles)

- **`full`** — single host; the stack owns its PostgreSQL (Docker volume).
- **`standalone`** — external managed PostgreSQL (e.g. Azure Database for PostgreSQL); the app tier scales behind the gateway.

Each has a **`-pull`** variant that adds the Fetcher for [pull-mode ingestion](#pull-mode-fetcher).

## Get the stack

Fetch the compose file and env template — no clone, images pull from GHCR:

```bash
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/docker-compose.yaml
curl -fsSLO https://raw.githubusercontent.com/kostiantyn-matsebora/deployment-dashboard/main/compose/.env.example
cp .env.example .env
# set API_KEY, POSTGRES_USER, POSTGRES_PASSWORD  (+ POSTGRES_HOST for standalone)

docker compose --profile full up -d
```

> ⚠️ **Set `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (+ `POSTGRES_HOST` for `standalone`) before starting.** Compose substitutes empty strings for missing values, so the API and database containers crash-loop instead of failing fast.

To pin a release, replace `main` in the URLs with the tag (e.g. `.../v0.6.0/compose/...`) — see [Pinning a release version](#pinning-a-release-version).

## Pull mode (Fetcher)

Use pull mode when you can't add a push step to your pipelines — or when the dashboard runs in a **locked-down network that forbids inbound WAN traffic**. The Fetcher is **outbound-only**: it polls the GitHub Deployments API and posts to the dashboard's internal ingest, so nothing needs to accept inbound connections (unlike push, where CI/CD must reach in). Only the `-pull` profiles start it.

Add two values to `.env`, then start a `-pull` profile:

```bash
# in .env, additionally set:
#   GITHUB_TOKEN=...                 # read-only; see token scope below
#   GITHUB_REPOS=acme/api,acme/web   # comma-separated owner/repo

docker compose --profile full-pull up -d
```

`standalone-pull` is identical (`--profile standalone-pull`, with `POSTGRES_HOST` set). Other fetcher options have sane defaults — see [Configuration → Fetcher: pull mode](./configuration.md#fetcher-pull-mode). The first start runs a bounded backfill, so the matrix fills after a poll cycle or two.

**GitHub token scope** — the Fetcher only reads, never writes:

- **Public repos:** a classic PAT with **no scopes**, or a fine-grained PAT with **Public repositories (read-only)**.
- **Private repos:** a fine-grained PAT with **Contents · Deployments · Actions: Read** on the target repos (or classic `repo`).

## Profiles

| Profile | What starts | Required env | Command |
|---|---|---|---|
| `full` | Gateway + Frontend + API + bundled PostgreSQL | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | `docker compose --profile full up -d` |
| `standalone` | Gateway + Frontend + API (external PostgreSQL) | + `POSTGRES_HOST` | `docker compose --profile standalone up -d` |
| `full-pull` | `full` + Fetcher | + `GITHUB_TOKEN`, `GITHUB_REPOS` | `docker compose --profile full-pull up -d` |
| `standalone-pull` | `standalone` + Fetcher | + `GITHUB_TOKEN`, `GITHUB_REPOS` | `docker compose --profile standalone-pull up -d` |

Then point your CI/CD at `http://<host>:8080/api/deployments` — see [Integrate your CI/CD](./send-events.md).

## Running from local source

Building from a clone is a **contributor** workflow — see [CONTRIBUTING.md → Local setup](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/CONTRIBUTING.md#local-setup).

## Production checklist

- **Set a strong `API_KEY`.** Writes are rejected `401` without it.
- **Set `CONTROL_API_KEY`** (distinct from `API_KEY`) only if you need the reset surface; leave it unset to hide `POST /api/control/reset`.
- **Front the stack with TLS** and keep it on your internal network — reads are unauthenticated by design ([Architecture](./architecture-overview.md)).
- **Set `HISTORY_RETENTION_DAYS`** (minimum 90; 365 recommended).
- **Scale the API** horizontally behind the gateway as needed — it's stateless.

See [Configuration](./configuration.md) for every environment variable.

## Pinning a release version

By default the stack pulls `latest` (tracks `main`). For a reproducible deploy, pin in `.env`:

```dotenv
DASHBOARD_VERSION=0.6.0
```

**No leading `v`** — the git tag `v0.6.0` publishes images as `0.6.0`. Each GitHub Release also attaches a compose bundle (`deployment-dashboard-compose-vX.Y.Z.zip`). Full process: [RELEASING.md](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/RELEASING.md).

## Hosting notes

The reference target is **Azure** (≤ $30/month, container-based — [SAD §5–6](../SAD.md#5-non-functional-requirements)), but nothing is Azure-specific: every component is a standard OCI container. Terraform modules for Azure are planned (`infrastructure/`, not yet present).
