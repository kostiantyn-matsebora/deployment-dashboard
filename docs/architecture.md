---
title: Architecture (SAD)
nav_order: 5
---

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
- Acting as a CI/CD engine — the **backend** only tracks deployment state pushed to it; it does not query any CI/CD tool. An **optional, separately-deployed `Dashboard.Fetcher` component** (per [CR-0009](cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md); see §7 "Dashboard.Fetcher (optional pull-mode adapter)") MAY translate pull → push by polling a CI/CD tool's API and posting events to `POST /api/deployments` like any other pusher; the backend's tool-agnostic contract is preserved because the fetcher reuses the same push endpoint and the same `X-Api-Key`. The backend is never extended with CI/CD-specific SDKs.
- Multi-organisation or multi-repository aggregation (out of scope for MVP)
- Role-based access control (the dashboard is internal read-only tooling)

## 4. Functional Requirements

| ID | Requirement |
|---|---|
| FR-01 | The system shall display a real-time deployment matrix organised by service (one row per service), showing the current state of each (service, environment) slot. |
| FR-02 | Each slot shall be capable of showing: version, status (success / in-progress / failure), actor, elapsed time since deployment, and a link to the CI/CD run. |
| FR-03 | When the current state is in-progress or failed, the slot shall also show the last successfully deployed version in a split section below the current state. |
| FR-04 | The system shall maintain a full deployment history per slot and expose it on demand via a history drawer. |
| FR-05 | The system shall receive deployment events through a push-based HTTP ingest API (`POST /api/deployments`) accepting: service, environment, version, status, run URL, run number, and actor. |
| FR-06 | Integrating the notify step shall require no changes to existing CI/CD pipelines beyond adding a single step. |
| FR-07 | The dashboard shall support filtering by service name and by failure state only. |
| FR-08 | All connected browser clients shall receive live updates when a new deployment event is ingested — no page reload required. |
| FR-09 | The system shall support any set of services and environments without hardcoded values; the service and environment lists shall be derived from stored data. |
| FR-10 | The ingest API shall authenticate every write request with an API key; requests with a missing or invalid key shall be rejected with HTTP 401. |
| FR-11 | (v2.0) A desktop notification client shall alert developers via OS notifications when a deployment slot changes state, with a click-through to the dashboard. |

---

## 5. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | All infrastructure shall run on Microsoft Azure. |
| NFR-02 | Total Azure infrastructure cost shall not exceed $30/month. |
| NFR-03 | Live updates shall be delivered to all connected clients within 5 seconds of a successful ingest event. |
| NFR-04 | The system is internal tooling — no public internet exposure is required. The SPA itself is read-only against the API and does not handle authentication secrets. The ingest endpoint (`POST /api/deployments`) is reserved for CI/CD tooling. The dev-environment fake API key is never embedded in the SPA bundle. |
| NFR-05 | The backend shall be stateless; any number of instances may run behind a load balancer without sticky sessions. |
| NFR-06 | All infrastructure shall be defined as code using Terraform. |
| NFR-07 | Deployment history shall be retained for a minimum of 90 days per slot. |
| NFR-08 | The dashboard shall load in a browser with no build step — no bundler or compilation required. |
| NFR-09 | **UX-RESPONSIVENESS INVARIANT.** The dashboard layout shall reflow correctly under any combination of: service count (1..N), environment count per service (1..N), env-name length (1..32 chars), version-string length (1..50 chars), and viewport width (≥ 1024 px). Under no combination may visual elements overlap such that information is clipped, occluded, or rendered illegible. This includes env labels, deployment boxes, version strings, status badges, connector lines, arrowheads, and fork trunks. Enforced by construction: env-tag + box pairs use CSS Grid (`auto` env-tag column, fixed leaf-width box column); connector geometry is anchored to live `getBoundingClientRect()` measurements re-evaluated via a `ResizeObserver` and a window-resize listener. The invariant is mirrored verbatim at the top of `docs/ui/deployment-dashboard.html` (the mockup is the visual contract). |

---

## 6. Constraints

- **Hosting platform:** Azure only — all infrastructure must run on Microsoft Azure.
- **Budget:** ≤ $30/month total (compute + database + storage combined).
- **Network:** The system is deployed inside the organisation's internal network or a private Azure-hosted container; it is not publicly accessible.
- **Technology stack:** Angular 20+ for the frontend; .NET 10 for all backend components.
- **Platform agnosticism:** The solution must not depend on any proprietary cloud compute model (e.g. serverless Functions). All backend components must be deployable as standard containerised applications on any OCI-compliant container host.

---

## 7. Target Architecture

The project is a **microservices architecture** — Write API, Read API, Fetcher (optional), Frontend SPA, and App Gateway are distinct services with distinct concerns, decomposed at the project + boundary level. Per the ≤ $30/month budget and small-team operational envelope, the Write and Read API services are **co-located in a single container image** (`deployment-dashboard-api`) on Azure Container Apps; the Fetcher, Frontend SPA, and App Gateway each ship as their own image. **Co-location is a packaging choice, not the architecture itself.** The `deployment-dashboard-api` host composes the Write surface (`POST /api/deployments`, API-key-gated) and the Read surface (matrix / history / discovery / SSE / health, unauthenticated) from separate library projects inside one host process. Real-time fan-out uses **SSE + PostgreSQL `LISTEN/NOTIFY`** — Azure Container Apps imposes no HTTP timeout on long-lived SSE connections, making a separate real-time service unnecessary.

> **Architecture invariants — [ADR-0006 (microservices architecture with container co-location)](adr/ADR-0006-microservices-architecture-with-container-co-location.md), reframing the [ADR-0002](adr/ADR-0002-modular-monolith-consolidation.md) co-location mechanics:**
> 1. **Microservices architecture.** Write API, Read API, Fetcher, Frontend SPA, and App Gateway are distinct services with distinct concerns. Decomposition at the project + boundary level.
> 2. **Container co-location of Write + Read.** `backend/api/` is the sole ASP.NET Core executable and the only backend Dockerfile; both Write and Read library surfaces compose into the `deployment-dashboard-api` image. Co-location is a packaging choice, not the architecture itself.
> 3. **Two endpoint-group library surfaces.** `backend/write-api/` and `backend/read-api/` are library projects composed into the host; the per-service library boundary is preserved.
> 4. **Future re-split is host-project + gateway-config only.** The gateway's path+method routing matrix discriminates Write vs Read today even though both upstreams resolve to `api:8080`, so moving Write + Read from co-location to per-service deployment is a config-only change with no library code touched. Trigger conditions live in [ADR-0002 → "Future split — trigger conditions"](adr/ADR-0002-modular-monolith-consolidation.md) (mechanics-of-record); the framing was reset by ADR-0006.

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
              │                                                 │
              │  routes per §7 Components → App Gateway         │
              │                          → Routing matrix       │
              └────┬───────────────────────────┬────────────────┘
                   │                           │
                   ▼                           ▼
        ┌──────────────────┐    ┌──────────────────────────────────┐
        │  Dashboard       │    │  API (.NET 10)                   │
        │  Frontend        │    │  single host, two endpoint       │
        │  (nginx +        │    │  groups composed from libraries: │
        │   Angular static)│    │   • Write — POST → INSERT+NOTIFY │
        │   internal-only  │    │     API-key gated                │
        │                  │    │   • Read — matrix/history/       │
        │                  │    │     discovery/SSE/LISTEN         │
        │                  │    │     unauthenticated              │
        │                  │    │  internal-only                   │
        └──────────────────┘    └──────────────┬───────────────────┘
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

**Optional pull-mode ingest edge** — added by [CR-0009](cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md). When push-mode integration is not available, an opt-in `Dashboard.Fetcher` container polls a CI/CD tool's API and pushes events through the same gateway like any other pusher:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Optional — when push-mode integration is not available              │
│                                                                      │
│  ┌────────────────────┐      poll CI/CD API on interval             │
│  │  CI/CD Tool API     │ ◄─────────────────────────────────────┐    │
│  │  (e.g. GitHub)      │                                       │    │
│  └────────────────────┘                                       │    │
│                                                               │    │
│           ┌───────────────────────────────────────────────────┘    │
│           ▼                                                        │
│  ┌────────────────────────────────┐                                │
│  │  Dashboard.Fetcher.Host         │                               │
│  │  (separate container, opt-in)   │                               │
│  │                                 │                               │
│  │   • Polls CI/CD API             │                               │
│  │   • POSTs /api/deployments      │ ── same X-Api-Key ──────► gw  │
│  │     with X-Progress-Reporter:   │                               │
│  │     dashboard-fetcher/<adapter> │                               │
│  │   • GET/PUT /api/fetcher/state  │ ── for opaque cursor ──► gw   │
│  └────────────────────────────────┘                                │
└──────────────────────────────────────────────────────────────────────┘
```

#### C4 Component Diagram

The diagram below shows the logical components.

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
| **App Gateway** | Single public-facing reverse proxy that fronts every component. Routes by path + HTTP method (see Routing matrix in §7 → App Gateway). Write and Read API services are co-located in one `deployment-dashboard-api` image, so both surfaces resolve to a single `api:8080` upstream today (co-location per [ADR-0002](adr/ADR-0002-modular-monolith-consolidation.md), framing per [ADR-0006](adr/ADR-0006-microservices-architecture-with-container-co-location.md)); the path+method matrix is preserved so a future re-split into per-service images is gateway-config-only. Eliminates CORS (single origin), minimises the public surface (NFR-04), and is the only container exposed to host / public ingress. SSE pass-through tuned (`proxy_buffering off`, `proxy_read_timeout 1h`). | nginx (alpine) |
| **API (write + read surfaces)** | Single ASP.NET Core host (`backend/api/`) composing two endpoint-group library surfaces. **Write surface** — `POST /api/deployments`: accepts deployment events from CI/CD pipelines, validates payload, persists the event, notifies connected SSE clients via PostgreSQL `NOTIFY`. API-key-gated (FR-10). **Read surface** — serves the current deployment matrix (latest per slot), per-slot history, environment/service discovery, SSE stream, and health. Unauthenticated. Stateless — reads are satisfied from the store; events brokered via PostgreSQL `LISTEN`. Any number of instances can run in parallel. **Internal-only — reachable only via the App Gateway.** | C#, ASP.NET Core Minimal API, EF Core 10, Npgsql |
| **Deployment Store** | Durable append-only store for all deployment events. Source of truth for the matrix query, history queries, and `lastSuccessful` / `previousFailed` derivation. | PostgreSQL (production and local dev); SQLite in-memory for unit tests only |
| **Real-time Hub** | Each API instance `LISTEN`s on the PostgreSQL `deployments` channel (via the read surface's SSE handler) and forwards events to its own connected SSE clients. No separate broker service is required. | PostgreSQL `LISTEN/NOTIFY`, ASP.NET Core SSE (`text/event-stream`) |
| **Dashboard Frontend** | Browser-based pipeline matrix view. Renders the services × environments grid, history drawer, version highlight, and live SSE updates. Built with `ng build` and served as static files from its own nginx container; **internal-only**, reached via the App Gateway. | Angular 20 (standalone components, zoneless change detection), NgRx Signal Store, Tailwind CSS, browser-native `EventSource`; nginx (alpine) runtime |
| **Notification Client** | Standalone desktop tray application. Polls the API's read surface (via the App Gateway) at a configurable interval, diffs against locally cached state, and fires OS notifications for changed slots. | .NET 10, WinForms (Windows) or MAUI (cross-platform); self-contained binary |
| **Dashboard.Fetcher (optional, MVP: GitHub Actions adapter)** — *added by [CR-0009](cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md)* | Out-of-process pull-mode adapter. Polls a CI/CD tool's API on a configurable interval (default 30 s), translates pulled events into the `POST /api/deployments` wire shape, and pushes them to the backend like any other CI/CD pusher — using the same `X-Api-Key` and setting `X-Progress-Reporter` to `dashboard-fetcher/<adapter-id>`. Stores its opaque cursor on the backend via `GET`/`PUT /api/fetcher/state/{source-id}` so restart-safety does not depend on local container storage (NFR-05). Plug-in adapter shape per [ADR-0004](adr/ADR-0004-opaque-per-progress-reporter-cursor.md) Decision 4: each CI/CD tool is one `ICiCdAdapter` implementation; host owns scheduler + retry + rate-limit back-off + Write-API client. **Opt-in deployment** — the backend functions identically whether or not the fetcher is running. | C# / .NET 10 (`Microsoft.NET.Sdk.Worker`), Polly (retry), HttpClient, `Dashboard.Shared` (DTO reuse) |

#### CI/CD Notify Step

A pipeline step that pushes deployment state to the API (see Summary row for context).

**Integration options (choose one per pipeline):**

| Option | How it works | Effort |
|---|---|---|
| Inline HTTP call | After the deploy step, run `curl` (or equivalent) to `POST /api/deployments` | Minimal — one step in any CI/CD tool |
| GitHub Actions composite action | `uses: org/deployment-dashboard/.github/actions/notify@main` | Zero per-workflow after initial setup (GitHub Actions only) |
| Webhook receiver | CI/CD tool fires a deployment-related webhook automatically; a lightweight receiver maps the payload to the dashboard schema | No pipeline changes needed if webhooks are already configured |

**Payload sent:**

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

#### Dashboard Backend — Write and Read API services (co-located)

Write and Read are **distinct microservices** with distinct concerns, **co-located** in one stateless ASP.NET Core container (`deployment-dashboard-api`) for operational simplicity within NFR-02 — composed from separate library projects. The architecture is microservices; the co-location is a packaging choice (per [ADR-0006](adr/ADR-0006-microservices-architecture-with-container-co-location.md)). Any number of instances of the container can run behind a load balancer; all mutable state lives in the database. The per-service boundary remains separable: the library partition preserves the option to move Write + Read from co-location to per-service deployment as a host-project + gateway-config change (no library code touched). See [ADR-0002 → "Future split — trigger conditions"](adr/ADR-0002-modular-monolith-consolidation.md) (mechanics-of-record; superseded only in framing, not in mechanics).

| Attribute | Value |
|---|---|
| Language | C# / .NET 10 |
| Framework | ASP.NET Core Minimal API |
| ORM | EF Core 10 + Npgsql |
| Storage | PostgreSQL (production and local dev); SQLite in-memory (unit tests only) |
| Scalability | Horizontal — stateless; multiple instances behind a load balancer; the host scales as a whole today (surfaces co-located, independently scalable only after a future split) |
| Container | One Docker image — single host project under `backend/api/`; surface libraries under `backend/write-api/` and `backend/read-api/` |
| Port | 8080 |

**Statelessness constraints (required for horizontal scaling):**

| Concern | How the API host satisfies it |
|---|---|
| Caching | No in-memory cache of deployment state between requests — every read hits the database. |
| Real-time fan-out | No in-process fan-out across instances — events brokered via PostgreSQL `LISTEN/NOTIFY`. Each API instance independently `LISTEN`s on the `deployments` channel and forwards events to its own connected SSE clients. |
| Session affinity | No sticky sessions — load balancer may route any request to any instance. SSE connections are long-lived but reconnect transparently via `Last-Event-ID`. |

**Responsibilities:**
- Write surface — accept and persist deployment events via `POST /api/deployments` (API-key-gated); NOTIFY the PostgreSQL `deployments` channel on every successful ingest
- Read surface — serve the current deployment matrix (`GET /api/deployments`) and per-slot history (unauthenticated)
- Read surface — stream real-time slot-update events via SSE (`GET /api/stream`) using PostgreSQL `LISTEN`

**Out of scope for the backend:** serving static SPA assets. The Angular build is shipped in its own **Dashboard Frontend** container (nginx), not in the API container. The backend serves JSON only.

#### App Gateway

The single public-facing reverse proxy fronting every component (see Summary above for one-liner).

| Attribute | Value |
|---|---|
| Image | `nginx:alpine` |
| Public port | `8080` (host) / `443` (Azure ingress) |
| Routing | Path + method-based; no upstream awareness in the SPA or in CI/CD callers |
| Statelessness | Pure proxy; no per-request state retained between calls |
| Container | Single small image (~30 MB) |
| Owner | `devops-engineer` (Dockerfile + `nginx.conf` live under `gateway/` at the repo root) |

**Routing matrix:**

Both Write and Read API services are co-located in `deployment-dashboard-api` today, so both surfaces resolve to a single `api:8080` upstream (co-location mechanics per [ADR-0002](adr/ADR-0002-modular-monolith-consolidation.md); architectural framing per [ADR-0006](adr/ADR-0006-microservices-architecture-with-container-co-location.md)). The matrix continues to discriminate on path + method so that moving Write + Read to per-service images is a gateway-config-only change — the `POST /api/deployments` row simply points at a new write upstream while every other row stays the same.

| Method + Path | Upstream | Surface |
|---|---|---|
| `POST /api/deployments` | `api:8080/api/deployments` | Write — API-key gated. |
| `GET /api/deployments` | `api:8080/api/deployments` | Read. |
| `GET /api/deployments/{service}/{environment}` | `api:8080/...` | Read. |
| `GET /api/deployments/{service}/{environment}/history` | `api:8080/...` | Read. |
| `GET /api/environments`, `GET /api/services` | `api:8080/...` | Read. |
| `GET /api/stream` | `api:8080/api/stream` — SSE pass-through (`proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 1h`, `X-Accel-Buffering: no`) | Read. |
| `GET /health` | `api:8080/health` | Read. |
| `GET /` and every other path | `dashboard:80/` (SPA shell + Angular bundle, with HTML5 history fallback to `index.html`) | n/a. |

**Why a gateway (vs. CORS + multiple origins):**
- Eliminates CORS entirely — the browser only ever sees one origin.
- Minimises the public surface — only one container in NFR-04's internal-only network has ingress.
- One ACA app gets public ingress in Azure; the others stay internal.
- The SPA and CI/CD callers are upstream-agnostic — they hit one URL.

#### Dashboard Frontend (MVP)

Angular 20 SPA in its own nginx container; reached only via the App Gateway. Attributes below.

| Attribute | Value |
|---|---|
| Framework | Angular 20 — standalone components, zoneless change detection |
| State | NgRx Signal Store — deployment matrix store + events |
| Styling | Tailwind CSS |
| Real-time | Browser-native `EventSource` — SSE connection to `GET /api/stream` (resolved via the App Gateway) |
| Build | `ng build dashboard` — output (`dist/dashboard/browser/`) copied into the nginx image |
| Runtime | `nginx:alpine` — serves static files + HTML5 history fallback to `index.html`; no proxying (the App Gateway handles all proxying upstream) |
| Container port | `80` (internal only) |
| Interaction | Click box → history drawer; hover version → cross-environment highlight |

**Visual layout:**

The canonical visual + interactive contract lives in `docs/ui/deployment-dashboard.html`. This section describes only the contract that other tiers must honour.

**6 box states:**

Each slot resolves to one of six states based on the slot's wire shape:

| State | Condition | Box appearance |
|---|---|---|
| **Success** | Last deployment succeeded | Full green box — version + actor + time |
| **Running + Last Successful** | Deploying now; previous terminal was success | Top: orange spinner + version; bottom: last successful version |
| **Running + Failed + Last Successful** | Deploying now; previous terminal was failure; an older success exists | Top: orange spinner + ⚠ prev. failed badge; bottom: last successful version |
| **Failed + Last Successful** | Last deployment failed; an older success exists | Top: red failed + version; bottom: last successful version |
| **Running** | Deploying now; no prior successful deployment | Full orange spinning box — version only |
| **Running + Failed** | Deploying now; previous terminal was failure; no successful history | Top: orange spinner + ⚠ prev. failed badge; no bottom section |

The box is split into two sections by a dashed divider when a last-successful state differs from the current state. This makes it immediately visible what is running *now* versus what last worked.

Boxes share a version highlight on hover — hovering a version amber-highlights all boxes across environments where the same version is deployed, making it easy to trace promotion progress.

#### Notification Client (v2.0)

A standalone system tray application installed on developer machines.

**Behaviour:**
1. Polls `GET /api/deployments` every 30 seconds
2. Compares response against locally cached state
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

#### Dashboard.Fetcher (optional pull-mode adapter)

*Added by [CR-0009](cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md); plug-in shape + cursor model anchored in [ADR-0004](adr/ADR-0004-opaque-per-progress-reporter-cursor.md).*

Out-of-process component that translates pull → push for environments where a CI/CD pipeline cannot directly invoke `POST /api/deployments` (no network reachability, no scripting hook, tool-managed deploys without notify-step support, etc.). The component is **opt-in**: backend operation is unchanged whether the fetcher is deployed or not. MVP ships the GitHub Actions adapter only.

| Attribute | Value |
|---|---|
| Library project | `backend/fetcher/Dashboard.Fetcher/` — `ICiCdAdapter` interface + per-tool adapter implementations + scheduler + Polly retry + Write API client |
| Host project | `backend/fetcher-host/Dashboard.Fetcher.Host/` — ASP.NET Core Worker (`Microsoft.NET.Sdk.Worker`); composition root; env-var configuration |
| Container image | `deployment-dashboard-fetcher` (multi-stage Dockerfile under `backend/fetcher-host/Dockerfile`; mirrors `backend/api/Dockerfile` posture) |
| Deployment | Separate container, never co-hosted with the API. Local dev: opt-in `docker compose --profile fetcher up`. Azure: ACR image is built and published; ACA wiring deferred (out of MVP scope per CR-0009 § 3d). |
| Auth to backend | Same `X-Api-Key` any other pusher uses. No multi-token middleware. |
| Event attribution | Always sets `X-Progress-Reporter: dashboard-fetcher/<adapter-id>` on every `POST /api/deployments` and on every `GET`/`PUT /api/fetcher/state/{source-id}`. |
| State / restart-safety | Opaque cursor blob persisted on the backend via `GET`/`PUT /api/fetcher/state/{source-id}` (keyed by `(progress_reporter, source-id)`). The fetcher container holds no durable state. NFR-05 preserved — running multiple fetcher replicas is undefined behaviour for MVP and is **not** supported (would cause N× CI/CD API calls); ACA deployment is configured as `minReplicas: 1, maxReplicas: 1` when the fetcher is enabled. |
| Plug-in shape | `interface ICiCdAdapter { string AdapterId { get; } Task<FetchPage> FetchPageAsync(string sourceId, string? opaqueCursor, int pageSize, CancellationToken ct); }` returning `(events, newCursor, hasMore)`. The host owns scheduler, retry, rate-limit back-off, Write-API dispatch. Backend remains adapter-agnostic. See [ADR-0004](adr/ADR-0004-opaque-per-progress-reporter-cursor.md) Decision 4. |
| MVP adapter | GitHub Actions — `GET /repos/{owner}/{repo}/deployments` + `GET /repos/{owner}/{repo}/deployments/{id}/statuses`; cursor = highest seen `deployment.id`; first-fetch cap `INITIAL_FETCH_LIMIT` (default 50, ceiling 500). PAT auth (env-var); GitHub App auth deferred. |
| Failure isolation | Fetcher crashes / restarts do not affect API availability; reverse also true. Network failures back off per Polly policy; the backend stays cold to any pull-mode failure mode. |

**Why a separate process, not an in-process `BackgroundService`?** See [ADR-0004](adr/ADR-0004-opaque-per-progress-reporter-cursor.md) Decision 3 — running N pollers inside N API replicas would multiply CI/CD API call volume; opt-in deployment is cleaner as a separate image; credential isolation (CI/CD PATs never enter the API host).

---

### CI/CD Integration

The ingest API (`POST /api/deployments`) is the sole integration point. Any CI/CD tool that can make an HTTP POST request can send deployment events — no CI/CD-specific SDK, plugin, or webhook infrastructure is required. The dashboard has no dependency on any particular build system and does not query any CI/CD tool.

All field names in the payload are generic: `run_url`, `run_number`, and `actor` map naturally to equivalent concepts in any CI/CD platform.

**Canonical integration snippets** — copy-pasteable inline steps for GitHub Actions, Azure DevOps, Jenkins, GitLab CI, and a generic shell pattern — live in [`ci-cd-integration.md`](./ci-cd-integration.md). The SAD keeps a single reference example below to anchor the wire contract; the integration guide is the canonical place for per-tool detail.

#### GitHub Actions — reference inline step

```yaml
- name: Notify Deployment Dashboard
  run: |
    curl -sf -X POST "${{ secrets.DEPLOYMENT_DASHBOARD_URL }}/api/deployments" \
      -H "Content-Type: application/json" \
      -H "X-Api-Key: ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}" \
      -d '{
        "service":      "service-a",
        "environment":  "dev",
        "version":      "${{ github.sha }}",
        "status":       "success",
        "run_url":      "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
        "run_number":   ${{ github.run_number }},
        "actor":        "${{ github.actor }}"
      }'
```

**Composite action option** — `org/deployment-dashboard/.github/actions/notify@main` provides a reusable wrapper; see [`ci-cd-integration.md` § GitHub Actions](./ci-cd-integration.md#github-actions) for the input schema.

**Other tools.** Azure DevOps (PowerShell task), Jenkins (declarative pipeline), GitLab CI, and a generic shell snippet are documented in [`ci-cd-integration.md`](./ci-cd-integration.md). Every CI/CD platform exposes equivalents for `run_url`, `run_number`, and `actor`.

**`deployment_status` webhook (no workflow changes):** GitHub fires a `deployment_status` event automatically when a deployment status is created. A lightweight webhook receiver endpoint maps the GitHub payload to the dashboard schema and calls `POST /api/deployments`.

**Secrets required:**

| Secret | Value |
|---|---|
| `DEPLOYMENT_DASHBOARD_URL` | Base URL of the dashboard (e.g. `https://dashboard.internal.company.com`) |
| `DEPLOYMENT_DASHBOARD_TOKEN` | API key for write access |

---

### Data Model

#### `deployments` table

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment surrogate key |
| `service` | TEXT | Service identifier (`service-a`, `service-b`, …) |
| `environment` | TEXT | Environment identifier (`dev`, `qa`, `uat`, `prod`, …) |
| `version` | TEXT | Semantic version or any string |
| `status` | TEXT | `in-progress` / `success` / `failure` |
| `run_url` | TEXT | Link to the CI/CD run |
| `run_number` | INTEGER | CI/CD run number |
| `actor` | TEXT | Username that triggered the run |
| `deployed_at` | DATETIME | UTC timestamp of the event |

**Retention:** old rows are pruned by a background job. The retention window is configurable via the `HISTORY_RETENTION_DAYS` environment variable (default: `365`). The pruning job runs once per day and deletes rows where `deployed_at < NOW() - HISTORY_RETENTION_DAYS days`.

**Current matrix behaviour:** the matrix always shows the **most recent deployment per slot regardless of status** — a failed deployment replaces the previous entry in the matrix view. This matches the mockup behaviour and gives an accurate picture of what was last attempted, with the status badge (success / failed / running) communicating the outcome.

**Indexes:**

| Index | Purpose |
|---|---|
| `(service, environment, deployed_at DESC)` | Matrix query — latest per slot. |

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

### API Contract

The API follows REST principles: resource-oriented URIs, standard HTTP methods, stateless interactions, and meaningful HTTP status codes. No server-side session state is held between requests.

| Method | Path | Success | Description |
|---|---|---|---|
| `POST` | `/api/deployments` | `201 Created` | **Write — CI/CD only.** Auth-gated by `X-Api-Key`. Record a new deployment event; body returns the created resource. Not invoked by the SPA. Accepts optional request header `X-Progress-Reporter` (≤ 64 chars, non-whitespace) — per [CR-0009](cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md); when present, persisted on the event row and surfaced on Read responses. |
| `GET` | `/api/deployments` | `200 OK` | Return current matrix (latest entry per service+environment). No auth. |
| `GET` | `/api/deployments/{service}/{environment}` | `200 / 404` | Return the current state for one slot. No auth. |
| `GET` | `/api/deployments/{service}/{environment}/history` | `200 / 404` | Return last N events for a slot (`?limit=50` default). No auth. |
| `GET` | `/api/environments` | `200 OK` | Return distinct environment list derived from stored data. No auth. |
| `GET` | `/api/services` | `200 OK` | Return distinct service list derived from stored data. No auth. |
| `GET` | `/api/stream` | `200 text/event-stream` | SSE stream; supports `Last-Event-ID` for reconnection. Emits slot-update events. No auth. |
| `GET` | `/api/fetcher/state/{source-id}` | `200 / 404` | **Write group — pull-mode adapter only** (added by [CR-0009](cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md)). Auth-gated by `X-Api-Key`. **Requires** request header `X-Progress-Reporter` (≤ 64, non-whitespace) — identifies which pusher's cursor to read. Returns the opaque cursor blob for `(progress_reporter, source-id)`, or `404 Not Found` if no state exists yet. Response body: `{ "cursor": "<string>", "updated_at": "<iso-8601 UTC>" }`. |
| `PUT` | `/api/fetcher/state/{source-id}` | `200 / 422` | **Write group — pull-mode adapter only** (added by [CR-0009](cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md)). Auth-gated by `X-Api-Key`. **Requires** request header `X-Progress-Reporter` (≤ 64, non-whitespace). Upserts the opaque cursor for `(progress_reporter, source-id)`. Body: `{ "cursor": "<string, ≤ 4096>" }`. `422` on missing / over-cap cursor or missing / over-cap header. Returns the canonical response shape of the GET. |
| `GET` | `/health` | `200 OK` | Liveness probe (`{"status": "ok"}`). No auth. |
| `GET` | `/` | `200 OK` | Serve dashboard HTML. No auth. |

**REST constraints observed:**
- **Stateless** — every request contains all information needed to process it; no session cookies, no server-side state
- **Uniform interface** — `POST` to create, `GET` to read; no RPC-style verbs in URIs
- **Resource-oriented URIs** — `/api/deployments/{service}/{environment}` identifies a specific deployment slot as a resource
- **Meaningful status codes** — `201` on create, `401` on missing/invalid API key, `404` when a slot has no history, `422` on invalid payload

**POST `/api/deployments` request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `service` | string | yes | Service identifier (matches the `service` column). |
| `environment` | string | yes | Environment identifier. |
| `version` | string | yes | Semantic version or any string. |
| `status` | string | yes | One of `in-progress`, `success`, `failure`. |
| `run_url` | string | yes | Link to the CI/CD run. |
| `run_number` | integer | yes | CI/CD run number. |
| `actor` | string | yes | Username that triggered the deploy. |

**Matrix response shape — per service:**

The top-level response is a dictionary keyed by service. Each service entry contains a per-environment map.

```json
{
  "service-a": {
    "envs": {
      "dev": {
        "current": {
          "version": "v2.3.2",
          "status": "in-progress",
          "run_url": "https://github.com/org/repo/actions/runs/1251",
          "run_number": 1251,
          "actor": "john.doe",
          "deployed_at": "2026-05-14T14:34:00Z"
        },
        "lastSuccessful": {
          "version": "v2.3.1",
          "run_url": "https://github.com/org/repo/actions/runs/1247",
          "run_number": 1247,
          "actor": "john.doe",
          "deployed_at": "2026-05-14T12:30:00Z"
        },
        "previousFailed": false
      }
    }
  }
}
```

Field rules:

- `lastSuccessful` is `null` when `current.status === "success"` (they are the same event) or when no successful deployment has ever occurred for this slot. `previousFailed` is `true` when `current.status === "in-progress"` and the most recent *terminal* deployment was a failure.

**SSE `slot-update` data payload:**

`GET /api/stream` emits events shaped as below. The inner `state` object is the exact per-slot shape from `GET /api/deployments` — clients patch their store with identical data from either endpoint without re-deriving `lastSuccessful` / `previousFailed` on the wire.

```json
{
  "service":     "service-a",
  "environment": "dev",
  "state": {
    "current":        { "version": "v2.3.2", "status": "in-progress", "run_url": "https://github.com/org/repo/actions/runs/1251", "run_number": 1251, "actor": "john.doe", "deployed_at": "2026-05-14T14:34:00Z" },
    "lastSuccessful": { "version": "v2.3.1", "run_url": "https://github.com/org/repo/actions/runs/1247", "run_number": 1247, "actor": "john.doe", "deployed_at": "2026-05-14T12:30:00Z" },
    "previousFailed": false
  }
}
```

The API's read surface derives `state` for the affected slot on every NOTIFY using the same logic as the matrix endpoint, so the per-slot wire shape is identical between REST and SSE.

---

### Infrastructure

#### Local Development

**Containers — three images, three Dockerfiles**

Each component has its own multi-stage Dockerfile. The API container serves JSON only — it does **not** bundle the SPA. The SPA is shipped in its own nginx container, and all back-end containers sit behind the App Gateway. `backend/api/Dockerfile` is the only API Dockerfile, and `backend/write-api/` + `backend/read-api/` are library projects with no Dockerfile of their own.

| Image | Source path | Notes |
|---|---|---|
| `deployment-dashboard/api` | `backend/api/` | SDK build → aspnet:10.0 runtime; EXPOSE 8080. Single host composing Write + Read endpoint groups; API-key middleware scoped to the write group only (`MapGroup("/api").RequireApiKey()`), read group unauthenticated. SSE handler in the read group. |
| `deployment-dashboard/dashboard` | `frontend/dashboard/` | `node:22-alpine` runs `ng build dashboard` → copies output into `nginx:alpine` and serves it on port 80 with HTML5 history fallback to `index.html`. |
| `deployment-dashboard/gateway` | `gateway/` | `nginx:alpine`; `nginx.conf` declares the routing matrix and SSE pass-through tuning. EXPOSE 80. **The only image with public ingress.** |

Conventional environment variables on the API container: `ConnectionStrings__DefaultConnection`; `API_TOKEN` (the key required on `X-Api-Key` for write-group endpoints); `HISTORY_RETENTION_DAYS` (consumed by the pruning job).

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
    expose: ["8080"]                   # internal only — Write + Read surfaces co-hosted
    environment:
      ConnectionStrings__DefaultConnection: "Host=db;Database=dashboard;Username=dashboard;Password=local-dev-password"
      API_TOKEN: "local-dev-token-not-for-production"     # required for X-Api-Key on write-group endpoints
      HISTORY_RETENTION_DAYS: "365"                       # consumed by the pruning job
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

**GitHub Actions secrets** — see §7 "CI/CD Integration → Secrets required" (above) for the canonical table.

#### Azure Deployment

**Infrastructure Diagram**

```
┌─── Azure ──────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─── Azure Container Registry ───────────────────────────────────────┐   │
│  │  deployment-dashboard/gateway:latest                                │   │
│  │  deployment-dashboard/dashboard:latest                              │   │
│  │  deployment-dashboard/api:latest                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                    ↑ pull images                                            │
│  ┌─── Azure Container Apps Environment ────────────────────────────────┐   │
│  │                                                                      │   │
│  │  ┌──────────────────────┐                                            │   │
│  │  │  App Gateway          │  ◄── ONLY public ingress (NFR-04)         │   │
│  │  │  nginx:alpine         │                                           │   │
│  │  │                       │                                           │   │
│  │  │                       │  routes per §7 Components → App Gateway   │   │
│  │  │                       │                          → Routing matrix │   │
│  │  │                       │                                           │   │
│  │  └──┬─────────────────────────────┬─────────────────────────────┘   │
│  │     │                             │                                    │   │
│  │     ▼                             ▼                                    │   │
│  │  ┌────────┐    ┌──────────────────────────────────────────────┐    │   │
│  │  │ Dashb. │    │  API (single host, two endpoint groups)       │    │   │
│  │  │ nginx +│    │  ASP.NET 10 — backend/api/                    │    │   │
│  │  │ Angular│    │   • Write — POST ingest + NOTIFY, API-key     │    │   │
│  │  │ static │    │     gated (scoped to write group only)        │    │   │
│  │  │ intern.│    │   • Read — matrix / history / discovery /     │    │   │
│  │  │        │    │     SSE / health, LISTEN; unauthenticated     │    │   │
│  │  │        │    │  internal                                     │    │   │
│  │  └────────┘    └──────────────────────┬───────────────────────┘    │   │
│  │                                       │                                │   │
│  └───────────────────────────────────────┼────────────────────────────────┘   │
│                            writes + NOTIFY / queries + LISTEN                 │
│                                          ↓                                    │
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

All three container apps share a **single** Azure Container Apps Environment on the **Consumption** plan, which is scale-to-zero by default — adding more small apps does not add fixed overhead. Total compute cost is dominated by vCPU-seconds × memory-seconds × request count, not by container count. The gateway and the dashboard containers in particular are static-only and idle the vast majority of the time, so their marginal cost on Consumption is close to zero.

| Logical component | Azure resource | SKU | Est. monthly cost |
|---|---|---|---|
| App Gateway + Dashboard + API (3 apps, 1 environment — Write + Read API services co-located in `deployment-dashboard-api`, packaging choice per [ADR-0006](adr/ADR-0006-microservices-architecture-with-container-co-location.md) / co-location mechanics-of-record in [ADR-0002](adr/ADR-0002-modular-monolith-consolidation.md), trimming per-app fixed overhead) | Azure Container Apps Environment + 3 Container Apps | Consumption (scale-to-zero) | ~$2–5 combined |
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
- **Write endpoint requires a static API key** — prevents arbitrary parties from injecting fake deployment records (FR-10). Read endpoints are unauthenticated by design.
- The API key is stored as a GitHub Actions secret, not in workflow files or source code.
- **PostgreSQL:** credentials passed via environment variable, never in source code or image; stored in Azure Key Vault in the target architecture.
- **Authentication is out of scope for the dashboard itself.** If read-endpoint access control is required, it should be delegated to an infrastructure-level sidecar or ambassador (e.g. OAuth2 Proxy, nginx auth_request, Azure API Management) placed in front of the container. The dashboard has no user identity model.

**`API_TOKEN` provisioning by deployment mode.** The middleware contract is the same in every deployment (one static `X-Api-Key` value gates the Write endpoint group); the *origin* of the value differs:

| Deployment mode | `API_TOKEN` origin |
|---|---|
| Local-dev (contributor) | `local-dev-token-not-for-production` literal, hard-coded in `dev_env/docker-compose.local.yml`. Internal-only, never accepted in any release deployment (defence-in-depth: the release-install path refuses this literal as `API_TOKEN`, regenerating if `./dashboard.env` is ever found to contain it). |
| Release-install (per GitHub issue [#7](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/7)) | Random 32-byte hex generated by the installer on first install (or read from `$env:DASHBOARD_API_TOKEN` if user supplies). Persisted to `<InstallDir>/dashboard.env` next to the release compose file. Printed once in the URL panel. Pre-existing `./dashboard.env` is reused on re-install when the value is non-empty and not the dev-literal. |
| Azure / target architecture (NFR-01 + NFR-06) | Azure Key Vault, referenced from the ACA app definition by `secretRef`. Terraform §4 provisions the Key Vault entry; the value is never present in the image, the compose file, or the workflow YAML. |

The three modes share **no token value** — a release-install token is randomly generated per install and never the dev literal; the Azure token is Key Vault-managed and never the release-install value. This split keeps the dev literal compromisable without leaking any prod token, the release-install token recoverable from `<InstallDir>/dashboard.env` without an Azure dependency, and the Azure token within the existing Key Vault governance boundary.

---

## 9. Phasing

### MVP — Web Dashboard

| Item | Scope |
|---|---|
| Backend API | `POST /api/deployments`, `GET /api/deployments`, `GET /api/environments`, history endpoint, SSE stream, health |
| Storage | PostgreSQL |
| Frontend | Angular 20 SPA — pipeline matrix, status badges, history drawer, version highlight, live SSE updates |
| Ingest | HTTP call (`curl` or equivalent) from any CI/CD pipeline (GitHub Actions, Azure DevOps, Jenkins, etc.) |
| Container | Three Docker images — API (single host composing Write + Read endpoint groups), Dashboard Frontend (Angular SPA), App Gateway |
| Config | `ConnectionStrings__DefaultConnection`, `API_TOKEN`, `HISTORY_RETENTION_DAYS` (default 365) |

**Definition of Done:**  
A developer can open the dashboard URL and see every service's current version per environment, updated within 30 seconds of a deployment completing.

### CI/CD Integration

Two distinct tracks: **inbound** integration (how third-party CI/CD pipelines push events into the dashboard's ingest API) and **outbound** component CI (how the dashboard's own four container images are built, tested, and published). The two tracks share nothing operationally; they are documented together because both touch SAD §7's CI/CD surface.

**Inbound — third-party pipelines push to the dashboard.**

| Item | Scope |
|---|---|
| Inline HTTP step | Shell/script snippet documented and tested for each CI/CD tool in use (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, etc.) |
| GitHub Actions composite action | Optional reusable `action.yml` for GitHub Actions users — define once, reference in every workflow |
| Webhook receiver | Optional lightweight endpoint to translate CI/CD webhook payloads (e.g. GitHub `deployment_status`) to the dashboard schema |
| **Pull-mode fetcher (optional, [CR-0009](cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md))** | `Dashboard.Fetcher` library + `Dashboard.Fetcher.Host` Worker + GitHub Actions adapter + Dockerfile + opt-in `docker-compose.local.yml --profile fetcher` entry + `X-Progress-Reporter` header on `POST /api/deployments` (also additively available to every other pusher) + `GET`/`PUT /api/fetcher/state/{source-id}` cursor endpoints + ACR image publish. ACA + Terraform wiring deferred — see CR-0009 § 3d. |
| Secrets | `DEPLOYMENT_DASHBOARD_URL` and `DEPLOYMENT_DASHBOARD_TOKEN` configured in each pipeline's secret store |

**Definition of Done — inbound:**  
Every active deployment pipeline sends a notify event to the ingest API on deploy. The matrix reflects real deployment data within 30 seconds of a deployment completing.

**Outbound — the dashboard's own four images are built + published.** Locked by [CR-0010](cr/CR-0010-component-ci-pipeline.md); operational guide [`docs/ci-cd-pipelines.md`](./ci-cd-pipelines.md). One reusable workflow + four thin callers; container images only (no NuGet, no npm); GHCR today, ACR-cutover one-input swap when WBS §4 lands.

| Workflow | Triggers | Outputs |
|---|---|---|
| `.github/workflows/api.yml` | `push: branches[main] / tags[v*]`, `pull_request: branches[main]`, `workflow_dispatch` | image `ghcr.io/<owner>/deployment-dashboard-api:<tags>`; backend coverage artefact (cobertura + trx); EF migration SQL artefact (`ef-migrations-script-<sha>`, 90-day retention) |
| `.github/workflows/fetcher.yml` | (same trigger set) | image `ghcr.io/<owner>/deployment-dashboard-fetcher:<tags>`; backend coverage artefact (fetcher tests only) |
| `.github/workflows/frontend.yml` | (same trigger set) | image `ghcr.io/<owner>/deployment-dashboard-frontend:<tags>`; frontend coverage artefact (cobertura per project ×4); mockup-visual report (+ traces on failure) |
| `.github/workflows/gateway.yml` | (same trigger set) | image `ghcr.io/<owner>/deployment-dashboard-gateway:<tags>` (build only — gateway is config-only nginx, no tests) |
| `.github/workflows/_build-and-push-image.yml` | reusable (`workflow_call`) — `build-kind: dotnet \| static` | invoked by the four callers above; never invoked directly |

Tag rules per CR-0010 § 3e: `sha-<7>` always, `latest` on default-branch push, `pr-<N>-sha-<7>` on PR (built not pushed), `vX.Y.Z` + `vX.Y` on tag push. PR runs build + test only — no push.

**Definition of Done — outbound:**  
A push to `main` produces four green workflow runs that publish four images to GHCR with deterministic tags; PR runs gate merge on build + test; the EF migration SQL is captured as a workflow artefact on every `api.yml` run for downstream CD consumption.

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
| 6 | Push vs pull data model? | **Push-by-default with optional pull-mode adapter** (per [CR-0009](cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md)). The backend itself remains push-only — it exposes `POST /api/deployments` and never queries any CI/CD tool's API. Callers are responsible for sending a correctly shaped payload. For environments where the CI/CD pipeline cannot invoke the ingest endpoint directly, an **optional, out-of-process `Dashboard.Fetcher` component** (separate container, opt-in deployment) MAY poll the CI/CD tool's API and push events to the same ingest endpoint like any other pusher — using the same `X-Api-Key` and setting `X-Progress-Reporter: dashboard-fetcher/<adapter-id>` for attribution. The backend's tool-agnostic contract is preserved because the fetcher reuses the push endpoint and the universal pusher-attribution header; no CI/CD-specific SDK is ever added to the backend. See SAD §7 "Dashboard.Fetcher (optional pull-mode adapter)" + [ADR-0004](adr/ADR-0004-opaque-per-progress-reporter-cursor.md) (cursor + adapter shape decisions). |
| 7–11 | Topology correlation scope; SSE topology delivery; dangling parent_deployments; ref/sha validation strictness; single vs split backend container | **Moved out of the initial SAD.** Decisions 7–9 → `docs/cr/CR-0003`. Decision 10 → `docs/cr/CR-0004`. Decision 11 → `docs/adr/ADR-0002`. See those documents for the verbatim decision text. |
