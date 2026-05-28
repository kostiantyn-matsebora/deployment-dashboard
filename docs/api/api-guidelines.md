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

**Verb mapping.** Side-effecting writes → `POST` (append-only ingest) or `PUT` (idempotent upsert, fetcher cursor). Reads → `GET`. No `PATCH`. No `DELETE` on the public API — retention is owned by the backend background job per SAD §11 Retention.

---

## 2. Required headers

| Header | Direction | When | Value |
|---|---|---|---|
| `X-Api-Key` | request | every write call (`POST /api/deployments`, `GET/PUT /api/fetcher/state/*`) | Static shared secret. |
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
- **Breaking change ⇒ new path prefix.** A v2 surface lives at `/api/v2/...` side-by-side with `/api/...` until the SPA + notify action + fetcher are all migrated.
- Servers MUST ignore unknown JSON fields on write (forward-compat with newer clients).
- Clients MUST ignore unknown JSON fields on read (forward-compat with newer servers).

---

## 4. Authentication

| Surface | Auth | Rationale |
|---|---|---|
| `POST /api/deployments` | `X-Api-Key` | FR-10 — every write rejected with `401` on missing/invalid key. |
| `GET/PUT /api/fetcher/state/{adapter}` | `X-Api-Key` | Mutates persistent state; same trust tier as ingest. |
| `GET /api/matrix`, `GET /api/deployments`, `GET /api/services`, `GET /api/environments` | none | Internal-only network (NFR-04); SPA never holds a secret. |
| `GET /api/events/stream` | none | Same as other reads; auth would defeat browser EventSource. |
| `GET /healthz`, `GET /readyz` | none | Probe surfaces. |

The dev/local fake key is configured in the API container's environment and is **never** embedded in the SPA bundle.

---

## 5. Pagination, filtering, sorting

- **Cursor pagination only.** Endpoints that paginate accept `cursor` + `limit`; response carries `next_cursor` (nullable).
- **No `offset` / `page`.** Cursors are opaque base64 blobs — clients MUST NOT parse them.
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
| `401 Unauthorized` | `X-Api-Key` missing or invalid. |
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

Implementers SHOULD NOT add these headers until a real limit is in force.

---

## 10. Security notes

- **Internal-only.** The API has no public ingress; only the App Gateway is reachable (NFR-04).
- **No CORS config.** Single origin via the gateway eliminates CORS surface entirely.
- **No PII.** `actor` is a CI/CD identifier (login / service principal), not an end user. No emails, no tokens.
- **No secret echo.** `X-Api-Key` MUST NOT appear in any response body, problem detail, or log line — the notify action masks it with `::add-mask::` on the CI side; the server masks on the storage side.
- **Opaque cursors.** Fetcher cursors are stored verbatim; the server MUST NOT parse, log, or inspect them.

---

## 11. Examples — copy-paste minimum viable calls

### Ingest (terminal success)

```http
POST /api/deployments HTTP/1.1
Host: dashboard.internal
Content-Type: application/json
X-Api-Key: ********
X-Progress-Reporter: dashboard-fetcher/github-actions

{
  "deployment_id":      "gh-9482-1",
  "service":            "service-a",
  "environment":        "dev",
  "version":            "1.4.2",
  "status":             "success",
  "happened_at":        "2026-05-28T09:42:17Z",
  "run_url":            "https://github.com/acme/repo/actions/runs/9482",
  "run_number":         9482,
  "actor":              "alice",
  "ref":                "refs/heads/main",
  "sha":                "3f2c1a9",
  "parent_deployments": []
}
```

```http
HTTP/1.1 201 Created
Location: /api/deployments/0d3e4f9a-2b1c-4f7e-9a12-7b6e5c2d8f01
Content-Type: application/json

{ "id": "0d3e4f9a-...", "deployment_id": "gh-9482-1", "happened_at": "2026-05-28T09:42:17Z", ... }
```

### Ingest (in-progress, same logical deployment as a later terminal row)

```http
POST /api/deployments HTTP/1.1
Content-Type: application/json
X-Api-Key: ********

{
  "deployment_id":      "gh-9491-1",
  "service":            "service-a",
  "environment":        "prod",
  "version":            "1.4.2",
  "status":             "in-progress",
  "happened_at":        "2026-05-28T10:14:02Z",
  "parent_deployments": ["gh-9482-1"]
}
```

A subsequent `POST` with `deployment_id=gh-9491-1`, `status=success`, and a later `happened_at` appends a second row. Both rows persist; the Matrix shows the latest by `happened_at`.

### Matrix snapshot

```http
GET /api/matrix HTTP/1.1
Accept: application/json
```

```http
HTTP/1.1 200 OK
ETag: W/"m-2026-05-28T10:14:02Z-482"
Content-Type: application/json

{
  "generated_at": "2026-05-28T10:14:02Z",
  "environments": ["dev","qa","uat","prod"],
  "rows": [
    {
      "service": "service-a",
      "slots": {
        "dev":  { "current": { ... status:"success" ... } },
        "prod": {
          "current":         { ... status:"failure", version:"1.4.3" ... },
          "last_successful": { ... status:"success", version:"1.4.2" ... }
        }
      }
    }
  ]
}
```

### SSE

```http
GET /api/events/stream HTTP/1.1
Accept: text/event-stream
Last-Event-ID: 01J9F4WZK3W9G2T6X4QH3DKQF4
```

```
: ping

id: 01J9F4WZK3W9G2T6X4QH3DKQF5
event: deployment
data: {"id":"01J9F4WZ...","deployment_id":"gh-9491-1","service":"service-a","environment":"prod","status":"success","happened_at":"2026-05-28T10:14:02Z",...}
```

### Fetcher cursor

```http
PUT /api/fetcher/state/github-actions HTTP/1.1
Content-Type: application/json
X-Api-Key: ********

{ "cursor": "eyJyZXBvIjoiYWNtZS9hcGkiLCJzaW5jZSI6Ijk0ODIifQ==" }
```

```http
HTTP/1.1 204 No Content
```

---

## 12. Known carry-over for implementers

| Item | Source | Action |
|---|---|---|
| `.github/actions/notify/action.yml` does not currently emit `happened_at` in the POST body. | Read of `action.yml` — payload assembly omits the field. | The action MUST be updated to send `happened_at` (e.g. `(Get-Date).ToUniversalTime().ToString("o")` at the moment the step runs). Without it the server returns `422`. |
| `action.yml` still has CR-0003 comments + a 409 hint branch referencing a uniqueness rule that no longer exists. | Read of `action.yml` lines 16-20, 43-50, 179, 283. | Strip the CR-0003 comment block and the `409 { … }` branch in the response-hint switch. |
| `service` (wire) vs `component` (SAD §11). | Compare SAD §11 to `action.yml`. | Reconcile SAD §11 to match the deployed wire name. |
| `parent_deployments` (wire correct) vs `parrent_deployments` (SAD §11, FRONTEND_REQUIREMENTS typo'd). | Same. | Fix the typo in the two docs. |
| `run_number` is `integer` on the wire vs `STRING` in SAD §11. | Same. | Reconcile SAD §11 to `integer`. |
