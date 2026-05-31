# API Guidelines

Companion to [`openapi.yaml`](./openapi.yaml). Binding for every implementer of `Dashboard.Api`, `Dashboard.Fetcher`, and the Angular SPA.

---

## 1. Naming

| Surface | Convention | Example |
|---|---|---|
| URI path segments | lower kebab-case, plural nouns | `/api/deployments`, `/api/fetcher/state` |
| Path params | lower kebab-case | `{adapter}` |
| Query params | lower snake_case | `?since=…&run_number=…` |
| JSON fields | lower snake_case | `deployment_id`, `parent_deployments`, `happened_at` |
| Enum values | lower kebab-case | `in-progress`, `success`, `failure` |
| Headers | `Train-Case` | `X-Api-Key`, `X-Component-Id`, `Last-Event-ID` |

**Verb mapping.**
- Side-effecting writes → `POST` (append-only ingest) or `PUT` (idempotent upsert, fetcher cursor).
- Named destructive actions on the control surface → `POST` (e.g. `reset`).
- Reads → `GET`. No `PATCH`.
- No `DELETE` on the public API — retention is owned by the backend background job per SAD §11 Retention.

---

## 2. Required headers

| Header | Direction | When | Value |
|---|---|---|---|
| `X-Api-Key` | request | every write call (`POST /api/deployments`, `GET/PUT /api/fetcher/state/*`, `POST /api/control/events`) | Static shared secret. |
| `X-Control-API-Key` | request | control stream + reset (`POST /api/control/reset`, `GET /api/control/stream`) | Static shared secret, distinct from `X-Api-Key` (D8). |
| `X-Component-Id` | request | **required** on `POST /api/control/events` | Component identifier. Pattern: `^[a-z0-9][a-z0-9.-]{0,127}$`. Stored as `component_id` on the row. |
| `X-Progress-Reporter` | request | optional on `POST /api/deployments` | Ingest attribution. Format: `<emitter>/<adapter>`. Stored alongside the deployment event row. |
| `Content-Type` | request | every body-bearing call | `application/json; charset=utf-8` |
| `Accept` | request | optional | `application/json`, or `text/event-stream` for SSE endpoints. |
| `Last-Event-ID` | request | SSE reconnect (deployment stream **and** control stream) | Last seen event id; server replays everything strictly greater within retention window. |
| `Retry-After` | response | `429`, `503` | Integer seconds. |
| `ETag` / `If-None-Match` | both | `GET /api/matrix` | Weak ETag; SPA SHOULD send `If-None-Match` on poll-mode fallback. |

---

## 3. Versioning

- **Single live version.** No `/v1` segment — internal-only tooling (NFR-04), one tenant, one consumer.
- **Evolution is additive only.** New optional fields, new endpoints, new enum values appended at the tail.
- **Breaking change ⇒ new path prefix.** A v2 surface lives at `/api/v2/...` side-by-side with `/api/...` until the SPA + notify step + fetcher are all migrated.
- **Write bodies are closed.**
  - `openapi.yaml` sets `additionalProperties: false` on ingest + fetcher-upsert bodies.
  - Unknown fields on write → `422` (not silently ignored).
  - Forward-compat: additive evolution (new optional fields only); never lenient parsing.
- **Read responses are open.** Clients MUST ignore unknown JSON fields (forward-compat with newer servers).

---

## 4. Authentication

| Surface | Auth | Rationale |
|---|---|---|
| `POST /api/deployments` | `X-Api-Key` | FR-10 — every write rejected with `401` on missing/invalid key. |
| `GET/PUT /api/fetcher/state/{adapter}` | `X-Api-Key` | Mutates persistent state; same trust tier as ingest. |
| `POST /api/control/events` | `X-Api-Key` | Components share the existing ingest key — no additional credential needed. |
| `POST /api/control/reset` | `X-Control-API-Key` | Destructive operation (D8); ingest key grants no control access. |
| `GET /api/control/stream` | `X-Control-API-Key` | Control stream is for trusted internal components; separates subscription privilege from ingest. |
| `GET /api/control/events` | none | Read-only observability; consistent with other GET endpoints. |
| `GET /api/matrix`, `GET /api/deployments`, `GET /api/services`, `GET /api/environments` | none | Internal-only network (NFR-04); SPA never holds a secret. |
| `GET /api/events/stream` | none | Same as other reads; auth would defeat browser EventSource. |
| `GET /healthz`, `GET /readyz` | none | Probe surfaces. |

The dev/local fake key is configured in the API container's environment and is **never** embedded in the SPA bundle.

---

## 5. Pagination, filtering, sorting

- **Cursor pagination only.** Endpoints that paginate accept `cursor` + `limit`; response carries `next_cursor` (nullable).
- **No `offset` / `page`.**
- **Cursors are opaque** base64 blobs — clients MUST NOT parse them.
- **Default `limit` = 100, max = 500.** Out-of-range → `422`. (`GET /api/control/events` default = 50, max = 200.)
- **Default sort** for `GET /api/deployments` is `happened_at DESC` then `id DESC` as a tiebreaker (stable for cursor resume).
- **Default sort** for `GET /api/control/events` is `received_at DESC` then `id DESC`.
- **Filtering** is via flat query params. No JSON filter DSL.
- `since` / `until` are RFC 3339 UTC timestamps; the server treats `[since, until)`.

---

## 6. Error envelope (RFC 9457)

Every non-2xx body is `application/problem+json`:

```json
{
  "type":     "https://deployment-dashboard/errors/validation",
  "title":    "Payload validation failed",
  "status":   422,
  "detail":   "status must be one of in-progress|success|failure",
  "instance": "/api/deployments"
}
```

For `422` payload-validation failures, the body additionally carries an `errors[]` array of JSON-Pointer / message pairs:

```json
{
  "type":   "https://deployment-dashboard/errors/validation",
  "title":  "Payload validation failed",
  "status": 422,
  "errors": [
    { "pointer": "/happened_at", "message": "must be RFC 3339 with timezone" },
    { "pointer": "/run_number",  "message": "must be an integer" },
    { "pointer": "/status",      "message": "must be one of in-progress|success|failure" }
  ]
}
```

### Status-code matrix (binding for the write surface)

| Status | Trigger |
|---|---|
| `201 Created` | Event appended. `Location` header carries `/api/deployments/{id}`. |
| `204 No Content` | Stored / recorded (fetcher state, component event, control reset). |
| `401 Unauthorized` | API key (`X-Api-Key` or `X-Control-API-Key`) missing or invalid. |
| `413 Payload Too Large` | Fetcher cursor or component event payload over 8 KiB. |
| `422 Unprocessable Entity` | Schema-level validation failed; or missing/invalid `X-Component-Id` on `POST /api/control/events`. |
| `429 Too Many Requests` | Future rate-limit slot. `Retry-After` always present. |
| `503 Service Unavailable` | DB unreachable; either LISTEN channel not attached. |

**No `409 Conflict` on ingest.** The store is append-only — duplicates are not a server-side concern.

---

## 7. Real-time stream — deployment events (SSE)

- Endpoint: `GET /api/events/stream`.
- Media type: `text/event-stream`.
- Event names: **`deployment`** (only).
- Each `data:` line carries one full `DeploymentEvent` JSON object — clients merge into local state by `(service, environment)` for the Matrix and by `id` for Swimlanes.
- `id:` is monotonic per-event; clients reconnect with `Last-Event-ID`.
- Server emits `: ping` comment every 15 s for proxy keepalive.
- Backed by PostgreSQL `LISTEN/NOTIFY` on the `deployment_events` channel — each API instance broadcasts only to its own connected clients (NFR-05).

---

## 8. Append-only semantics

- `POST /api/deployments` **appends** a row. There is no update, no upsert, no dedup.
- A retried POST produces an **additional** row. Handling retries is the caller's concern.
- `deployment_id` is an **emitter-supplied correlation key** grouping multiple event rows. NOT a row identity, NOT a uniqueness constraint, NOT an idempotency key.
- `happened_at` is **emitter-supplied** and required (UTC wall-clock on the CI/CD side).
- The read surface reduces the log:
  - **Matrix** — `MAX(happened_at)` per `(service, environment)` for `current`; success-filtered for `last_successful`.
  - **Swimlanes** — client groups rows by `deployment_id`.
  - **History drawer** — every row preserved, newest-first.
- `PUT /api/fetcher/state/{adapter}` is the **one** non-append surface in the deployment domain — idempotent upsert of a cursor row.

---

## 9. Rate limiting

MVP does not enforce rate limits — internal-only network, single SPA, predictable CI/CD push rate. The contract reserves:

- `429 Too Many Requests` + `Retry-After` for the ingest path.
- `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` for a future budget-based limiter.
- Implementers SHOULD NOT add these headers until a real limit is in force.

---

## 10. Security notes

- **Internal-only.** The API has no public ingress; only the App Gateway is reachable (NFR-04).
- **No CORS config.** Single origin via the gateway eliminates CORS surface entirely.
- **No PII.** `actor` is a CI/CD identifier (login / service principal), not an end user.
- **No secret echo.** `X-Api-Key` and `X-Control-API-Key` MUST NOT appear in any response body, problem detail, or log line.
- **Opaque cursors.** Fetcher cursors and component event payloads are stored verbatim; the server MUST NOT parse, log (beyond acknowledgement), or inspect them.

---

## 11. Control plane — Kubernetes-style orchestration

### Communication model

The API is the **single source of truth** for system state. Components (fetcher, demo-driver, …) always initiate calls to the API — the API never initiates calls to components.

```
Component ──GET /api/control/stream──────► API   X-Control-API-Key  subscribe; receive orchestration events
Component ──POST /api/control/events─────► API   X-Api-Key          report;    post status / operational events
Operator  ──POST /api/control/reset──────► API   X-Control-API-Key  admin;     triggers reset event on stream
Anyone    ──GET  /api/control/events─────► API   (none)             observe;   read component-posted events (2 h)
```

Every arrow originates at the caller. The SSE stream is a **response to a component-initiated GET** — the API emits into it, but the connection is inbound.

### SSE control stream (`GET /api/control/stream`)

| Property | Value |
|---|---|
| Auth | `X-Control-API-Key` (header required) |
| Client type | Backend service components only — NOT browser clients |
| HTTP client | Components MUST use `fetch()` + `ReadableStream`; browser `EventSource` cannot send custom headers |
| Event names | `reset` (current); forward-compatible — unknown types are no-ops |
| **`Last-Event-ID` replay** | Supported; backed by `control_stream_events` table (2 h retention) |
| Heartbeat | `: ping` comment every 15 s |
| Filter | `?component=<id>` — server delivers only events where `component` equals the id or `"*"` |
| Fan-out | PostgreSQL `NOTIFY control_events` channel; consistent across API instances (NFR-05) |

**`Last-Event-ID` replay behaviour** mirrors the deployment stream:
- On reconnect, component sends `Last-Event-ID: <last-seen-uuid>`.
- Server replays `WHERE id > @last ORDER BY id` from `control_stream_events`, then attaches to live channel.
- Events older than 2 h are purged; replay is bounded to the retention window.

**Current event type:**

| `type` | When emitted | Scope |
|---|---|---|
| `reset` | On `POST /api/control/reset` | `component: "*"` (all components) |

Components MUST ignore unknown `type` values (forward-compatibility).

**Wire example:**
```
: ping

event: reset
id: 01J9F4WZK3W9G2T6X4QH3DKQF6
data: {"id":"01J9F4WZK3W9G2T6X4QH3DKQF6","type":"reset","component":"*","occurred_at":"2026-05-31T10:00:00Z"}
```

### Component event reporting (`POST /api/control/events`)

| Property | Value |
|---|---|
| Auth | **`X-Api-Key`** — same key components already hold for ingest / fetcher state |
| Component identity | **`X-Component-Id` header (required)** — NOT a body field |
| `component_id` stored | Server writes the `X-Component-Id` value as `component_id` on the row |
| Shape | Single endpoint for ALL components — body contains only event data, no identity field |
| Semantics | Append-only log in `component_events` table; `received_at` is server-assigned |
| **Retention** | **2 hours** — short-lived observability data, not a durable audit log |
| `occurred_at` | Component-supplied (mirrors `happened_at` semantics on deployment events) |
| `payload` | Opaque JSON object; stored verbatim; ≤ 8 KiB |

**`X-Component-Id` rules:**
- **Required.** Missing or invalid → `422`.
- Pattern: `^[a-z0-9][a-z0-9.-]{0,127}$` — lowercase kebab/dot.
- Examples: `dashboard-fetcher`, `dashboard-fetcher.github-actions`, `demo-driver`.
- Dot separates family from variant (e.g. `.github-actions`); no slashes.

**Known `event_type` values** (not exhaustive — new types are additive):

| `event_type` | Meaning |
|---|---|
| `status` | State transition or periodic status report |
| `heartbeat` | Periodic liveness ping; no state change |
| `error` | Component encountered an error; `state` will be `error` |

### Readiness probe

`GET /readyz` checks all three conditions:
1. DB reachable.
2. `deployment_events` LISTEN channel attached.
3. `control_events` LISTEN channel attached.

Any failing check → `503 Service Unavailable`.

### Retention summary

| Table | Retention | Rationale |
|---|---|---|
| `deployment_events` | 365 days (configurable, ≥ 90 d) | Audit + history drawer |
| `fetcher_state` | Permanent (upsert) | Cursor must survive restarts |
| `control_stream_events` | **2 hours** | Short replay window for reconnecting components |
| `component_events` | **2 hours** | Live health monitoring only |

### Reconciliation loop (reference pattern)

```
// Component startup — two separate keys, one per surface
fetch("GET /api/control/stream?component=dashboard-fetcher", {
  headers: {
    "X-Control-API-Key": CONTROL_API_KEY,
    "Last-Event-ID": lastSeenId   // if reconnecting
  }
})

on event "reset":
  clear local state / cursor
  fetch("POST /api/control/events", {
    headers: {
      "X-Api-Key":       API_KEY,
      "X-Component-Id":  "dashboard-fetcher.github-actions",
      "Content-Type":    "application/json"
    },
    body: JSON.stringify({
      event_type:  "status",
      state:       "idle",
      detail:      "Reset acknowledged; cursor cleared",
      occurred_at: new Date().toISOString(),
      payload:     { trigger: "reset", control_event_id: event.data.id }
    })
  })

// Periodic heartbeat (every ≤ 30 s)
fetch("POST /api/control/events", {
  headers: {
    "X-Api-Key":      API_KEY,
    "X-Component-Id": "dashboard-fetcher",
    "Content-Type":   "application/json"
  },
  body: JSON.stringify({ event_type: "heartbeat", state: "running", occurred_at: ... })
})
```

---

## 12. Examples — copy-paste minimum viable calls

See [`api-examples.md`](./api-examples.md) — ingest, matrix snapshot, SSE, fetcher cursor, control reset, control stream subscription, component event post.

---

## 13. Known carry-over for implementers

Discrepancies reconciled against `openapi.yaml` (D1). History:

| Item | Resolution |
|---|---|
| `service` (wire) vs `component` (SAD domain model). | ✅ Fixed — SAD domain model renamed to `service`. |
| `parent_deployments` (wire) vs `parrent_deployments` (SAD + FRONTEND_REQUIREMENTS typo). | ✅ Fixed — typo corrected in both docs; type is `STRING[]` (correlation keys), not `GUID[]`. |
| `run_number` is `integer` on the wire vs `STRING` in SAD. | ✅ Fixed — SAD reconciled to `INTEGER`. |
| Surrogate row id named `event_id` (GUID) in SAD vs `id` (uuid) on the wire. | ✅ Fixed — SAD renamed to `id`; type is a time-ordered **UUIDv7** (unique + sortable, doubles as SSE resume cursor). |
