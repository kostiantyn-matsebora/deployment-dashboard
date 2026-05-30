# Demo Driver Specification — `@deployment-dashboard/demo-driver`

**Status:** Draft · **Date:** 2026-05-30

Standalone demo-orchestration service:
- Drives scripted scenarios by POSTing events to `POST /api/deployments`.
- Target-agnostic — works against the mock or a real `Dashboard.Api` instance; `WRITE_API_URL` selects the target.

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/api/openapi.yaml`](api/openapi.yaml) | Write API contract (`POST /api/deployments`); `DeploymentEventIngest` wire shape. |
| [`demo/data/events.json`](../demo/data/events.json) | Built-in scenario seed data. |
| [`docs/SAD.md`](SAD.md) | Domain model, `happened_at` semantics, Write API auth. |
| [`docs/MOCK_SPECIFICATION.md`](MOCK_SPECIFICATION.md) | Control-panel reference pattern. |

---

## 1. Role

The demo driver is a **separate, opt-in service** that:
- Loads scripted scenarios from `demo/data/`.
- Drives them by POSTing events sequentially to `POST /api/deployments`.
- Exposes a **control API** (`/demo/`) for starting, stopping, and querying scenarios.
- Serves a **browser control panel** at `GET /` for manual operation.
- Is **target-agnostic** — works against the mock or a real backend; the Write API URL is an env var.

The mock server is unchanged. The demo driver supplements it for cases where a backend (mock or real) needs seeding with realistic demo data via the canonical write path.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Node.js / TypeScript / NestJS** — same stack as mock. | Shares `demo/data/events.json` loader; no new runtime dependency. |
| D2 | Location: **`frontend/demo-driver/`** | Consistent with mock's position as dev/demo tooling; follows `frontend/[application]` path convention. |
| D3 | **Target URL configurable** via `WRITE_API_URL`. | Works against mock (`:3000`) or real backend without code change. |
| D4 | Control API prefix: **`/demo/`** (not `/api/`). | Keeps driver control surface separate from the application API namespace. |
| D5 | **Scenario file format** reuses `demo/data/events.json` schema. | No new format; existing `events[]` + `elapsed_minutes` field is the scenario definition. |
| D6 | `elapsed_minutes → happened_at`: **`Date.now() - elapsed_minutes * 60_000`** at run time. | Matches mock loader behaviour; events land correctly relative to "now" on the target backend. |
| D7 | **Sequential POST** with configurable inter-event delay (`EMIT_DELAY_MS`, default `0`). | `0` = bulk load (seed); `> 0` = paced emission for live demo effect. |
| D8 | Default port **`3001`**. | Avoids collision with mock at `:3000`. |
| D9 | **Panel path `GET /demo/`** — NestJS serves everything under `/demo/*`. | No nginx path-stripping required; gateway proxies `location /demo/` without a trailing-slash rewrite. |

---

## 3. Solution layout

```
frontend/demo-driver/
  src/
    main.ts                      bootstrap (port, config)
    app.module.ts                NestJS root module
    config/
      configuration.ts           ConfigModule factory (env vars → typed config)
    demo/
      demo.module.ts
      demo.controller.ts         GET|POST /demo/* control surface + panel
      demo.service.ts            scenario orchestration (start / stop / status)
    scenarios/
      scenario-loader.ts         load + validate scenario JSON files
      scenario-runner.ts         elapsed_minutes → happened_at; sequential POST loop
    write-api/
      write-api.client.ts        HTTP client — POST /api/deployments (with retry)
    ui/
      panel.html                 browser control panel (inline, no bundler)
  test/
    demo.controller.spec.ts
    scenario-runner.spec.ts
    write-api.client.spec.ts
  Dockerfile                     multi-stage: build → node:lts-alpine runtime
  package.json
  tsconfig.json
```

---

## 4. Control API — `/demo/`

No authentication required (internal dev/demo tooling only).

### 4.1 Status

| Method · Path | Response |
|---|---|
| `GET /demo/status` | `DemoStatus` |

`DemoStatus`:
```json
{
  "scenario":     "demo-set",
  "state":        "idle",
  "events_total": 47,
  "events_sent":  0,
  "errors":       0,
  "started_at":   null,
  "finished_at":  null
}
```

`state` enum: `idle` | `running` | `done` | `failed`

### 4.2 Scenarios

| Method · Path | Request | Response |
|---|---|---|
| `GET /demo/scenarios` | — | `{ items: string[] }` — discovered scenario names |
| `POST /demo/scenarios/{name}/run` | `{ delay_ms?: number }` | `DemoStatus` |
| `POST /demo/scenarios/{name}/stop` | — | `DemoStatus` |
| `POST /demo/reset` | — | `DemoStatus` (`state` reset to `idle`, counters zeroed) |

**Idempotency:** `POST /demo/scenarios/{name}/run` while `state == running` returns current status; does not double-start.

### 4.3 Event feed (SSE)

| Method · Path | Response |
|---|---|
| `GET /demo/stream` | `text/event-stream` |

Each successfully posted event emits one named event:

```
event: posted
data: {
  "deployment_id": "gh-pay-dev-4830",
  "service":       "payments-api",
  "environment":   "dev",
  "status":        "success",
  "happened_at":   "2026-05-30T08:14:00Z",
  "posted_at":     "2026-05-30T10:02:31Z"
}

: ping        ← heartbeat every 15 s
```

Failed POST attempts emit:

```
event: error
data: {
  "deployment_id":   "gh-pay-dev-4830",
  "http_status":     422,
  "attempt":         3,
  "posted_at":       "2026-05-30T10:02:31Z"
}
```

No history replay — only events posted after the stream opens are delivered.

---

## 5. Scenarios

### 5.1 Discovery

At startup the driver:
- Scans `SCENARIOS_DIR` for `*.json` files matching the `events.json` schema.
- Names each scenario by filename (without extension).
- Always includes `demo-set` (sourced from `demo/data/events.json`).

### 5.2 Built-in scenario: `demo-set`

Source: `demo/data/events.json#events` (47 events).

**Run sequence:**
1. Load `events[]` from the scenario file.
2. For each event (array order):
   - Compute `happened_at = new Date(Date.now() - elapsed_minutes * 60_000).toISOString()`.
   - Strip `elapsed_minutes` (not part of the `DeploymentEventIngest` wire shape).
   - `POST /api/deployments` with `X-Api-Key` + `X-Progress-Reporter` headers.
   - Increment `events_sent` on `201`; increment `errors` on any other outcome.
   - Wait `EMIT_DELAY_MS` before next event.
3. Set `state`:
   - `done` — all events attempted (even if some errored).
   - `failed` — run was stopped before completion via `POST /demo/scenarios/{name}/stop`.

**Timing note.** `happened_at` is emitter-supplied (SAD §Domain Model). The demo driver acts as the emitter; it supplies wall-clock-relative timestamps that match the seed's `elapsed_minutes` intent.

---

## 6. Write API integration

| Concern | Spec |
|---|---|
| Endpoint | `POST {WRITE_API_URL}/api/deployments` |
| Auth | `X-Api-Key: <API_KEY>` on every request |
| Attribution | `X-Progress-Reporter: demo-driver/demo-set` (scenario name in the adapter segment) |
| Retry | 3 attempts, exponential backoff: 100 ms → 200 ms → 400 ms; applies on network error or `5xx` |
| Non-2xx (final) | Log `{ http_status, deployment_id, service, environment }`; increment `errors`; continue |
| `4xx` (client error) | No retry; log immediately; increment `errors`; continue |

---

## 7. Control panel

`GET /demo/` serves a browser control panel (`text/html`). No bundler — inline HTML/CSS/JS (NFR-08 spirit; tooling consistency with mock).

| Card | Controls |
|---|---|
| Scenarios | Dropdown to select scenario; **Run** / **Stop** buttons; delay (ms) input |
| Status | State badge (`idle` / `running` / `done` / `failed`); progress bar (`events_sent / events_total`); error count; started/finished timestamps |
| Post Feed | Real-time `GET /demo/stream` SSE feed; `● LIVE` / `● RECONNECTING` badge; `posted` and `error` frames rendered inline; Clear button |

Panel behaviour:
- Calls `GET /demo/status` + `GET /demo/scenarios` on load.
- Calls `POST /demo/scenarios/{name}/run` and `POST /demo/scenarios/{name}/stop` on button click.
- Subscribes to `GET /demo/stream` for the live feed.

---

## 8. Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP listen port |
| `WRITE_API_URL` | `http://localhost:3000` | Base URL of the Write API target |
| `API_KEY` | `dev-secret` | Shared secret; sent as `X-Api-Key` |
| `SCENARIOS_DIR` | `../../demo/data` | Path to scenario JSON files |
| `EMIT_DELAY_MS` | `0` | Inter-event delay (ms); `0` = bulk load |

---

## 9. Testing

| Layer | Project | Scope |
|---|---|---|
| Unit | `scenario-runner.spec.ts` | `elapsed_minutes → happened_at` conversion; sequential POST order; `events_sent` / `errors` counter accuracy; stop-mid-run sets `state = failed` |
| Unit | `write-api.client.spec.ts` | Retry on `5xx` (3 attempts); no retry on `4xx`; `X-Api-Key` header present; `X-Progress-Reporter` header present |
| Unit | `demo.controller.spec.ts` | `idle → running → done` state transitions; idempotent double-start; stop from running |
| Integration | `demo.e2e.spec.ts` | Start driver against mock (`WRITE_API_URL=http://localhost:3000`); `POST /demo/scenarios/demo-set/run`; poll `GET /demo/status` until `state == done`; assert `GET http://localhost:3000/api/services` returns ≥ 1 service |

---

## 10. Running

```powershell
cd frontend/demo-driver
npm install          # first time only
npm run start:dev    # ts-node, hot-reload
```

Override target and key:

```powershell
$env:WRITE_API_URL = 'http://staging-backend:8080'
$env:API_KEY       = 'prod-key'
$env:EMIT_DELAY_MS = '500'
npm run start:dev
```

---

## 11. Deployment

| Aspect | Spec |
|---|---|
| Image | Multi-stage Dockerfile in `frontend/demo-driver/`. Stage 1: `node:lts-alpine` builds TypeScript. Stage 2: `node:lts-alpine` runs the compiled output. |
| Gateway path | Proxied by App Gateway at `location /demo/` → `DEMO_DRIVER_UPSTREAM` (see [`GATEWAY_SPECIFICATION.md`](GATEWAY_SPECIFICATION.md)). |
| SSE | `/demo/stream` requires the same proxy SSE block as `/api/events/stream` (buffering off, `proxy_read_timeout 3600s`). |
| Port | Container listens on `PORT` (default `3001`); `DEMO_DRIVER_UPSTREAM` in the gateway is `demo-driver:3001`. |
| Panel access | Direct: `http://localhost:3001/demo/`. Via gateway: `http://gateway/demo/`. |

---

## 12. Out of scope

- Scenario authoring or editing (read-only against `demo/data/`).
- Scenario scheduling / cron.
- Concurrent multi-scenario execution.
- Authentication on the control API or control panel.
- Clearing the target backend (Write API is append-only; reset is a mock `/_mock/reset` concern for mock targets).
- `sse_templates` emission (periodic live-event driver — scoped to a future scenario, e.g. `live-demo`).
