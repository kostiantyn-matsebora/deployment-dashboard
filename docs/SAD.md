# Solution Architecture Document — Deployment Dashboard

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

- Show a real-time:
  - **services × environments deployment matrix**
  - **graph of deployments of different environments per service**
  
  sourced from CI/CD pipeline events (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, or any tool that can make an HTTP POST)

- Show a real-time **graph of deployments of different environments per service* 
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
| FR-05 | The system shall receive deployment events through a push-based HTTP ingest API |
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

---

## 6. Constraints

- **Hosting platform:** Azure only — all infrastructure must run on Microsoft Azure.
- **Budget:** ≤ $30/month total (compute + database + storage combined).
- **Network:** The system is deployed inside the organisation's internal network or a private Azure-hosted container; it is not publicly accessible.
- **Technology stack:** Angular 20+ for the frontend; .NET 10 for all backend components.
- **Platform agnosticism:** The solution must not depend on any proprietary cloud compute model (e.g. serverless Functions). All backend components must be deployable as standard containerised applications on any OCI-compliant container host.

---

## 7. Target Architecture

The project is a **microservices architecture** — Write API, Read API, Fetcher (optional), Frontend SPA, and App Gateway are distinct services with distinct concerns, decomposed at the project + boundary level.

> 1. **Microservices architecture.** Write API, Read API, Fetcher, Frontend SPA, and App Gateway are distinct services with distinct concerns. Decomposition at the project + boundary level.

> 2. **Separation of concerns (CQRS) consolidation in container** write and read api separated as two different components but consolidated as container.


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

**Optional pull-mode ingest edge** — When push-mode integration is not available, an opt-in fetcher component polls a CI/CD tool's API and pushes events through the same gateway like any other pusher:

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


#### CI/CD Notify Step

A pipeline step that pushes deployment state to the API (see Summary row for context).


#### Dashboard Backend — Write and Read API services (co-located)

Write and Read are **distinct microservices** with distinct concerns, **co-located** in one stateless ASP.NET Core container.

| Attribute | Value |
|---|---|
| Language | C# / .NET 10 |
| Framework | ASP.NET Core Minimal API |
| ORM | EF Core 10 + Npgsql |
| Storage | PostgreSQL (production and local dev); SQLite in-memory (unit tests only) |
| Scalability | Horizontal — stateless; multiple instances behind a load balancer; the host scales as a whole today (surfaces co-located, independently scalable only after a future split) |
| Container | All C4 containers are running as docker containers |

**Statelessness constraints (required for horizontal scaling):**

| Concern | How the API host satisfies it |
|---|---|
| Caching | No in-memory cache of deployment state between requests — every read hits the database. |
| Real-time fan-out | No in-process fan-out across instances — events brokered via PostgreSQL `LISTEN/NOTIFY`. Each API instance independently `LISTEN`s on the `deployments` channel and forwards events to its own connected SSE clients. |
| Session affinity | No sticky sessions — load balancer may route any request to any instance. SSE connections are long-lived but reconnect transparently via `Last-Event-ID`. |

**Responsibilities:**

- Write surface — accept and persist deployment events; NOTIFY the PostgreSQL `deployment_events` channel on every successful ingest.
- Read surface — serve the unique services and feeds of events per service.
- Read surface — stream real-time slot-update events via SSE using PostgreSQL `LISTEN`.

**Why a gateway (vs. CORS + multiple origins):**
- Eliminates CORS entirely — the browser only ever sees one origin.
- Minimises the public surface — only one container in NFR-04's internal-only network has ingress.
- One ACA app gets public ingress in Azure; the others stay internal.
- The SPA and CI/CD callers are upstream-agnostic — they hit one URL.

### Dashboard Frontend (MVP)

Angular 20 SPA in its own nginx container; reached only via the App Gateway. Attributes below.

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

Box shows all attributes (except synthetic) belongs to deployment event model, with ability to configure by user set of attributes shown.

#### Views

- Graph of deployments placed one under another, consolidating graphs of Github workflows for different services to one view.
- Services × environments deployment matrix.

### CI/CD Integration

The ingest API is the sole integration point. Any CI/CD tool that can make an HTTP POST request can send deployment events — no CI/CD-specific SDK, plugin, or webhook infrastructure is required. The dashboard has no dependency on any particular build system and does not query any CI/CD tool.

### Domain Model

#### Deployment event

| Attribute | Type | Required | Description |
|---|---|---|---|
| `id` | GUID  | TRUE | Unique synthetic identifier |
| `component` | STRING | TRUE | Component (service/application) identifier |
| `environment` | STRING | TRUE | Environment identifier  |
| `version` | STRING | FALSE | Version of service  |
| `status` | ENUM | TRUE| `in-progress` / `success` / `failure` |
| `run_url` | STRING | FALSE| Link to the CI/CD run |
| `sha` | STRING | FALSE| Unique identifier of commit |
| `run_number` | STRING | FALSE| CI/CD run identifier |
| `ref` | STRING | FALSE | Branch or PR number
| `actor` | STRING | FALSE| Username that triggered the run |
| `happened_at` | DATETIME | TRUE | UTC timestamp of the event |
| `parrent_deployments` | GUID[] | FALSE | References to parent deployments |

#### Retention

Old rows are pruned by a background job. The retention window is configurable via the `HISTORY_RETENTION_DAYS` environment variable (default: `365`).

The pruning job runs once per day and deletes rows where `happened_at < NOW() - HISTORY_RETENTION_DAYS days`.
