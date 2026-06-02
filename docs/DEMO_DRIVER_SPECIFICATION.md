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
| [`docs/api/api-guidelines.md`](api/api-guidelines.md) §11 | Control-plane contract — `GET /api/control/stream` event vocabulary + `POST /api/control/events` ack contract + `GET /api/control/events/stream` SSE contract (FROZEN; consumed, not redefined). |
| [`docs/diagrams/reset-choreography.md`](diagrams/reset-choreography.md) | Visual reference for the reset choreography; the driver is the "Demo Driver" participant. |
| [`docs/GITHUB_EMULATOR_SPECIFICATION.md`](GITHUB_EMULATOR_SPECIFICATION.md) | GitHub emulator service — in-memory store, emulated REST surface, fixture/generator, config. |
| [`docs/diagrams/github-emulation.md`](diagrams/github-emulation.md) | Visual reference for demo-mode topology and seed→backfill→poll sequence (§5). |

---

## 1. Role

The demo driver is a **separate, opt-in service** that:
- Loads scripted scenarios from `demo/data/`.
- Drives them by POSTing events sequentially to `POST /api/deployments`.
- Exposes a **control API** (`/demo/`) for starting, stopping, and querying scenarios.
- Serves a **browser control panel** at `GET /` for manual operation.
- **Participates in the API-driven reset choreography** as the `demo-driver` component (D10, §4.7) — drains + acks on `reset-initiated`, blocks its own surface, recovers on `reset-completed`. Degrades gracefully when the target has no control stream (e.g. the mock).
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
| D10 | **Demo-driver participates in the API-driven reset choreography** as the `demo-driver` component — subscribes to `GET /api/control/stream`, acks `reset-initiated`, blocks its own `/demo/` surface, reports `running` on `reset-completed`. | The API orchestrates a system-wide reset (see [`reset-choreography.md`](diagrams/reset-choreography.md)); the driver is a first-class participant ("Demo Driver" in the choreography), distinct from the existing operator-triggered `POST /demo/api-reset` proxy (§4.5). Component id `demo-driver` matches the API's default `Reset:ExpectedComponents`. Degrades gracefully: against a target with no control stream (e.g. the mock) the subscriber fails to connect, logs, and retries — it never crashes the driver. |
| G1 | **GitHub emulation lives in a SEPARATE `github-emulator` service** (`demo/github-emulator/`), not in the driver. | Per-adapter isolation — future ADO/Jenkins emulators become sibling services, each at its own root, with no path-prefix or port collision and no fetcher change required. |
| G2 | **No fetcher code change** — fetcher is config-driven (FETCHER_SPEC F9); demo mode sets `GITHUB__BASE_URL=http://github-emulator:3100`. The fetcher-host is wired into the demo compose profile (currently absent from all compose files). | Config-only change; fetcher adapter is unmodified. |
| G3 | **Demo set = curated `demo/data/github/` fixture** (owned by the emulator — GITHUB_EMULATOR_SPEC §7) — workflow YAML + dev→staging→prod `needs` chain + one artifact-sourced version — coherent with existing demo service/env names. | Proves the headline fetcher features `parent_deployments` (F10) + artifact version (F15). |
| G4 | **Random set / periodic emit = GitHub-shaped generator in the emulator** (GITHUB_EMULATOR_SPEC §8). | Symmetric with the existing write-path random set; lives alongside the fixture loader, not in the driver. |
| G5 | **Emulated REST emits `X-RateLimit-*` headers + `Link` pagination + serves `/rate_limit`** (owned by the emulator — GITHUB_EMULATOR_SPEC §5); ETag/`304` deferred. | Exercises the fetcher's F8/F16 paths. |
| G6 | **The emulator IS the test mock for fetcher integration coverage** — tests seed it via `POST /_github/seed` then assert the fetcher's output (realizes FETCHER_SPEC §7.2 — GITHUB_EMULATOR_SPEC §10). | Dedicated service means no driver-restart needed for integration test isolation. |

---

## 3. Solution layout

```
demo/driver/
  src/
    main.ts                          bootstrap (port, config)
    app.module.ts                    NestJS root module
    config/
      configuration.ts               env vars → typed config
    demo/
      demo.module.ts
      demo.controller.ts             GET|POST /demo/* control surface + panel
      demo.service.ts                orchestration (ingest / emit / reset)
      emit.service.ts                periodic random-event emitter
    control/
      control-stream.subscriber.ts   long-lived GET /api/control/stream subscriber (fetch + ReadableStream; Last-Event-ID + heartbeat); dispatches reset-* events to the reset-coordinator AND publishes every parsed frame (including unknown types) to ControlFeed
      control-feed.ts                in-process fan-out (RxJS Subject/observable) — publishes every control-stream frame; GET /demo/control-stream subscribes to it
      component-events.subscriber.ts long-lived GET /api/control/events/stream SSE subscriber (fetch+ReadableStream; Last-Event-ID + exponential backoff); fans frames into ComponentEventFeed
      component-event-feed.ts        in-process fan-out (RxJS Subject/observable) — publishes every component-event frame; GET /demo/control-events subscribes to it
      reset-coordinator.ts           reset state machine: on reset-initiated → block /demo/ + stop work + ack; on reset-completed → unblock + post running; local GateMaxTtl safety unblock
      control-events.client.ts       POST /api/control/events (X-Api-Key + X-Component-Id: demo-driver) — reset-ack + status component events
    scenarios/
      scenario-loader.ts             load + validate scenario JSON files
      scenario-runner.ts             elapsed_minutes → happened_at; sequential POST loop
      random-event-generator.ts      random DeploymentEventIngest event factory
    write-api/
      write-api.client.ts            POST /api/deployments (with retry)
      control-api.client.ts          POST /api/control/reset (single attempt)
    github/
      github-proxy.controller.ts     GET|POST /demo/github/* → proxy → GITHUB_EMULATOR_URL/_github/*
      github-proxy.client.ts         HTTP client for GITHUB_EMULATOR_URL/_github/* calls
    ui/
      panel.ts                       browser control panel (inline, no bundler)
  test/
    demo.controller.spec.ts
    scenario-runner.spec.ts
    write-api.client.spec.ts
    control-api.client.spec.ts
    control-stream.subscriber.spec.ts
    control-feed.spec.ts
    component-events.subscriber.spec.ts
    component-event-feed.spec.ts
    reset-coordinator.spec.ts
    control-events.client.spec.ts
    random-event-generator.spec.ts
    github-proxy.controller.spec.ts
    github-proxy.client.spec.ts
  Dockerfile                         multi-stage: build → node:lts-alpine runtime
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
  "finished_at":  null,
  "reset_state":  "idle",
  "reset_id":     null
}
```

`state` enum: `idle` | `running` | `done` | `failed` | `blocked`

- **`blocked`.** Set while an API-driven reset is in progress (between `reset-initiated` and `reset-completed`); the `/demo/` control surface is blocked (§4.7). `GET /demo/status` still answers (returns the blocked state) — it is never blocked.

**Reset-participation fields** (§4.7):

| Field | Type | Notes |
|---|---|---|
| `reset_state` | `idle` \| `blocked` | Driver's reset-participation state, independent of scenario `state`. `blocked` = a reset is in progress. |
| `reset_id` | string \| null | The `reset_id` of the in-progress reset; `null` when `reset_state == idle`. |

### 4.2 Scenarios (legacy — backwards compat)

| Method · Path | Request | Response |
|---|---|---|
| `GET /demo/scenarios` | — | `{ items: string[] }` — discovered scenario names |
| `POST /demo/scenarios/{name}/run` | `{ delay_ms?: number }` | `DemoStatus` |
| `POST /demo/scenarios/{name}/stop` | — | `DemoStatus` |
| `POST /demo/reset` | — | `DemoStatus` (`state` reset to `idle`, counters zeroed) |

**Idempotency:** `POST /demo/scenarios/{name}/run` while `state == running` returns current status; does not double-start.

### 4.3 Ingest

| Method · Path | Request | Response |
|---|---|---|
| `POST /demo/ingest` | `IngestRequest` | `DemoStatus` |
| `POST /demo/ingest/stop` | — | `DemoStatus` |

`IngestRequest`:
```json
{
  "dataset":  "demo",
  "reset":    true,
  "count":    20,
  "delay_ms": 0
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `dataset` | `"demo"` \| `"random"` | `"demo"` | `"demo"` = events from `demo-set` scenario file; `"random"` = generated events |
| `reset` | boolean | `false` | When `true`, calls `POST /api/control/reset` on the write-API target before ingesting |
| `count` | integer | `10` | Number of service scenarios to generate (1–10); `"random"` only — each scenario emits 3 events per `(service, env)` slot: one primary (current state, branching topology) + two historical (2 h and 4 h old) covering the remaining statuses so every slot has full `in-progress`/`success`/`failure` coverage; ignored for `"demo"` |
| `delay_ms` | integer | `EMIT_DELAY_MS` | Per-event delay (ms); `0` = bulk load |

**Idempotency:** `POST /demo/ingest` while `state == running` returns current status; does not double-start.

### 4.4 Live Emission

Periodic random-event emission — mirrors `/_mock/emit` pattern from the mock.

| Method · Path | Request | Response |
|---|---|---|
| `GET /demo/emit` | — | `{ emitting: boolean }` |
| `POST /demo/emit` | `{ enabled?: boolean }` — omit to toggle | `{ emitting: boolean }` |

When enabled, fires every `EMIT_INTERVAL_MS` (default 8 s): generates one random event, POSTs it to `WRITE_API_URL/api/deployments`, and emits a `posted` / `error` frame on `/demo/stream`.

### 4.5 API Reset

| Method · Path | Response |
|---|---|
| `POST /demo/api-reset` | `{ ok: boolean, http_status: number }` |

Proxies `POST {WRITE_API_URL}/api/control/reset` with `X-Control-API-Key: CONTROL_API_KEY`.
Returns `{ ok: true, http_status: 204 }` on success; `{ ok: false, http_status: N }` on failure; `{ ok: false, http_status: 0 }` on network error.
No retry — destructive operation, single attempt.

### 4.6 Event feed (SSE)

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
  "posted_at":     "2026-05-30T10:02:31Z",
  "reporter":      "demo-driver/demo"
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
  "posted_at":       "2026-05-30T10:02:31Z",
  "reporter":        "demo-driver/demo"
}
```

`reporter` mirrors the `X-Progress-Reporter` attribution header sent on the deployment POST (§7): `demo-driver/<dataset>` for ingest runs (e.g. `demo-driver/demo`, `demo-driver/random`) and `demo-driver/emit` for periodic live emission.

No history replay — only events posted after the stream opens are delivered.

> **Panel note.** `/demo/stream` is no longer surfaced in the control panel (§8). The panel's Deployments card uses `/demo/deployments-stream` (§4.11) instead. The endpoint itself is unchanged.

### 4.7 Reset participation (control-stream subscriber)

The driver is a participant in the API-driven reset choreography (D10; visual: [`reset-choreography.md`](diagrams/reset-choreography.md)). This is **distinct** from `POST /demo/api-reset` (§4.5):

- **§4.5 `/demo/api-reset`** — outbound, operator-triggered. The driver *initiates* a reset by proxying `POST /api/control/reset`. Unchanged.
- **§4.7 subscriber** — inbound, API-driven. The driver *reacts* to reset events the API broadcasts (whoever triggered them). New.

**Subscriber.**
- A long-lived service holds an open `GET /api/control/stream?component=demo-driver` with `X-Control-API-Key: CONTROL_API_KEY`.
- Uses `fetch()` + `ReadableStream` (NOT browser `EventSource` — custom headers required), parsing the SSE frames.
- Honors `Last-Event-ID` on reconnect and the `: ping` heartbeat (15 s).
- Component id is fixed at `demo-driver` (matches the API's default `Reset:ExpectedComponents`).
- **Graceful degradation.** If the target exposes no control stream (e.g. the mock) the connect attempt fails; the subscriber logs and retries with backoff — it never crashes the driver. The rest of the driver (ingest / emit / panel) stays fully functional.

**On `reset-initiated`** (drain):
1. Stop any running ingest / scenario run; disable live emission.
2. Enter `reset_state = blocked`, record `reset_id` from the event id; scenario `state` reflects `blocked`.
3. Block the `/demo/` control API — incoming control calls (`ingest` / `ingest/stop` / `scenarios/*/run`/`stop` / `emit` / `api-reset`) return **`503`** while blocked. Body is **RFC 9457 `application/problem+json`** (consistent with the API surface, [`api-guidelines.md §6`](api/api-guidelines.md#6-error-envelope-rfc-9457)) — `type` `.../errors/reset-in-progress`, `title` `Reset in progress`, `status` 503. `Retry-After` (seconds) is set from the remaining local gate window (`RESET_GATE_MAX_TTL_MS`, §8). `GET /demo/status` is **never** blocked — it reports the blocked state. `GET /demo/stream` stays open.
4. Disable + dim the interactive control cards (Ingest, GitHub Emulator, Reset-System trigger) on the `GET /demo/` panel; the data feeds (Status, Deployments, Events) stay live so the operator can watch the reset choreography (§8). No full-panel overlay.
5. POST a `reset-ack` via the component-event client:

```
POST {WRITE_API_URL}/api/control/events
X-Api-Key:       <API_KEY>
X-Component-Id:  demo-driver
Content-Type:    application/json; charset=utf-8

{
  "event_type":  "reset-ack",
  "state":       "paused",
  "occurred_at": "<now, RFC 3339 UTC>",
  "payload":     { "reset_id": "<reset-initiated event id>" }
}
```

**On `reset-started`:** no action — the driver is already blocked from `reset-initiated`. State this explicitly so no double-handling is implemented.

**On `reset-completed`** (recover):
1. Unblock the `/demo/` control API.
2. Clear `reset_state` back to `idle`; clear `reset_id`; scenario `state` returns to `idle` (counters as left by §4.2 `reset` semantics).
3. Re-enable the interactive control cards (Ingest, GitHub Emulator — §8).
4. POST a component event reusing the existing `event_type: status` (NOT a new type), `state: running`, `payload.reset_id` = the completed reset's id.
5. **Do NOT auto-restart** any scenario or re-enable emission — return to idle; the operator resumes manually.

**Unknown `event_type`:** no-op (forward-compatibility, per control-stream contract).

**Resilience.**
- Subscriber reconnects with `Last-Event-ID`; a missed `reset-completed` is recovered on replay (2 h `control_stream_events` window).
- **Local safety unblock.** If the driver is `blocked` and sees no `reset-completed` within a sane bound, it auto-unblocks locally rather than staying wedged forever. The bound mirrors the API's `GateMaxTtl` concept (the API forces `→ idle` on `GateMaxTtlSeconds`); the driver's bound is configurable (`RESET_GATE_MAX_TTL_MS`, §8) and SHOULD be ≥ the API's `GateMaxTtlSeconds` plus margin. On safety unblock: unblock `/demo/`, re-enable the interactive control cards, set `reset_state = idle`, and log a warning. No `running` event is posted (none was confirmed).

### 4.8 Control API event feed (SSE) — `GET /demo/control-stream`

| Method · Path | Response |
|---|---|
| `GET /demo/control-stream` | `text/event-stream` |

Re-broadcasts every frame the driver's control-stream subscriber receives from `GET /api/control/stream` (§4.7).

- Named frames carry the upstream `type` (`reset-initiated` / `reset-started` / `reset-completed` / unknown) and the `ControlStreamEvent` JSON as data; unknown types are forwarded verbatim (forward-compat display).
- `: ping` heartbeat every 15 s.
- **No history replay** — only frames received after the panel connects are delivered.
- **Exempt from reset control-dimming** — the feed continues emitting while `reset_state == blocked`; it is a data feed, not an interactive control (same pattern as §4.6 `/demo/stream`).

Wire example:

```
: ping

event: reset-initiated
data: {"id":"01J9F4WZK3W9G2T6X4QH3DKQF6","type":"reset-initiated","component":"*","occurred_at":"2026-05-31T10:00:00Z"}

event: reset-completed
data: {"id":"01J9F4X1N6B2C3D4E5F6G7H8J9","type":"reset-completed","component":"*","reset_id":"01J9F4WZK3W9G2T6X4QH3DKQF6","occurred_at":"2026-05-31T10:00:11Z"}
```

**Rationale.** The driver holds the single authenticated upstream connection (`X-Control-API-Key`); the browser never sees the key and N panels share one upstream subscription. Degrades gracefully when the upstream has no control stream (e.g. the mock): the feed simply stays empty.

### 4.9 Component event feed (SSE) — `GET /demo/control-events`

| Method · Path | Response |
|---|---|
| `GET /demo/control-events` | `text/event-stream` |

Re-broadcasts every frame the driver's component-events SSE subscriber receives from `GET /api/control/events/stream` (§4.9 subscriber). Mirrors the `GET /demo/control-stream` pattern (§4.8) exactly.

**Subscriber** (`component-events.subscriber.ts`):
- A long-lived service holds an open `GET {WRITE_API_URL}/api/control/events/stream` using `fetch()` + `ReadableStream` (NOT browser `EventSource` — permits future custom headers and uniform reconnect logic).
- Honors `Last-Event-ID` on reconnect; exponential backoff on connection failure.
- Fans each received `ComponentEventRecord` frame into an in-process `ComponentEventFeed` (RxJS Subject/observable).
- **Graceful degradation.** If the upstream is unreachable, the subscriber logs and retries — never crashes the driver.

**Re-broadcast** (`GET /demo/control-events`):
- Each panel `EventSource` connection subscribes to `ComponentEventFeed`.
- Named frames carry `event: component` and the `ComponentEventRecord` JSON as data; `: ping` heartbeat every 15 s.
- **No history replay** — fresh panel connect starts empty; fills as events arrive from the live stream.
- **Exempt from reset control-dimming** — feed continues while `reset_state == blocked`; data surface, not an interactive control (same pattern as §4.8).

Wire example:
```
: ping

event: component
data: {"id":"01J9F4WZK3W9G2T6X4QH3DKQF6","component_id":"demo-driver","event_type":"reset-ack","state":"paused","occurred_at":"2026-05-31T10:00:01Z"}

event: component
data: {"id":"01J9F4X1N6B2C3D4E5F6G7H8J9","component_id":"dashboard-fetcher","event_type":"status","state":"running","occurred_at":"2026-05-31T10:00:12Z"}
```

**Rationale.** The driver holds the single upstream connection; N panels share one upstream subscription. Same-origin re-broadcast avoids cross-origin / gateway-path issues. Symmetric with `GET /demo/control-stream` (§4.8).

### 4.10 Liveness aggregate — `GET /demo/health`

| Method · Path | Response |
|---|---|
| `GET /demo/health` | `HealthStatus` — read-only; never blocked by reset gate |

`HealthStatus`:
```json
{
  "driver":   "up",
  "api":      "up" | "down",
  "emulator": "up" | "down",
  "fetcher":  "up" | "down"
}
```

| Component | Probe | `"up"` condition |
|---|---|---|
| `driver` | n/a | Always `"up"` — if the panel can call this endpoint, the driver is running. |
| `api` | `GET {WRITE_API_URL}/healthz` | 2xx response. |
| `emulator` | `GET {GITHUB_EMULATOR_URL}/_github/status` | 2xx response. |
| `fetcher` | `GET {FETCHER_URL}/health` | 2xx response. |

Any non-2xx or unreachable → `"down"`. Probes are issued in parallel, with a short timeout (≤ 2 s per component); a slow component does not block the others. The panel polls this endpoint every 5 s to drive the status-bar liveness chips (§8).

### 4.11 Deployments feed (proxy) — `GET /demo/deployments-stream`

| Method · Path | Response |
|---|---|
| `GET /demo/deployments-stream` | `text/event-stream` |

Same-origin SSE passthrough of [`GET /api/events/stream`](api/openapi.yaml) (the API's deployment event stream). The driver opens an upstream connection to `{WRITE_API_URL}/api/events/stream` with `X-Api-Key` and fans out each received frame to every connected browser client.

**Frame pass-through.**

| Upstream frame | Forwarded as-is |
|---|---|
| `event: deployment` + `DeploymentEvent` JSON data | yes |
| `: ping` heartbeat | yes |
| SSE `id:` field (ULID) | yes |

**Parameter pass-through.**

| Client header / query | Forwarded to upstream | Notes |
|---|---|---|
| `Last-Event-ID` (header) | yes | Enables transparent client reconnect + server replay. |
| `?service` (query) | yes | Server-side filter on `service` identifier (upstream feature). |

- Public — no auth required from the browser client.
- **Exempt from reset control-dimming** — the feed continues while `reset_state == blocked`; it is a data feed, not an interactive control (same pattern as §4.8 `/demo/control-stream`).
- No history replay beyond what the upstream provides (upstream replays events newer than `Last-Event-ID`).

**Rationale.** The driver holds the single upstream connection with `X-Api-Key`; browser clients remain same-origin and never see the key. Proxying here means the panel sees events from all pushers — fetcher, demo-driver, any future source — not just what the driver itself posted. Symmetric with the `/demo/control-stream` proxy pattern (§4.8).

---

## 5. GitHub source (emulator proxy)

The driver exposes `/demo/github/*` as a **same-origin proxy** to the `github-emulator` service's `/_github/*` control surface. The emulated GitHub REST surface (`/repos/…`, `/rate_limit`) and all store/fixture/generator logic are owned by the emulator — see [`GITHUB_EMULATOR_SPECIFICATION.md`](GITHUB_EMULATOR_SPECIFICATION.md).

**Rationale.** The proxy exists solely for browser reachability — the panel must call same-origin to avoid CORS issues in gateway mode. The emulator has no secret; this is not an auth boundary.

### 5.1 Proxy routes

| Method | Driver path | Forwards to | Notes |
|---|---|---|---|
| `GET` | `/demo/github/status` | `GET {GITHUB_EMULATOR_URL}/_github/status` | Read-only; forwarded verbatim; **never blocked** during reset (data surface). |
| `POST` | `/demo/github/seed` | `POST {GITHUB_EMULATOR_URL}/_github/seed` | Interactive mutator — returns `503` while `reset_state == blocked` (§4.7). |
| `POST` | `/demo/github/clear` | `POST {GITHUB_EMULATOR_URL}/_github/clear` | Interactive mutator — `503` while blocked. |
| `GET` | `/demo/github/emit` | `GET {GITHUB_EMULATOR_URL}/_github/emit` | Read-only; forwarded verbatim; never blocked. |
| `POST` | `/demo/github/emit` | `POST {GITHUB_EMULATOR_URL}/_github/emit` | Interactive mutator — `503` while blocked. |

Request body and response body are forwarded verbatim. Non-2xx upstream responses surfaced to the caller as-is.

**Reset participation.** Mutator proxy routes (`POST /demo/github/seed`, `POST /demo/github/clear`, `POST /demo/github/emit`) return `503 application/problem+json` while `reset_state == blocked` (same gate as `POST /demo/ingest` — §4.7). The two read routes (`GET /demo/github/status`, `GET /demo/github/emit`) are data surfaces and bypass the gate, consistent with the §4.9 control-events proxy pattern.

---

## 6. Scenarios

### 6.1 Discovery

At startup the driver:
- Scans `SCENARIOS_DIR` for `*.json` files matching the `events.json` schema.
- Names each scenario by filename (without extension).
- Always includes `demo-set` (sourced from `demo/data/events.json`).

### 6.2 Built-in scenario: `demo-set`

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

## 7. Write API integration

| Concern | Spec |
|---|---|
| Endpoint | `POST {WRITE_API_URL}/api/deployments` |
| Auth | `X-Api-Key: <API_KEY>` on every request |
| Attribution | `X-Progress-Reporter: demo-driver/{dataset}` — dataset name in the adapter segment; `demo-driver/emit` for periodic emission |
| Retry | 3 attempts, exponential backoff: 100 ms → 200 ms → 400 ms; applies on network error or `5xx` |
| Non-2xx (final) | Log `{ http_status, deployment_id, service, environment }`; increment `errors`; continue |
| `4xx` (client error) | No retry; log immediately; increment `errors`; continue |

---

## 8. Control panel

`GET /demo/` serves a browser control panel (`text/html`). No bundler — inline HTML/CSS/JS (NFR-08 spirit; tooling consistency with mock).

**Status bar.** A persistent bar at the top of the panel shows four liveness chips — **Driver** · **API** · **Emulator** · **Fetcher** — each green=up / red=down / amber=checking. Driven by `GET /demo/health` (§4.10) polled every 5 s. Driver is always green if the panel loaded.

| Card | Position | Controls |
|---|---|---|
| **Ingest** | 1 | *Ingest sub-section:* Dataset dropdown (`demo` \| `random`); count input (random only, hidden for demo); **Reset** checkbox (checked by default); delay (ms) input; **Ingest** / **Stop** buttons. *Live Emission sub-section:* Random events `OFF` / `LIVE` badge; **Enable** / **Disable** toggle → `GET\|POST /demo/emit`. |
| **GitHub Emulator** | 2 (between Ingest and Status) | *Seed sub-section:* Dataset dropdown (`demo` \| `random`); count input (random only); **Reset** checkbox; **Seed** / **Clear** buttons → `POST /demo/github/seed` \| `POST /demo/github/clear`. *Live sub-section:* `OFF` / `LIVE` badge; **Enable** / **Disable** toggle → `POST /demo/github/emit`. *Store sub-section:* counters (repos / deployments / statuses / workflows / environments), dataset badge, `seeded_at` — from `GET /demo/github/status`. |
| **Status** | 3 | State badge (`idle` / `running` / `done` / `failed`); progress bar (`events_sent / events_total`); error count; started/finished timestamps |
| **API** | 4 | **Reset State** button; inline result (`✓ Reset OK (204)` / `✗ HTTP 401`) |
| **Deployments** | 5 | Real-time `GET /demo/deployments-stream` SSE feed (§4.11) — proxies `GET /api/events/stream`; all pushers (demo-driver, fetcher, any); `● LIVE` / `● RECONNECTING` badge; rows follow unified Time·Source·Event·ID·Details format (see below); **Clear** button. Persists latest 10 rows to `localStorage`; hydrates on page load; **Clear** empties localStorage. Stays live during reset. |
| **Reset (system)** | 6 | Reset-state indicator badge (`IDLE` / `RESET IN PROGRESS`); shows active `reset_id` when blocked. Reflects API-driven reset participation (§4.7) — read-only. |
| **Events** | 7 | Merged feed sourced from BOTH `GET /demo/control-stream` (§4.8 SSE) AND `GET /demo/control-events` (§4.9 SSE); `EventSource` on each; rows sorted **datetime DESC** (newest first) across both sources; timestamps rendered **with milliseconds**; dedup by `id`; single `● LIVE` / `● RECONNECTING` badge; **Clear** button. Fresh connect starts empty — fills as events arrive (no server replay on either feed). Persists latest 20 rows to `localStorage`; hydrates on page load; **Clear** empties localStorage. Stays live during reset. |

**GitHub Emulator card.** All panel calls go to `/demo/github/*` (the proxy — §5). The Seed sub-section and Live sub-section are interactive controls — dimmed and disabled while `reset_state == blocked` (mutator proxy routes return `503`; §5.1). The Store sub-section is a data surface and stays live.

- **Emulator-liveness gating.** The GitHub Emulator card is **hidden unless the emulator answers the liveness probe** — `emulator == "up"` in the `GET /demo/health` response. When the emulator is absent (e.g. non-demo deployments) the card stays hidden; the 5 s health poll re-evaluates, so the card appears/disappears as the emulator comes and goes.

**Unified feed row format.** Both feed cards (Deployments, Events) use the same column order:

| Column | Content |
|---|---|
| **Time** | Timestamp (with milliseconds) |
| **Source** | Reporter / origin |
| **Event** | Event name or type |
| **ID** | Correlation identifier |
| **Details** | Event-specific fields in a single cell |

Per-feed row mapping:

| Feed | Row kind | Time | Source | Event | ID | Details |
|---|---|---|---|---|---|---|
| Deployments (`/demo/deployments-stream`) | — | `happened_at` (ms) | `progress_reporter` (e.g. `dashboard-fetcher/github-actions`, `demo-driver/demo`) | `status` | `deployment_id` | `service / env → status` · `version` |
| Events (merged) | control-stream row | `occurred_at` (ms) | `control-api` (literal) | `type` (reset-initiated=amber / reset-started=blue / reset-completed=green / unknown=default) | event `id` | `reset_id: <id>` when present |
| Events (merged) | component row | `received_at` (ms) | `component_id` | `event_type` | record `id` | `state` (colour-coded) · `detail` when present · notable payload keys |

**localStorage persistence.**
- Deployments: latest **10** rows (by `happened_at` DESC); trimmed on every append.
- Events: latest **20** rows (by timestamp DESC, across both kinds); trimmed on every merge+sort.
- Hydration on page load: both feeds restore from `localStorage` before the first network response arrives. Neither feed has server replay — `localStorage` is the sole source of historical rows on load. Incoming live frames are deduped by `id` on merge.
- **Clear** on a feed card: empties the in-memory list AND removes that feed's `localStorage` key; the feed stays empty after refresh.

**Reset blocking (controls only — no overlay).** While `reset_state == blocked` (§4.7):
- Interactive control cards (Ingest, GitHub Emulator) are disabled and visually dimmed — their controls would return `503` anyway.
- Data feeds — Status, Deployments, Events — stay fully live so the operator can watch the reset choreography.
- Reset state is signalled by the inline `RESET IN PROGRESS` badge (Reset (system) card), not a blocking overlay.
- Dim/disable clears automatically when `reset_state` returns to `idle`.

Panel behaviour:
- Polls `GET /demo/health` every 5 s → drives status-bar chips; `emulator == "up"` shows/hides the GitHub Emulator card.
- Calls `GET /demo/status` + `GET /demo/emit` on load; polls `GET /demo/status` to surface `reset_state` changes.
- The panel does NOT subscribe to the upstream `GET /api/control/stream` directly — that is the backend subscriber's job (§4.7); the panel consumes `GET /demo/control-stream` for the Events feed.
- Calls `POST /demo/ingest` / `POST /demo/ingest/stop` on Ingest/Stop buttons.
- Calls `POST /demo/emit` on Live Emission Enable/Disable.
- Calls `POST /demo/api-reset` on Reset State button.
- Subscribes to `GET /demo/deployments-stream` (§4.11) for the Deployments feed.
- Subscribes to `GET /demo/control-stream` (§4.8) AND `GET /demo/control-events` (§4.9) via `EventSource` for the merged Events feed; merges and deduplicates by `id`, sorts datetime DESC.
- `GET /demo/deployments-stream`, `GET /demo/control-stream`, and `GET /demo/control-events` are data feeds — live throughout reset and exempt from reset control-dimming.

---

## 9. Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP listen port |
| `WRITE_API_URL` | `http://localhost:3000` | Base URL of the Write API target |
| `API_KEY` | `dev-secret` | Shared secret; sent as `X-Api-Key` on every ingest request **and** on `POST /api/control/events` (reset-ack / status) — §4.7. No new key needed. |
| `CONTROL_API_KEY` | `dev-secret` | Secret for `X-Control-API-Key` on `POST /api/control/reset` (§4.5) **and** on the `GET /api/control/stream` subscriber (§4.7). No new key needed. |
| `COMPONENT_ID` | `demo-driver` | Component identity sent as `X-Component-Id` on `POST /api/control/events` and as `?component=` on the control-stream subscription. Default matches the API's `Reset:ExpectedComponents`; overriding it will exclude the driver from ack-counting — change only with intent. |
| `RESET_GATE_MAX_TTL_MS` | `90000` | Local safety-unblock bound (§4.7). If `blocked` this long with no `reset-completed`, the driver auto-unblocks. SHOULD be ≥ the API's `Reset:GateMaxTtlSeconds` (default 60 s) plus margin. |
| `SCENARIOS_DIR` | `../../demo/data` | Path to scenario JSON files |
| `EMIT_DELAY_MS` | `0` | Per-event delay for ingest runs (ms); `0` = bulk load |
| `EMIT_INTERVAL_MS` | `8000` | Interval between periodic random events when Live Emission is enabled |
| `GITHUB_EMULATOR_URL` | `http://localhost:3100` | Base URL of the `github-emulator` service; used by the `/demo/github/*` proxy (§5) and the emulator liveness probe (§4.10). |
| `FETCHER_URL` | `http://localhost:8080` | Base URL of the fetcher-host; used by the fetcher liveness probe `GET {FETCHER_URL}/health` (§4.10). |

> The emulated GitHub REST surface and its config (e.g. `GITHUB_SIM_RATE_LIMIT`) are owned by the emulator — see [`GITHUB_EMULATOR_SPECIFICATION.md`](GITHUB_EMULATOR_SPECIFICATION.md) §4. The fetcher's own demo-mode config (`GITHUB__BASE_URL`, `GITHUB__TOKEN`, etc.) is fetcher config — see FETCHER_SPEC §6.

---

## 10. Testing

| Layer | File | Scope |
|---|---|---|
| Unit | `scenario-runner.spec.ts` | `elapsed_minutes → happened_at` conversion; `runWire` posts pre-computed events; sequential POST order; counter accuracy; stop-mid-run sets `state = failed` |
| Unit | `write-api.client.spec.ts` | Retry on `5xx` (3 attempts); no retry on `4xx`; `X-Api-Key` + `X-Progress-Reporter` headers |
| Unit | `control-api.client.spec.ts` | Single attempt (no retry); `X-Control-API-Key` header; `ok=true` on 2xx; `ok=false` on 4xx/5xx/network |
| Unit | `random-event-generator.spec.ts` | All required wire fields present; status in valid enum; `happened_at` in the past; unique `deployment_id`s; correct count |
| Unit | `demo.controller.spec.ts` | All endpoints: status, scenarios, ingest, ingest/stop, emit GET/POST, api-reset, reset; state transitions; NotFoundException on missing scenario; `/demo/` control calls return `503` + `Retry-After` while `reset_state == blocked`, while `GET /demo/status` still answers (blocked state); `GET /demo/control-stream` emits frames pushed to ControlFeed and is NOT blocked during reset; `GET /demo/control-events` re-broadcasts SSE from ComponentEventFeed and is NOT blocked during reset |
| Unit | `control-feed.spec.ts` | Every parsed frame (known + unknown type) is published to subscribers; multiple subscribers each receive all frames; late subscriber gets only post-subscription frames (no replay) |
| Unit | `component-events.subscriber.spec.ts` | Parses SSE frames from `fetch()`+ReadableStream; reconnects with `Last-Event-ID`; connect failure logs + retries and does NOT crash; each received frame published to `ComponentEventFeed`; exponential backoff applied on reconnect |
| Unit | `control-events.client.spec.ts` | `reset-ack` POST carries `X-Api-Key` + `X-Component-Id: demo-driver` + correct body (`event_type: reset-ack`, `state: paused`, `payload.reset_id`); `status`/`running` POST shape; component id from `COMPONENT_ID` |
| Unit | `control-stream.subscriber.spec.ts` | Parses SSE frames from `fetch()`+ReadableStream; reconnects with `Last-Event-ID`; connect failure (no control stream, e.g. mock) logs + retries and does NOT crash; unknown `event_type` is a no-op; dispatches `reset-initiated`/`reset-completed` to the coordinator; publishes every parsed frame (known + unknown) to ControlFeed |
| Unit | `reset-coordinator.spec.ts` | On `reset-initiated`: stops ingest/run, disables emit, enters `blocked`, acks (`paused` + `reset_id`); `reset-started` = no-op; on `reset-completed`: unblocks, posts `status`/`running` with `reset_id`, returns to idle, does NOT auto-restart; local `RESET_GATE_MAX_TTL_MS` safety unblock fires when no `reset-completed` arrives (no `running` posted) |
| Integration | `demo.e2e.spec.ts` | Start driver against mock; `POST /demo/ingest { dataset: "demo" }`; poll until `state == done`; assert `GET /api/services` returns ≥ 1 service |
| Integration | `reset-cycle.e2e.spec.ts` | Full reset cycle against a **real** `Dashboard.Api`: trigger `POST /api/control/reset`; assert the driver acks `reset-initiated` (component event visible via `GET /api/control/events/stream`), `/demo/` calls return `503` while blocked, and on `reset-completed` the driver unblocks + posts `status`/`running` and returns to idle |
| Unit | `github-proxy.controller.spec.ts` | All five proxy routes (`status`, `seed`, `clear`, `emit` GET, `emit` POST) forward request body + response body verbatim to `GITHUB_EMULATOR_URL/_github/*`; `POST` mutator routes return `503` while `reset_state == blocked`; `GET` routes are NOT blocked; non-2xx upstream responses surfaced as-is |
| Unit | `github-proxy.client.spec.ts` | HTTP client constructs correct upstream URL; passes body through; surfaces upstream status code |
| Unit | `health.controller.spec.ts` | `GET /demo/health` returns `{ driver:"up", api, emulator, fetcher }`; probes run in parallel; `2xx` upstream → `"up"`, non-2xx/unreachable → `"down"`; never blocked by reset gate; `FETCHER_URL` used for fetcher probe |

---

## 11. Running

```powershell
cd demo/driver
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

## 12. Deployment

| Aspect | Spec |
|---|---|
| Image | Multi-stage Dockerfile in `demo/driver/`. Stage 1: `node:lts-alpine` builds TypeScript. Stage 2: `node:lts-alpine` runs the compiled output. |
| Gateway path | Proxied by App Gateway at `location /demo/` → `DEMO_DRIVER_UPSTREAM` (see [`GATEWAY_SPECIFICATION.md`](GATEWAY_SPECIFICATION.md)). |
| SSE | `/demo/stream`, `/demo/deployments-stream`, `/demo/control-stream`, and `/demo/control-events` require the same proxy SSE block as `/api/events/stream` (buffering off, `proxy_read_timeout 3600s`). |
| Port | Container listens on `PORT` (default `3001`); `DEMO_DRIVER_UPSTREAM` in the gateway is `demo-driver:3001`. |
| Panel access | Direct: `http://localhost:3001/demo/`. Via gateway: `http://gateway/demo/`. |

---

## 13. Out of scope

- Scenario authoring or editing (read-only against `demo/data/`).
- Scenario scheduling / cron.
- Concurrent multi-scenario execution.
- Authentication on the control API or control panel.
- **Clearing the target backend data.** The driver never truncates backend state itself — the Write API is append-only and data-clearing is owned by the API's reset orchestrator (or `/_mock/reset` for mock targets). The driver only *participates* in the API-driven reset choreography (§4.7, D10): it reacts to control-stream reset events (drain → ack → block → recover) but performs no data deletion. The operator-triggered `POST /demo/api-reset` proxy (§4.5) merely forwards the trigger to the API; the API does the clearing.
- Initiating its own reset choreography beyond the §4.5 proxy (the driver is a reactor, not the orchestrator).
- Component-event filtering UI (component_id / event_type filter inputs) on the Events panel card.
- Server-side replay of control-stream frames — history is not stored in the driver (localStorage provides client-side persistence; §8).
- Emulated GitHub REST surface, store, fixture, and generator logic (owned by `github-emulator` — [`GITHUB_EMULATOR_SPECIFICATION.md`](GITHUB_EMULATOR_SPECIFICATION.md)).
