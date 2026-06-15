# GitHub API Emulation — Fetcher Demo Emulation

Visual reference only. Authoritative behaviour stays in [`DEMO_DRIVER_SPECIFICATION.md`](../DEMO_DRIVER_SPECIFICATION.md) §5, [`GITHUB_EMULATOR_SPECIFICATION.md`](../GITHUB_EMULATOR_SPECIFICATION.md), and [`FETCHER_SPECIFICATION.md`](../FETCHER_SPECIFICATION.md) §5. Wire shapes are in [`openapi.yaml`](../api/openapi.yaml) (dashboard API) and the fetcher spec's endpoint tables (GitHub surface).

---

## Diagram A — Demo-mode topology

Three services; two parallel write paths into `Dashboard.Api`.

```mermaid
flowchart LR
    subgraph Panel["Operator (browser panel)"]
        P1["Write-path controls<br/>/demo/ingest · /demo/emit"]
        P2["GitHub-source controls<br/>/demo/github/* (proxy)"]
    end

    subgraph Driver["Demo Driver :3001<br/>write-path + /demo/github/* proxy"]
        WP["Write-path module"]
        Proxy["/demo/github/*<br/>proxy controller"]
    end

    subgraph Emulator["github-emulator :3100<br/>GitHub REST @ root + /_github/* control"]
        GHREST["GET /repos/{o}/{r}/…<br/>GET /rate_limit<br/>X-RateLimit-* · Link headers"]
        GHCtl["/_github/seed · /_github/clear<br/>/_github/emit · /_github/status"]
        Store["In-memory<br/>GitHub store"]
    end

    subgraph Fetcher["Dashboard.Fetcher<br/>GITHUB_BASE_URL=http://github-emulator:3100<br/>(code unchanged — F9)"]
        FA["GithubActionsAdapter"]
    end

    subgraph API["Dashboard.Api"]
        Ingest["POST /api/deployments"]
    end

    DB[("PostgreSQL")]
    SPA["Angular SPA"]

    P1 --> WP
    WP -->|"POST /api/deployments"| Ingest

    P2 --> Proxy
    Proxy -->|"/_github/*"| GHCtl
    GHCtl --> Store
    Store --> GHREST

    FA -->|"GET /repos/… · /rate_limit"| GHREST
    FA -->|"POST /api/deployments<br/>(mapped events)"| Ingest

    Ingest --> DB
    DB --> SPA
```

**Key constraint.** The fetcher code is unchanged; `GITHUB_BASE_URL=http://github-emulator:3100` points its root-relative paths at the emulator. The driver proxy (`/demo/github/*`) exists solely for browser same-origin reachability — not an auth boundary.

---

## Diagram B — Seed → backfill → poll sequence

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator (panel)
    participant D as Demo Driver
    participant E as github-emulator (/_github/*)
    participant GH as Emulated GitHub REST (/repos/…)
    participant F as Fetcher
    participant API as Dashboard.Api

    Op->>D: POST /demo/github/seed {dataset:"demo"}
    D->>E: POST /_github/seed {dataset:"demo"} (proxy)
    E->>E: populate in-memory store<br/>(repos · deployments · statuses<br/>runs · workflow YAML · environments · artifacts)
    E-->>D: GithubStoreStatus
    D-->>Op: GithubStoreStatus

    Note over F: cursor null → backfill (F14, §5.8)
    F->>GH: GET /repos/{o}/{r}/actions/workflows?per_page=100
    GH-->>F: {workflows:[…]} + X-RateLimit-* headers

    F->>GH: GET /repos/{o}/{r}/environments
    GH-->>F: {environments:[…]}

    loop per environment
        F->>GH: GET /repos/{o}/{r}/deployments?environment={E}&per_page=100
        GH-->>F: [{deployment…}] + Link rel=next (when more pages)
        F->>GH: GET /repos/{o}/{r}/deployments/{id}/statuses
        GH-->>F: [{status…}]
        F->>GH: GET /repos/{o}/{r}/actions/runs/{run_id}
        GH-->>F: {id, name, path, head_sha}
        F->>GH: GET /repos/{o}/{r}/contents/{path}?ref={sha}
        GH-->>F: {content: "<base64 workflow YAML>", encoding:"base64"}
    end

    Note over F: map events · resolve parent_deployments (§5.6)<br/>· resolve version (§5.7) · POST batch oldest-first
    F->>API: POST /api/deployments (batch — incl. parent_deployments + version)
    API-->>F: 201

    Note over F: cursor advanced to max(status.created_at)

    Op->>D: POST /demo/github/emit {enabled:true}
    D->>E: POST /_github/emit {enabled:true} (proxy)
    E-->>D: {emitting:true}
    D-->>Op: {emitting:true}

    loop every EMIT_INTERVAL_MS
        E->>E: append new deployment + status lifecycle<br/>(created_at=now)
        Note over F: next poll — cursor present → incremental
        F->>GH: GET /repos/{o}/{r}/deployments?environment={E}
        GH-->>F: new deployment(s) since cursor
        F->>API: POST /api/deployments (new events)
        API-->>F: 201
    end
```

---

## Decisions (locked)

| # | Decision |
|---|---|
| G1 | GitHub emulation lives in a **separate `github-emulator` service** (`demo/github-emulator/`) — not in the driver. Per-adapter isolation: future ADO/Jenkins emulators are sibling services, each at their own root, with no path-prefix or port collision and no fetcher change required. |
| G2 | No fetcher code change — fetcher is config-driven (FETCHER_SPEC F9); demo mode sets `GITHUB_BASE_URL=http://github-emulator:3100`. The fetcher-host is wired into the demo compose profile (currently absent from all compose files). |
| G3 | Demo set = curated `demo/data/github/` fixture (workflow YAML + dev→staging→prod `needs` chain + artifact-sourced version), coherent with existing demo service/env names. Proves `parent_deployments` (F10) + artifact version (F15). |
| G4 | Random set / periodic emit = GitHub-shaped generator in the emulator, parallel to the write-path `random-event-generator.ts`. |
| G5 | Emulated REST emits `X-RateLimit-*` headers + `Link` pagination + serves `/rate_limit`; ETag/`304` deferred. Exercises the fetcher's F8/F16 paths. |
| G6 | The emulator IS the test mock for fetcher integration coverage — tests seed it via `POST /_github/seed` then assert the fetcher's output (realizes FETCHER_SPEC §7.2). |
