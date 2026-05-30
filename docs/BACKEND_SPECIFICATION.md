# Backend Specification — `Dashboard.Api`

**Status:** Draft · **Date:** 2026-05-30

Implementation contract for `Dashboard.Api` (co-located Write + Read API).

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/api/openapi.yaml`](api/openapi.yaml) | **The API contract.** Wire shapes, status codes, field rules. Wins on any conflict. |
| [`docs/api/api-guidelines.md`](api/api-guidelines.md) | Companion conventions (naming, pagination, errors, SSE). |
| [`docs/SAD.md`](SAD.md) | Architecture, NFRs, domain model, retention. |
| [`docs/FRONTEND_REQUIREMENTS.md`](FRONTEND_REQUIREMENTS.md) | Read-side consumer (Matrix + Swimlanes). |

> `CR-####` / `ADR-####` documents referenced elsewhere **do not exist** — ignore those citations.

---

## 1. Stack

| Aspect | Value |
|---|---|
| Language / runtime | C# / **.NET 10** |
| Framework | ASP.NET Core **Minimal API** |
| ORM / driver | **EF Core 10 + Npgsql** |
| Store | PostgreSQL (prod + local dev); **SQLite in-memory** (unit tests only) |
| Real-time | PostgreSQL **LISTEN/NOTIFY** → SSE via .NET 10 `Results.ServerSentEvents` |
| Migrations | `dotnet-ef` 10.0.0 (pinned in `.config/dotnet-tools.json`) |
| Format gate | `dotnet format backend/Dashboard.sln --verify-no-changes` (blocking) |
| Coverage | XPlat Code Coverage → cobertura via `backend/Dashboard.runsettings` |

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **`openapi.yaml` is the single source of truth** for the API. | Locked answer to planning Q2. |
| D2 | Row `id` is a **time-ordered UUIDv7** (`Guid.CreateVersion7()`), server-assigned. | One value = unique surrogate **and** sortable cursor. Satisfies `format: uuid` with no schema change. |
| D3 | **SSE resume cursor = the row `id`.** `Last-Event-ID` replay = `WHERE id > @last ORDER BY id`. | UUIDv7 is insert-time ordered. `happened_at` is emitter-supplied and may arrive out of order, so it cannot be the resume key. |
| D4 | Transport via **.NET 10 `Results.ServerSentEvents`** (`SseItem<T>`). | Framework handles `event:`/`data:`/`id:` framing + heartbeat; only the resume key is app logic. |
| D5 | **Unknown write fields → `422`** (not ignored). | `openapi.yaml` sets `additionalProperties: false`; D1 makes openapi authoritative. |
| D6 | **Configurable CORS** via `CORS_ALLOWED_ORIGINS` (default off). | Gateway is optional; backend + frontend may live on different domains. With the gateway (same origin), CORS stays off. |
| D7 | **No Snowflake** for `id`. | A 64-bit int violates `format: uuid`; UUIDv7 gives the same time-ordering, contract-compliant. |
| D8 | **Control API gated by `X-Control-API-Key`** — a key distinct from `X-Api-Key`. | Least-privilege: ingest/fetcher credentials cannot trigger destructive control operations. |

---

## 3. Solution layout

One host image composed from endpoint-group libraries:

```
backend/
  Dashboard.sln
  Dashboard.runsettings              # XPlat coverage (CI consumes it)
  .dockerignore
  shared/      Dashboard.Shared/      # domain entities, DbContext, problem-details, contracts
  write-api/   Dashboard.Write/       # ingest endpoint group (library)
  read-api/    Dashboard.Read/        # matrix / history / discovery / SSE (library)
  control-api/ Dashboard.Control/     # control endpoint group (library)
  api/         Dashboard.Api/         # composition host (Program.cs) + Dockerfile
  tests/
    Dashboard.Shared.Tests/
    Dashboard.Write.Tests/
    Dashboard.Read.Tests/
    Dashboard.Control.Tests/
    Dashboard.Api.Tests/             # WebApplicationFactory end-to-end
```

- **Co-location.** Write & Read are distinct endpoint-group libraries (`MapWriteEndpoints` / `MapReadEndpoints`) composed by one `Dashboard.Api` host — one image, future-split seam preserved.
- **Test scoping** — fetcher tests live with the fetcher component, not in these projects; the API test run excludes `Dashboard.Fetcher.Tests`.

---

## 4. Data model

### `deployment_events` (append-only log)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | `Guid.CreateVersion7()` — surrogate **and** stream cursor (D2) |
| `deployment_id` | text | no | correlation key; NOT unique, NO dedup |
| `service` | text | no | |
| `environment` | text | no | |
| `version` | text | yes | ≤ 50 chars |
| `status` | text | no | `in-progress` \| `success` \| `failure` |
| `happened_at` | timestamptz | no | **emitter-supplied**; all read ordering uses this |
| `run_url` | text | yes | ≤ 2048 |
| `run_number` | text | yes | ≤ 128 |
| `actor` | text | yes | ≤ 128 |
| `ref` | text | yes | ≤ 256, opaque |
| `sha` | text | yes | ≤ 128, opaque |
| `parent_deployments` | text[] | yes | ≤ 32, stored verbatim, not resolved |
| `progress_reporter` | text | yes | from `X-Progress-Reporter` |

**Indexes**
- PK `(id)` — doubles as the SSE resume index (`id >` scan).
- `(service, environment, happened_at DESC, id DESC)` — Matrix `current`, history drawer, listing tiebreak.
- partial `WHERE status='success'` on `(service, environment, happened_at DESC)` — Matrix `last_successful`.
- `(happened_at DESC, id DESC)` — global listing + cursor.

### `fetcher_state` (the only non-append surface)

| Column | Type | Notes |
|---|---|---|
| `adapter` | text PK | `^[a-z0-9][a-z0-9-]{0,63}$` |
| `cursor` | text | opaque blob, ≤ 8 KiB → else `413` |
| `updated_at` | timestamptz | latest write wins |

### Retention

Daily `IHostedService` deletes `WHERE happened_at < NOW() - HISTORY_RETENTION_DAYS`. Env-configurable, default `365`, NFR-07 floor 90.

---

## 5. Endpoints

| Surface | Method · Path | Auth | Behaviour |
|---|---|---|---|
| ingest | `POST /api/deployments` | `X-Api-Key` | append 1 row → `NOTIFY deployment_events` → `201` + `Location` |
| deployments | `GET /api/deployments` | none | cursor page, `happened_at DESC, id DESC`; filters: service/environment/status/deployment_id/since/until |
| deployments | `GET /api/deployments/{id}` | none | single row / `404` |
| matrix | `GET /api/matrix` | none | `current` + `last_successful` per slot; weak `ETag` + `If-None-Match` |
| discovery | `GET /api/services`, `GET /api/environments` | none | distinct, sorted |
| stream | `GET /api/events/stream` | none | SSE; `event: deployment`; `id:` = row id; `Last-Event-ID` replay; `: ping`/15 s |
| fetcher | `GET/PUT /api/fetcher/state/{adapter}` | `X-Api-Key` | opaque upsert; `413` > 8 KiB |
| control | `POST /api/control/reset` | `X-Control-API-Key` | delete all rows from `deployment_events` + `fetcher_state` → `204` (D8) |
| ops | `GET /healthz`, `GET /readyz` | none | liveness / readiness (DB reachable + LISTEN attached) |

---

## 6. Cross-cutting

| Concern | Spec |
|---|---|
| **Auth** | `X-Api-Key` endpoint filter on write + fetcher. `X-Control-API-Key` endpoint filter on control surface (D8). Both: missing/invalid → `401` (FR-10). Keys from env; never logged or echoed. |
| **Validation** | Closed bodies (`additionalProperties:false`). Failures → `422` `application/problem+json` with `errors[]` (JSON-Pointer + message). |
| **Errors** | RFC 9457 everywhere. No `409` on ingest (append-only). `Retry-After` reserved for `429`/`503`. |
| **CORS** | `CORS_ALLOWED_ORIGINS` (CSV). Empty → no CORS (gateway/same-origin). Set → policy over read GETs **and** the SSE stream (EventSource is CORS-gated cross-origin). No credentials. |
| **Statelessness (NFR-05)** | No in-memory cache of state; every read hits the DB. SSE fan-out only via per-instance `LISTEN`. No sticky sessions. |
| **Secrets** | `X-Api-Key` and `X-Control-API-Key` never appear in any body, problem detail, or log line. Cursors stored verbatim, never parsed/logged. |

---

## 7. SSE + LISTEN/NOTIFY

1. One `IHostedService` per instance holds a dedicated Npgsql connection: `LISTEN deployment_events`. NOTIFY payload = the new row `id`.
2. Notifications fan out through an in-process `Channel<DeploymentEvent>` to each open SSE response.
3. `GET /api/events/stream` returns `Results.ServerSentEvents(IAsyncEnumerable<SseItem<DeploymentEvent>>)`; `SseItem.EventId` = row `id`.
4. On `Last-Event-ID`: replay `WHERE id > @last ORDER BY id` from the DB, then attach to the live channel.
5. Optional `?service=` server-side filter.

> Two intentional orderings: **listing** pagination sorts `happened_at DESC, id DESC` (guidelines §5); **stream** resume sorts `id` only (insert order).

---

## 8. Testing

| Layer | Project | Scope · store |
|---|---|---|
| Unit | Shared/Write/Read `*.Tests` | validation rules, matrix reduction, cursor codec, problem-details mapping · **SQLite in-memory** |
| Integration | `Dashboard.Api.Tests` | `WebApplicationFactory`: auth 401, ingest 201+Location, 422 envelope, matrix shape, pagination, SSE single-event + resume · Postgres (Testcontainers) |

CI runs: `dotnet test backend/Dashboard.sln --settings backend/Dashboard.runsettings`.

---

## 9. Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `ConnectionStrings__Postgres` | — | DB connection |
| `API_KEY` | — | shared write/fetcher secret (`X-Api-Key`) |
| `CONTROL_API_KEY` | — | control surface secret (`X-Control-API-Key`, D8) |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | CSV of allowed origins; empty disables CORS |
| `HISTORY_RETENTION_DAYS` | `365` | retention window (≥ 90) |

---

## 10. Implementation phases (atomic commits)

1. **Scaffold** — sln, 4 src + 4 test projects, `Dashboard.runsettings`, `.dockerignore`; green, format-clean, no endpoints.
2. **Domain + EF** — entities, `DbContext`, initial migration, Npgsql config.
3. **Write** — `POST /api/deployments`, API-key filter, validation/problem-details, NOTIFY.
4. **Read** — list (cursor), get-by-id, matrix (+ETag), discovery.
5. **SSE** — LISTEN broadcaster + stream + `Last-Event-ID` replay.
6. **Fetcher state + Ops** — upsert + `/healthz` + `/readyz`.
7. **Retention job.**
8. **CORS + Dockerfile + integration tests** green.
9. **Control API** — `Dashboard.Control` library; `POST /api/control/reset`; control-key filter; `Dashboard.Control.Tests`.

---

## 11. Out of scope

- `Dashboard.Fetcher` / `fetcher-host` (separate component).
- `gateway/` (separate nginx component — see [`GATEWAY_SPECIFICATION.md`](GATEWAY_SPECIFICATION.md)); the API supports split-domain via D6 CORS regardless.
- `infrastructure/` (Terraform), `dev_env/` (compose) — reserved per SAD §7.
