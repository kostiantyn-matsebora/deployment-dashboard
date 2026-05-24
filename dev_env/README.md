# dev_env — local Deployment Dashboard stack

Implements MVP §2 of `docs/WBS.md`. The contributor flow is a compose-merge
override on the release-install stack — see § Compose-merge override below
for the structure and how to extend it.

## Topology — App Gateway in front, two app containers behind

Per SAD §7 "App Gateway", the local stack mirrors the Azure topology:

- **`gateway`** — `nginx:alpine`, host port `8080`. **The only entry point.**
  Routes by path + method to the appropriate backend.
- **`dashboard`** — `nginx:alpine` serving the Angular SPA bundle. Internal-only.
- **`api`** — ASP.NET Core Minimal API hosting the **co-located Write and Read
  API services** as composed library projects (microservices architecture per
  [ADR-0006](../docs/adr/ADR-0006-microservices-architecture-with-container-co-location.md);
  co-location mechanics per ADR-0002 / §10 Decision 11): POST ingest + NOTIFY,
  matrix / history / discovery / SSE / health. Internal-only. The gateway
  routes path + method onto the same `api` upstream so a future move from
  co-location to per-service images is a gateway-config-only change (mechanics
  per ADR-0002).
- **`db`** — PostgreSQL 16. Host port `5432` is published for dev convenience only (psql / EF tooling).
- **`pgadmin`** — host port `5050` for dev convenience.

EF Core migrations apply in-process inside the `api` container on startup —
no separate one-shot runner service. See § Migrations below.

There is no CORS in the system. The browser only ever sees one origin —
`http://localhost:8080/` — and the gateway picks the right upstream
based on the request path and method.

**Zero-setup, no `.env` files.** Every local-dev value is inline as
declarative `environment:` blocks inside the compose files. There is no
`.env`, no `.env.local`, no template to copy. The values are obviously
fake by design (`API_TOKEN=local-dev-token-not-for-production`,
`POSTGRES_PASSWORD=local-dev-password`) and stable so other tooling
(notably `testing/`) can default to the same token. Real production
secrets live only in Terraform + Azure Key Vault + GitHub Actions
Environments.

## Prerequisites

- Docker Desktop 24+ with Docker Compose v2 (verified with 29.1.4).
- PowerShell 7+ (the scripts require it).
- Ports `5432`, `5050`, `8080` free. (`8080` is the only app port — the
  gateway covers Dashboard + API behind it.)
- ~3 GB free disk for image layers.

## First run

```powershell
pwsh -NoProfile -File dev_env/start.ps1
```

Then open `http://localhost:8080/` in a browser. That is the entire
first-run flow. **No other host ports serve the application** — write
ingest, SSE, matrix, and the SPA are all on `:8080` behind the gateway.

The first build pulls Postgres 16, the .NET 10 SDK + ASP.NET runtime,
Node 22, and nginx — expect ~2 minutes. Subsequent runs use cached
layers and complete in seconds.

When the script reports the stack is healthy it prints:

- Dashboard / Gateway URL — `http://localhost:8080/`
- Postgres connection — `localhost:5432` (`dashboard` / `local-dev-password`)
- pgAdmin URL + login — `http://localhost:5050/` (`admin@example.com` / `admin`)
- A sample `curl` for `POST http://localhost:8080/api/deployments`
  with the fixed local-dev `X-Api-Key` baked in.

Re-running `start.ps1` while the stack is already up is a no-op:
`docker compose up -d` is idempotent and the URLs are re-printed.

## Scaled variant (NFR-05 validation only)

```powershell
pwsh -NoProfile -File dev_env/start.ps1 -Scaled
```

Uses `docker-compose.scaled.yml`: same gateway in front, but **3 API
replicas** behind it (Write + Read services co-located in one image per
[ADR-0006](../docs/adr/ADR-0006-microservices-architecture-with-container-co-location.md);
co-location mechanics per ADR-0002). Docker DNS resolves the `api` upstream
to multiple replica IPs and nginx round-robins across them — the gateway IS
the load balancer. The dashboard remains on the same URL:
`http://localhost:8080/`.

This is how we validate the backend is stateless — any replica accepts
an ingest POST and broadcasts via PG `LISTEN/NOTIFY`, every replica
sees the notification and fans out to its own SSE subscribers; SSE
clients must reconnect cleanly across replicas via `Last-Event-ID`.
Not the default local-dev experience.

## Optional services — pull-mode fetcher (real GitHub API)

Per CR-0009 / WBS §1.5, an opt-in pull-mode fetcher worker can be brought
up alongside the default stack. Use `-RealGha` to point it at your own repos.

```powershell
$env:GHA_TOKEN = "<your-pat>"
pwsh -NoProfile -File dev_env/start.ps1 -RealGha
```

**`GHA_TOKEN` precondition.** When `-RealGha` is set, `start.ps1`
requires `$env:GHA_TOKEN` to be a non-empty string and exits non-zero
before any `docker compose up` if it is missing. Pass `-AllowMissingGhaToken`
to skip the precondition (fetcher boots with placeholder token; GitHub API
calls will 401):

```powershell
pwsh -NoProfile -File dev_env/start.ps1 -RealGha -AllowMissingGhaToken
```

`-RealGha` uses external Postgres by default. Combine with `-LocalDb` for
a fully self-contained bring-up:

```powershell
$env:GHA_TOKEN = "<your-pat>"
pwsh -NoProfile -File dev_env/start.ps1 -RealGha -LocalDb
```

## Stopping

```powershell
pwsh -NoProfile -File dev_env/stop.ps1            # keeps DB volume
pwsh -NoProfile -File dev_env/stop.ps1 -Volumes   # drops DB volume
```

Tears down both compose variants if they exist.

## Where the configuration lives

All env vars are defined inline in the compose files under each
service's `environment:` block:

- `install/docker-compose.release.yml` — canonical service inventory (services / profiles / env-var contract / volumes). Shared between the release-install path and the contributor flow.
- `dev_env/docker-compose.local.yml` — contributor-flow OVERRIDE; layered on the release compose via `docker compose -f release.yml -f local.yml`. Only carries the deltas: `build:` blocks, `pull_policy: never`, dev-literal substitutions for the three secrets the release file reads from `dashboard.env`, and the `pgadmin` convenience service.
- `dev_env/docker-compose.scaled.yml` — scaled NFR-05 variant, structurally distinct (different project `name:`, container-name suffixes, 3-replica `api`, no fetcher, no pgadmin). Standalone; NOT layered on release.

The values are obviously fake (`local-dev-password`,
`local-dev-token-not-for-production`, etc.) and stable. They are not
secrets and never make it past the developer laptop. Real production
secrets come from Terraform + Azure Key Vault + GitHub Actions
Environments — never from this directory.

## Compose-merge override (issue #21)

The contributor stack `start.ps1` brings up is `docker compose -f install/docker-compose.release.yml -f dev_env/docker-compose.local.yml up -d --build`. Compose merges the override on top of the base per its standard merge rules (later `-f` files override earlier; service `environment:` blocks merge by key; arrays replace; new services append). The override exists because contributors need three things the release stack does not:

1. **Build from source.** Release pulls GHCR-pinned images; contributors need `build:` blocks so iteration on `backend/` / `frontend/` / `gateway/` source produces fresh local images. `pull_policy: never` prevents `docker compose pull` from attempting to pull the locally-tagged `:dev` images from any registry.
2. **Dev-literal secrets.** Release reads `POSTGRES_PASSWORD` / `API_TOKEN` / `ConnectionStrings__DefaultConnection` from `dashboard.env` (written by `install.ps1` from random values). The override re-states the same three keys with the obviously-fake dev literals so the zero-`.env`-file invariant survives. Compose may emit one-line `variable XXX not set` warnings on stderr — cosmetic; see [ADR-0010 § Decision § Mechanics #3](../docs/adr/ADR-0010-dev-env-compose-derives-from-release.md) for the symptom + trade-off analysis.
3. **pgAdmin convenience.** Dropped from the release stack per issue #7.

Every other release-file detail (env-var substitutions like `${FETCHER_POLL_INTERVAL_SECONDS:-30}`, the `fetcher` profile, `${DASHBOARD_PORT:-8080}` mapping, `${DASHBOARD_VERSION:-latest}` image refs that the override redirects via `image:` overrides) is inherited — so an installer-side feature lands in the contributor flow with no porting.

**Adding a dev-only service.** Add it as a new top-level service entry in `dev_env/docker-compose.local.yml`. Compose merge appends services that don't exist in the base. Example: `pgadmin` already shows the pattern — full service definition, host-published port, depends_on the inherited `db`.

**Adding a contributor-flow env-var override.** Add the key to the relevant service's `environment:` block in the override file. Service-level `environment:` blocks merge by key — your override wins for that one key without restating the rest of the env block.

**Adding a build context.** Add `build:` + `image:` + `pull_policy: never` to the service in the override. The build context resolves relative to the override file's directory, so `../backend` from `dev_env/docker-compose.local.yml` resolves to the repo's `backend/` tree.

**Why no `dev_env/start.sh` bash sibling?** Out of scope per issue #21 ("Cross-OS shell sugar (PS-vs-bash parity for start/stop) — that's a separate concern"). PowerShell 7+ is the documented contributor-flow prerequisite.

## Migrations

Startup-applied EF migrations contract per [`docs/install.md` § Migrations](../docs/install.md#migrations). The local stack uses the same path — no separate one-shot service to actuate and no `dotnet-ef` install step in either compose file.

**Contributor delta — authoring a new migration.** Create it from your host (`dotnet ef migrations add ...`) and restart the `api` container; the new migration applies on the next start (idempotent re-apply per the canonical contract).

## Common issues

**`Cannot connect to the Docker daemon`**
Docker Desktop isn't running. Start it and re-run `start.ps1`.

**`Bind for 0.0.0.0:8080 failed: port is already allocated`**
Something else is holding the port. Run `dev_env/stop.ps1`, or
`docker ps` then `docker rm -f <name>`, then retry. (No other app
ports are bound — only `:8080`, `:5432`, and `:5050`.)

**Health check times out**
`start.ps1` dumps `docker compose logs --tail=50` automatically.
Most common causes: startup-applied migrations failed — look at the
`dashboard-api` logs for `Microsoft.EntityFrameworkCore` errors; or the
gateway came up before the API was ready — the gateway healthcheck
will recover on retry. Bump `-HealthTimeoutSeconds 120` on the first
cold-build run.

**Scaled stack: SSE drops after a few seconds**
Confirm `gateway/nginx.conf` is being baked into the gateway image
and that `proxy_buffering off; proxy_read_timeout 1h;` are present in
the `/api/stream` location.

## Overlay-chain story (issue #72)

The contributor stack is built from the release compose base plus one or more overlays.
Which overlays are added depends on the `start.ps1` flag passed.

### Overlay chains per flag

| `start.ps1` flag | Compose chain | Profiles activated |
|---|---|---|
| (no flag — default) | `release.yml` + `demo.yml` + `local.yml` + `demo-local.yml` | `--profile db --profile fetcher` |
| `-LocalDb` | `release.yml` + `local.yml` | `--profile db` |
| `-RealGha` | `release.yml` + `local.yml` | `--profile fetcher` |
| `-RealGha -LocalDb` | `release.yml` + `local.yml` | `--profile db --profile fetcher` |
| `-Integration` | `release.yml` + `local.yml` + `integration.yml` | `--profile db --profile fetcher` |
| `-Scaled` | `scaled.yml` (standalone) | (none) |

### Activation-via-overlay-presence pattern

Two overlays use **presence in the compose chain** as their activation signal — no
profile gating is applied to their services:

- `install/docker-compose.demo.yml` — defines `demo-gha` + `demo-driver` (release-image
  variants). Added by `start.ps1` (default) and `install.ps1 -Demo`.
- `dev_env/docker-compose.demo-local.yml` — local-build overrides for `demo-gha` +
  `demo-driver` (swaps GHCR refs with locally-built `:dev` images). Added by `start.ps1`
  (default) after `demo.yml` in the chain. NOT added for `install.ps1` (release uses GHCR).
- `dev_env/docker-compose.integration.yml` — defines `mock-gha` with host port
  `18080:80` and the fixture bind-mount. Added by `start.ps1 -Integration`.

This avoids two `--profile` flags that would otherwise need to be coordinated
across three files (release + local + overlay). Per ADR-0010, the release file is
the source-of-truth; overlays carry only the deltas.

### Cross-references

- [ADR-0010](../docs/adr/ADR-0010-dev-env-compose-derives-from-release.md) — dev_env compose derives from release.
- [CR-0015](../docs/cr/CR-0015-release-vs-demo-compose-split.md) — release vs demo compose split (issue #72 design-of-record).

## Files

| File | Purpose |
|---|---|
| `docker-compose.local.yml` | Core contributor-flow override — `build:` blocks + dev-literal secrets + pgAdmin for core services (api/dashboard/gateway/fetcher). See [ADR-0010](../docs/adr/ADR-0010-dev-env-compose-derives-from-release.md). |
| `docker-compose.demo-local.yml` | Demo-mode local-build overrides — swaps GHCR-pinned `demo-gha` + `demo-driver` images with locally-built `:dev` tags. Only in chain for demo mode. (issue #72) |
| `docker-compose.integration.yml` | Integration substrate overlay — `mock-gha` with host port `18080:80` + fixture bind-mount. Added to chain by `start.ps1 -Integration` (issue #72 ASR-B). |
| `docker-compose.scaled.yml` | Standalone scaled variant — 3 API replicas behind the gateway. NFR-05 validation. NOT layered on release. |
| `start.ps1` | Thin wrapper: compose up → poll `http://localhost:8080/health` → print URLs. Flags: `-LocalDb`, `-RealGha`, `-Demo`, `-Integration`, `-Scaled`, `-AllowMissingGhaToken`, `-HealthTimeoutSeconds`. |
| `stop.ps1` | Tear down all compose variants (reconstructs the overlay chain for each mode). `-Volumes` to wipe DB data. |
