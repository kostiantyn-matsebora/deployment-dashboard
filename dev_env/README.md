# dev_env — local Deployment Dashboard stack

Implements WBS §11 MVP §2 of `docs/deployment-dashboard-architecture.md`.

## Topology — App Gateway in front, four app containers behind

Per SAD §7 "App Gateway", the local stack mirrors the Azure topology:

- **`gateway`** — `nginx:alpine`, host port `8080`. **The only entry point.**
  Routes by path + method to the appropriate backend.
- **`dashboard`** — `nginx:alpine` serving the Angular SPA bundle. Internal-only.
- **`write-api`** — ASP.NET Core Minimal API, POST ingest + NOTIFY. Internal-only.
- **`read-api`** — ASP.NET Core Minimal API, matrix / history / discovery / SSE / health. Internal-only.
- **`db`** — PostgreSQL 16. Host port `5432` is published for dev convenience only (psql / EF tooling).
- **`pgadmin`** — host port `5050` for dev convenience.
- **`migrations`** — one-shot SDK container; runs `dotnet ef database update` then exits.

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
  gateway covers Dashboard + Write API + Read API behind it.)
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

Uses `docker-compose.scaled.yml`: same gateway in front, but **3 Read
API replicas + 2 Write API replicas** behind it. Docker DNS resolves
the upstream names to multiple replica IPs and nginx round-robins
across them — the gateway IS the load balancer. The dashboard remains
on the same URL: `http://localhost:8080/`.

This is how we validate the backend is stateless — SSE clients must
reconnect cleanly across replicas via `Last-Event-ID`. Not the default
local-dev experience.

## Stopping

```powershell
pwsh -NoProfile -File dev_env/stop.ps1            # keeps DB volume
pwsh -NoProfile -File dev_env/stop.ps1 -Volumes   # drops DB volume
```

Tears down both compose variants if they exist.

## Where the configuration lives

All env vars are defined inline in the compose files under each
service's `environment:` block:

- `dev_env/docker-compose.local.yml` — default stack.
- `dev_env/docker-compose.scaled.yml` — scaled NFR-05 variant.

The values are obviously fake (`local-dev-password`,
`local-dev-token-not-for-production`, etc.) and stable. They are not
secrets and never make it past the developer laptop. Real production
secrets come from Terraform + Azure Key Vault + GitHub Actions
Environments — never from this directory.

## Migrations

Both compose files run a one-shot `migrations` service that:

1. Mounts `backend/` into a `mcr.microsoft.com/dotnet/sdk:10.0` container.
2. Installs `dotnet-ef` 10.0.0 (cached in a named volume).
3. Runs `dotnet ef database update --project shared/Dashboard.Shared --startup-project shared/Dashboard.Shared`.

Both APIs `depends_on: migrations: service_completed_successfully`, so
they only start once the schema is current. The runtime images stay
SDK-free.

To re-run migrations manually after adding a new EF migration:

```powershell
docker compose -f dev_env/docker-compose.local.yml up migrations --force-recreate
```

## Common issues

**`Cannot connect to the Docker daemon`**
Docker Desktop isn't running. Start it and re-run `start.ps1`.

**`Bind for 0.0.0.0:8080 failed: port is already allocated`**
Something else is holding the port. Run `dev_env/stop.ps1`, or
`docker ps` then `docker rm -f <name>`, then retry. (No other app
ports are bound — only `:8080`, `:5432`, and `:5050`.)

**Health check times out**
`start.ps1` dumps `docker compose logs --tail=50` automatically.
Most common causes: migrations failed — look at `dashboard-migrations`
logs; or the gateway came up before the Read API was ready — the
gateway healthcheck will recover on retry. Bump `-HealthTimeoutSeconds
120` on the first cold-build run.

**Scaled stack: SSE drops after a few seconds**
Confirm `gateway/nginx.conf` is being baked into the gateway image
and that `proxy_buffering off; proxy_read_timeout 1h;` are present in
the `/api/stream` location.

## Files

| File | Purpose |
|---|---|
| `docker-compose.local.yml` | Default local stack — gateway + dashboard + write-api + read-api + db + pgadmin + migrations. |
| `docker-compose.scaled.yml` | Same shape with 3 Read API + 2 Write API replicas behind the gateway. NFR-05 validation. |
| `start.ps1` | Thin wrapper: compose up → poll `http://localhost:8080/health` (via the gateway) → print URLs. `-Scaled`, `-HealthTimeoutSeconds`. |
| `stop.ps1` | Tear down both compose variants. `-Volumes` to wipe DB data. |
