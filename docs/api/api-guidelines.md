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
| Headers | `Train-Case` | `X-Api-Key`, `X-Progress-Reporter`, `Last-Event-ID` |

**Verb mapping.**
- Side-effecting writes → `POST` (append-only ingest) or `PUT` (idempotent upsert, fetcher cursor).
- Named destructive actions on the control surface → `POST` (e.g. `reset`).
- Reads → `GET`. No `PATCH`.
- No `DELETE` on the public API — retention is owned by the backend background job per SAD §11 Retention.

---

## 2. Required headers

| Header | Direction | When | Value |
|---|---|---|---|
| `X-Api-Key` | request | every write call (`POST /api/deployments`, `GET/PUT /api/fetcher/state/*`) | Static shared secret. |
| `X-Control-API-Key` | request | every control call (`POST /api/control/*`) | Static shared secret, distinct from `X-Api-Key` (D8). |
| `Content-Type` | request | every body-bearing call | `application/json; charset=utf-8` |
| `Accept` | request | optional | `application/json`, or `text/event-stream` for the SSE endpoint. |
| `X-Progress-Reporter` | request | optional, ingest only | `<emitter>/<adapter>`, e.g. `dashboard-fetcher/github-actions`. |
| `Last-Event-ID` | request | SSE reconnect | Last seen event id; server replays everything strictly greater. |
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
| `POST /api/control/*` | `X-Control-API-Key` | Destructive operations require a distinct secret (D8); ingest key grants no control access. |
| `GET /api/matrix`, `GET /api/deployments`, `GET /api/services`, `GET /api/environments` | none | Internal-only network (NFR-04); SPA never holds a secret. |
| `GET /api/events/stream` | none | Same as other reads; auth would defeat browser EventSource. |
| `GET /healthz`, `GET /readyz` | none | Probe surfaces. |

The dev/local fake key is configured in the API container's environment and is **never** embedded in the SPA bundle.

---

## 5. Pagination, filtering, sorting

- **Cursor pagination only.** Endpoints that paginate accept `cursor` + `limit`; response carries `next_cursor` (nullable).
- **No `offset` / `page`.**
- **Cursors are opaque** base64 blobs — clients MUST NOT parse them.
- **Default `limit` = 100, max = 500.** Out-of-range → `422`.
- **Default sort** for `GET /api/deployments` is `happened_at DESC` then `id DESC` as a tiebreaker (stable for cursor resume).
- **Filtering** is via flat query params (`?service=…&environment=…&status=…&deployment_id=…&since=…&until=…`). No JSON filter DSL.
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
| `401 Unauthorized` | API key (`X-Api-Key` or `X-Control-API-Key`) missing or invalid. |
| `413 Payload Too Large` | Fetcher cursor over 8 KiB. |
| `422 Unprocessable Entity` | Schema-level validation failed (missing required field, malformed `happened_at`, bad enum, non-integer `run_number`, oversized array, …). |
| `429 Too Many Requests` | Future rate-limit slot. `Retry-After` always present. |
| `503 Service Unavailable` | DB unreachable; LISTEN not attached. |

**No `409 Conflict` on ingest.** The store is append-only — duplicates are not a server-side concern.

---

## 7. Real-time stream (SSE)

- Endpoint: `GET /api/events/stream`.
- Media type: `text/event-stream`.
- Event names: **`deployment`** (only).
- Each `data:` line carries one full `DeploymentEvent` JSON object — clients merge into local state by `(service, environment)` for the Matrix and by `id` for Swimlanes.
- `id:` is monotonic per-event; clients reconnect with `Last-Event-ID`.
- Server emits `: ping` comment every 15 s for proxy keepalive.
- Backed by PostgreSQL `LISTEN/NOTIFY` — each API instance broadcasts only to its own connected clients (NFR-05).

---

## 8. Append-only semantics

- `POST /api/deployments` **appends** a row. There is no update, no upsert, no dedup.
- A retried POST (network glitch, CI runner restart, manual replay) produces an **additional** row. Handling retries is the caller's concern.
- `deployment_id` is an **emitter-supplied correlation key** that groups the multiple event rows of one logical deployment (e.g. `in-progress` row + terminal `success` row). It is NOT a row identity, NOT a uniqueness constraint, NOT an idempotency key.
- `happened_at` is **emitter-supplied** and required. It carries the UTC wall-clock at which the deployment transitioned to the reported `status` on the CI/CD side (SAD §11). It is NOT the dashboard's write time — a delayed POST from a retry queue still sorts correctly relative to peers.
- The read surface reduces the log when needed:
  - **Matrix** — `MAX(happened_at)` per `(service, environment)` for `current`; `MAX(happened_at) WHERE status='success'` for `last_successful`.
  - **Swimlanes** — client groups rows by `deployment_id` to render one node per logical deployment.
  - **History drawer** — every row preserved, newest-first.
- `PUT /api/fetcher/state/{adapter}` is the **one** non-append surface in the system — idempotent upsert of a single cursor row keyed by adapter.

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
- **No PII.** `actor` is a CI/CD identifier (login / service principal), not an end user. No emails, no tokens.
- **No secret echo.** `X-Api-Key` and `X-Control-API-Key` MUST NOT appear in any response body, problem detail, or log line — the CI caller masks on its side (e.g. `::add-mask::` in GitHub Actions); the server masks on the storage side.
- **Opaque cursors.** Fetcher cursors are stored verbatim; the server MUST NOT parse, log, or inspect them.

---

## 11. Examples — copy-paste minimum viable calls

See [`api-examples.md`](./api-examples.md) — ingest, matrix snapshot, SSE, fetcher cursor, control reset.

---

## 12. Known carry-over for implementers

Discrepancies reconciled against `openapi.yaml` (D1). History:

| Item | Resolution |
|---|---|
| `service` (wire) vs `component` (SAD domain model). | ✅ Fixed — SAD domain model renamed to `service`. |
| `parent_deployments` (wire) vs `parrent_deployments` (SAD + FRONTEND_REQUIREMENTS typo). | ✅ Fixed — typo corrected in both docs; type is `STRING[]` (correlation keys), not `GUID[]`. |
| `run_number` is `integer` on the wire vs `STRING` in SAD. | ✅ Fixed — SAD reconciled to `INTEGER`. |
| Surrogate row id named `event_id` (GUID) in SAD vs `id` (uuid) on the wire. | ✅ Fixed — SAD renamed to `id`; type is a time-ordered **UUIDv7** (unique + sortable, doubles as SSE resume cursor). |
