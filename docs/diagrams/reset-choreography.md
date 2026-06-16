# Reset Choreography

Choreography-driven, event-based system-state reset across `Dashboard.Api` and its optional components (fetcher, demo-driver). The API is the orchestrator and single source of truth; components react to control-stream events and report back via `POST /api/control/events`.

**Authoritative behaviour:** [`API_SPECIFICATION.md` §10](../API_SPECIFICATION.md#10-implementation-phases-atomic-commits). This document is the visual reference only — wire shapes live in [`openapi.yaml`](../api/openapi.yaml).

## Control-stream event vocabulary

| `type` | Emitted when | `component` | Effect on components |
|---|---|---|---|
| `reset-initiated` | `POST /api/control/reset` accepted | `*` | Drain: stop fetching/ingesting, block own API + UI, then ack `paused`. |
| `reset-started` | Acks in OR timeout elapsed | `*` | Reset window opened; ingest briefly returns `503`. |
| `reset-completed` | Data cleared, gates released | `*` | Recover: clear state, re-ingest/backfill, unblock, report `running`. |

**`correlation_id` — the universal process id (#265).** It originates at `reset-initiated` (where `correlation_id == id`) and is carried by every downstream command frame (`reset-started` / `reset-completed`) and component event (`reset-ack`, post-reset `status`), so the whole saga shares one filterable key. Each event keeps its own unique `id` (PK / SSE cursor), **distinct** from `correlation_id`; there is no `reset_id` field.

Acks are `POST /api/control/events` with `event_type: reset-ack`, `state: paused`, and the **required** header `X-Correlation-Id: <reset-initiated id>`. The orchestrator gates on `correlation_id` (the stored header value, matched against the in-flight cycle). A reset-ack with a missing/mismatched `correlation_id` is recorded but does not count toward the gate (see [`API_SPECIFICATION.md` §7 Channel 3](../API_SPECIFICATION.md#channel-3--component_acks-reset-ack-fan-in)).

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator
    participant API as Dashboard.Api
    participant DB as PostgreSQL
    participant F as Fetcher
    participant D as Demo Driver

    Note over F,D: Both hold an open GET /api/control/stream

    Op->>API: POST /api/control/reset
    activate API
    Note over API: idle → draining<br/>advisory lock · correlation_id = reset-initiated id (uuidv7)
    API->>DB: emit reset-initiated {id, correlation_id: id, component:"*"}
    API-->>Op: 202 Accepted {correlation_id, state: draining}
    deactivate API
    Note over API: reset → 409 · ingest STILL OPEN

    DB-->>F: reset-initiated
    DB-->>D: reset-initiated

    par Fetcher drains
        F->>F: stop poll loop + ingestion
        F->>API: POST /api/control/events {reset-ack, paused} · X-Correlation-Id
    and Demo driver drains
        D->>D: block /demo/ API · stop emit · UI banner
        D->>API: POST /api/control/events {reset-ack, paused} · X-Correlation-Id
    end

    Note over API: orchestrator counts acks for correlation_id
    alt both acks in (fetcher + demo-driver)
        DB-->>API: ack(fetcher) + ack(demo-driver)
    else AckTimeoutSeconds (default 10s) elapses
        Note over API: proceed — components optional
    end

    Note over API: draining → resetting · ingest gate ON
    API->>DB: emit reset-started {correlation_id}
    Note over API: POST /api/deployments → 503 (brief)
    API->>DB: clear deployment history + fetcher cursors
    Note over API: gates OFF · resetting → idle · reset reopens
    API->>DB: emit reset-completed {correlation_id}

    DB-->>F: reset-completed
    DB-->>D: reset-completed

    par Fetcher recovers
        F->>F: clear cursor → backfill (initial ingestion)
        F->>API: POST /api/deployments (backfill batch)
        F->>F: resume periodic poll
        F->>API: POST /api/control/events {running}
    and Demo driver recovers
        D->>D: unblock /demo/ API · clear UI banner
        D->>API: POST /api/control/events {running}
    end
```

## State machine (API-driven)

Implemented with the **Stateless** library (`dotnet-state-machine/stateless`); current state is externally persisted in a DB state row (loaded per transition), with a Postgres advisory lock electing a single driver across instances (NFR-05). A `GateMaxTtl` safety abort prevents the system wedging with ingestion blocked if the driving instance dies mid-cycle.

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Draining: POST /reset → emit reset-initiated
    Draining --> Resetting: both acks OR 10s timeout<br/>emit reset-started · ingest gate ON
    Resetting --> Idle: data cleared · gates OFF<br/>emit reset-completed

    Draining --> Draining: POST /reset → 409
    Resetting --> Resetting: POST /reset → 409 · ingest → 503
    Draining --> Idle: GateMaxTtl exceeded (abort)
    Resetting --> Idle: GateMaxTtl exceeded (abort)
```

## Decisions (locked)

| # | Decision |
|---|---|
| 1 | State machine via the **Stateless** library; state externally persisted (DB state row) + Postgres advisory lock for single-driver election across instances (NFR-05). |
| 2 | Proceed when **both** acks (fetcher + demo-driver) are in **OR** `AckTimeoutSeconds` elapses; default **10 s**. |
| 3 | Reset clears **only** `deployment_events` + `fetcher_state`; control/component tables left to the 2 h retention job. |
| 4 | Event types `reset-initiated` / `reset-started` / `reset-completed`; the legacy `reset` type is dropped (no alias). |
| 5 | Ack = `POST /api/control/events` `{event_type: reset-ack, state: paused}` + **required** header `X-Correlation-Id` = the `reset-initiated` id. The ack-gate keys on `correlation_id` (#265, Option A — `reset_id` retired everywhere). A missing/mismatched `correlation_id` is recorded but does not count toward the gate. |
| 6 | No status endpoint — reset progress is observable via the control-stream events only. |

Config keys (appsettings + env override): `AckTimeoutSeconds` (default 10), `ExpectedComponents` (default `dashboard-fetcher`, `demo-driver`), `GateMaxTtlSeconds` (default 60).

**`GateMaxTtlSeconds` enforcement.** This is a hard wall-clock ceiling on the entire orchestrator cycle, not just a checkpoint. A linked `CancellationTokenSource` armed with `GateMaxTtlSeconds` is created when the cycle starts and passed to every await inside the cycle — including `ClearDataTablesAsync`. If the ceiling fires (timeout, not graceful shutdown), the cycle is force-aborted: state written to `idle`, a `reset-completed` event emitted on the control stream so connected components recover, and the advisory lock released. The ack-wait (`AckTimeoutSeconds`) is a separate, inner timeout and is unaffected.
