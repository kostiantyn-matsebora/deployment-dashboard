# Mock API Specification — `@deployment-dashboard/mock`

**Status:** Stable · **Date:** 2026-05-29

Development and test mock for the Deployment Dashboard backend. Implements the full application API contract in-memory and exposes a separate control surface for test harnesses and a browser control panel.

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/api/openapi.yaml`](api/openapi.yaml) | Wire shapes the `/api/` surface must match. |
| [`demo/data/events.json`](../demo/data/events.json) | Seed dataset loaded at startup. |

---

## 1. Stack

| Aspect | Value |
|---|---|
| Runtime | Node.js / TypeScript |
| Framework | NestJS 10 + Express |
| Default port | `3000` (override via `PORT` env var) |
| State | In-memory only — resets on restart |
| Location | `frontend/mock/` |

---

## 2. Solution layout

```
frontend/mock/src/
  app.controller.ts          GET /  — HTML control panel
  app.module.ts              NestJS module (registers all controllers)
  main.ts                    bootstrap (CORS for :4200, configurable port)
  auth/
    api-key.ts               validateApiKey() — reads API_KEY env var
  data/
    store.ts                 EventStore singleton + FeedEntry types
    demo-types.ts            TypeScript types for demo/data/events.json
  deployments/
    deployments.controller.ts  POST/GET /api/deployments, GET /api/deployments/:id
  matrix/
    matrix.controller.ts     GET /api/matrix
  discovery/
    discovery.controller.ts  GET /api/services, GET /api/environments
  events/
    events.controller.ts     GET /api/events/stream
    emit.service.ts          EmitService singleton (timer ownership)
  fetcher/
    fetcher.controller.ts    GET/PUT /api/fetcher/state/:adapter
    fetcher.store.ts         FetcherStore singleton
  mock/
    mock.controller.ts       /_mock/* control surface + SSE feed
```

---

## 3. In-memory store

### Event store (`store.ts`)

Single `EventStore` singleton shared across all request handlers.

**Startup:** loads `demo/data/events.json`, converts `elapsed_minutes` → absolute `happened_at` relative to boot time, tags every loaded event `_demo: true` internally. The `_demo` flag never appears on the wire.

**Demo flag:** `store.isDemoEnabled` (default `true`). When `false`, all read surfaces (`list`, `findById`, `matrix`, `services`, `environments`) behave as if demo events do not exist. User-posted and SSE-emitted events are never tagged `_demo` and remain visible regardless.

**Reset:** `store.reset()` — removes all non-`_demo` events and sets `_demoEnabled = true`.

**Append:** `store.append(event, source)` — prepends the event to the store, emits on `live$` (consumed by `/api/events/stream`) and `feed$` (consumed by `/_mock/stream`).

### Fetcher store (`fetcher.store.ts`)

`FetcherStore` singleton: `Map<adapter, FetcherState>`. No persistence. `clear()` removes all entries.

### Emit service (`emit.service.ts`)

`EmitService` singleton owns the periodic emission timer. Default: **disabled**. When enabled, fires `nextSseEvent()` every **8 seconds**, which appends a templated event from `demo/data/events.json#sse_templates` (round-robin) with `source: 'sse-emitter'`.

---

## 4. Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `API_KEY` | `dev-secret` | Shared secret for write + fetcher endpoints |

`API_KEY` is validated on every request that carries `X-Api-Key`. Missing or mismatched → `401` `application/problem+json`.

---

## 5. Application API — `/api/`

Mirrors the contract in `docs/api/openapi.yaml`. All state is in-memory; no database.

### 5.1 Write

| Method · Path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/deployments` | `X-Api-Key` | `DeploymentEventIngest` body | `201` + `Location: /api/deployments/{id}` + `DeploymentEvent` |

**Validation** — required fields: `deployment_id`, `service`, `environment`, `status` (`in-progress`\|`success`\|`failure`), `happened_at`. Missing or invalid → `422` with `errors[]` array (JSON Pointer + message).

**Side-effects** — appended event emits on `live$` (SSE app stream) and `feed$` (ingest feed).

### 5.2 Read — deployments

| Method · Path | Filters | Response |
|---|---|---|
| `GET /api/deployments` | `service`, `environment`, `status`, `deployment_id`, `since`, `until`, `cursor`, `limit` (max 500, default 100) | `{ items: DeploymentEvent[], next_cursor: string\|null }` |
| `GET /api/deployments/:id` | — | `DeploymentEvent` or `404` |

Cursor is opaque base64-encoded integer offset.

### 5.3 Read — matrix

| Method · Path | Filters | Response |
|---|---|---|
| `GET /api/matrix` | `?service=` | `{ generated_at, environments, rows[] }` |

Each `rows[]` entry: `{ service, slots: { [env]: { current, last_successful?, prev_failed? } } }`.

`prev_failed: true` added when a failure exists between `current` and `last_successful` (or anywhere after `current` when no success exists). Not part of the `openapi.yaml` wire contract — mock extension only.

### 5.4 Discovery

| Method · Path | Response |
|---|---|
| `GET /api/services` | `{ items: string[] }` — derived from visible store events, sorted |
| `GET /api/environments` | `{ items: string[] }` — sorted by `[dev, staging, qa, preprod, prod]` then alphabetical |

Reflects `demo_enabled` state — returns empty arrays when demo is off and no user events exist.

### 5.5 SSE stream

| Method · Path | Response |
|---|---|
| `GET /api/events/stream` | `text/event-stream` |

```
id: <uuid>
event: deployment
data: <DeploymentEvent JSON>

: ping        ← heartbeat every 15 s
```

Optional `?service=` server-side filter. No `Last-Event-ID` replay (in-memory store — history not buffered).

### 5.6 Fetcher state

| Method · Path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/fetcher/state/:adapter` | `X-Api-Key` | — | `{ adapter, cursor, updated_at }` or `404` |
| `PUT /api/fetcher/state/:adapter` | `X-Api-Key` | `{ cursor: string }` | `204` or `413` if cursor > 8 KiB |

### 5.7 Ops

| Path | Response |
|---|---|
| `GET /healthz` | `{ status: "ok" }` |
| `GET /readyz` | `{ status: "ready", checks: { db: "ok", listen: "ok" } }` |

---

## 6. Control surface — `/_mock/`

Intended for E2E / API test harnesses and the browser control panel. Deliberately outside `/api/` to keep the application API namespace clean. No auth required.

### 6.1 Status + reset

| Method · Path | Request | Response |
|---|---|---|
| `GET /_mock/status` | — | `MockStatus` |
| `POST /_mock/reset` | — | `MockStatus` |

`MockStatus`:
```json
{
  "emitting":         false,
  "demo_enabled":     true,
  "event_count":      47,
  "fetcher_adapters": []
}
```

`POST /_mock/reset` restores the deterministic clean slate:

| Field | After reset |
|---|---|
| `emitting` | `false` |
| `demo_enabled` | `true` |
| `event_count` | demo baseline (47 with default seed) |
| `fetcher_adapters` | `[]` |

### 6.2 SSE emission control

| Method · Path | Request body | Response |
|---|---|---|
| `GET /_mock/emit` | — | `{ emitting: boolean, event_count: number }` |
| `POST /_mock/emit` | `{ "enabled": boolean }` — omit to toggle | `{ emitting, event_count }` |

When enabled, `nextSseEvent()` fires every **8 s** using `sse_templates` from the seed (round-robin). Each emitted event appears on the application SSE stream and in the ingest feed with `source: "sse-emitter"`.

### 6.3 Demo data control

| Method · Path | Request body | Response |
|---|---|---|
| `GET /_mock/demo` | — | `{ enabled: boolean }` |
| `POST /_mock/demo` | `{ "enabled": boolean }` — omit to toggle | `{ enabled }` |
| `POST /_mock/demo/reset` | — | `{ enabled: true, event_count: number }` |

`POST /_mock/demo/reset` purges user-posted and SSE-emitted events and re-enables demo visibility. Does **not** disable SSE emission.

### 6.4 Live ingest feed

| Method · Path | Response |
|---|---|
| `GET /_mock/stream` | `text/event-stream` |

Every call to `store.append()` (from `POST /api/deployments` or the SSE emitter) emits one named event:

```
event: ingest
data: {
  "event":       { ...DeploymentEvent },
  "source":      "write-api" | "sse-emitter",
  "received_at": "<ISO 8601 server wall-clock>"
}

: ping        ← heartbeat every 15 s
```

No history replay — only events that arrive after the stream is opened are delivered. Reconnection is handled by `EventSource` auto-retry.

---

## 7. Startup defaults

| State | Default |
|---|---|
| SSE emission | disabled |
| Demo data | enabled (47 events from seed) |
| Fetcher state | empty |
| CORS | `http://localhost:4200` allowed (Angular dev server) |

---

## 8. Control panel

`GET /` serves a browser control panel (`text/html`).

| Card | Controls |
|---|---|
| SSE Emission | Enable / Disable toggle |
| Demo Data | Hide / Show toggle + Reset button |
| Event Store | Live event count (3 s poll) |
| Ingest Feed | Real-time `/_mock/stream` SSE feed; `● LIVE` / `● RECONNECTING` badge; Clear button |

The panel calls `/_mock/emit` and `/_mock/demo` for state reads and mutations; count is updated optimistically on each SSE frame and confirmed every 3 s.

---

## 9. Typical E2E usage

```ts
// Global beforeEach — restore clean slate
await fetch('http://localhost:3000/_mock/reset', { method: 'POST' });

// Enable SSE emission for a test that needs live events
await fetch('http://localhost:3000/_mock/emit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ enabled: true }),
});

// Hide demo data for a write-path test that needs an empty store
await fetch('http://localhost:3000/_mock/demo', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ enabled: false }),
});

// Ingest a test event
await fetch('http://localhost:3000/api/deployments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-key' },
  body: JSON.stringify({
    deployment_id: 'test-1',
    service: 'checkout',
    environment: 'prod',
    status: 'success',
    happened_at: new Date().toISOString(),
  }),
});

// Subscribe to the ingest feed
const source = new EventSource('http://localhost:3000/_mock/stream');
source.addEventListener('ingest', (e) => {
  const { event, source, received_at } = JSON.parse(e.data);
});
```

---

## 10. Running

```powershell
cd frontend/mock
npm install          # first time only
npm run start:dev    # ts-node, hot-reload on file save
```

Override port or key:

```powershell
$env:PORT = '3001'; $env:API_KEY = 'my-key'; npm run start:dev
```
