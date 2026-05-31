# API Specification — `Dashboard.Api`

**Status:** Draft · **Date:** 2026-05-31

Implementation contract for `Dashboard.Api` (co-located Write + Read + Control API).

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/api/openapi.yaml`](api/openapi.yaml) | **The API contract.** Wire shapes, status codes, field rules. Wins on any conflict. |
| [`docs/api/api-guidelines.md`](api/api-guidelines.md) | Companion conventions (naming, pagination, errors, SSE, control plane). |
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
| D3 | **SSE resume cursor = the row `id`.** `Last-Event-ID` replay = `WHERE id > @last ORDER BY id`. | UUIDv7 is insert-time ordered. `happened_at` is emitter-supplied and may arrive out of order, so it cannot be the resume key. Applies to both SSE streams. |
| D4 | Transport via **.NET 10 `Results.ServerSentEvents`** (`SseItem<T>`). | Framework handles `event:`/`data:`/`id:` framing + heartbeat; only the resume key is app logic. |
| D5 | **Unknown write fields → `422`** (not ignored). | `openapi.yaml` sets `additionalProperties: false`; D1 makes openapi authoritative. |
| D6 | **Configurable CORS** via `CORS_ALLOWED_ORIGINS` (default off). | Gateway is optional; backend + frontend may live on different domains. With the gateway (same origin), CORS stays off. |
| D7 | **No Snowflake** for `id`. | A 64-bit int violates `format: uuid`; UUIDv7 gives the same time-ordering, contract-compliant. |
| D8 | **Control API gated by `X-Control-API-Key`** — a key distinct from `X-Api-Key`. | Least-privilege: ingest/fetcher credentials cannot trigger destructive operations or subscribe to the control stream. |
| D9 | **Component events use `X-Api-Key` + `X-Component-Id` header** — not `X-Control-API-Key`, not a body field. | Components already hold `X-Api-Key` for ingest; `X-Component-Id` is an identity token (not a secret) stored verbatim as `component_id`. |
| D10 | **Control plane uses a second PostgreSQL channel `control_events`**, backed by a second `IHostedService`. | Mirrors the `deployment_events` pattern; keeps deployment and orchestration fan-out independent; both channels must be attached for `readyz` to return 200. |
| D11 | **`component_events` and `control_stream_events` have 2-hour retention.** Purged by the same daily background job, separate from `HISTORY_RETENTION_DAYS`. | Short-lived observability data; not a durable audit log. |

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

- **Co-location.** Write, Read, and Control are distinct endpoint-group libraries composed by one `Dashboard.Api` host — one image, future-split seam preserved.
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
| `progress_reporter` | text | yes | from `X-Progress-Reporter` header |

**Indexes**
- PK `(id)` — doubles as the SSE resume index (`id >` scan).
- `(service, environment, happened_at DESC, id DESC)` — Matrix `current`, history drawer, listing tiebreak.
- partial `WHERE status='success'` on `(service, environment, happened_at DESC)` — Matrix `last_successful`.
- `(happened_at DESC, id DESC)` — global listing + cursor.

### `fetcher_state` (non-append, latest-write-wins)

| Column | Type | Notes |
|---|---|---|
| `adapter` | text PK | `^[a-z0-9][a-z0-9-]{0,63}$` |
| `cursor` | text | opaque blob, ≤ 8 KiB → else `413` |
| `updated_at` | timestamptz | latest write wins |

### `control_stream_events` (append-only log, 2 h retention)

Persists events emitted on the control SSE stream; enables `Last-Event-ID` replay for reconnecting components.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | `Guid.CreateVersion7()` — SSE resume cursor (D2, D3) |
| `type` | text | no | e.g. `reset`; open string, forward-compatible |
| `component` | text | no | target component id or `"*"` |
| `occurred_at` | timestamptz | no | server-assigned at emit time |

**Indexes**
- PK `(id)` — SSE resume scan (`id >` query).
- `(component, id)` — optional filter by component on replay.

### `component_events` (append-only log, 2 h retention)

Stores operational events posted by components via `POST /api/control/events`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | no | `Guid.CreateVersion7()` — sort key |
| `component_id` | text | no | from `X-Component-Id` header; `^[a-z0-9][a-z0-9.-]{0,127}$` |
| `event_type` | text | no | `status` \| `heartbeat` \| `error` \| … (open) |
| `state` | text | no | `running` \| `idle` \| `paused` \| `error` |
| `detail` | text | yes | ≤ 512 chars |
| `occurred_at` | timestamptz | no | **component-supplied** (mirrors `happened_at` semantics) |
| `received_at` | timestamptz | no | server-assigned insert time |
| `payload` | jsonb | yes | opaque; stored verbatim; ≤ 8 KiB → else `413` |

**Indexes**
- PK `(id)`.
- `(component_id, received_at DESC, id DESC)` — per-component listing + filter.
- `(received_at DESC, id DESC)` — global listing + cursor.

### Retention

| Table | Retention | Job |
|---|---|---|
| `deployment_events` | `HISTORY_RETENTION_DAYS` (default 365, ≥ 90) | Daily `IHostedService`; `WHERE happened_at < NOW() - interval` |
| `control_stream_events` | **2 hours** (fixed) | Same job; `WHERE occurred_at < NOW() - '2 hours'` |
| `component_events` | **2 hours** (fixed) | Same job; `WHERE received_at < NOW() - '2 hours'` |
| `fetcher_state` | permanent (upsert) | No purge |

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
| control | `POST /api/control/reset` | `X-Control-API-Key` | truncate `deployment_events` + `fetcher_state` + `component_events` + `control_stream_events` → `NOTIFY control_events` with `reset` event → `204` (D8) |
| control-stream | `GET /api/control/stream` | `X-Control-API-Key` | SSE; `event: reset` (+ future types); `id:` = row id; `Last-Event-ID` replay from `control_stream_events` (2 h window); `: ping`/15 s; `?component=` filter |
| control-events | `POST /api/control/events` | `X-Api-Key` + `X-Component-Id` | append 1 row to `component_events`; `component_id` from header (D9); `413` > 8 KiB payload; `422` on missing/invalid header → `204` |
| control-events | `GET /api/control/events` | none | cursor page, `received_at DESC, id DESC`; filters: component_id/event_type/since; 2 h retention window |
| ops | `GET /healthz`, `GET /readyz` | none | liveness / readiness (DB reachable + both LISTEN channels attached, D10) |

---

## 6. Cross-cutting

| Concern | Spec |
|---|---|
| **Auth** | `X-Api-Key` on write, fetcher, and component event POST. `X-Control-API-Key` on control reset and control stream. Both: missing/invalid → `401`. `X-Component-Id` on `POST /api/control/events`: missing/pattern-invalid → `422` (identity header, not an auth secret). Keys from env; never logged or echoed. |
| **Validation** | Closed bodies (`additionalProperties:false`). Failures → `422` `application/problem+json` with `errors[]` (JSON-Pointer + message). |
| **Errors** | RFC 9457 everywhere. No `409` on ingest (append-only). `Retry-After` reserved for `429`/`503`. |
| **CORS** | `CORS_ALLOWED_ORIGINS` (CSV). Empty → no CORS (gateway/same-origin). Set → policy over read GETs **and** the deployment SSE stream. Control stream is component-to-API only; CORS not required. |
| **Statelessness (NFR-05)** | No in-memory cache of state; every read hits the DB. SSE fan-out only via per-instance `LISTEN`. No sticky sessions. |
| **Secrets** | `X-Api-Key` and `X-Control-API-Key` never appear in any body, problem detail, or log line. `X-Component-Id` is not a secret — it is an identity token stored verbatim; never masked. Payloads/cursors stored verbatim, never parsed/logged. |

---

## 7. SSE + LISTEN/NOTIFY

Two independent channels, each served by a dedicated `IHostedService`:

### Channel 1 — `deployment_events` (browser/SPA stream)

1. `IHostedService` holds a dedicated Npgsql connection: `LISTEN deployment_events`. NOTIFY payload = the new row `id`.
2. Notifications fan out through an in-process `Channel<DeploymentEvent>` to each open `GET /api/events/stream` response.
3. Returns `Results.ServerSentEvents(IAsyncEnumerable<SseItem<DeploymentEvent>>)`; `SseItem.EventId` = row `id`.
4. On `Last-Event-ID`: replay `WHERE id > @last ORDER BY id` from `deployment_events`, then attach to the live channel.
5. Optional `?service=` server-side filter.

### Channel 2 — `control_events` (component orchestration stream)

1. `IHostedService` holds a dedicated Npgsql connection: `LISTEN control_events`. NOTIFY payload = the serialised `ControlStreamEvent` JSON.
2. On `POST /api/control/reset`: after truncating tables, `NOTIFY control_events` with a `reset` event; also insert a row into `control_stream_events`.
3. Notifications fan out through an in-process `Channel<ControlStreamEvent>` to each open `GET /api/control/stream` response.
4. Returns `Results.ServerSentEvents(IAsyncEnumerable<SseItem<ControlStreamEvent>>)`; `SseItem.EventId` = row `id`.
5. On `Last-Event-ID`: replay `WHERE id > @last ORDER BY id` from `control_stream_events` (bounded to 2 h retention), then attach to the live channel.
6. Optional `?component=` server-side filter (matches `component == value OR component == "*"`).

### `readyz` dependency

Both LISTEN connections must be established before `GET /readyz` returns `200`. Either missing → `503`.

> Two intentional orderings across both streams: **listing/pagination** sorts `happened_at DESC` / `received_at DESC` then `id DESC` (guidelines §5); **stream resume** sorts `id` only (insert order, D3).

---

## 8. Testing

| Layer | Project | Scope · store |
|---|---|---|
| Unit | `Shared/Write/Read/Control *.Tests` | validation rules, matrix reduction, cursor codec, problem-details mapping, `X-Component-Id` extraction · **SQLite in-memory** |
| Integration | `Dashboard.Api.Tests` | `WebApplicationFactory`: auth 401, ingest 201+Location, 422 envelope, matrix shape, pagination, SSE single-event + resume, control stream SSE + Last-Event-ID replay, component event POST/GET, reset → NOTIFY flow · Postgres (Testcontainers) |

CI runs: `dotnet test backend/Dashboard.sln --settings backend/Dashboard.runsettings`.

---

## 9. Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `ConnectionStrings__Postgres` | — | DB connection |
| `API_KEY` | — | shared write/fetcher/component-event secret (`X-Api-Key`) |
| `CONTROL_API_KEY` | — | control stream + reset secret (`X-Control-API-Key`, D8) |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | CSV of allowed origins; empty disables CORS |
| `HISTORY_RETENTION_DAYS` | `365` | deployment-events retention window (≥ 90); control-plane tables always use fixed 2 h |

---

## 10. Implementation phases (atomic commits)

1. **Scaffold** — sln, 4 src + 4 test projects, `Dashboard.runsettings`, `.dockerignore`; green, format-clean, no endpoints.
2. **Domain + EF** — entities, `DbContext`, initial migration, Npgsql config.
3. **Write** — `POST /api/deployments`, API-key filter, validation/problem-details, NOTIFY.
4. **Read** — list (cursor), get-by-id, matrix (+ETag), discovery.
5. **SSE** — LISTEN broadcaster + stream + `Last-Event-ID` replay.
6. **Fetcher state + Ops** — upsert + `/healthz` + `/readyz`.
7. **Retention job** — deployment events only.
8. **CORS + Dockerfile + integration tests** green.
9. **Control reset** — `Dashboard.Control` library; `POST /api/control/reset`; control-key filter; `Dashboard.Control.Tests`.
10. **Control plane** — `control_stream_events` + `component_events` tables + migrations; second LISTEN `IHostedService`; `GET /api/control/stream` SSE + `Last-Event-ID`; `POST /api/control/events` (`X-Component-Id` extraction); `GET /api/control/events`; extend `readyz` to check both channels; extend retention job for 2 h tables; integration tests.

---

## 11. Out of scope

- `Dashboard.Fetcher` / `fetcher-host` (separate component).
- `gateway/` (separate nginx component — see [`GATEWAY_SPECIFICATION.md`](GATEWAY_SPECIFICATION.md)); the API supports split-domain via D6 CORS regardless.
- `infrastructure/` (Terraform), `dev_env/` (compose) — reserved per SAD §7.
