# Deployment Dashboard — Backend

ASP.NET Core 10 implementation of the two stateless services that back the
Deployment Dashboard. See `docs/deployment-dashboard-architecture.md` (the
authoritative spec) for the full picture; this README only covers how to
build and run the projects in this folder.

## Layout

```
backend/
├── write-api/
│   ├── Dashboard.WriteApi/        # POST /api/deployments, NOTIFY dispatch
│   └── Dashboard.WriteApi.Tests/  # SQLite-in-memory unit tests
├── read-api/
│   ├── Dashboard.ReadApi/         # Matrix, history, discovery, SSE, /health, SPA
│   └── Dashboard.ReadApi.Tests/   # SQLite-in-memory unit tests
├── shared/
│   ├── Dashboard.Shared/          # DbContext, entities, DTOs, migrations,
│   │                              # API-key middleware, NOTIFY/LISTEN, SSE writer
│   └── Dashboard.Shared.Tests/    # Matrix derivation + wire-contract tests
└── Dashboard.sln
```

`shared/` owns the EF Core `DbContext` and the single migrations set; both
APIs reference it.

## Prerequisites

- .NET 10 SDK (verified with `10.0.203`).
- PostgreSQL 16 reachable at the connection string for production / dev.
  Unit tests do not require a running database — they use SQLite in-memory
  via `Microsoft.EntityFrameworkCore.Sqlite`.

## Restore, build, test

From the `backend/` directory:

```powershell
dotnet restore
dotnet build
dotnet test
```

`dotnet build` builds the solution; `dotnet test` runs all unit-test
projects.

## Run the APIs locally

Both APIs read configuration via the standard ASP.NET Core configuration
chain (environment variables override `appsettings.json`).

### Required environment variables

| Variable | Used by | Description |
|---|---|---|
| `ConnectionStrings__DefaultConnection` | both | PostgreSQL Npgsql connection string (e.g. `Host=localhost;Port=5432;Database=dashboard;Username=dashboard;Password=dashboard`). |
| `API_TOKEN` | Write API | Static API key. Every request to `/api/*` on the Write API must include `X-Api-Key: <token>`. Requests with missing/invalid keys are rejected with `401`. |
| `HISTORY_RETENTION_DAYS` | Read API | Retention window for the daily pruning job. Default `365`; values `<= 0` disable pruning. |

Hosting expects port `8080` (per SAD §7). When running outside Docker you
can set the URL explicitly:

```powershell
$env:ASPNETCORE_URLS = "http://localhost:8080"
```

### Apply database migrations

The migrations live under
`shared/Dashboard.Shared/Migrations/`. They are applied with the standard
EF Core CLI:

```powershell
dotnet ef database update --project shared/Dashboard.Shared
```

The connection string is read from `ConnectionStrings__DefaultConnection`.
The `DesignTimeDbContextFactory` in `shared/Dashboard.Shared/Persistence/`
falls back to `localhost:5432` when the variable is unset.

### Start the Write API (PowerShell)

```powershell
$env:ConnectionStrings__DefaultConnection = "Host=localhost;Port=5432;Database=dashboard;Username=dashboard;Password=dashboard"
$env:API_TOKEN = "local-dev-token"
$env:ASPNETCORE_URLS = "http://localhost:8081"
dotnet run --project write-api/Dashboard.WriteApi
```

Quick smoke:

```powershell
curl -X POST http://localhost:8081/api/deployments `
  -H "Content-Type: application/json" `
  -H "X-Api-Key: local-dev-token" `
  -d '{
    "service": "web-portal",
    "environment": "dev",
    "version": "v2.3.1",
    "status": "success",
    "run_url": "https://github.com/org/repo/actions/runs/1247",
    "run_number": 1247,
    "actor": "john.doe"
  }'
```

### Start the Read API (PowerShell)

```powershell
$env:ConnectionStrings__DefaultConnection = "Host=localhost;Port=5432;Database=dashboard;Username=dashboard;Password=dashboard"
$env:HISTORY_RETENTION_DAYS = "365"
$env:ASPNETCORE_URLS = "http://localhost:8080"
dotnet run --project read-api/Dashboard.ReadApi
```

Endpoints:

- `GET  /api/deployments` — current matrix
- `GET  /api/deployments/{service}/{environment}` — single slot
- `GET  /api/deployments/{service}/{environment}/history?limit=50` — history
- `GET  /api/environments` and `GET /api/services` — discovery
- `GET  /api/stream` — SSE (`text/event-stream`), supports `Last-Event-ID`
- `GET  /health` — `200 OK` plus a DB ping
- `GET  /` — serves the Angular SPA from `wwwroot` (empty in source; the
  Dockerfile in `read-api/` will drop the `ng build` output there).

## Wire format

All JSON keys are `snake_case` (`run_url`, `run_number`, `deployed_at`)
except for the slot-level keys `lastSuccessful` and `previousFailed`,
which remain camelCase to match the mockup contract. The `System.Text.Json`
options live in `shared/Dashboard.Shared/Json/DashboardJson.cs`.

## Migrations

- Location: `shared/Dashboard.Shared/Migrations/`.
- Initial migration: `20260514154415_CreateDeploymentsTable` — creates
  the `deployments` table and the
  `ix_deployments_service_environment_deployed_at` index (with
  `deployed_at` descending, per SAD §7 Indexes).
- Add a new migration:

  ```powershell
  dotnet ef migrations add <Name> --project shared/Dashboard.Shared
  ```

## Tests

```powershell
dotnet test
```

- `shared/Dashboard.Shared.Tests/` — matrix derivation across all six box
  states from the mockup, validation rules, JSON wire format, SSE
  formatter, broker fan-out + replay.
- `write-api/Dashboard.WriteApi.Tests/` — `POST /api/deployments` happy
  path, `422` validation, `401` missing/invalid key, append-only behaviour
  on retry, `/health`.
- `read-api/Dashboard.ReadApi.Tests/` — matrix, slot, history (404 +
  ordering + limit), discovery, `/health`.

Tests use SQLite in-memory and an in-process `WebApplicationFactory`; no
PostgreSQL is required.
