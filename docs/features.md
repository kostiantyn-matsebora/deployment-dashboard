---
title: Features
nav_order: 4
description: What the dashboard does and the user-visible surfaces it exposes.
---

# Features

The dashboard's user-visible surfaces grouped by concern. Each row cites the source-of-truth doc; this page is a map, not a restatement.

## Data ingestion

| Surface | Detail | Source |
|---|---|---|
| Write endpoint | `POST /api/deployments` — single endpoint for all upstream tools. API-key-gated (`X-Api-Key`) on the Write group only. | [architecture.md](architecture.html) §7, §8 |
| Payload contract | JSON envelope: `service`, `environment`, `version`, `status` ∈ `in-progress` / `success` / `failure`, `actor`, `run_url`, plus optional correlation fields. | [architecture.md](architecture.html) §7 wire format |
| Per-tool snippets | GitHub Actions, Azure DevOps, Jenkins, GitLab CI, generic curl — copy-paste pipeline-step examples. | [ci-cd-integration.md](ci-cd-integration.html) |
| Optional pull-mode fetcher | Worker that polls a CI/CD API and translates runs into `POST /api/deployments`. GitHub Actions today (CR-0009); extensible per adapter. | [CR-0009](cr/CR-0009-pull-mode-fetcher.html), [architecture.md](architecture.html) §7 fetcher block |
| Anonymous-mode transport | Fetcher omits the `Authorization` header entirely when `GHA_TOKEN` is empty or equals the compose-default placeholder — powers the zero-PAT demo path. | [ci-cd-integration.md](ci-cd-integration.html) § Anonymous-mode transport |

## Views and layouts

Four views x three layouts; switch from the header.

| | Matrix | Swim-lane | Workflow-rows |
|---|---|---|---|
| **Detailed** | Services x envs grid; full slot card with version + actor + time. | Per-service rows; full slot card per env cell. | Per-workflow rows; full slot card per env. |
| **Compact** | Same grid; reduced slot footprint. | Per-service rows; compact cells. | Per-workflow rows; compact cells. |
| **Glance** | Status-only cells (color + icon). | Per-service rows; status-only. | Per-workflow rows; status-only. |
| **Focus** | Single-slot foreground with peripheral dim. | Same focus mode, swim-lane orientation. | Same focus mode, workflow-rows orientation. |

View + layout choices are per-user, persisted in `localStorage` (no server-side preferences per CR-0002 / CR-0005 / CR-0006). View source: [`docs/ui/compact-options.md`](ui/compact-options.html), [`docs/ui/focus-layout-options.md`](ui/focus-layout-options.html).

## Box states

Six states; each communicated by colour + composition. The box is split into two sections by a dashed divider when a last-successful state differs from the current state — what is running *now* vs. what last worked.

| State | When | Visual |
|---|---|---|
| **Success** | Last deployment succeeded. | Full green box: version + actor + time. |
| **Running + Last Successful** | Deploying now; previous terminal was success. | Top: orange spinner + version. Bottom: last successful version. |
| **Running + Failed + Last Successful** | Deploying now; previous terminal was failure; an older success exists. | Top: orange spinner + ⚠ prev. failed badge. Bottom: last successful version. |
| **Failed + Last Successful** | Last deployment failed; an older success exists. | Top: red failed + version. Bottom: last successful version. |
| **Running** | Deploying now; no prior successful deployment. | Full orange spinning box: version only. |
| **Running + Failed** | Deploying now; previous terminal was failure; no successful history. | Top: orange spinner + ⚠ prev. failed badge; no bottom section. |

Source: [architecture.md](architecture.html) §7 "6 box states", binary visual contract at `docs/ui/deployment-dashboard.html`.

## Themes

Light / dark / auto (system-preference). Persisted in `localStorage`; FOIT-free bootstrap.

| Mode | Behaviour |
|---|---|
| Light | Force light palette. |
| Dark | Force dark palette. |
| Auto | Follows `prefers-color-scheme`; updates live on OS change. |

Source: [CR-0006](cr/CR-0006-theme-light-dark-auto.html), [ADR-0003](adr/ADR-0003-theme-persistence-foit-bootstrap.html), [`docs/ui/theme-options.md`](ui/theme-options.html).

## Real-time updates

| Surface | Detail |
|---|---|
| Wire | SSE (`GET /api/stream`) over Postgres `LISTEN/NOTIFY`. No polling on the read side. |
| Latency | Live updates ≤ 5 s after ingest (NFR-03). |
| Reconnection | SSE clients reconnect via `Last-Event-ID`; backend is stateless per replica (NFR-05). |
| Wire shape | Per-slot state delta — identical shape to `GET /api/deployments` so clients patch without re-deriving. Topology is NOT on the SSE wire (CR-0003). |

Source: [architecture.md](architecture.html) §7 (SSE + LISTEN/NOTIFY), [CR-0003](cr/CR-0003-no-topology-on-sse.html).

## History

| Surface | Detail |
|---|---|
| Slot history drawer | Per-slot timeline of deployment events with status + version + actor + time + run link. |
| Retention | ≥ 90 days enforced by daily pruning job; `HISTORY_RETENTION_DAYS` default 365 (NFR-07). |
| Backfill | Fetcher uses an opaque cursor for ordered backfill — never co-locates with the API (ADR-0004). |

Source: [architecture.md](architecture.html) §7 history endpoint, [ADR-0004](adr/ADR-0004-opaque-cursor-and-fetcher-non-co-location.html).

## Internal-tooling posture

| Aspect | Posture |
|---|---|
| Auth on Read group | None — internal read-only tooling (NFR-04). |
| Auth on Write group | Static `X-Api-Key` middleware applied only to `MapGroup("/api").RequireApiKey()`. |
| Ingress | Single nginx gateway on port 8080; **no public ingress required** in target Azure topology. |
| SPA secret posture | SPA never embeds the API key; writes are CI/CD/ops only (per project memory § SPA read-only principle). |
| RBAC | Out of scope (NFR-04). |

Source: [architecture.md](architecture.html) §8 (Security), bindings.md § Hard constraints.
