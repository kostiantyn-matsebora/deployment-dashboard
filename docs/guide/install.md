# Install & deploy

How to run Deployment Dashboard for a real team. For a zero-config local trial, use the [Quickstart](./quickstart.md) instead.

## Concepts in one minute

- **Ingestion is push-first.** Your CI/CD pipeline `POST`s a deployment event to `POST /api/deployments` (one extra step — see [Integrate your CI/CD](./send-events.md)).
- **Pull mode is optional.** The `Dashboard.Fetcher` component can poll a CI/CD API (GitHub Actions today) and post events through the same endpoint. You only need it if you can't add a push step to your pipelines.
- **The gateway is the only published port.** Everything else (API, frontend, PostgreSQL) is internal. Default published port: `:8080`.
- **The backend is stateless.** Run any number of API instances behind the gateway; no sticky sessions. SSE fan-out works across instances via PostgreSQL `LISTEN/NOTIFY`.

## Deployment shapes (Compose profiles)

Compose files live in [`compose/`](https://github.com/kostiantyn-matsebora/deployment-dashboard/tree/main/compose). Copy `compose/.env.example` to `compose/.env` and fill in the vars for your profile (see [Configuration](./configuration.md)).

Two shapes, each with a pull-mode variant:

- **`standalone`** — cloud / distributed. PostgreSQL is an external managed service; the app tier scales horizontally behind the gateway.
- **`full`** — single-VM / all-in-one. The stack owns its PostgreSQL (Docker volume) on the same host.

| Profile | What starts | Required env | Command |
|---|---|---|---|
| `standalone` | Gateway + Frontend + API. External PostgreSQL, push-only. | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST` | `docker compose -f compose/docker-compose.yaml --profile standalone up` |
| `standalone-pull` | `standalone` + Fetcher (pull-mode ingestion). | + `GITHUB_REPOS` / `GITHUB_TOKEN` | `docker compose -f compose/docker-compose.yaml --profile standalone-pull up` |
| `full` | Gateway + Frontend + API + bundled PostgreSQL (Docker volume). Push-only. | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | `docker compose -f compose/docker-compose.yaml --profile full up` |
| `full-pull` | `full` + Fetcher (pull-mode ingestion). | + `GITHUB_REPOS` / `GITHUB_TOKEN` | `docker compose -f compose/docker-compose.yaml --profile full-pull up` |
| `demo` | Everything + Demo Driver + GitHub Emulator + Fetcher. Zero-config evaluation. | _(none — insecure defaults)_ | `docker compose -f compose/docker-compose.yaml -f compose/docker-compose.demo.yaml --profile demo up` |

> Pick **`standalone`** when your database is managed (e.g. Azure Database for PostgreSQL). Pick **`full`** for a single box that owns its data volume.

## Minimal production start

```bash
cp compose/.env.example compose/.env
# edit compose/.env — set at least API_KEY, POSTGRES_USER, POSTGRES_PASSWORD
#   (+ POSTGRES_HOST for standalone)

docker compose -f compose/docker-compose.yaml --profile full up -d
```

Then point your CI/CD at `http://<host>:8080/api/deployments` — see [Integrate your CI/CD](./send-events.md).

## Running from local source

`compose/docker-compose.local.yaml` swaps every published image for a locally built one (`pull_policy: never`). Stack it on top of the base + demo overrides:

```bash
docker compose \
  -f compose/docker-compose.yaml \
  -f compose/docker-compose.demo.yaml \
  -f compose/docker-compose.local.yaml \
  --profile demo up --build
```

## Production checklist

- **Set a strong `API_KEY`.** Every write is rejected with `401` without it.
- **Set `CONTROL_API_KEY`** (distinct from `API_KEY`) only if you need the destructive reset surface; leave it unset to hide `POST /api/control/reset` entirely.
- **Front the stack with TLS.** The dashboard is internal read-only tooling (no auth on reads, by design — see [Architecture overview](./architecture-overview.md)). Do **not** expose the Read API to the public internet; terminate TLS and restrict to your internal network.
- **Set `HISTORY_RETENTION_DAYS`** to your audit needs (minimum 90; 365 recommended for production).
- **Scale the API** horizontally behind the gateway as load grows — it's stateless.

See [Configuration](./configuration.md) for every environment variable.

## Pinning a release version

By default the stack pulls `latest`, which tracks the most recent push to `main`. For a reproducible deployment, pin to a published release version:

```dotenv
# compose/.env
DASHBOARD_VERSION=0.1.0
```

**No leading `v`.** The git tag is `v0.1.0`; the published image tag is `0.1.0`. See `compose/.env.example` for the full note.

Each GitHub Release also attaches a compose bundle (`deployment-dashboard-compose-vX.Y.Z.zip`) containing all `compose/*.yaml` files and `compose/.env.example` — a clone-free way to deploy a specific version without checking out the repo.

For the full release process, see [RELEASING.md](../../RELEASING.md).

## Hosting notes

The reference target is **Azure** (≤ $30/month, container-based — see [SAD §5–6](../SAD.md#5-non-functional-requirements)), but nothing is Azure-specific: every backend component is a standard OCI container deployable on any container host. Terraform modules for Azure are planned (`infrastructure/`, not yet present).
