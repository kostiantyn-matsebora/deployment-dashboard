# Solution Architecture — Deployment Dashboard

**Version:** 1.0  
**Status:** Draft  
**Date:** May 2026

---

## 1. Problem Statement

Teams using any CI/CD tool (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, etc.) lack a unified, at-a-glance view of what version of each service is currently deployed to each environment. Built-in deployment views in individual CI/CD tools typically show one row per environment with no per-service granularity, or require navigating across multiple pipelines and logs to reconstruct the full picture. As the number of services and environments grows, determining the state of the entire system becomes increasingly manual and error-prone.

**Core question the system must answer:**  
*"What version of service X is running in environment Y right now — and did the last deployment succeed?"*

---

## 2. Goals

- Show a real-time **services × environments deployment matrix** sourced from CI/CD pipeline events (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, or any tool that can make an HTTP POST)
- Record a per-slot history of deployments (version, status, actor, time, run link)
- Require **no changes to existing CI/CD pipelines** beyond adding a single notification step
- Support **SSE fan-out across multiple backend instances** — all connected browser clients receive live updates regardless of which instance handled the ingest request; no sticky sessions required
- Support any CI/CD tool, repository, and set of services/environments — no hardcoded values; services and environments are discovered from stored data

## 3. Non-Goals

- Triggering or managing deployments (the system is read-only / notification-only)
- Acting as a CI/CD engine — the system only tracks deployment state pushed to it; it does not query any CI/CD tool
- Multi-organisation or multi-repository aggregation (out of scope for MVP)
- Role-based access control (the dashboard is internal read-only tooling)

## 4. Functional Requirements

| ID | Requirement |
|---|---|
| FR-01 | The system shall display a real-time deployment matrix organised by service (one row per service), showing the current state of each (service, environment) slot. Environment placement within a row is a per-view rendering concern (columns or pills) — see §7 "Visual layout". |
| FR-02 | Each slot shall be capable of showing: version, status (success / in-progress / failure), actor, elapsed time since deployment, a link to the CI/CD run, source ref, and commit SHA. The user may select a subset of these attributes for the matrix view via the attribute picker (FR-12); the history drawer and any Focus-view expanded row always show every attribute (see §7 "Full-attribute disclosure rule"). `ref` and `sha` are nullable on the wire (FR-05; §7 "deployments table"); when null/absent on a slot the picker still renders the attribute slot empty rather than the literal string `null` (see §7 "Null-render invariant for nullable attributes"). |
| FR-03 | When the current state is in-progress or failed, the slot shall also show the last successfully deployed version in a split section below the current state. This element is always-on and is not affected by the attribute picker (FR-12). |
| FR-04 | The system shall maintain a full deployment history per slot and expose it on demand via a history drawer. |
| FR-05 | The system shall receive deployment events through a push-based HTTP ingest API (`POST /api/deployments`) accepting: service, environment, version, status, run URL, run number, and actor. The payload also accepts two optional source-identifier fields — `ref` (branch / PR / human-readable source identifier) and `sha` (commit SHA) — both nullable strings; the server stores them when present and renders them via the API responses defined in §"API Contract". The SPA exposes both fields to the user as Display picker (FR-12) options and as Topology correlation picker options (FR-13); see §7 "Attribute vocabulary" and §7 "Null-render invariant for nullable attributes". Stricter validation of value shape is a separate, deferred follow-up (§10 Decision 10). |
| FR-06 | Integrating the notify step shall require no changes to existing CI/CD pipelines beyond adding a single step. |
| FR-07 | The dashboard shall support filtering by service name and by failure state only. Both filters apply across every layout view defined in §7 "Visual layout". |
| FR-08 | All connected browser clients shall receive live updates when a new deployment event is ingested — no page reload required. |
| FR-09 | The system shall support any set of services and environments without hardcoded values; the service and environment lists shall be derived from stored data. |
| FR-10 | The ingest API shall authenticate every write request with an API key; requests with a missing or invalid key shall be rejected with HTTP 401. |
| FR-11 | (v2.0) A desktop notification client shall alert developers via OS notifications when a deployment slot changes state, with a click-through to the dashboard. |
| FR-12 | The dashboard shall expose four named layout views — **Detailed**, **Compact**, **Glance**, **Focus** — and an attribute picker that lets the user choose which of the FR-02 attributes appear on the matrix grid, subject to a per-view cap. View selection and per-view attribute selection persist client-side in `localStorage`. See §7 "Visual layout" for the contract. |
| FR-13 | The SPA shall offer three layouts — **Matrix**, **Swim-lane**, **Workflow-rows** — selectable from a top-bar segmented control. Layout selection is orthogonal to view (FR-12): all 4 × 3 = 12 (view, layout) combinations are supported. Layout selection persists client-side in `localStorage` under key `dashboard.layout`. Default: `Matrix` (preserves canonical first paint). Swim-lane and Workflow-rows render per-service topology (§5 "Topology derivation" / §7 "Topology in the wire shape"); when a service has no topology (no explicit `parent_deployments` and the correlation fallback yields no edges), that service renders as a single root chain in those layouts. The mockup (`docs/deployment-dashboard.html`) is the visual contract; the responsiveness invariant in NFR-09 already covers all three layouts. |

---

## 5. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | All infrastructure shall run on Microsoft Azure. |
| NFR-02 | Total Azure infrastructure cost shall not exceed $30/month. |
| NFR-03 | Live updates shall be delivered to all connected clients within 5 seconds of a successful ingest event. |
| NFR-04 | The system is internal tooling — no public internet exposure is required. The SPA itself is read-only against the API and does not handle authentication secrets. Write endpoints (`POST /api/deployments`, `PATCH /api/config/topology`) are reserved for CI/CD and ops tooling. The dev-environment fake API key is never embedded in the SPA bundle. |
| NFR-05 | The backend shall be stateless; any number of instances may run behind a load balancer without sticky sessions. |
| NFR-06 | All infrastructure shall be defined as code using Terraform. |
| NFR-07 | Deployment history shall be retained for a minimum of 90 days per slot. |
| NFR-08 | The dashboard shall load in a browser with no build step — no bundler or compilation required. |
| NFR-09 | **UX-RESPONSIVENESS INVARIANT.** The dashboard layout shall reflow correctly under any combination of: service count (1..N), environment count per service (1..N), env-name length (1..32 chars), version-string length (1..50 chars), viewport width (≥ 1024 px), view (Detailed / Compact / Glance / Focus), and layout (Matrix / Swim-lane / Workflow-rows). Under no combination may visual elements overlap such that information is clipped, occluded, or rendered illegible. This includes env labels, deployment boxes, version strings, status badges, connector lines, arrowheads, and fork trunks. Enforced by construction: env-tag + box pairs use CSS Grid (`auto` env-tag column, fixed leaf-width box column); connector geometry is anchored to live `getBoundingClientRect()` measurements re-evaluated via a `ResizeObserver` and a window-resize listener. **Exception (Glance view only):** the env label is rendered INSIDE the deployment rectangle. This is the single allowed overlap of env-tag and box, and is permitted because the Glance pill's vertical extent forces the connector y to cross the env-tag y in any left-of-box layout. The env label remains visible (not clipped) and the connector terminates at the pill's left edge as in other views. The same invariant is mirrored verbatim at the top of `docs/deployment-dashboard.html` (the mockup is the visual contract). |

---

## 6. Constraints

- **Hosting platform:** Azure only — all infrastructure must run on Microsoft Azure.
- **Budget:** ≤ $30/month total (compute + database + storage combined). One unified backend container app (Write + Read surfaces in a single host — see §7 "Backend module architecture") helps stay under this cap by halving the per-app overhead vs. two backend container apps.
- **Network:** The system is deployed inside the organisation's internal network or a private Azure-hosted container; it is not publicly accessible.
- **Technology stack:** Angular 20+ for the frontend; .NET 10 for all backend components.
- **Platform agnosticism:** The solution must not depend on any proprietary cloud compute model (e.g. serverless Functions). All backend components must be deployable as standard containerised applications on any OCI-compliant container host. The single backend container app (Write + Read surfaces) is itself a standard OCI image listening on a single port — no proprietary compute model is required.

---

## 7. Target Architecture

Given the Azure-only hosting constraint, the ≤ $30/month budget, and the platform-agnosticism requirement, the backend is deployed as **one containerised ASP.NET Core service** on Azure Container Apps. That single container hosts two logically-distinct API surfaces — **Write API** (`POST /api/deployments`, API-key-gated) and **Read API** (matrix / history / discovery / SSE / health, unauthenticated) — composed at startup from separate library projects (see §"Backend module architecture"). A future split into two containers is a host-project + gateway-config change only; the library boundary is the migration seam. Real-time fan-out uses **SSE + PostgreSQL `LISTEN/NOTIFY`** — Azure Container Apps imposes no HTTP timeout on long-lived SSE connections, making a separate real-time service unnecessary.

---

### System Design

#### High-Level Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          GitHub                                       │
│                                                                      │
│  ┌────────────────────┐      deployment_status event                 │
│  │  CI/CD Workflow     │ ─────────────────────────────────────────►  │
│  │  (existing)         │                                             │
│  └────────────────────┘                                             │
│                                                                      │
│  ┌────────────────────┐                                             │
│  │  Notify Step        │ ──── POST /api/deployments ──────────────► │
│  │  (new, ~5 lines)    │                                             │
│  └────────────────────┘                                             │
└──────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
              ┌─────────────────────────────────────────────────┐
              │            App Gateway (nginx)                  │
              │              ▲ ONLY PUBLIC SURFACE              │
              │  routes by path + method:                       │
              │   GET  /                  → Dashboard           │
              │   POST /api/deployments   → API (Write)         │
              │   GET  /api/*             → API (Read)          │
              │   GET  /api/stream  (SSE) → API (Read)          │
              │   GET  /health            → API (Read)          │
              └────┬───────────────────────────┬────────────────┘
                   │                           │
                   ▼                           ▼
        ┌──────────────────┐         ┌──────────────────────────┐
        │  Dashboard       │         │  API container (.NET 10) │
        │  Frontend        │         │  ─ Write API surface     │
        │  (nginx +        │         │    POST → INSERT+NOTIFY  │
        │   Angular static)│         │    API-key gated         │
        │   internal-only  │         │  ─ Read API surface      │
        │                  │         │    matrix/history/disc.  │
        │                  │         │    SSE / LISTEN          │
        │                  │         │    unauthenticated       │
        │                  │         │  internal-only           │
        └──────────────────┘         └──────────┬───────────────┘
                                                │
                                                ▼
                                     ┌───────────────────────┐
                                     │      PostgreSQL       │
                                     │  LISTEN/NOTIFY        │
                                     └───────────────────────┘

                        ▲                              ▲
        Browser + CI/CD │       one origin, no CORS    │
                        └──────────────┬───────────────┘
                                       ▼
                          (App Gateway, internal-only)
                                       │
                                       ▼
                          ┌────────────────────────────┐
                          │   Notification Client      │
                          │   (desktop tray, v2.0)     │
                          │                            │
                          │  Polls GET /api/deployments│
                          │  (via the gateway)         │
                          │  OS notification on change │
                          │  Click → open gateway URL  │
                          └────────────────────────────┘
```

#### C4 Component Diagram

The diagram below shows the *logical* components. The **Ingest API** and **Read API** are logical surfaces; at deployment time they are composed into a single API container (see §7 "Backend module architecture"). The diagram is unchanged by the consolidation — the component-level boundaries persist; only the host packaging differs.

```
╔══════════════════════════════════════════════════════════════════════════╗
║  Deployment Dashboard System                                             ║
║                                                                          ║
║  ┌─────────────────┐   deployment event   ┌──────────────────────────┐  ║
║  │                 │◄─────────────────────│   GitHub Actions         │  ║
║  │   Ingest API    │                      │   [External System]      │  ║
║  │                 │                      └──────────────────────────┘  ║
║  └────────┬────────┘                                                     ║
║           │                                                              ║
║     persists │                 broadcasts                                ║
║           ▼                         ▼                                   ║
║  ┌─────────────────┐     ┌──────────────────────┐                       ║
║  │                 │     │                      │                        ║
║  │  Deployment     │     │  Real-time Hub        │                       ║
║  │  Store          │     │                      │                        ║
║  │                 │     └──────────┬───────────┘                       ║
║  └────────▲────────┘               │ pushes events                      ║
║           │                        │                                     ║
║       queries │                    │                                     ║
║           │                        │                                     ║
║  ┌────────┴────────┐               │                                     ║
║  │                 │               │                                     ║
║  │  Read API       │               │                                     ║
║  │                 │               │                                     ║
║  └────────┬────────┘               │                                     ║
║           │                        │                                     ║
║    REST   │           live updates │                                     ║
║           └──────────┬─────────────┘                                     ║
║                      ▼                                                   ║
║           ┌──────────────────────┐       ┌──────────────────────────┐   ║
║           │  Dashboard Frontend  │       │  Notification Client      │   ║
║           │  (browser)           │       │  (desktop tray)           │   ║
║           └──────────────────────┘       └──────────┬───────────────┘   ║
║                                                     │ polls REST        ║
║                                                     └──► Read API       ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

### Components

#### Summary

| Component | Description | Technologies |
|---|---|---|
| **CI/CD Notify Step** | A step (or script) added to any existing CI/CD pipeline. Sends a deployment event to the ingest API via an HTTP POST. Works with any CI/CD tool that can run a shell command or script (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, CircleCI, etc.). | Shell / `curl` (any CI/CD tool); optional GitHub Actions composite action (`action.yml`) |
| **App Gateway** | Single public-facing reverse proxy that fronts every component. Routes by path and HTTP method: `GET /` → Dashboard Frontend; `POST /api/deployments` → API (Write surface); all other `GET /api/*` and `GET /api/stream` → API (Read surface). Both surfaces resolve to the same single `api` upstream — the path+method-based routing matrix is preserved so a future split back into separate `write-api` / `read-api` upstreams is gateway-config-only. Eliminates CORS (single origin), minimises the public surface (NFR-04), and is the only container exposed to host / public ingress. SSE pass-through tuned (`proxy_buffering off`, `proxy_read_timeout 1h`). | nginx (alpine) |
| **API container** | Single .NET 10 host that composes two logically-distinct API surfaces from separate library projects (see §"Backend module architecture"): **Write API surface** — accepts deployment events from CI/CD pipelines, validates payload, persists the event, notifies connected SSE clients via PostgreSQL `NOTIFY`; API-key-gated (FR-10). **Read API surface** — serves the current deployment matrix (latest per slot), per-slot history, environment/service discovery, SSE stream, and health; unauthenticated. Stateless on both surfaces — any number of instances can run in parallel; reads are satisfied from the store; events brokered via PostgreSQL `LISTEN`. **Internal-only — reachable only via the App Gateway.** | C#, ASP.NET Core Minimal API, EF Core 10, Npgsql |
| **Deployment Store** | Durable append-only store for all deployment events. Source of truth for the matrix query, history queries, and `lastSuccessful` / `previousFailed` derivation. | PostgreSQL (production and local dev); SQLite in-memory for unit tests only |
| **Real-time Hub** | Each API container instance `LISTEN`s on the PostgreSQL `deployments` channel (Read surface) and forwards events to its own connected SSE clients. No separate broker service is required. | PostgreSQL `LISTEN/NOTIFY`, ASP.NET Core SSE (`text/event-stream`) |
| **Dashboard Frontend** | Browser-based pipeline matrix view. Renders the services × environments grid, history drawer, version highlight, and live SSE updates. Built with `ng build` and served as static files from its own nginx container; **internal-only**, reached via the App Gateway. | Angular 20 (standalone components, zoneless change detection), NgRx Signal Store, Tailwind CSS, browser-native `EventSource`; nginx (alpine) runtime |
| **Notification Client** | Standalone desktop tray application. Polls the Read API (via the App Gateway) at a configurable interval, diffs against locally cached state, and fires OS notifications for changed slots. | .NET 10, WinForms (Windows) or MAUI (cross-platform); self-contained binary |

#### CI/CD Notify Step

A small step (or script) added to any existing deployment pipeline. Responsible for pushing deployment state into the dashboard. Works with any CI/CD tool that can make an HTTP POST — no CI/CD-specific SDK is required.

**Integration options (choose one per pipeline):**

| Option | How it works | Effort |
|---|---|---|
| Inline HTTP call | After the deploy step, run `curl` (or equivalent) to `POST /api/deployments` | Minimal — one step in any CI/CD tool |
| GitHub Actions composite action | `uses: org/deployment-dashboard/.github/actions/notify@main` | Zero per-workflow after initial setup (GitHub Actions only) |
| Webhook receiver | CI/CD tool fires a deployment-related webhook automatically; a lightweight receiver maps the payload to the dashboard schema | No pipeline changes needed if webhooks are already configured |

**Payload sent (minimum required shape):**

```json
{
  "service":     "service-a",
  "environment": "dev",
  "version":     "v2.3.1",
  "status":      "success",
  "run_url":     "https://ci.example.com/runs/12345",
  "run_number":  1247,
  "actor":       "john.doe"
}
```

Two optional source-identifier fields — `ref` and `sha` — MAY be included on the same payload (FR-05; full shape in §"API Contract" → "POST `/api/deployments` request body"). Backward compatible: omitting them leaves the matrix behaviour unchanged.

```json
{
  "service":     "service-a",
  "environment": "dev",
  "version":     "v2.3.1",
  "status":      "success",
  "run_url":     "https://ci.example.com/runs/12345",
  "run_number":  1247,
  "actor":       "john.doe",
  "ref":         "feature/login-revamp",
  "sha":         "9f1c0d2e8a"
}
```

#### Dashboard Backend

A stateless ASP.NET Core web service hosting both the **Write API** and **Read API** surfaces in a single OCI container. Any number of instances can run behind a load balancer — all mutable state lives in the database.

| Attribute | Value |
|---|---|
| Language | C# / .NET 10 |
| Framework | ASP.NET Core Minimal API |
| ORM | EF Core 10 + Npgsql |
| Storage | PostgreSQL (production and local dev); SQLite in-memory (unit tests only) |
| Scalability | Horizontal — stateless; multiple instances behind a load balancer; the unified container scales as a whole until traffic-shape evidence justifies a split (see §"Backend module architecture" → "Future split — trigger conditions") |
| Container | **Single Docker image** (~120 MB self-contained) hosting both surfaces; built from `backend/api/` |
| Port | 8080 — single listener serving both `POST /api/deployments` (Write) and all read endpoints |

**Statelessness constraints (required for horizontal scaling):**
- No in-memory cache of deployment state between requests — every read hits the database
- No in-process SSE fan-out across instances — SSE events are brokered via PostgreSQL `LISTEN`/`NOTIFY`; each instance subscribes to the channel independently and forwards events to its own connected clients
- No sticky sessions — the load balancer may route any request to any instance; SSE connections are long-lived but reconnect transparently via `Last-Event-ID`

**Responsibilities:**
- Accept and persist deployment events via `POST /api/deployments` (Write surface; API-key-gated)
- Serve the current deployment matrix (`GET /api/deployments`) and per-slot history (Read surface; unauthenticated)
- Derive per-service topology (DAG of env edges) from raw deployments on every matrix read (Read surface; §"Data Model" → "Topology Derivation"). SSE slot-update events carry slot state only — clients refresh topology via a follow-up `GET /api/deployments` with their own `correlationAttribute`.
- Expose the server-side topology correlation configuration via `GET /api/config/topology` (read-only to the SPA — used to display the system default in the picker) and accept runtime updates via `PATCH /api/config/topology` (admin / CI / ops tooling only; **not invoked by the SPA**; SPA per-user overrides travel as a `correlationAttribute` query parameter on read endpoints — see §"API Contract")
- Stream real-time slot-update events via SSE (`GET /api/stream` — Read surface); NOTIFY the PostgreSQL `deployments` channel on every successful ingest

**Out of scope for the backend:** serving static SPA assets. The Angular build is shipped in its own **Dashboard Frontend** container (nginx), not in the API container. The backend serves JSON only.

**Backend module architecture — single host, two library surfaces:**

The .NET solution under `backend/` is organised as a thin host project that composes two library projects — one per API surface — plus a shared library for cross-cutting concerns. This mirrors the modular-monolith pattern used on the frontend (single workspace, multiple libraries, one application project) and preserves the option to split the host back into two without a code rewrite.

```
backend/
├── api/          # Host project (ASP.NET Core executable) — Program.cs, single Dockerfile,
│                 # composition root. References write-api/ and read-api/ libraries and
│                 # maps each library's endpoint group + middleware onto the single host.
├── write-api/    # Library project — endpoint group for POST /api/deployments,
│                 # request DTOs, NOTIFY dispatch. API-key middleware is applied here
│                 # (scoped to the write surface only — see §"Security Considerations").
├── read-api/     # Library project — endpoint groups for matrix / history / discovery /
│                 # SSE / health / topology config. Unauthenticated. No write paths.
├── shared/       # Class library — EF Core DbContext, entities, migrations,
│                 # NOTIFY/LISTEN abstractions, ApiKeyMiddleware implementation, DTOs.
└── Dashboard.sln # References api/, write-api/, read-api/, shared/, plus unit tests.
```

| Rule | Enforcement |
|---|---|
| Only `api/` references the two surface libraries. `write-api/` and `read-api/` do not reference each other. | Solution-level `ProjectReference` graph; reviewed in PR. |
| Both surface libraries depend on `shared/`. `shared/` depends on neither. | Same. |
| Each surface library exposes a single `IEndpointRouteBuilder` extension (e.g. `MapWriteEndpoints`, `MapReadEndpoints`) — the host wires them up. | Public surface enforced by being the only `public` extension method on each library. |
| API-key middleware is applied **only** to the write endpoint group; the read group is unauthenticated. | `MapGroup("/api").RequireApiKey()` on the write group; no such call on the read group. |
| One Dockerfile, one image, one ACA container app. | `backend/api/Dockerfile` is the only API Dockerfile. |
| EF Core entities, `DbContext`, and migrations live in `shared/` — one migration set serves both surfaces. | Existing rule, unchanged. |

**Future split — trigger conditions:**

The host-composition design keeps the option open to split back into two separate container apps. Re-splitting becomes a host-project + gateway-config change only (no library code touched). Triggers that justify the split:

| Trigger | Why it justifies a split |
|---|---|
| Asymmetric resource needs | Sustained CPU/memory profile differs between surfaces (e.g. SSE fan-out under read load saturating the container before write traffic does). Splitting allows independent scaling. |
| Independent release cadence | One surface requires more frequent restarts / canary windows than the other and the coupling is paying a cost. |
| Tightened security boundary | An external requirement to run the write surface on a separately-credentialed network segment (e.g. only ingest from the CI/CD VNet; read endpoints in a different subnet). |
| Cost-cap pressure inverted | If ACA pricing changes and two small apps become cheaper than one larger one. (Today the opposite holds — see §6.) |

Re-split mechanics (no library code change):
1. Add `backend/write-api-host/Program.cs` (calls `MapWriteEndpoints`) and `backend/read-api-host/Program.cs` (calls `MapReadEndpoints`).
2. Two new Dockerfiles under each host directory.
3. Gateway `nginx.conf` re-introduces a second upstream (e.g. `write_api`) and the path+method routing matrix points the `POST /api/deployments` row to it.
4. Two ACA container apps in place of one; everything else is unchanged.

**Configuration — Read API topology (FR-13 / §"Topology Derivation"):**

Topology is a read-side concern (the Write API surface has no knowledge of correlation). The Read API surface holds the **server-side** configuration and reloads it on every read. Server-side config is mutated only by admin / CI / ops tooling via `PATCH /api/config/topology` (§"API Contract") — the SPA never invokes PATCH. End-user picker preferences live in browser `localStorage` and reach the server as a per-request `correlationAttribute` query parameter on read endpoints (no auth required; reads are unauthenticated). Default values are bootstrapped from the API host's `appsettings.json` on first run and persisted to a single config row in the database thereafter.

```yaml
# backend/api/appsettings.json (bootstrap defaults — Read surface)
Topology:
  CorrelationAttribute: "version"     # server-side global default; one of: version, ref, sha, actor, run, ago
  PerServiceOverrides: {}             # service -> attribute; ops-managed; empty by default; updated via PATCH
```

| Setting | Type | Default | Notes |
|---|---|---|---|
| `Topology.CorrelationAttribute` | string | `"version"` | Server-side global fallback used when the request carries no `correlationAttribute` query parameter and no per-service override applies. Allowed values: `version`, `ref`, `sha`, `actor`, `run`, `ago`. **`id` is explicitly disallowed** — `deployment_id` is the *explicit* key (the referent for `parent_deployments`); using it as a correlation attribute would degenerate to "explicit only" and is a contract violation. |
| `Topology.PerServiceOverrides` | dict<string, string> | `{}` | Service-name → correlation attribute. Ops-managed; overrides both the server default and any user-supplied `correlationAttribute` query parameter for that service only. Persisted in the database; updated at runtime via `PATCH /api/config/topology`. Setting a service's override to `null` via PATCH removes it. |

**Precedence (per request, per service):** `Topology.PerServiceOverrides[service]` > request `correlationAttribute` query parameter > `Topology.CorrelationAttribute` (server-side default).

Rationale: per-service overrides are an ops-managed contract (e.g. service-b is known to deploy by `sha`, not `version`) — they must not be silently broken by a user picker. The user picker is a *global* hint for services that have no ops override.

The setting is explicitly not surfaced to the Write API: ingest does not depend on the active correlation attribute.

#### App Gateway

A single nginx reverse-proxy container that fronts every other component. It is the **only** container exposed to the host (local dev) or to public ingress (Azure). The two back-end components — the API container (hosting both Write and Read surfaces) and the Dashboard Frontend — sit behind it on the internal Docker / ACA network.

| Attribute | Value |
|---|---|
| Image | `nginx:alpine` |
| Public port | `8080` (host) / `443` (Azure ingress) |
| Routing | Path + method-based; no upstream awareness in the SPA or in CI/CD callers |
| Statelessness | Pure proxy; no per-request state retained between calls |
| Container | Single small image (~30 MB) |
| Owner | `devops-engineer` (Dockerfile + `nginx.conf` live under `gateway/` at the repo root) |

**Routing matrix:**

Today both API surfaces resolve to a single `api` upstream (one container, both surfaces). The matrix continues to discriminate on path + method so that a future re-split into separate `write-api` / `read-api` upstreams (per §"Backend module architecture" → "Future split") is a gateway-config-only change — the row for `POST /api/deployments` simply points at the new write upstream while every other row stays the same.

| Method + Path | Upstream | Surface (logical) |
|---|---|---|
| `POST /api/deployments` | `api:8080/api/deployments` | Write — API-key gated by the host. |
| `GET /api/deployments` | `api:8080/api/deployments` | Read. |
| `GET /api/deployments/{service}/{environment}` | `api:8080/...` | Read. |
| `GET /api/deployments/{service}/{environment}/history` | `api:8080/...` | Read. |
| `GET /api/environments`, `GET /api/services` | `api:8080/...` | Read. |
| `GET /api/config/topology` | `api:8080/api/config/topology` (read-only mirror of server-side defaults; SPA-readable, no auth) | Read. |
| `PATCH /api/config/topology` | `api:8080/api/config/topology` (auth-gated by `X-Api-Key` at the host; **admin / CI / ops tooling only — not invoked by the SPA**; see §"API Contract") | Write (admin). |
| `GET /api/stream` | `api:8080/api/stream` — SSE pass-through (`proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 1h`, `X-Accel-Buffering: no`) | Read. |
| `GET /health` | `api:8080/health` | Read. |
| `GET /` and every other path | `dashboard:80/` (SPA shell + Angular bundle, with HTML5 history fallback to `index.html`) | n/a. |

**Why a gateway (vs. CORS + multiple origins):**
- Eliminates CORS entirely — the browser only ever sees one origin.
- Minimises the public surface — only one container in NFR-04's internal-only network has ingress.
- One ACA app gets public ingress in Azure; the others stay internal — matches the cost table without forcing each to expose itself publicly.
- The SPA and CI/CD callers are upstream-agnostic — they hit one URL.
- Decouples internal topology from external clients — collapsing two API containers into one (or re-splitting later) is invisible to every CI/CD caller and to the SPA.

#### Dashboard Frontend (MVP)

An Angular 20 single-page application packaged in its own nginx container. The container does NOT terminate public traffic — it is reached only via the App Gateway, and serves the static SPA assets it was built with.

| Attribute | Value |
|---|---|
| Framework | Angular 20 — standalone components, zoneless change detection |
| State | NgRx Signal Store — deployment matrix store + events |
| Styling | Tailwind CSS |
| Real-time | Browser-native `EventSource` — SSE connection to `GET /api/stream` (resolved via the App Gateway) |
| Build | `ng build dashboard` — output (`dist/dashboard/browser/`) copied into the nginx image |
| Runtime | `nginx:alpine` — serves static files + HTML5 history fallback to `index.html`; no proxying (the App Gateway handles all proxying upstream) |
| Container port | `80` (internal only) |
| Interaction | Click box → history drawer; hover version → cross-environment highlight; view switcher + per-view attribute picker (FR-12); layout switcher (FR-13: Matrix / Swim-lane / Workflow-rows); correlation-attribute picker (per-user override; written to `localStorage` only; appended as `correlationAttribute` query parameter on read endpoints); view, attribute, layout, and correlation-attribute selection persisted in `localStorage` |

**Visual layout:**

The canonical visual + interactive contract lives in `docs/deployment-dashboard.html`. The decision record for the four-views design — defaults, caps, switcher behaviour, persistence rules — lives in `docs/ui-compact-options.md`. This section describes only the contract that other tiers must honour.

**Layout views (FR-12):**

The dashboard renders four named views. The user switches between them via a segmented control in the header; the active view is persisted in `localStorage` (`dashboard.view`). The default for first-time visitors is **Detailed**.

| View | Intent | Default attributes shown | Max attributes | Notes |
|---|---|---|---|---|
| **Detailed** | Default first-visit view; full information density | `status`, `version`, `run`, `ago`, `actor` | 7 | The original canonical pipeline-matrix layout (services × environments, full-size slot boxes). Cap accommodates all seven FR-02 attributes (`status`, `version`, `run`, `ago`, `actor`, `ref`, `sha`); defaults are the canonical first-paint five. |
| **Compact** | Dense matrix targeting ~15 services per viewport | `status`, `version`, `run`, `ago` | 5 | Same layout shape as Detailed — services × environments — every dimension shrunk; status colour and split section preserved. Cap raised by one to allow one of `actor` / `ref` / `sha` alongside the default four without forcing a deselection. |
| **Glance** | Maximum-density list, ~25+ services per viewport | `version` (in coloured pill) | 1 | One row per service; environments rendered as coloured pills inline (not columns); click pill → drawer. Cap is 1 by design — the pill body has room for exactly one attribute; users may swap `version` for any of `status`, `run`, `ago`, `actor`, `ref`, `sha`. |
| **Focus** | Compact rows by default; click chevron to expand a row to full Detailed-size fidelity | `status`, `version`, `run`, `ago` (collapsed) | 5 (collapsed); expanded rows always show all 7 (see "Full-attribute disclosure rule") | A row pin keeps an expanded row open across filter changes. |

**Attribute vocabulary:**

The matrix attribute picker exposes the seven FR-02 attributes. Each one is bound to a specific source field on the matrix-slot wire shape (see §"API Contract" → "Matrix response shape — per service"):

| Key | Picker label | Source field | Notes |
|---|---|---|---|
| `status` | Status badge | `current.status` | Renders the success / failed / running text badge in the slot body. Distinct from the always-on status colour treatment of the slot background. |
| `version` | Version | `current.version` | Semver string. |
| `run` | Run number | `current.run_number` (linked via `current.run_url`) | Renders the run number; the `run_url` link is bound to the same attribute (no separate picker entry). |
| `ago` | Elapsed time | `current.deployed_at` (rendered relative) | Relative time, e.g. `3m ago`. |
| `actor` | Actor | `current.actor` | Who triggered the deploy. |
| `ref` | Source ref | `current.ref` | Free-form source identifier — branch name, PR number, tag, or any human-readable git ref. Nullable on the wire (FR-05); when null/absent the picker slot renders empty per the null-render invariant below. No length cap or format constraint (§10 Decision 10 — stricter validation deferred). |
| `sha` | Commit SHA | `current.sha` | Free-form commit SHA. Nullable on the wire (FR-05); when null/absent the picker slot renders empty per the null-render invariant below. The SPA MAY truncate the rendered value for display (e.g. first 7 chars) without altering the underlying stored value; the full value remains in the history drawer (full-attribute disclosure rule). |

The absolute `current.deployed_at` timestamp is rendered only in the history drawer; it is not a matrix-picker option.

**Null-render invariant for nullable attributes:**

`ref` and `sha` are the two FR-02 attributes that may legitimately be `null` or absent on a wire payload (per §"deployments table" and §"Matrix response shape — per service" → field rules). When the user selects one of these as a Display attribute and the slot's `current.<attr>` (or `lastSuccessful.<attr>`) value is null or absent:

- The attribute slot in the box body renders empty — no text, no placeholder, no the literal string `"null"` / `"undefined"`.
- The slot's other selected attributes render normally.
- The 6-box-state determination is unaffected — `ref`/`sha` are display-only and do not feed state derivation (§7 "6 box states", §7 line referenced for matrix-state derivation).
- The Topology correlation pass (§"Topology Derivation" pass 3) already excludes deployments whose chosen correlation attribute is null on either side (`P.<correlation-attribute>` equals `D.<correlation-attribute>` is `false` when either operand is null) — no additional handling needed.

This invariant generalises the existing "empty array (`[]`) is a legitimate user choice — render the slot body empty" rule (§7 "Load-time hardening rules") from per-view to per-attribute.

**Always-on elements (not affected by the picker):**

These elements are part of the 6-box-state contract (FR-03) or of the matrix visual treatment, and render in every view regardless of the user's attribute-picker state:

- **Slot background status colour treatment** — green / red / orange — including the in-progress pulse animation.
- **`⚠ prev. failed` badge** — rendered when `previousFailed === true` (FR-03).
- **Last-successful split section** — dashed divider plus the last-successful version and elapsed time — rendered when `lastSuccessful` is non-null (FR-03). The attribute picker controls the top (current) section only; the bottom section is always shown when present.

**6 box states (unchanged contract):**

Each box still resolves to one of six states based on the slot's wire shape. Per-view rendering may shrink or recolour the box, but the state determination logic is identical across views.

| State | Condition | Box appearance |
|---|---|---|
| **Success** | Last deployment succeeded | Full green box — version + actor + time |
| **Running + Last Successful** | Deploying now; previous terminal was success | Top: orange spinner + version; bottom: last successful version |
| **Running + Failed + Last Successful** | Deploying now; previous terminal was failure; an older success exists | Top: orange spinner + ⚠ prev. failed badge; bottom: last successful version |
| **Failed + Last Successful** | Last deployment failed; an older success exists | Top: red failed + version; bottom: last successful version |
| **Running** | Deploying now; no prior successful deployment | Full orange spinning box — version only |
| **Running + Failed** | Deploying now; previous terminal was failure; no successful history | Top: orange spinner + ⚠ prev. failed badge; no bottom section |

The box is split into two sections by a dashed divider when a last-successful state differs from the current state. This makes it immediately visible what is running *now* versus what last worked.

Boxes share a version highlight on hover — hovering a version amber-highlights all boxes (and Glance pills) across environments where the same version is deployed, making it easy to trace promotion progress. Hover highlight applies in every view.

**Full-attribute disclosure rule:**

The side-panel history drawer and the Focus view's expanded rows always display every deployment attribute available to the user, regardless of the matrix attribute picker. The picker constrains what is rendered on the matrix grid only; the drawer and the Focus-expanded row are full-fidelity detail surfaces. Frontend and QA cite this rule when verifying that hidden picker attributes still surface in the drawer or in an expanded Focus row.

**Client-side persistence (`localStorage`):**

View selection and per-view attribute selection are pure client-side UI state — no backend wire impact, no server round-trip on toggle.

| Key | Value shape | Example | Cap |
|---|---|---|---|
| `dashboard.view` | one of `'detailed'`, `'compact'`, `'glance'`, `'focus'` (string) | `"compact"` | n/a |
| `dashboard.attrs.detailed` | JSON array of attribute keys (`string[]`) | `["status","version","run","ago","actor","ref","sha"]` | ≤ 7 |
| `dashboard.attrs.compact` | JSON array (`string[]`) | `["status","version","run","ago","sha"]` | ≤ 5 |
| `dashboard.attrs.glance` | JSON array (`string[]`) | `["ref"]` | ≤ 1 |
| `dashboard.attrs.focus` | JSON array (`string[]`) | `["status","version","run","ago","ref"]` | ≤ 5 |
| `dashboard.layout` | one of `'matrix'`, `'swim-lane'`, `'workflow-rows'` (string) | `"matrix"` | n/a |
| `dashboard.correlationAttribute` | one of `'version'`, `'ref'`, `'sha'`, `'actor'`, `'run'`, `'ago'`, or absent (string \| missing) | `"sha"` | n/a |

Load-time hardening rules:
- Wrap every `JSON.parse` in `try / catch`. Any throw → fall back to the view's default attribute set.
- If the parsed value is not an array → fall back to defaults.
- Filter the array to known attribute keys only (`status`, `version`, `run`, `ago`, `actor`, `ref`, `sha`); unknown keys are silently dropped.
- If the filtered array exceeds the view's cap → truncate to the cap.
- An empty array (`[]`) is a legitimate user choice — render the slot body empty, leaving only the always-on elements. Do not auto-restore defaults in this case.
- For `dashboard.layout` and `dashboard.view`: if the persisted string is not in the allowed set, fall back to the default (`matrix` and `detailed` respectively). No throw — `localStorage.getItem` returns a string or `null`.
- For `dashboard.correlationAttribute`: if the persisted string is not in the allowed set, treat as absent — the SPA then omits the `correlationAttribute` query parameter, falling back to the server-side default. Absence is the canonical "follow the system default" state and is not an error.

Filters (search by service name, failures-only toggle) and the stats bar are cross-cutting and apply identically across all four views and all three layouts.

**Layout axis (FR-13):**

Orthogonal to the four views above, the SPA offers three **layouts**. The user switches between them via a second segmented control in the header (independent of the view switcher); the active layout is persisted in `localStorage` (`dashboard.layout`). All 4 × 3 = 12 (view, layout) combinations are supported.

| Layout | Intent | Topology data required | Render shape |
|---|---|---|---|
| **Matrix** | Default first paint — canonical pipeline-matrix layout. Equivalent to the pre-FR-13 contract. | No — environments are columns; each service is a row. | Services × environments grid. |
| **Swim-lane** | One horizontal lane per service; envs laid out left-to-right along the per-service env DAG (parents to the left of children). | Yes — uses `topology.edges` from the matrix response (§"API Contract"). When a service has no edges, it renders as a single root chain (one node per env, ordered by `deployed_at` of `current`). | Per-service horizontal lane; connectors anchored to `getBoundingClientRect()` per NFR-09. |
| **Workflow-rows** | One DAG drawn per service with envs as rows; promotes the topology to a first-class visual element. | Yes — same `topology.edges` source. Empty-topology services render as a single root chain (same fallback as Swim-lane). | Per-service vertical DAG; rows are envs, columns are DAG levels. |

Default for first-time visitors: **Matrix** (preserves the canonical first-paint contract).

Layout is **orthogonal** to view (FR-12): the chosen view's attribute picker, density, and 6-box-state rendering remain identical across layouts. Only the spatial arrangement of envs within a service changes.

**Glance exception under FR-13:**

The Glance view's "env-tag-inside-pill" rendering (NFR-09 Glance exception) applies in all three layouts. In Matrix layout the pills are inline along the row. In Swim-lane and Workflow-rows, the same pill rendering is used at each node in the DAG, with the env label inside the coloured pill rather than to its left. The mockup (`docs/deployment-dashboard.html`) is the visual contract for this; the responsiveness invariant in NFR-09 is the geometric guarantee.

**Module architecture — modular monolith Angular workspace:**

The frontend is organised as a single Angular workspace containing one application project (the shell) and a small number of library projects (`type: library`). All projects build together via `ng build` and the output is bundled into the Read API Docker image as static assets. This pattern is chosen over a flat monolith — to enforce explicit boundaries between feature areas and a reusable shared layer — and over a micro-frontend approach — which would add a routing/state-sync problem the single-page dashboard does not have, while breaking NFR-08 (no build step in the browser).

```
frontend/
├── dashboard/    # Angular application project (apps/dashboard) — root component, routes,
│                 # SSE bootstrap, Tailwind entry, top-level layout
├── matrix/       # Feature library — pipeline matrix component, environment boxes,
│                 # 6-state rendering, version hover highlight, filters, stats bar
├── drawer/       # Feature library — history drawer component, current/last-successful
│                 # panel, history list, lazy fetch of per-slot history
├── shared/       # Cross-feature library — NgRx Signal Store, API client, SSE service,
│                 # DTO/model interfaces, Tailwind tokens, shared pipes/directives
└── angular.json  # Workspace configuration; one ng build produces a single SPA bundle
```

| Rule | Enforcement |
|---|---|
| Feature libraries (`matrix/`, `drawer/`) may depend only on `shared/` — never on each other or on `dashboard/` | `@angular-eslint/no-restricted-imports` rule + TypeScript path mappings in `tsconfig.base.json` |
| `shared/` may not depend on any feature library or on `dashboard/` | Same lint rule |
| The application project (`dashboard/`) is the only project allowed to import from feature libraries | Same lint rule |
| Each library exposes its public surface via a barrel `public-api.ts`; deep imports across libraries are forbidden | Angular CLI ng-package convention |
| All projects share a single Tailwind config and PostCSS pipeline at the workspace root | `tailwind.config.js` at `frontend/`; libraries do not declare their own |
| All projects are built together — no separate publish step; `ng build dashboard` produces one bundle | Single Angular workspace |

Feature additions land as a new library under `frontend/` (e.g. a future `settings/` lib) rather than as another folder inside `dashboard/`. Cross-cutting concerns land in `shared/`. Anything that imports browser globals or `EventSource` lives in `shared/` as a service so feature libraries can be unit-tested without a DOM.

**Mockup ↔ Angular SPA bridge:**

The canonical mockup (`docs/deployment-dashboard.html`) and the Angular SPA must render the same visual contract. The mockup is the design source of truth; the SPA implements it. The `testing/mockup-visual/` harness validates the mockup against the six geometric invariants enumerated in NFR-09; an equivalent Playwright suite under `testing/e2e/` validates the SPA against the same six invariants. Drift between the mockup and the SPA is a defect. Engineers triage the discrepancy per the conflict-resolution table in `CLAUDE.md` (visual/interactive → mockup wins; data/API → SAD wins) before any code change lands.

#### Notification Client (v2.0)

A standalone system tray application installed on developer machines.

**Behaviour:**
1. Polls `GET /api/deployments` every 30 seconds
2. Compares response against locally cached state (extracts per-slot entries from each service's `envs` map; ignores the `topology` block — the v2.0 client is slot-oriented, not topology-aware)
3. For each changed slot: fires an OS notification
   - Title: `Deployed: {service} → {environment}`
   - Body: `{version} · {status} · {actor}`
4. Clicking the notification opens the dashboard URL in the default browser

**Implementation:**

Built as a .NET 10 self-contained binary, consistent with the stack constraint.

| Target | Framework | Binary size | Notes |
|---|---|---|---|
| Windows | .NET 10 WinForms (`NotifyIcon` + toast) | ~5 MB | Simplest — Windows-only |
| Cross-platform | .NET MAUI or Avalonia | ~15–25 MB | Win + macOS + Linux from single codebase |

**Configuration** (stored in a local config file or env vars):

```json
{
  "dashboard_url": "http://internal.company.com:8080",
  "poll_interval_seconds": 30,
  "notify_on": ["success", "failure"],
  "filter_environments": ["uat", "prod"]
}
```

The `filter_environments` list is optional. When omitted or set to `[]`, the client fetches the distinct environment list from `GET /api/environments` and notifies on all of them. This means no configuration is required on first run — the client self-discovers the environment list from whatever data exists in the dashboard.

---

### CI/CD Integration

The ingest API (`POST /api/deployments`) is the sole integration point. Any CI/CD tool that can make an HTTP POST request can send deployment events — no CI/CD-specific SDK, plugin, or webhook infrastructure is required. The dashboard has no dependency on any particular build system and does not query any CI/CD tool.

All field names in the payload are generic: `run_url`, `run_number`, and `actor` map naturally to equivalent concepts in any CI/CD platform.

---

#### GitHub Actions (example)

**Inline step (any workflow):**

```yaml
- name: Notify Deployment Dashboard
  run: |
    curl -sf -X POST "${{ secrets.DEPLOYMENT_DASHBOARD_URL }}/api/deployments" \
      -H "Content-Type: application/json" \
      -H "X-Api-Key: ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}" \
      -d '{
        "deployment_id":      "gh-${{ github.run_id }}",
        "parent_deployments": [],
        "service":            "service-a",
        "environment":        "dev",
        "version":            "${{ github.sha }}",
        "status":             "success",
        "run_url":            "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
        "run_number":         ${{ github.run_number }},
        "actor":              "${{ github.actor }}"
      }'
```

`deployment_id` should be a stable CI/CD-side identifier (here `gh-${run_id}` — the GitHub Actions run id, prefixed to namespace across tools). `parent_deployments` lists the `deployment_id` values of upstream deployments (e.g. the dev deploy that produced the artefact being promoted to qa); pass `[]` to defer topology to the correlation fallback (§"Topology Derivation").

**Reusable composite action (define once, reference in every workflow):**

```yaml
uses: org/deployment-dashboard/.github/actions/notify@main
with:
  dashboard_url:       ${{ secrets.DEPLOYMENT_DASHBOARD_URL }}
  api_token:           ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}
  deployment_id:       gh-${{ github.run_id }}
  parent_deployments:  ""                       # optional; space- or comma-separated list of upstream deployment_ids
  service:             service-a
  environment:         dev
  version:             ${{ github.sha }}
  status:              success
```

**`deployment_status` webhook (no workflow changes):** GitHub fires a `deployment_status` event automatically when a deployment status is created. A lightweight webhook receiver endpoint maps the GitHub payload to the dashboard schema and calls `POST /api/deployments`.

**Secrets required:**

| Secret | Value |
|---|---|
| `DEPLOYMENT_DASHBOARD_URL` | Base URL of the dashboard (e.g. `https://dashboard.internal.company.com`) |
| `DEPLOYMENT_DASHBOARD_TOKEN` | API key for write access |

---

#### Azure DevOps (example)

Add a script task at the end of a deployment stage:

```yaml
- task: PowerShell@2
  displayName: Notify Deployment Dashboard
  inputs:
    targetType: inline
    script: |
      $body = @{
        deployment_id      = "ado-$(Build.BuildId)"
        parent_deployments = @()                # optional; deployment_ids of upstream stages
        service            = "service-a"
        environment        = "dev"
        version            = "$(Build.BuildNumber)"
        status             = "success"
        run_url            = "$(System.CollectionUri)$(System.TeamProject)/_build/results?buildId=$(Build.BuildId)"
        run_number         = [int]"$(Build.BuildId)"
        actor              = "$(Build.RequestedFor)"
      } | ConvertTo-Json
      Invoke-RestMethod -Uri "$(DEPLOYMENT_DASHBOARD_URL)/api/deployments" `
        -Method POST -ContentType "application/json" `
        -Headers @{ "X-Api-Key" = "$(DEPLOYMENT_DASHBOARD_TOKEN)" } `
        -Body $body
```

---

#### Other tools (Jenkins, GitLab CI, CircleCI, etc.)

Any tool that supports running a shell command or script integrates in the same way — send an HTTP POST to `/api/deployments` with the required JSON body and the `X-Api-Key` header. Example for a generic shell step:

```sh
curl -sf -X POST "$DEPLOYMENT_DASHBOARD_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $DEPLOYMENT_DASHBOARD_TOKEN" \
  -d "{
    \"deployment_id\":      \"$TOOL_PREFIX-$BUILD_ID\",
    \"parent_deployments\": [],
    \"service\":             \"$SERVICE_NAME\",
    \"environment\":         \"$ENVIRONMENT\",
    \"version\":             \"$VERSION\",
    \"status\":              \"success\",
    \"run_url\":             \"$BUILD_URL\",
    \"run_number\":          $BUILD_NUMBER,
    \"actor\":               \"$BUILD_USER\"
  }"
```

Map the tool's built-in variables to the payload fields — every CI/CD platform exposes equivalent values. `deployment_id` must be unique per `(service, deployment_id)` — namespace by tool prefix (e.g. `gh-`, `ado-`, `jenkins-`) to avoid collisions across CI/CD platforms.

---

### Data Model

#### `deployments` table

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment surrogate key (internal). |
| `deployment_id` | TEXT | **CI/CD-side identifier** for this deployment event (e.g. run id, build number, guid). Required. Unique within `service`. Used as the referent for `parent_deployments`. Distinct from the internal `id` surrogate. |
| `service` | TEXT | Service identifier (`service-a`, `service-b`, …) |
| `environment` | TEXT | Environment identifier (`dev`, `qa`, `uat`, `prod`, …) |
| `version` | TEXT | Semantic version or any string |
| `status` | TEXT | `in-progress` / `success` / `failure` |
| `run_url` | TEXT | Link to the GitHub Actions run |
| `run_number` | INTEGER | GitHub Actions run number |
| `actor` | TEXT | GitHub username that triggered the run |
| `ref` | TEXT NULL | **Optional source identifier.** Free-form string — branch name, PR number, tag, or any human-readable git ref. Nullable; omit (or send `null`) when absent. No length or format constraint at this stage — stricter validation is a deferred follow-up (see §10 "Decisions"). |
| `sha` | TEXT NULL | **Optional commit SHA.** Free-form string — the commit hash associated with this deployment. Nullable; omit (or send `null`) when absent. No length or format constraint at this stage (not required to be hex, not bounded to 7/40 chars) — stricter validation is a deferred follow-up (see §10 "Decisions"). |
| `deployed_at` | DATETIME | UTC timestamp of the event |
| `parent_deployments` | TEXT[] (PostgreSQL) / JSON-encoded array (SQLite) | **Explicit topology references.** Zero or more `deployment_id` values of parent deployments. Nullable; an empty array (or NULL) means "no explicit parents — fall back to correlation". Each element must reference an existing or future deployment within the same `service`. |

**Retention:** old rows are pruned by a background job. The retention window is configurable via the `HISTORY_RETENTION_DAYS` environment variable (default: `365`). The pruning job runs once per day and deletes rows where `deployed_at < NOW() - HISTORY_RETENTION_DAYS days`.

**Current matrix behaviour:** the matrix always shows the **most recent deployment per slot regardless of status** — a failed deployment replaces the previous entry in the matrix view. This matches the mockup behaviour and gives an accurate picture of what was last attempted, with the status badge (success / failed / running) communicating the outcome.

**Indexes:**

| Index | Purpose |
|---|---|
| `(service, environment, deployed_at DESC)` | Matrix query — latest per slot. |
| `UNIQUE (service, deployment_id)` | Enforces `deployment_id` uniqueness within a service; required so `parent_deployments` references resolve unambiguously. |
| `(service, deployment_id)` | Lookup hot path for the topology builder when resolving explicit parents. |

**Topology constraints (enforced at ingest by the Write API; see §"API Contract" → "POST /api/deployments validation"):**

- `deployment_id` is required and non-empty.
- `(service, deployment_id)` must be unique — duplicate POSTs are rejected with `409 Conflict`.
- Every entry in `parent_deployments` must be a non-empty string referencing a `deployment_id` *within the same `service`*. References to a different service are rejected with `400 Bad Request`.
- A reference to a `deployment_id` that has not yet been ingested is **accepted** and stored verbatim. The topology builder treats it as "dangling" until the missing source lands; reconciliation is automatic on the next read.
- Cycle prevention: a POST whose `parent_deployments` would, combined with already-ingested references, form a directed cycle is rejected with `400 Bad Request`. Dangling references are excluded from the cycle check (cannot prove a cycle through an unresolved node).

**Matrix query — PostgreSQL** (latest per slot):

```sql
SELECT DISTINCT ON (service, environment) *
FROM   deployments
ORDER  BY service, environment, deployed_at DESC;
```

**Matrix query — SQLite** (equivalent, `DISTINCT ON` not supported):

```sql
SELECT d.*
FROM   deployments d
INNER JOIN (
    SELECT service, environment, MAX(deployed_at) AS latest
    FROM   deployments
    GROUP  BY service, environment
) m ON d.service = m.service
    AND d.environment = m.environment
    AND d.deployed_at = m.latest;
```

---

#### Topology Derivation

The per-service env DAG surfaced to the SPA (FR-13 Swim-lane / Workflow-rows; matrix response `topology.edges`) is derived **on the read side**. The Write API persists the raw deployment rows including `parent_deployments`; the Read API computes the topology on every matrix read and on every NOTIFY-triggered slot recompute. No topology rows are stored.

**Inputs**

| Input | Source |
|---|---|
| All deployments for `service` | `deployments` table. |
| Correlation attribute (active for this service, per request) | Resolved in this precedence order: (1) `Topology.PerServiceOverrides[service]` if present (ops-managed, server-side); (2) the request's `correlationAttribute` query parameter if supplied and valid; (3) `Topology.CorrelationAttribute` (server-side default, default `version`). See §"Configuration" → "Read API — topology" and §"API Contract" → "GET /api/matrix — query parameters". |
| User override (if any) | Sent as a `correlationAttribute` query parameter on read endpoints — a per-request hint only. Stored client-side in `localStorage`; never persisted server-side. The SPA does not invoke `PATCH /api/config/topology`. |

**Algorithm — five passes**

1. **Bucket by env.** Group all deployments for `service` by `environment`, ordered within each bucket by `deployed_at DESC`. (The DAG is per-service, not global; an env may appear in the DAG even if it has only one deployment.)
2. **Explicit-first pass.** For each deployment `D` with non-empty `parent_deployments`, resolve each id to its source deployment `P` (same `service`, looked up by `deployment_id`). For each successful resolution, emit one directed edge `P.environment → D.environment` with `source: "explicit"`. Skip self-edges (`P.environment === D.environment`). Skip duplicate `(from, to)` pairs within the explicit pass.
3. **Correlation fallback pass.** For each deployment `D` *without* `parent_deployments` (NULL or empty array), find candidate parent deployments `P` such that:
   - `P.service === D.service`
   - `P.environment !== D.environment`
   - `P.<correlation-attribute>` equals `D.<correlation-attribute>` (case-sensitive string equality of the source field; e.g. `version`, `ref`, `sha`, `run_number` stringified)
   - `P.deployed_at < D.deployed_at`
   - The "closest in time" candidate per parent env wins — for each candidate env, keep only the `P` with the greatest `deployed_at` strictly less than `D.deployed_at`.
   Emit one edge `P.environment → D.environment` per parent env match with `source: "correlated"`.
4. **Merge.** Union the explicit edges and the correlated edges keyed by `(from, to)`. When both produce the same `(from, to)` pair, `source: "explicit"` wins (so the SPA can render explicit edges distinctly from correlated ones).
5. **Dangling references.** If `parent_deployments[i]` references a `deployment_id` not yet ingested, the reference is held verbatim on the row (already accepted at ingest per §"deployments table" → "Topology constraints"). It contributes no edge in the explicit pass for this read. The next read after the missing source lands automatically picks it up — no reconciliation job, no NOTIFY-replay needed.

**Cycle handling at read time**

The DAG should already be acyclic (write-time check), but the read-side builder runs a defensive topological sort and drops any edge that would close a cycle, logging a `WARN` with the offending `(from, to)` pair. Defence-in-depth: a race between two writes — both passing their independent cycle checks — could theoretically commit a cycle, and the SPA must not loop forever.

**Output**

A `topology` object per service, shaped per §"API Contract" → "Matrix response shape per service":

```json
{
  "edges": [
    { "from": "dev",  "to": "qa-1", "source": "explicit" },
    { "from": "qa-1", "to": "uat",  "source": "correlated" }
  ]
}
```

---

### API Contract

The API follows REST principles: resource-oriented URIs, standard HTTP methods, stateless interactions, and meaningful HTTP status codes. No server-side session state is held between requests.

| Method | Path | Success | Description |
|---|---|---|---|
| `POST` | `/api/deployments` | `201 Created` | **Write — CI/CD only.** Auth-gated by `X-Api-Key`. Record a new deployment event; body returns the created resource. Body must include the new `deployment_id` field and may include `parent_deployments` (see "POST /api/deployments validation" below). Not invoked by the SPA. |
| `GET` | `/api/deployments` | `200 OK` | Return current matrix (latest entry per service+environment), with per-service `topology.edges` (see "Matrix response shape"). Optional `?correlationAttribute=<attr>` query parameter — per-request override of the correlation fallback attribute (see "GET /api/deployments — query parameters" below). No auth. |
| `GET` | `/api/deployments/{service}/{environment}` | `200 / 404` | Return the current state for one slot. No auth. |
| `GET` | `/api/deployments/{service}/{environment}/history` | `200 / 404` | Return last N events for a slot (`?limit=50` default). No auth. |
| `GET` | `/api/environments` | `200 OK` | Return distinct environment list derived from stored data. No auth. |
| `GET` | `/api/services` | `200 OK` | Return distinct service list derived from stored data. No auth. |
| `GET` | `/api/stream` | `200 text/event-stream` | SSE stream; supports `Last-Event-ID` for reconnection. Emits **slot-update events only** — topology is not carried on the wire (clients refresh topology via `GET /api/deployments` with their own `correlationAttribute` after each event). See "SSE slot-update data payload" below. No auth. |
| `GET` | `/api/config/topology` | `200 OK` | **SPA-readable.** Return the server-side topology configuration — global `correlationAttribute` plus the `perServiceOverrides` map. Used by the SPA to display the system default in the picker so users can distinguish "system default" from their personal override. No auth. |
| `PATCH` | `/api/config/topology` | `200 / 400 / 401` | **Admin / CI / ops tooling only — not invoked by the SPA.** Update the server-side topology correlation attribute. Auth-gated by the same `X-Api-Key` middleware as `POST /api/deployments`. The SPA expresses per-user picker preferences via the `correlationAttribute` query parameter on read endpoints, not by writing to this endpoint. See "PATCH /api/config/topology" below. |
| `GET` | `/health` | `200 OK` | Liveness probe (`{"status": "ok"}`). No auth. |
| `GET` | `/` | `200 OK` | Serve dashboard HTML. No auth. |

**REST constraints observed:**
- **Stateless** — every request contains all information needed to process it; no session cookies, no server-side state
- **Uniform interface** — `POST` to create, `GET` to read, `PATCH` to update topology config; no RPC-style verbs in URIs
- **Resource-oriented URIs** — `/api/deployments/{service}/{environment}` identifies a specific deployment slot as a resource
- **Append-only writes with a deduplication key** — `POST /api/deployments` is an append-only insert keyed on `(service, deployment_id)`. The CI/CD-side caller owns `deployment_id`; retrying with the *same* `deployment_id` is rejected with `409 Conflict` and does not produce a duplicate row. Retrying with a *new* `deployment_id` is a new event and creates a new history entry.
- **Meaningful status codes** — `201` on create, `400` on invalid topology references (missing `deployment_id`, cross-service parent, cycle), `401` on missing/invalid API key, `404` when a slot has no history, `409` on duplicate `(service, deployment_id)`, `422` on otherwise invalid payload

**POST `/api/deployments` request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `deployment_id` | string | **yes (new)** | CI/CD-side identifier (run id, build number, guid). Non-empty. Unique within `service`. |
| `parent_deployments` | string[] | no (new) | Zero or more `deployment_id` values of parent deployments in the same `service`. Omit or send `[]` to fall back to the correlation-based topology derivation (§"Topology Derivation"). Each entry must reference an existing or future deployment in the same service. |
| `service` | string | yes | Service identifier (matches the `service` column). |
| `environment` | string | yes | Environment identifier. |
| `version` | string | yes | Semantic version or any string. |
| `status` | string | yes | One of `in-progress`, `success`, `failure`. |
| `run_url` | string | yes | Link to the CI/CD run. |
| `run_number` | integer | yes | CI/CD run number. |
| `actor` | string | yes | Username that triggered the deploy. |
| `ref` | string \| null | no | **Optional.** Branch name, PR number, tag, or any human-readable git ref. Free-form string. Omit the property, send `null`, or send a string; absence and `null` are equivalent. No length or format validation at this stage (see §10 "Decisions"). |
| `sha` | string \| null | no | **Optional.** Commit SHA associated with this deployment. Free-form string. Omit the property, send `null`, or send a string; absence and `null` are equivalent. No length or format validation at this stage (see §10 "Decisions"). |

Backward compatibility: payloads that omit both `ref` and `sha` (the original seven-field shape) MUST continue to be accepted. Existing stored rows without these fields remain valid; the server treats missing values as `null`.

**POST `/api/deployments` validation — failure modes:**

| Condition | Status |
|---|---|
| Missing or empty `deployment_id` | `422 Unprocessable Entity` |
| Duplicate `(service, deployment_id)` — an event with this id already exists | `409 Conflict` |
| `parent_deployments[i]` references a `deployment_id` that exists but belongs to a different `service` | `400 Bad Request` |
| `parent_deployments[i]` references a `deployment_id` that, together with already-stored references, would form a directed cycle through resolved nodes | `400 Bad Request` |
| `parent_deployments[i]` references a `deployment_id` that does not yet exist | **accepted** (`201 Created`); the reference is recorded as dangling and resolved on the next read after the missing source lands |
| Missing/invalid `X-Api-Key` | `401 Unauthorized` |
| Any other Data Annotations failure | `422 Unprocessable Entity` |

Cycle prevention: dangling references are excluded from the write-time cycle check (cannot prove a cycle through an unresolved node). The read-side builder runs a defensive topological sort and drops any edge that would close a cycle (see §"Topology Derivation" → "Cycle handling at read time") — this catches the race-condition cycle case.

**PATCH `/api/config/topology` request body:**

Either or both of the following fields may be set in a single request. Unset fields are left unchanged.

```json
{
  "correlationAttribute": "ref",
  "perServiceOverrides": {
    "service-x": "sha",
    "service-y": null
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `correlationAttribute` | string | One of `version`, `ref`, `sha`, `actor`, `run`, `ago`. Replaces the global default. Rejected with `400` if not in this set or if `id` is supplied (the explicit key is not a correlation attribute). |
| `perServiceOverrides` | dict<string, string \| null> | Dictionary keyed by service name. A string value sets/replaces the override for that service. `null` removes the override for that service. Keys not present in the request are left unchanged (PATCH semantics, not PUT). |

Response: `200 OK` with the full active config (same shape as `GET /api/config/topology`). The new setting takes effect on the next matrix read — no client reconnect or service restart is required (NFR-03's 5 s budget still applies).

Audience: **admin / CI / ops tooling only — the SPA does not invoke this endpoint.** PATCH is auth-gated by the same `X-Api-Key` middleware as `POST /api/deployments` (FR-10). It changes the **server-side** default + per-service overrides — settings that affect every viewer. End-user picker preferences are per-user, ephemeral, and travel as a `correlationAttribute` query parameter on read endpoints (see below). This keeps the API key out of the SPA bundle entirely (NFR-04).

**GET `/api/deployments` — query parameters:**

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `correlationAttribute` | string | no | Per-request hint for the correlation-fallback pass of the topology builder (§"Topology Derivation"). Allowed values: `version`, `ref`, `sha`, `actor`, `run`, `ago`. **`id` is disallowed.** Invalid value → `400 Bad Request`. Omitted → falls back to the server-side default (`Topology.CorrelationAttribute`). |

Behaviour:
- The query parameter affects **only** the correlation fallback pass. Explicit `parent_deployments` edges (pass 2 of the derivation algorithm) are unaffected.
- Per-service overrides win regardless: if `Topology.PerServiceOverrides[service]` is set (ops-managed, server-side), that attribute is used for `service` even when the request supplies a different `correlationAttribute`. Precedence (per request, per service): `PerServiceOverrides[svc] > query-param > server default`.
- The parameter is a **hint**, not server state. Two simultaneous requests with different `correlationAttribute` values see different topologies; this is by design — the user picker is a personal preference, not a system change.
- The endpoint remains unauthenticated. The `X-Api-Key` is for writes only.

The same `correlationAttribute` query parameter is accepted on:
- `GET /api/deployments` (matrix)
- `GET /api/deployments/{service}/{environment}` and `.../history` accept it but ignore it — these endpoints do not return topology.

The query parameter is **not** accepted on `GET /api/stream`. SSE topology semantics are documented below.

**Matrix response shape — per service:**

The top-level response is a dictionary keyed by service. Each service entry contains two siblings: `envs` (the existing per-slot map) and `topology` (the new per-service env DAG; FR-13). The per-slot shape inside `envs` is unchanged.

```json
{
  "service-a": {
    "envs": {
      "dev": {
        "current": {
          "deployment_id": "gh-run-1251",
          "version": "v2.3.2",
          "status": "in-progress",
          "run_url": "https://github.com/org/repo/actions/runs/1251",
          "run_number": 1251,
          "actor": "john.doe",
          "deployed_at": "2026-05-14T14:34:00Z",
          "parent_deployments": ["gh-run-1240"],
          "ref": "feature/login-revamp",
          "sha": "9f1c0d2e8a"
        },
        "lastSuccessful": {
          "deployment_id": "gh-run-1247",
          "version": "v2.3.1",
          "run_url": "https://github.com/org/repo/actions/runs/1247",
          "run_number": 1247,
          "actor": "john.doe",
          "deployed_at": "2026-05-14T12:30:00Z",
          "parent_deployments": [],
          "ref": null,
          "sha": null
        },
        "previousFailed": false
      }
    },
    "topology": {
      "edges": [
        { "from": "dev",  "to": "qa-1", "source": "explicit" },
        { "from": "qa-1", "to": "uat",  "source": "correlated" }
      ]
    }
  }
}
```

Field rules:

- `current.deployment_id` and `current.parent_deployments` are surfaced on the wire so the SPA can render explicit parent links and so the history drawer can display the explicit lineage. `lastSuccessful.deployment_id` is included for symmetry; `lastSuccessful.parent_deployments` is included for completeness but the SPA renders edges from the matrix `topology` block, not by walking these arrays client-side.
- `lastSuccessful` is `null` when `current.status === "success"` (they are the same event) or when no successful deployment has ever occurred for this slot. `previousFailed` is `true` when `current.status === "in-progress"` and the most recent *terminal* deployment was a failure.
- `topology.edges` is always present (possibly empty) per service. `from` and `to` are env names already present in this service's `envs` map. `source` is `"explicit"` or `"correlated"` per §"Topology Derivation" merge rules.
- `ref` and `sha` are surfaced on both `current` and `lastSuccessful` when stored. When absent on the stored row, the server MAY omit the property entirely OR emit it as `null`; clients MUST treat absent and `null` as equivalent. The SPA renders these fields per FR-12 (Display attribute picker — §7 "Attribute vocabulary") and may use them as the correlation key per FR-13 (Topology correlation picker — §"Topology Derivation"); they are not used by the matrix-state derivation logic. Null/absent values render empty in the picker slot (§7 "Null-render invariant for nullable attributes") and are skipped by the correlation fallback pass.
- The same per-event shape — including `ref` and `sha` with the same omitted-or-`null`-when-absent rule — applies to `GET /api/deployments/{service}/{environment}` (single slot, `current` / `lastSuccessful`) and to every item returned by `GET /api/deployments/{service}/{environment}/history`. The history endpoint returns deployment events as an array; each item carries the full row fields (`deployment_id`, `service`, `environment`, `version`, `status`, `run_url`, `run_number`, `actor`, `deployed_at`, `parent_deployments`, `ref`, `sha`).

**SSE `slot-update` data payload:**

`GET /api/stream` emits events shaped as below. The inner `state` object is the exact per-slot shape from `GET /api/deployments` — clients patch their store with identical data from either endpoint without re-deriving `lastSuccessful` / `previousFailed` on the wire. **Topology is not carried on the SSE wire** — see "SSE topology semantics" below for the rationale and the refresh contract.

```json
{
  "service":     "service-a",
  "environment": "dev",
  "state": {
    "current":        { "deployment_id": "gh-run-1251", "version": "v2.3.2", "status": "in-progress", "run_url": "https://github.com/org/repo/actions/runs/1251", "run_number": 1251, "actor": "john.doe", "deployed_at": "2026-05-14T14:34:00Z", "parent_deployments": ["gh-run-1240"], "ref": "feature/login-revamp", "sha": "9f1c0d2e8a" },
    "lastSuccessful": { "deployment_id": "gh-run-1247", "version": "v2.3.1", "run_url": "https://github.com/org/repo/actions/runs/1247", "run_number": 1247, "actor": "john.doe", "deployed_at": "2026-05-14T12:30:00Z", "parent_deployments": [], "ref": null, "sha": null },
    "previousFailed": false
  }
}
```

The Read API derives `state` for the affected slot on every NOTIFY using the same logic as the matrix endpoint, so the per-slot wire shape is identical between REST and SSE. `lastSuccessful` and `previousFailed` follow the same rules as the REST per-slot response. `ref` and `sha` follow the same omitted-or-`null`-when-absent rule as on the matrix response (§"Matrix response shape — per service" → field rules).

**SSE topology semantics — single source of truth:**

The SSE event carries the slot update only. The SPA refreshes per-service topology by issuing `GET /api/deployments?correlationAttribute=<user's-preference>` after each slot-update event (or after `Last-Event-ID` replay on reconnect). Topology is therefore *always* derived with the user's current picker preference; the SSE wire shape never has to encode it.

Rationale:
- **One source of truth for topology — the matrix GET endpoint.** SSE and GET cannot disagree because SSE no longer claims to know the topology.
- **No per-user fan-out on the server.** The server emits one slot-update payload for every viewer; user preference enters the picture only on the subsequent GET.
- **Reconnect correctness is trivial.** `Last-Event-ID` replay continues to deliver slot updates; the SPA re-fetches topology after the replay catches up. No "which topology to trust" reasoning on the client.
- **Cost is negligible.** The SPA already issues an HTTP request per SSE event in the original design (to fetch `/history` on drawer open); one extra GET per event is a microsecond on a same-cluster call and falls inside NFR-03's 5 s budget by orders of magnitude.

The SPA's refresh policy:
1. Receive SSE `slot-update` → apply `state` to the matrix store immediately (so status / version / actor update without waiting on a round trip).
2. Issue `GET /api/deployments?correlationAttribute=<picker-value>` — replace topology wholesale per service in the store.
3. On reconnect after disconnect: SSE `Last-Event-ID` replays missed slot updates, then a single GET refreshes topology.

Topology can be coalesced if multiple slot-update events arrive within a short window (≤ 250 ms) — issue one GET, not N — but this is an implementation detail; the contract is "topology in the store is eventually consistent with the user's picker preference within NFR-03's budget".

---

### Infrastructure

#### Local Development

**Containers — three images, three Dockerfiles**

Each component has its own multi-stage Dockerfile. The API container hosts both Write and Read surfaces (per §"Backend module architecture") and serves JSON only — it does **not** bundle the SPA. The SPA is shipped in its own nginx container, and both sit behind the App Gateway.

| Image | Source path | Dockerfile context | Notes |
|---|---|---|---|
| `deployment-dashboard/api` | `backend/api/` | `backend/` | SDK build → aspnet:10.0 runtime; EXPOSE 8080; no SPA stage; no `wwwroot`. Composes the `write-api/` and `read-api/` libraries into a single host (Write surface API-key-gated; Read surface unauthenticated). |
| `deployment-dashboard/dashboard` | `frontend/dashboard/` | `frontend/` | `node:22-alpine` runs `ng build dashboard` → copies `dist/dashboard/browser/` into `nginx:alpine` and serves it on port 80 with HTML5 history fallback to `index.html`. |
| `deployment-dashboard/gateway` | `gateway/` | `gateway/` | `nginx:alpine`; `nginx.conf` declares the routing matrix (path + method) and SSE pass-through tuning. EXPOSE 80. **The only image with public ingress.** |

Conventional connection-string variables: the API host reads `ConnectionStrings__DefaultConnection`. The Write surface reads `API_TOKEN` (the key required on `X-Api-Key`); the Read surface reads `HISTORY_RETENTION_DAYS`. Both env vars are bound on the single API container.

**Docker Compose — Local Development**

```yaml
services:
  gateway:
    build: { context: ../gateway }
    ports: ["8080:80"]                 # ONLY host-published service
    depends_on: [dashboard, api]

  dashboard:
    build: { context: ../frontend, dockerfile: dashboard/Dockerfile }
    expose: ["80"]                     # internal only — no host port

  api:
    build: { context: ../backend, dockerfile: api/Dockerfile }
    expose: ["8080"]                   # internal only — hosts both Write and Read surfaces
    environment:
      ConnectionStrings__DefaultConnection: "Host=db;Database=dashboard;Username=dashboard;Password=local-dev-password"
      API_TOKEN: "local-dev-token-not-for-production"     # required for the Write surface (X-Api-Key)
      HISTORY_RETENTION_DAYS: "365"                       # consumed by the Read surface pruning job
    depends_on:
      db: { condition: service_healthy }
      migrations: { condition: service_completed_successfully }

  migrations:
    image: mcr.microsoft.com/dotnet/sdk:10.0
    # one-shot: dotnet ef database update against db, then exits 0

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: dashboard
      POSTGRES_USER: dashboard
      POSTGRES_PASSWORD: local-dev-password
    volumes: ["pg-data:/var/lib/postgresql/data"]
    ports: ["5432:5432"]               # dev-only convenience for psql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dashboard"]
      interval: 5s
      retries: 5

  pgadmin:
    image: dpage/pgadmin4:latest
    ports: ["5050:80"]                 # dev-only convenience
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@example.com
      PGADMIN_DEFAULT_PASSWORD: admin
    depends_on: [db]

volumes:
  pg-data:
```

The browser only ever talks to `http://localhost:8080/` — the gateway resolves whether a request is for the SPA or one of the APIs. There is no CORS preflight anywhere in the system. In Azure the same topology applies: only the gateway's ACA app has public ingress.

**Horizontally scaled deployment**

For production deployments with multiple backend replicas:

```yaml
services:
  lb:
    image: nginx:alpine
    ports: ["80:80"]
    depends_on: [api]

  api:
    image: deployment-dashboard:latest
    deploy:
      replicas: 3
    environment:
      ConnectionStrings__DefaultConnection: "Host=db;Database=dashboard;Username=dashboard;Password=${DB_PASSWORD}"
      API_TOKEN: "${API_TOKEN}"
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    # ... same as above
```

All instances are stateless and share the same PostgreSQL database. SSE fan-out works correctly because each instance subscribes to the same `LISTEN deployments` channel on PostgreSQL and independently forwards events to its own connected clients. The load balancer does **not** need sticky sessions for REST calls; SSE connections are long-lived but reconnect transparently via `Last-Event-ID`.

**Hosting options**

| Option | Notes |
|---|---|
| Docker on any VM / Linux host | Simplest overall setup; same image as local dev |
| Azure Container Apps | Scales to zero; managed PostgreSQL handles backups; **chosen for target architecture** |
| Azure App Service (container) | Persistent option if always-on is preferred |
| Self-hosted runner host | Run alongside the GitHub Actions runner |

**GitHub Actions secrets required**

| Secret | Value |
|---|---|
| `DEPLOYMENT_DASHBOARD_URL` | Base URL of the dashboard (e.g. `https://dashboard.internal.company.com`) |
| `DEPLOYMENT_DASHBOARD_TOKEN` | API key for write access |

#### Azure Deployment

**Infrastructure Diagram**

```
┌─── Azure ──────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─── Azure Container Registry ───────────────────────────────────────┐   │
│  │  deployment-dashboard/gateway:latest                                │   │
│  │  deployment-dashboard/dashboard:latest                              │   │
│  │  deployment-dashboard/api:latest      (Write + Read surfaces)       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                    ↑ pull images                                            │
│  ┌─── Azure Container Apps Environment ────────────────────────────────┐   │
│  │                                                                      │   │
│  │  ┌──────────────────────┐                                            │   │
│  │  │  App Gateway          │  ◄── ONLY public ingress (NFR-04)         │   │
│  │  │  nginx:alpine         │                                           │   │
│  │  │                       │  routes (single api upstream today):      │   │
│  │  │                       │    GET /                  → dashboard     │   │
│  │  │                       │    POST /api/deployments  → api (Write)   │   │
│  │  │                       │    GET  /api/*            → api (Read)    │   │
│  │  │                       │    GET  /api/stream (SSE) → api (Read)    │   │
│  │  │                       │    GET  /health           → api (Read)    │   │
│  │  └──┬────────────────────┬─────┘                                     │   │
│  │     │                    │                                            │   │
│  │     ▼                    ▼                                            │   │
│  │  ┌──────────┐    ┌──────────────────────────────────────────────┐   │   │
│  │  │ Dashboard│    │  API container                                │   │   │
│  │  │ nginx +  │    │  ASP.NET Core 10 — single host                │   │   │
│  │  │ Angular  │    │   ─ Write surface: POST ingest, NOTIFY,       │   │   │
│  │  │ static   │    │     API-key gated (FR-10)                     │   │   │
│  │  │ build    │    │   ─ Read surface: matrix / history /          │   │   │
│  │  │ internal │    │     discovery / SSE / health, LISTEN          │   │   │
│  │  │          │    │  internal                                     │   │   │
│  │  └──────────┘    └────────────────────────┬──────────────────────┘   │   │
│  │                                           │                            │   │
│  └───────────────────────────────────────────┼────────────────────────────┘   │
│                                 writes + queries + LISTEN/NOTIFY              │
│                                              ↓                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Azure Database for PostgreSQL Flexible Server  (Burstable B1ms)    │   │
│  │  LISTEN/NOTIFY channel: "deployments"                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                   ↑
                  Browser + CI/CD  │  one origin only — no CORS
                                   │
                          ┌────────┴─────────┐
                          │   Public clients │
                          └──────────────────┘
```

**Component Mapping**

All three container apps share a **single** Azure Container Apps Environment on the **Consumption** plan, which is scale-to-zero by default — adding more small apps does not add fixed overhead. Total compute cost is dominated by vCPU-seconds × memory-seconds × request count, not by container count. The gateway and the dashboard containers in particular are static-only and idle the vast majority of the time, so their marginal cost on Consumption is close to zero. The unified API container further reduces the per-app overhead vs. the original two-API design and stays comfortably under NFR-02.

| Logical component | Azure resource | SKU | Est. monthly cost |
|---|---|---|---|
| App Gateway + Dashboard + API (3 apps, 1 environment) | Azure Container Apps Environment + 3 Container Apps | Consumption (scale-to-zero) | ~$2–5 combined |
| Container Images | Azure Container Registry | Basic | ~$5 |
| Deployment Store | Azure Database for PostgreSQL Flexible Server | Burstable B1ms | ~$13–15 |
| **Total** | | | **~$20–25/month** |

**Trade-off Analysis: SSE vs SignalR**

The original design considered **Azure SignalR Service with the Functions SignalR binding**. On Azure Container Apps, SSE is fully viable — ACA imposes no HTTP timeout on long-lived connections. **SSE + PostgreSQL `LISTEN/NOTIFY`** is therefore the chosen approach; Azure SignalR Service is not required.

| Dimension | SSE + PostgreSQL LISTEN/NOTIFY | Azure SignalR Service |
|---|---|---|
| **Protocol** | HTTP/1.1 text stream (`text/event-stream`) — browser-native `EventSource` | WebSocket (SignalR protocol) — requires `@microsoft/signalr` JS client (~50 KB) |
| **Fan-out mechanism** | Each backend instance `LISTEN`s on a PostgreSQL channel and forwards events to its own connected clients | SignalR Service brokers all delivery; backend emits one output binding message per event regardless of connection count |
| **Backend statefulness** | Each instance must maintain a live PostgreSQL `LISTEN` connection | Fully stateless — no persistent connection from the Function to a broker |
| **Azure Functions compatibility** | Not applicable — hosted on Container Apps, which imposes no HTTP timeout | Not applicable |
| **Horizontal scaling** | Load balancer must route SSE reconnects correctly; `Last-Event-ID` mitigates message loss | No sticky sessions needed; SignalR Service handles all client state |
| **Reconnection** | Browser `EventSource` reconnects automatically with `Last-Event-ID` | SignalR JS client reconnects automatically; server sends missed messages if hub history is enabled |
| **Infrastructure cost** | Requires PostgreSQL for fan-out (already needed for storage) — no extra cost | Requires Azure SignalR Service — Free tier ($0 for ≤ 20 concurrent connections) |
| **Operational complexity** | PostgreSQL `LISTEN/NOTIFY` is invisible to operators; no extra service | One additional Azure resource to provision and monitor |
| **Verdict** | **Chosen** — Container Apps imposes no HTTP timeout | Not used |

**Decision:** SSE + PostgreSQL `LISTEN/NOTIFY` is used. Azure SignalR Service is not required.

---

## 8. Security Considerations

- The dashboard is **internal-only**: hosted on a private network or behind VPN. Not exposed to the internet.
- **API-key middleware is scoped to write endpoints only.** Even though the Write and Read surfaces live in the same single API host (§7 "Backend module architecture"), the API-key middleware (`ApiKeyMiddleware`, in `shared/`) is applied **only** to the Write endpoint group (`POST /api/deployments`, `PATCH /api/config/topology`). The Read endpoint group (`GET /api/*`, `GET /api/stream`, `GET /health`) is unauthenticated by design (per FR-10 — write-only auth — and Decision #1 — read-side auth is delegated to a sidecar). The host composition wires this up via `MapGroup("/api").RequireApiKey()` on the write group only — there is no global `UseMiddleware<ApiKeyMiddleware>()` call. Future agents adding endpoints must place each new endpoint in the right group; a write-side endpoint accidentally added to the read group would skip authentication.
- Write endpoint requires a static API key — prevents arbitrary parties from injecting fake deployment records.
- The API key is stored as a GitHub Actions secret, not in workflow files or source code.
- **PostgreSQL:** credentials passed via environment variable, never in source code or image; stored in Azure Key Vault in the target architecture.
- **Authentication is out of scope for the dashboard itself.** If read-endpoint access control is required, it should be delegated to an infrastructure-level sidecar or ambassador (e.g. OAuth2 Proxy, nginx auth_request, Azure API Management) placed in front of the container. The dashboard has no user identity model.

---

## 9. Phasing

### MVP — Web Dashboard

| Item | Scope |
|---|---|
| Backend API | `POST /api/deployments`, `GET /api/deployments`, `GET /api/environments`, history endpoint, SSE stream, health |
| Storage | PostgreSQL |
| Frontend | Angular 20 SPA — pipeline matrix, status badges, history drawer, version highlight, live SSE updates |
| Ingest | HTTP call (`curl` or equivalent) from any CI/CD pipeline (GitHub Actions, Azure DevOps, Jenkins, etc.) |
| Container | Three Docker images — API (Write + Read surfaces), Dashboard Frontend (Angular SPA), App Gateway |
| Config | `ConnectionStrings__DefaultConnection`, `API_TOKEN`, `HISTORY_RETENTION_DAYS` (default 365) |

**Definition of Done:**  
A developer can open the dashboard URL and see every service's current version per environment, updated within 30 seconds of a deployment completing.

### CI/CD Integration

| Item | Scope |
|---|---|
| Inline HTTP step | Shell/script snippet documented and tested for each CI/CD tool in use (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, etc.) |
| GitHub Actions composite action | Optional reusable `action.yml` for GitHub Actions users — define once, reference in every workflow |
| Webhook receiver | Optional lightweight endpoint to translate CI/CD webhook payloads (e.g. GitHub `deployment_status`) to the dashboard schema |
| Secrets | `DEPLOYMENT_DASHBOARD_URL` and `DEPLOYMENT_DASHBOARD_TOKEN` configured in each pipeline's secret store |

**Definition of Done:**  
Every active deployment pipeline sends a notify event to the ingest API on deploy. The matrix reflects real deployment data within 30 seconds of a deployment completing.

### v2.0 — Notification Client

| Item | Scope |
|---|---|
| Tray application | Polls `GET /api/deployments`, diffs against cached state |
| OS notifications | One notification per changed deployment slot (service+environment) |
| Click-through | Notification click opens dashboard URL in default browser |
| Configuration | Local config file: dashboard URL, poll interval, status filter (`notify_on`), optional environment filter (defaults to all environments discovered from `GET /api/environments`) |
| Distribution | Self-contained binary (no runtime installation required) |

**Definition of Done:**  
A developer installs the tray binary, configures the dashboard URL, and receives an OS notification within one poll cycle of any UAT or PROD deployment.

---

## 10. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Authentication on read endpoints? | Out of scope — delegated to a sidecar or ambassador (e.g. OAuth2 Proxy) placed in front of the container |
| 2 | Retention policy for deployment history? | Configurable via `HISTORY_RETENTION_DAYS`; default **365 days**; pruned daily |
| 3 | Should failures update the current matrix? | **Yes** — the matrix always shows the last deployment regardless of status; the status badge communicates the outcome |
| 4 | Single repo or multi-repo? | Not applicable — the system is push-based; it does not query or know about repositories. Any workflow can push to it. |
| 5 | Which environments trigger notifications? | Configurable; defaults to **all environments** discovered dynamically from `GET /api/environments`; can be restricted via `filter_environments` in the client config |
| 6 | Push vs pull data model? | **Push** — the system exposes an ingest API; it does not query GitHub or any CI/CD tool. Callers are responsible for sending a correctly shaped payload. How deployments are triggered, structured, or named in the source is irrelevant to the system. |
| 7 | Scope of the topology correlation-attribute override (per-user / per-service / global)? | **Three-tier with split persistence.** (1) **Server-side global default** (`Topology.CorrelationAttribute`) — bootstrap default `version`. (2) **Server-side per-service override** (`Topology.PerServiceOverrides[service]`) — ops-managed; necessary because real environments use different correlation attributes for different services (e.g. service-a deploys by `version`, service-b by `sha`). (3) **Per-user picker preference** — stored client-side in `localStorage` only; sent as `correlationAttribute` query parameter on read endpoints. Precedence: `PerServiceOverrides[svc] > query-param > server default`. Rationale for split persistence: keeping the per-user preference out of server state preserves NFR-04 (the SPA is read-only against the API and never carries the `X-Api-Key`); ops still get a shared lever (PATCH) for environments where topology must be governed centrally. |
| 8 | Topology delivery — SSE wire vs. follow-up GET? | **Slot updates over SSE; topology fetched via `GET /api/deployments?correlationAttribute=…` after each event.** Rationale: with a per-user `correlationAttribute` query parameter (Decision #7), SSE cannot carry "the" topology — every connected viewer might have a different picker preference, and a single broadcast payload cannot satisfy them all. The simplest correct contract is **one source of truth — the GET endpoint** — and a refresh-on-event policy on the SPA. Cost: one extra HTTP call per SSE event on a same-cluster connection; well inside NFR-03's 5 s budget. Eliminates "which topology to trust" reasoning on the client and makes `Last-Event-ID` replay trivially correct. See §"API Contract" → "SSE topology semantics". |
| 9 | Explicit `parent_deployments` references that point to a not-yet-ingested deployment — reject or accept? | **Accept and hold as dangling.** Rationale: out-of-order ingest is normal in distributed CI/CD (different pipelines, different runners, network delays); rejecting forces callers to retry-with-backoff and ties topology correctness to ingest ordering. Dangling references contribute no edge until the missing source lands; the next read after that reconciles them automatically (§"Topology Derivation" pass 5). Cross-service references and cycles are still hard rejections (`400`). |
| 10 | Validation of `ref` and `sha` (length, format, character set, required-when-paired)? | **Deferred — additive-only for now.** This cycle adds `ref` and `sha` as nullable, unconstrained string fields on the ingest payload and the read-side wire shape (FR-05). No length cap, no hex check on `sha`, no required-when-`ref`-set rule. A separate, larger validation overhaul is on the project backlog and will revisit every payload field (`version`, `ref`, `sha`, others) together, set length caps, define a standard format, and surface proper 4xx errors. Backward compatibility: payloads with neither field, either field, or both must continue to work. |
| 11 | Should the Write API and Read API ship as one container or two? | **One container, two library surfaces — split deferred.** The two API surfaces (`POST /api/deployments` and the read endpoints) ship inside a single ASP.NET Core host project (`backend/api/`) that composes two separate library projects (`backend/write-api/`, `backend/read-api/`) per §7 "Backend module architecture". Rationale: (a) the two surfaces share the same `DbContext`, `LISTEN/NOTIFY` plumbing, and EF migrations — running them as one OS process avoids duplicate database connection pools and duplicate `LISTEN` subscriptions for zero functional benefit at MVP scale; (b) one ACA container app is cheaper than two on the Consumption plan and keeps NFR-02 comfortable; (c) the library boundary preserves the option to split: re-splitting becomes a host-project + gateway-config change, no library code touched (mechanics in §7 "Backend module architecture" → "Future split"). Trigger conditions for splitting are listed there. API-key middleware is scoped to the write endpoint group only (§8) — co-location does not change the auth boundary. |

---

## 11. Work Breakdown Structure

---

### MVP — Web Dashboard

#### 1. Implement Solution

- 1.0 Backend host (`backend/api/`) — composition root that wires up Write and Read surface libraries; `Program.cs`, single Dockerfile, single ACA container app target; references `backend/write-api/`, `backend/read-api/`, `backend/shared/`. API-key middleware is applied **only** to the Write endpoint group (see §8 "Security Considerations" and §7 "Backend module architecture"). See §10 Decision 11 for rationale and future-split mechanics.
- 1.1 Ingest API (Write surface — ASP.NET Core Minimal API library at `backend/write-api/`; composed into the API host)
  - 1.1.1 `DeploymentEvent` record with Data Annotations validation (`422` on invalid payload); fields include `deployment_id` (required) and `parent_deployments` (optional)
  - 1.1.2 EF Core `DeploymentEntity` and `DbContext` in `backend/shared/`; `deployments` table migration with `deployment_id` column + unique index on `(service, deployment_id)` and `parent_deployments` column (PostgreSQL `text[]`; SQLite JSON-encoded array). Migrations live in `shared/` and serve both surfaces.
  - 1.1.3 `201 Created` response with created resource body; `409 Conflict` on duplicate `(service, deployment_id)`; `400` on cross-service parent ref or on cycle through resolved references
  - 1.1.4 API key middleware applied to the Write endpoint group only (`MapGroup("/api").RequireApiKey()` on the write group; no global registration) — `401` on missing / invalid token; the Read group is unauthenticated by design
  - 1.1.5 PostgreSQL `NOTIFY deployments` channel after successful insert
  - 1.1.6 Topology cycle-check helper — validates `parent_deployments` against the already-resolved subgraph at ingest time; dangling references are accepted unchecked
- 1.2 Read API (Read surface — ASP.NET Core Minimal API library at `backend/read-api/`; composed into the same API host)
  - 1.2.1 `GET /api/deployments` — matrix query with `lastSuccessful`, `previousFailed`, and per-service `topology.edges` derivation; accept optional `correlationAttribute` query parameter (validated against the allowed enum; `400` on invalid value); precedence `PerServiceOverrides[svc] > query-param > server default`
  - 1.2.2 `GET /api/deployments/{service}/{environment}/history` — last N events, `404` when no history
  - 1.2.3 `GET /api/environments` and `GET /api/services` — discovery from stored data
  - 1.2.4 `GET /api/stream` — SSE endpoint; subscribe to PostgreSQL `LISTEN deployments` per connected client; **slot-update payload only — topology is NOT carried on the wire** (the SPA refreshes topology via `GET /api/deployments?correlationAttribute=…` after each event, per §"API Contract" → "SSE topology semantics")
  - 1.2.5 `GET /health` — database connectivity check
  - 1.2.6 Topology derivation service — explicit-first + correlation fallback passes per §"Topology Derivation"; correlation attribute resolved per request using the three-tier precedence; defensive read-side cycle drop with `WARN` log
  - 1.2.7 `GET /api/config/topology` (SPA-readable; surfaces server-side `CorrelationAttribute` + `PerServiceOverrides` so the picker can display "system default") and `PATCH /api/config/topology` (admin / CI / ops only — **not invoked by the SPA**). The PATCH endpoint lives on the Write endpoint group (auth-gated by the same `X-Api-Key` middleware that protects `POST /api/deployments`, per FR-10 and §8). GET is on the Read group (unauthenticated).
- 1.3 Dashboard Frontend (Angular 20 SPA)
  - 1.3.1 Angular workspace — standalone components, zoneless change detection, Tailwind CSS
  - 1.3.2 `DeploymentMatrixStore` (NgRx Signal Store) — matrix state, `lastSuccessful`, `previousFailed`, per-service `topology.edges`
  - 1.3.3 Pipeline matrix component — service rows, environment boxes; 6 states (success, running, failed, split variants)
  - 1.3.4 Box component — status badge, version, ago, actor, run link; ⚠ prev. failed badge
  - 1.3.5 History drawer component — current state panel + history list; displays `deployment_id` and `parent_deployments` for each entry
  - 1.3.6 Version hover directive — amber highlight across all environments for the same version
  - 1.3.7 SSE Angular service — browser-native `EventSource` subscription to `/api/stream`; dispatch slot-update events (slot state only — no topology on the wire) to `DeploymentMatrixStore`; on every slot-update event, trigger a topology refresh via `GET /api/deployments?correlationAttribute=<picker-value>` (coalesce bursts within ≤ 250 ms into a single GET)
  - 1.3.8 Search filter and "failures only" toggle; stats bar
  - 1.3.9 View switcher component (`frontend/matrix/` or `frontend/shared/`) — segmented control rendering the four views (Detailed / Compact / Glance / Focus); writes `dashboard.view`
  - 1.3.10 Attribute picker component (`frontend/matrix/`) — dropdown `Display <n>/<max>`; popover with seven checkboxes (`status`, `version`, `run`, `ago`, `actor`, `ref`, `sha`); per-view cap enforcement (disabled state when cap reached); null-render invariant honoured for `ref`/`sha` (§7 "Null-render invariant for nullable attributes")
  - 1.3.11 Per-view templates in `frontend/matrix/` — four standalone row components (`detailed-row`, `compact-row`, `glance-row`, `focus-row`) selected by the parent matrix component based on the active view
  - 1.3.12 Signal Store slice (`frontend/shared/`) — `{ view, attrs[view], layout, correlationAttribute }` with derived signals `activeView`, `selectedAttrs`, `capReached`, `activeLayout`, `activeCorrelationAttribute` (string | undefined; undefined → "use server default" → omit query parameter)
  - 1.3.13 `localStorage` persistence service (`frontend/shared/`) — typed wrapper for the seven `dashboard.*` keys (`dashboard.view`, `dashboard.attrs.{view}` ×4, `dashboard.layout`, `dashboard.correlationAttribute`); corruption-safe (try/catch around `JSON.parse`, filter to known attribute keys, truncate to per-view cap, validate layout/view/correlation-attribute string against allowed set, fall back to defaults on any failure); empty-array selection preserved; unknown correlation-attribute value treated as absent (omit query parameter)
  - 1.3.14 Layout switcher component (FR-13) — second segmented control in the header rendering the three layouts (Matrix / Swim-lane / Workflow-rows); writes `dashboard.layout`
  - 1.3.15 Layout renderers — Swim-lane and Workflow-rows components consume per-service `topology.edges`; Matrix layout is the existing services × environments grid. Connector geometry anchored to `getBoundingClientRect()` via `ResizeObserver` + window-resize listener (NFR-09). Empty-topology fallback: single root chain ordered by `current.deployed_at`.
  - 1.3.16 Glance pill with embedded env tag — env name rendered inside the coloured pill (NFR-09 Glance exception); rendering shared across all three layouts.
  - 1.3.17 Topology correlation-attribute picker — UI control that writes a user preference **only to `localStorage`** (key `dashboard.correlationAttribute`); never invokes `PATCH /api/config/topology`. Reads server-side default via `GET /api/config/topology` to label the "system default" option. The chosen value is appended as `correlationAttribute` query parameter on every `GET /api/deployments` (matrix fetch + post-SSE refresh). No `X-Api-Key` is ever sent from the SPA.
- 1.4 CI/CD notify step documentation
  - 1.4.1 Generic inline HTTP call (`curl`) snippet documented for any CI/CD tool
  - 1.4.2 GitHub Actions reusable composite action (`action.yml`) with input parameters including `deployment_id` (required) and `parent_deployments` (optional, space- or comma-separated list)
  - 1.4.3 Pester tests for any non-trivial composite action or webhook receiver script logic

#### 2. Automate Local Deployment (Docker Compose + PowerShell)

- 2.1 `docker-compose.yml` — API container (Write + Read surfaces) + Dashboard Frontend + App Gateway + PostgreSQL + pgAdmin + migrations one-shot
- 2.2 PowerShell `start.ps1` — bring up the stack, wait for health check, print dashboard URL
- 2.3 PowerShell `stop.ps1` — tear down containers and volumes
- 2.4 PowerShell `seed.ps1` — POST prefilled test deployment events via Ingest API
- 2.5 `.env.local` template with all required variables documented

#### 3. Functional and E2E Tests — Local Environment (API + prefilled test data)

- 3.1 Seed local database with representative test data covering all 6 box states (`seed.ps1`); seed set must include explicit `deployment_id` values and at least one chain of `parent_deployments` references so topology can be exercised
- 3.2 Functional (API) tests
  - 3.2.1 `POST /api/deployments` — happy path, validation errors, auth rejection; new cases: missing `deployment_id` → `422`; duplicate `(service, deployment_id)` → `409`; cross-service parent → `400`; cycle → `400`; dangling reference → `201`
  - 3.2.2 `GET /api/deployments` — matrix shape, `lastSuccessful`, `previousFailed`, and `topology.edges` correctness (explicit-only, correlated-only, mixed, dangling-then-resolved)
  - 3.2.3 `GET /api/deployments/{s}/{e}/history` — ordering, `404` for unknown slot
  - 3.2.4 `GET /api/environments`, `GET /api/services`, `GET /health`
  - 3.2.5 `GET /api/config/topology` — unauthenticated read returns server-side defaults; `PATCH /api/config/topology` — `401` without `X-Api-Key`; happy-path PATCH semantics (unset fields unchanged; explicit `null` removes a service's override). No SPA-driven e2e for PATCH (the SPA does not invoke it).
  - 3.2.6 `GET /api/deployments?correlationAttribute=<attr>` — happy path for each allowed value; `400` on invalid value (`id`, unknown attribute); per-service override beats the query parameter; absence of the parameter falls back to the server-side default
- 3.3 E2E tests
  - 3.3.1 Pipeline matrix renders all services and environments with correct states
  - 3.3.2 History drawer opens on box click; shows correct events including `deployment_id` and `parent_deployments`
  - 3.3.3 Real-time update — POST a new event, verify matrix box updates without page reload
  - 3.3.4 Layout switcher (FR-13) — verify all 4 × 3 = 12 (view, layout) combinations render without NFR-09 violations; reuse the six geometric invariants from `testing/mockup-visual/`
  - 3.3.5 Glance exception — env tag rendered inside the coloured pill across all three layouts; connector terminates at pill's left edge
  - 3.3.6 Topology rendering — explicit edges visually distinct from correlated edges; empty-topology services render as single root chains in Swim-lane / Workflow-rows

#### 4. Implement Infrastructure (Terraform)

- 4.1 Resource Group and naming convention module
- 4.2 Azure PostgreSQL Flexible Server (B1ms, private access)
- 4.3 Azure Container Registry (Basic SKU)
- 4.4 Azure Container Apps Environment
- 4.5 Azure Container Apps — three container app definitions: API (Write + Read surfaces), Dashboard Frontend, App Gateway. A future split adds a second backend container app per §10 Decision 11.
- 4.6 Azure Key Vault — store `API_TOKEN`, `ConnectionStrings__DefaultConnection`
- 4.7 Workspace-based environments (`dev`, `prod`) with per-environment variable files

#### 5. Implement Component Deployment (Terraform)

- 5.1 GitHub Actions workflow — Docker build, push to ACR, update Container App revision on merge to main
- 5.2 Angular `ng build` output is bundled into the **Dashboard Frontend** nginx image (not into the API container) — `frontend/dashboard/Dockerfile` copies `dist/dashboard/browser/` into `nginx:alpine`. The API container serves JSON only.
- 5.3 Database migration step — run EF Core migration as part of deployment pipeline
- 5.4 Terraform `azurerm_container_app` revision update triggered by new image digest in ACR

#### 6. Deploy Infrastructure

- 6.1 Run `terraform apply` for target environment
- 6.2 Verify all resources provisioned (`terraform show`, Azure Portal check)
- 6.3 Confirm Key Vault secrets populated; Container Apps read environment variables correctly

#### 7. Smoke Test Infrastructure

- 7.1 `GET /health` returns `200 OK` — confirms Container App started and PostgreSQL reachable
- 7.2 `GET /api/stream` opens SSE connection — confirms LISTEN/NOTIFY subscription works (receive a test event within 5 s)
- 7.3 Angular SPA loads in a browser from the App Gateway URL — confirms the Dashboard Frontend nginx container serves the bundle and the gateway routes `GET /` correctly. (The API container does not serve static assets.)
- 7.4 Confirm PostgreSQL `deployments` table exists with correct schema

#### 8. Deploy Components

- 8.1 Deploy the API container image (Write + Read surfaces) via CI pipeline (Docker build, push to ACR, update Container App revision). Dashboard Frontend and App Gateway images deploy via the same pipeline as separate ACA apps.
- 8.2 Run database schema migration (idempotent)

#### 9. Functional and E2E Tests — Real Environment (API + prefilled test data)

- 9.1 Seed real environment with prefilled test data (`seed.ps1` targeting real endpoint with test API token)
- 9.2 Functional (API) tests against real Azure endpoints (same suite as §3.2)
- 9.3 E2E tests against real environment (same suite as §3.3, including SSE live update)

#### 10. Clean Up Test Data

- 10.1 Run `cleanup.ps1` — delete all rows inserted by the test seed from `deployments` table
- 10.2 Verify `GET /api/deployments` returns an empty matrix

#### 11. Fill Out Initial Data in Database

- 11.1 Coordinate with each team to supply current deployed versions per environment
- 11.2 Run `init-data.ps1` — POST one event per service+environment slot with real versions and `success` status
- 11.3 Verify matrix reflects the correct baseline state across all services and environments

---

### CI/CD Integration

#### 1. Implement Solution

- 1.1 Document the generic inline HTTP call pattern for each CI/CD tool in use (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, etc.)
- 1.2 GitHub Actions — reusable composite action (`action.yml`) with input parameters
- 1.3 GitHub Actions — optional `deployment_status` webhook receiver
- 1.4 Pester tests for any non-trivial composite action or webhook receiver script logic
- 1.5 Secrets documentation — `DEPLOYMENT_DASHBOARD_URL` and `DEPLOYMENT_DASHBOARD_TOKEN` per CI/CD tool

#### 2. Automate Local Deployment (Docker Compose + PowerShell)

- 2.1 PowerShell `test-notify.ps1` — send a test payload to the local ingest API to verify the integration pattern works
- 2.2 Confirm local dashboard updates on receipt

#### 3. Functional and E2E Tests — Local Environment (API + prefilled test data)

- 3.1 Functional tests — send the integration payload from each supported CI/CD tool pattern; verify `201` and matrix update
- 3.2 E2E tests — verify the dashboard updates visually after each notify pattern fires

#### 4. Implement Infrastructure (Terraform)

- 4.1 No new Azure resources — CI/CD integration is pipeline-side configuration only
- 4.2 Add `DEPLOYMENT_DASHBOARD_URL` and `DEPLOYMENT_DASHBOARD_TOKEN` to each CI/CD tool's secret store

#### 5. Implement Component Deployment (Terraform)

- 5.1 Add notify step to each active deployment pipeline
- 5.2 Confirm the step fires correctly on the next deployment

#### 6. Deploy Infrastructure

- 6.1 Secrets provisioned in each CI/CD tool's secret store
- 6.2 Verify secrets are accessible from the pipeline at runtime

#### 7. Smoke Test Infrastructure

- 7.1 Run `test-notify.ps1` against real ingest endpoint — verify `201` and matrix update
- 7.2 Confirm API key authentication works (`401` with wrong token)

#### 8. Deploy Components

- 8.1 Merge notify step into each active deployment pipeline
- 8.2 Confirm the step executes on the first triggered deployment

#### 9. Functional and E2E Tests — Real Environment (API + prefilled test data)

- 9.1 Trigger a real deployment in each pipeline — verify notify event is sent and matrix updates within 30 seconds
- 9.2 Verify `run_url` in the matrix box opens the correct pipeline run

#### 10. Clean Up Test Data

- 10.1 No test data cleanup required — real deployment events are valid production data

#### 11. Fill Out Initial Data in Database

- 11.1 Current versions were backfilled in MVP §11 — no additional inserts required
- 11.2 Verify matrix reflects accurate real state after the first batch of pipeline-triggered events

---

### v2.0 — Notification Client

#### 1. Implement Solution

- 1.1 Core polling loop — `GET /api/deployments` on configurable interval; diff against cached state
- 1.2 OS notifications — one notification per changed slot; title, body, and status formatting
- 1.3 Click-through — notification click opens dashboard URL in default browser
- 1.4 Configuration — load from local config file; auto-discover environment list from `GET /api/environments` when `filter_environments` is empty
- 1.5 Build target — self-contained binary (.NET 10 publish with `--self-contained -r <rid>`)

#### 2. Automate Local Deployment (Docker Compose + PowerShell)

- 2.1 PowerShell `start.ps1` — bring up MVP backend docker-compose stack; wait for health check
- 2.2 PowerShell `run-local.ps1` — start notification client pointed at local stack; pass config via env file
- 2.3 PowerShell `stop.ps1` — stop client and tear down backend stack
- 2.4 `.env.local` / config file template with all required variables documented

#### 3. Functional and E2E Tests — Local Environment (API + prefilled test data)

- 3.1 Seed local database with test deployment events (`seed.ps1` from MVP stack)
- 3.2 Functional tests
  - 3.2.1 Client polls and reads matrix state correctly on first cycle
  - 3.2.2 Diff logic detects changed slots and emits correct notification payload
  - 3.2.3 No spurious notifications fired when matrix state is unchanged
- 3.3 E2E tests
  - 3.3.1 POST new deployment event via Ingest API — verify OS notification fires within one poll cycle
  - 3.3.2 Notification click opens correct dashboard URL in default browser

#### 4. Implement Infrastructure (Terraform)

- 4.1 No new Azure resources — v2.0 is a standalone binary that consumes MVP backend endpoints
- 4.2 GitHub Actions release environment — configure secrets, permissions, and release token in repository settings
- 4.3 GitHub Actions release workflow YAML — matrix build for Windows, macOS, Linux on tag push
- 4.4 Pester tests for any non-trivial build or packaging script logic

#### 5. Implement Component Deployment (Terraform)

- 5.1 `build.ps1` — compile and package self-contained binary; validated in CI matrix
- 5.2 GitHub Releases publish step — upload platform binaries and attach changelog-derived release notes
- 5.3 Pre-release tag convention documented for smoke-test validation runs

#### 6. Deploy Infrastructure

- 6.1 Configure GitHub Actions environment with required secrets and permissions
- 6.2 Push pre-release tag — verify workflow triggers and completes without error

#### 7. Smoke Test Infrastructure

- 7.1 Verify binary artifacts for all three platforms are attached to the pre-release GitHub Release
- 7.2 Install pre-release binary on a developer machine; verify it starts and reads config without error

#### 8. Deploy Components

- 8.1 Tag stable version and trigger release pipeline
- 8.2 Verify binary artifacts attached to the stable GitHub Release for all target platforms

#### 9. Functional and E2E Tests — Real Environment (API + prefilled test data)

- 9.1 Install stable binary on a developer machine; configure with real dashboard URL and API endpoint
- 9.2 Seed real environment with a test deployment event (`seed.ps1` targeting real endpoint with test API token)
- 9.3 Functional tests — verify client reads matrix state and detects changed slot within one poll cycle
- 9.4 E2E tests
  - 9.4.1 POST test event — verify OS notification fires within one poll cycle
  - 9.4.2 Notification click opens real dashboard URL in default browser

#### 10. Clean Up Test Data

- 10.1 Run `cleanup.ps1` — delete test deployment records inserted in §9.2
- 10.2 Verify no spurious notification fires on the next client poll after cleanup

#### 11. Fill Out Initial Data in Database

- 11.1 Initial data was seeded in MVP §11 — no additional inserts required for v2.0
- 11.2 Verify the client reads the correct baseline state on first poll
- 11.3 Verify no spurious notifications fire for stable (`success`) slots on subsequent polls
