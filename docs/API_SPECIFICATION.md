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
| D10 | **Control plane uses a second PostgreSQL channel `control_events`**, backed by a second `IHostedService`. | Mirrors the `deployment_events` pattern; keeps deployment and orchestration fan-out independent; all LISTEN channels (incl. `component_acks`, D12) must be attached for `readyz` to return 200. |
| D11 | **`component_events` and `control_stream_events` have 2-hour retention.** Purged by the same daily background job, separate from `HISTORY_RETENTION_DAYS`. | Short-lived observability data; not a durable audit log. |
| D12 | **Reset is a choreography driven by a state machine** built on the **Stateless** library (`dotnet-state-machine/stateless`). Current state is **externally persisted** in a single `reset_cycle` DB row (loaded per transition); a **Postgres advisory lock** elects a single driver across instances (NFR-05). A `GateMaxTtlSeconds` safety abort releases gates if the driving instance dies mid-cycle. | Stateless transitions are pure/in-memory; persistence + advisory lock make them correct across stateless API replicas without sticky sessions. |
| D13 | **Proceed when both expected acks are in OR `AckTimeoutSeconds` elapses** (default 10 s). Components are optional — the choreography never blocks indefinitely. | Demo-driver / fetcher are optional deployments; a missing component must not wedge a reset. |
| D14 | **Reset clears only `deployment_events` + `fetcher_state`.** Control/component tables (`control_stream_events`, `component_events`, `reset_cycle`) are left to the existing 2 h retention job. | The reset choreography itself emits control/component rows; truncating them would erase the in-flight audit trail. |
| D15 | **Event vocabulary `reset-initiated` / `reset-started` / `reset-completed`**; the legacy single `reset` type is **dropped (no alias)**. | One phaseless event cannot express drain → clear → recover; additive evolution per guidelines §3 (this surface has no external consumers yet). |
| D16 | **Ack contract:** `POST /api/control/events` `{event_type: reset-ack, state: paused}` + **required** header `X-Correlation-Id` = the `id` of the `reset-initiated` event. The ack-gate keys on `correlation_id` (#265, Option A — `reset_id` retired). | Reuses the existing component-event inbound endpoint; one universal `correlation_id` correlates + gates acks per cycle, and makes the whole saga filterable end-to-end. |
| D17 | **No reset status endpoint** — progress is observable via control-stream events only. | Avoids a polled status surface; the stream already carries every phase transition. |

Visual reference: [`docs/diagrams/reset-choreography.md`](diagrams/reset-choreography.md) (sequence + state diagrams).

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
| `status` | text | no | `pending` \| `queued` \| `waiting` \| `in-progress` \| `success` \| `failure` \| `cancelled` \| `rejected` |
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
| `id` | uuid PK | no | `Guid.CreateVersion7()` — SSE resume cursor (D2, D3). Always unique per row; **distinct** from `correlation_id` |
| `type` | text | no | e.g. `reset-initiated` \| `reset-started` \| `reset-completed`; open string, forward-compatible |
| `component` | text | no | target component id or `"*"` |
| `correlation_id` | uuid | no | the process id — on `reset-initiated` equals this row's own `id` (origin); on `reset-started` / `reset-completed` the initiating `reset-initiated` `id`. Present on every reset frame (nullable in schema only for forward-compat with future non-reset types) |
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
| `correlation_id` | text | yes | from `X-Correlation-Id` header; opaque, ≤ 128 chars; the process key, **distinct** from `id`. For reset = the `reset-initiated` event id. **REQUIRED on `reset-ack` — this IS the ack-gate key.** `null` when absent (allowed on non-reset posts) |
| `event_type` | text | no | `status` \| `heartbeat` \| `error` \| … (open) |
| `state` | text | no | `running` \| `idle` \| `paused` \| `error` |
| `detail` | text | yes | ≤ 512 chars |
| `occurred_at` | timestamptz | no | **component-supplied** (mirrors `happened_at` semantics) |
| `received_at` | timestamptz | no | server-assigned insert time |
| `payload` | jsonb | yes | opaque; stored verbatim; ≤ 8 KiB → else `413` |

**Indexes**
- PK `(id)`.
- `(component_id, received_at DESC, id DESC)` — per-component SSE replay filter.
- `(received_at DESC, id DESC)` — global SSE replay + cursor.
- `(correlation_id)` — the ack-gate matches reset-acks by `correlation_id`, and read surfaces filter the saga by it. Partial `WHERE correlation_id IS NOT NULL` keeps it lean.

### `reset_cycle` (single-row reset state, D12)

Externally-persisted state for the reset state machine. **Single row** (fixed PK `1`) — the choreography is strictly serial (one reset in flight; `409` otherwise), so a single upserted row is sufficient and simpler than an append log. Loaded per transition; the Stateless machine reads `state`, mutates, writes back under the advisory lock.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | smallint PK | no | always `1` — enforces single row |
| `state` | text | no | `idle` \| `draining` \| `resetting` (D12) |
| `correlation_id` | uuid | yes | the current cycle's process id — the `id` of its `reset-initiated` event; `null` when `idle`. The ack-gate matches incoming reset-ack `correlation_id` against this |
| `expected_components` | text[] | yes | snapshot of `ExpectedComponents` at cycle start (D13) |
| `acks_received` | text[] | yes | component ids that have posted `reset-ack` for this `correlation_id` |
| `started_at` | timestamptz | yes | when the current cycle entered `draining` |
| `deadline_at` | timestamptz | yes | `started_at + AckTimeoutSeconds`; also bounded by `GateMaxTtlSeconds` for the abort path |

**Not covered by deployment retention** — a control-plane state row, not history. It is **not** truncated by a reset (D14) and is exempt from `HISTORY_RETENTION_DAYS`; it persists across cycles, overwritten in place.

### Retention

| Table | Retention | Job |
|---|---|---|
| `deployment_events` | `HISTORY_RETENTION_DAYS` (default 365, ≥ 90) | Daily `IHostedService`; `WHERE happened_at < NOW() - interval` |
| `control_stream_events` | **2 hours** (fixed) | Same job; `WHERE occurred_at < NOW() - '2 hours'` |
| `component_events` | **2 hours** (fixed) | Same job; `WHERE received_at < NOW() - '2 hours'` |
| `reset_cycle` | permanent (single row, upsert) | No purge — control-plane state, not history |
| `fetcher_state` | permanent (upsert) | No purge |

---

## 5. Endpoints

| Surface | Method · Path | Auth | Behaviour |
|---|---|---|---|
| ingest | `POST /api/deployments` | `X-Api-Key` | append 1 row → `NOTIFY deployment_events` → `201` + `Location`; **`503` + `Retry-After`** during the reset data-clearing window (state `resetting`) |
| deployments | `GET /api/deployments` | none | cursor page, `happened_at DESC, id DESC`; filters: service/environment/status/deployment_id/since/until |
| deployments | `GET /api/deployments/{id}` | none | single row / `404` |
| matrix | `GET /api/matrix` | none | `current` (latest **effective**: `in-progress`/`success`/`failure`) + `last_successful` + optional `next` (latest **non-effective**: `pending`/`queued`/`waiting`/`cancelled`/`rejected`, only when newer than `current`) per slot; weak `ETag` + `If-None-Match` |
| discovery | `GET /api/services`, `GET /api/environments` | none | distinct, sorted |
| stream | `GET /api/events/stream` | none | SSE; `event: deployment`; `id:` = row id; `Last-Event-ID` replay; `: ping`/15 s |
| fetcher | `GET/PUT /api/fetcher/state/{adapter}` | `X-Api-Key` | opaque upsert; `413` > 8 KiB |
| control | `POST /api/control/reset` | `X-Control-API-Key` | **async** (D8, D12): emit `reset-initiated` (state `idle→draining`) → `202` + `ResetAccepted{correlation_id, state}`; drain + ack-or-timeout → `reset-started` (`draining→resetting`, ingest gate ON) → clear **only `deployment_events` + `fetcher_state`** (D14) → `reset-completed` (`resetting→idle`); `409` if a reset is already in flight |
| control-stream | `GET /api/control/stream` | `X-Control-API-Key` | SSE; `event:` ∈ `reset-initiated` \| `reset-started` \| `reset-completed` (+ future types); `id:` = row id; `Last-Event-ID` replay from `control_stream_events` (2 h window); `: ping`/15 s; `?component=` filter |
| control-events | `POST /api/control/events` | `X-Api-Key` + `X-Component-Id` (+ optional `X-Correlation-Id`) | append 1 row to `component_events`; `component_id` from header (D9); optional `correlation_id` from `X-Correlation-Id` (opaque ≤ 128, nullable); `NOTIFY component_events <id>`; `413` > 8 KiB payload; `422` on missing/invalid `X-Component-Id` or `X-Correlation-Id` > 128 chars → `204` |
| control-events-stream | `GET /api/control/events/stream` | none | SSE; `event: component`; `id:` = row id (UUIDv7); `Last-Event-ID` replay from `component_events` (2 h window); `: ping`/15 s; fresh connect = live only; no query filters |
| ops | `GET /healthz`, `GET /readyz` | none | liveness / readiness (DB reachable + all four LISTEN channels attached: `deployment_events`, `control_events`, `component_acks`, `component_events` — D10, D12) |

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

Four independent channels, each served by a dedicated `IHostedService`:

### Channel 1 — `deployment_events` (browser/SPA stream)

1. `IHostedService` holds a dedicated Npgsql connection: `LISTEN deployment_events`. NOTIFY payload = the new row `id`.
2. Notifications fan out through an in-process `Channel<DeploymentEvent>` to each open `GET /api/events/stream` response.
3. Returns `Results.ServerSentEvents(IAsyncEnumerable<SseItem<DeploymentEvent>>)`; `SseItem.EventId` = row `id`.
4. On `Last-Event-ID`: replay `WHERE id > @last ORDER BY id` from `deployment_events`, then attach to the live channel.
5. Optional `?service=` server-side filter.

### Channel 2 — `control_events` (component orchestration stream)

1. `IHostedService` holds a dedicated Npgsql connection: `LISTEN control_events`. NOTIFY payload = the serialised `ControlStreamEvent` JSON.
2. The reset choreography (D12) emits three events on this channel — `reset-initiated` (on accept), `reset-started` (acks-in/timeout), `reset-completed` (data cleared) — each `NOTIFY control_events` + an inserted `control_stream_events` row. Data is cleared (only `deployment_events` + `fetcher_state`, D14) between `reset-started` and `reset-completed`.
3. Notifications fan out through an in-process `Channel<ControlStreamEvent>` to each open `GET /api/control/stream` response.
4. Returns `Results.ServerSentEvents(IAsyncEnumerable<SseItem<ControlStreamEvent>>)`; `SseItem.EventId` = row `id`.
5. On `Last-Event-ID`: replay `WHERE id > @last ORDER BY id` from `control_stream_events` (bounded to 2 h retention), then attach to the live channel.
6. Optional `?component=` server-side filter (matches `component == value OR component == "*"`).

### Channel 3 — `component_acks` (reset ack fan-in)

The reset orchestrator must learn when a component has drained, across API instances (the driving instance — holder of the advisory lock — may not be the one that received the ack POST). Mechanism:

1. `POST /api/control/events` with `event_type = reset-ack` inserts the `component_events` row as usual, then `NOTIFY component_acks` with payload `{component_id, correlation_id}`.
2. A dedicated `IHostedService` `LISTEN component_acks` (third channel) forwards each ack to the driving instance, which adds the `component_id` to `reset_cycle.acks_received` for the matching `correlation_id` under the advisory lock.
3. When `acks_received ⊇ expected_components` **or** `deadline_at` passes, the state machine fires `draining → resetting`.

Only `reset-ack` events trigger the NOTIFY; ordinary `status` / `heartbeat` / `error` events do not. Acks whose `correlation_id` does not match the current cycle's `correlation_id` are ignored (stale/duplicate-safe).

**Ack-gate key — `correlation_id` (binding).** The NOTIFY payload and the fan-in match are derived from the **`correlation_id` column** (sourced from the `X-Correlation-Id` header), matched against `reset_cycle.correlation_id`. `X-Correlation-Id` is **REQUIRED on `reset-ack`**: a reset-ack with a missing/invalid/mismatched `correlation_id` is still recorded (`204`) but does **NOT** count toward the gate. There is no `reset_id` body field — the gate reads `correlation_id` only.

### Channel 4 — `component_events` (component-event SSE stream)

Mirrors Channel 1 (`deployment_events`) exactly, but fans out component-reported events instead of deployment events.

1. `POST /api/control/events` inserts the `component_events` row, then issues `NOTIFY component_events <id>` — **id only** (NOT the full JSON; a `payload` can be up to 8 KiB, exceeding the ~8000-byte Postgres NOTIFY limit).
2. A singleton background broadcaster `ComponentEventBroadcaster` (`IHostedService`) holds one dedicated Npgsql connection with `LISTEN component_events`. On each notification, it fetches the full row by id from the DB, then fans it out through an in-process `Channel<ComponentEventRecord>` to all open `GET /api/control/events/stream` responses.
3. This **mirrors `DeploymentEventBroadcaster` exactly** (id-only NOTIFY → DB fetch → fan-out). It differs from `ControlEventBroadcaster` (Channel 2), which carries the whole event in the NOTIFY payload.
4. Returns `Results.ServerSentEvents(IAsyncEnumerable<SseItem<ComponentEventRecord>>)`; `event: component`; `SseItem.EventId` = row `id`. Each `ComponentEventRecord` includes `correlation_id` (the stored value, or `null`).
5. On `Last-Event-ID`: replay `WHERE id > @last ORDER BY id` from the existing `component_events` table (already 2 h retention) — then attach to the live channel. Migration (no new tables): `component_events.correlation_id` + its index; rename `control_stream_events.reset_id` → `correlation_id`; rename `reset_cycle.reset_id` → `correlation_id`.
6. No query filters on the stream endpoint.

### `readyz` dependency

All LISTEN connections must be established before `GET /readyz` returns `200`. Any missing → `503`. Four required checks: `deployment_events`, `control_events`, `component_acks`, and `component_events` (D10).

> Two intentional orderings across all streams: **listing/pagination** sorts `happened_at DESC` / `received_at DESC` then `id DESC` (guidelines §5); **stream resume** sorts `id` only (insert order, D3).

---

## 8. Testing

| Layer | Project | Scope · store |
|---|---|---|
| Unit | `Shared/Write/Read/Control *.Tests` | validation rules, matrix reduction, cursor codec, problem-details mapping, `X-Component-Id` extraction · **SQLite in-memory** |
| Integration | `Dashboard.Api.Tests` | `WebApplicationFactory`: auth 401, ingest 201+Location, 422 envelope, matrix shape, pagination, SSE single-event + resume, control stream SSE + Last-Event-ID replay, component event POST + SSE stream + Last-Event-ID replay, reset → NOTIFY flow · Postgres (Testcontainers) |

CI runs: `dotnet test backend/Dashboard.sln --settings backend/Dashboard.runsettings`.

---

## 9. Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `postgres` / `5432` / `deployment_dashboard` / — / — | DB connection parts; the app assembles the connection string (appsettings `Postgres` section = base, these env vars override) |
| `API_KEY` | — | shared write/fetcher/component-event secret (`X-Api-Key`) |
| `CONTROL_API_KEY` | — | control stream + reset secret (`X-Control-API-Key`, D8) |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | CSV of allowed origins; empty disables CORS |
| `HISTORY_RETENTION_DAYS` | `365` | deployment-events retention window (≥ 90); control-plane tables always use fixed 2 h |

**Reset choreography (appsettings + env, D12–D13).** These bind from `appsettings.json` (PascalCase `Reset` section) **and** are overridable via flat `SCREAMING_SNAKE` env vars. `RESET_EXPECTED_COMPONENTS` is a CSV string (replaces the old indexed-array `Reset__ExpectedComponents__0…` override, eliminating the array-append footgun).

| Key (appsettings) | Env override | Default | Purpose |
|---|---|---|---|
| `Reset:AckTimeoutSeconds` | `RESET_ACK_TIMEOUT_SECONDS` | `10` | Max seconds to await component acks before forcing `draining → resetting` (D13). |
| `Reset:ExpectedComponents` | `RESET_EXPECTED_COMPONENTS` (CSV string) | `dashboard-fetcher,demo-driver` | Component ids whose acks are awaited; snapshotted into `reset_cycle.expected_components` at cycle start. |
| `Reset:GateMaxTtlSeconds` | `RESET_GATE_MAX_TTL_SECONDS` | `60` | Hard wall-clock ceiling on the entire orchestrator cycle (draining → resetting → idle), including data clearing. When exceeded: state forced to `idle`, `reset-completed` emitted on the control stream (so components recover), advisory lock released. Prevents a hung DB call wedging ingest indefinitely. |

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
10. **Control plane** — `control_stream_events` + `component_events` tables + migrations; second LISTEN `IHostedService` (`ControlEventBroadcaster`); `GET /api/control/stream` SSE + `Last-Event-ID`; `POST /api/control/events` (`X-Component-Id` extraction, `NOTIFY component_events <id>`); fourth LISTEN `IHostedService` (`ComponentEventBroadcaster`): id-only NOTIFY → DB fetch → fan-out → `GET /api/control/events/stream` SSE + `Last-Event-ID`; extend `readyz` to check all four channels; extend retention job for 2 h tables; integration tests.
11. **Reset choreography** — `reset_cycle` table + migration; Stateless state machine (`idle/draining/resetting`) with DB-persisted state loaded per transition + Postgres advisory-lock single-driver election (D12); `GateMaxTtlSeconds` safety abort; ingest gate (`503` + `Retry-After` while `resetting`); `POST /api/control/reset` reworked to `202`/`409` async, emitting `reset-initiated`/`reset-started`/`reset-completed`; ack fan-in via `component_acks` NOTIFY + third LISTEN `IHostedService` (D16); reset clears **only** `deployment_events` + `fetcher_state` (D14); `Reset:*` config (appsettings + env); `readyz` now checks all four LISTEN channels (`deployment_events`, `control_events`, `component_acks`, `component_events`); integration tests (drain → ack-or-timeout → clear → recover, `409` reentry, `503` ingest window, `GateMaxTtl` abort, component-events SSE + Last-Event-ID). Atomic commit. Canonical visual: [`docs/diagrams/reset-choreography.md`](diagrams/reset-choreography.md).

---

## 11. Out of scope

- `Dashboard.Fetcher` / `fetcher-host` (separate component).
- `gateway/` (separate nginx component — see [`GATEWAY_SPECIFICATION.md`](GATEWAY_SPECIFICATION.md)); the API supports split-domain via D6 CORS regardless.
- `infrastructure/` (Terraform), `dev_env/` (compose) — reserved per SAD §7.
