---
title: "ADR-0006: Microservices Architecture with Container Co-Location"
parent: ADRs
nav_order: 6
---

# ADR-0006 — Microservices architecture with container co-location of Write + Read API services

- **Status:** accepted (2026-05-19) — supersedes [ADR-0002](./ADR-0002-modular-monolith-consolidation.md).

- **Context.**

  The project's architecture has been described in several places (SAD §7, [ADR-0002](./ADR-0002-modular-monolith-consolidation.md), [`docs/WBS.md`](../WBS.md) §1.0 + §4.5, [`README.md`](../../README.md), [CR-0009](../cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md) and [CR-0010](../cr/CR-0010-component-ci-pipeline.md) cross-refs, the `.github/workflows/api.yml` header comment) as a **"modular monolith."** That framing is **misleading at the architectural level**.

  The system is decomposed at the **project and boundary level** into distinct services with distinct concerns:

  | Service | Concern | Project / library | Image |
  |---|---|---|---|
  | **Write API** | `POST /api/deployments`, `PATCH /api/config/topology`, `GET/PUT /api/fetcher/state/{source-id}`; API-key-gated; NOTIFY dispatch | `backend/write-api/Dashboard.WriteApi` | co-located in `deployment-dashboard-api` |
  | **Read API** | matrix, history, discovery, SSE stream, `/health`; unauthenticated; LISTEN-subscribed fan-out | `backend/read-api/Dashboard.ReadApi` | co-located in `deployment-dashboard-api` |
  | **Fetcher** | optional pull-mode adapter; CI/CD API polling; backend-held opaque cursor; `Microsoft.NET.Sdk.Worker` | `backend/fetcher-host/Dashboard.Fetcher.Host` (+ adapters) | `deployment-dashboard-fetcher` |
  | **Frontend SPA** | Angular 20 standalone + NgRx Signal Store + Tailwind; nginx static-serving runtime | `frontend/dashboard` (composes `@dd/matrix`, `@dd/drawer`, `@dd/shared`) | `deployment-dashboard-frontend` |
  | **App Gateway** | sole public ingress; path+method routing matrix; SSE pass-through tuning | `gateway/` | `deployment-dashboard-gateway` |

  That is a **microservices architecture** — each service owns its own contract surface, scaling envelope, and (for Fetcher / Frontend SPA / Gateway) its own image. The "modular monolith" label under-sells that decomposition.

  The packaging choice — Write API + Read API share one image (`deployment-dashboard-api`) for operational simplicity within the ≤ $30/month NFR-02 envelope — is **container co-location**, not "modular-monolith-as-an-architecture." Conflating the two produced ~15 documents claiming the **backend** is a modular monolith, which:

  - over-couples the co-location packaging choice to the architectural identity,
  - obscures the per-service boundaries that engineers in fact respect when adding endpoints (Write endpoint group vs Read endpoint group; FR-10 auth boundary; FR-08 statelessness preserved per-service),
  - reads as a regression from "microservices" rather than a deliberate packaging optimisation within an already-microservices design,
  - makes the future-split discussion harder than it needs to be (the project is *already* microservices at the boundary level; the future change is "stop co-locating two of the services," not "split a monolith").

  The **frontend** Angular workspace's "modular monolith" framing in `frontend/README.md` and `frontend/package.json` is a **different concept** (Angular libraries pattern — `@dd/matrix`, `@dd/drawer`, `@dd/shared` composed into the `dashboard/` application shell, intra-application module boundaries) and is **not** affected by this ADR. ADR-0006 only reframes the backend-architecture claim.

  Constraints (all unchanged from ADR-0002 — restated here so the new framing makes the constraint-set explicit):

  - **NFR-02 (≤ $30/month).** Three ACA container apps (`deployment-dashboard-gateway`, `deployment-dashboard-frontend`, `deployment-dashboard-api`) on the Consumption plan, plus the optional `deployment-dashboard-fetcher` when enabled. Co-locating Write + Read in one image stays comfortably inside the cap.
  - **NFR-05 (stateless backend across replicas).** Each instance of `deployment-dashboard-api` independently `LISTEN`s on the PostgreSQL `deployments` channel. No sticky sessions; no in-process cross-instance fan-out. Co-location does not introduce shared in-memory state between Write and Read.
  - **FR-10 (write-only auth).** API-key middleware applied **only** to the Write endpoint group (`MapGroup("/api").RequireApiKey()`); Read group unauthenticated. The per-service auth boundary survives co-location.
  - **Future-split affordance must remain cheap.** When (if) a traffic-shape, cadence, or security signal justifies it, splitting `deployment-dashboard-api` into a separate Write-host image and Read-host image must be a host-project + gateway-config change — not a code rewrite.

- **Decision.**

  > **Architecture: microservices.** Distinct services with distinct concerns — Write API, Read API, Fetcher, Frontend SPA, Gateway. Decomposition at the project + boundary level.
  >
  > **Deployment: container co-location.** Write API + Read API share one image (`deployment-dashboard-api`) for operational simplicity. Fetcher / Frontend / Gateway each have their own image. **Co-location is a packaging choice, not the architecture itself.**

  The wire contracts, project boundaries, scaling envelopes, and security boundary established by ADR-0002 survive verbatim. The future-split mechanics defined in ADR-0002 (host-project + gateway-config-only change) are unchanged — they are now framed as moving Write API and Read API from co-location to per-service deployment **within the same microservices architecture**, not as "splitting a monolith."

  **Canonical north-star phrasing** for the SAD and any doc that needs a one-line architectural statement:

  > Microservices architecture; container co-location of Write + Read API services is a packaging choice.

  **Cross-ref replacement guidance** for documents previously saying "modular monolith (per ADR-0002)":

  | Original framing | Replacement |
  |---|---|
  | "the backend is a modular monolith (per ADR-0002)" | "Write + Read API services are co-located in one container image (`deployment-dashboard-api`) per ADR-0006" |
  | "modular monolith — single API container hosting two library surfaces" | "two API services (Write, Read) co-located in one container image; one ASP.NET Core host composing two library surfaces" |
  | "per ADR-0002" (where the citation is about the **co-location mechanics**: single Dockerfile, single ACA target, project graph, future-split mechanics) | **keep** the ADR-0002 reference — those mechanics survive; ADR-0006 reframes, ADR-0002 retains the mechanics-of-record |
  | "per ADR-0002" (where the citation is about the **architectural framing**: "the system IS a …") | repoint to ADR-0006 |

- **Consequences.**

  - **Zero code change.** No new project, no project-reference rewiring, no new Dockerfile, no new ACA target, no migration. `backend/api/` host still references `backend/write-api/`, `backend/read-api/`, `backend/shared/`. `backend/api/Dockerfile` remains the only API Dockerfile. The single `api:8080` upstream in `gateway/nginx.conf` remains the only API upstream. CI workflows (`.github/workflows/api.yml`) build one image (`deployment-dashboard-api`), unchanged.
  - **Zero infra / IaC change.** Three container apps + one environment on Azure Container Apps Consumption plan. The cost table in SAD §7 → Azure Container Apps does not change.
  - **Zero security-surface change.** API-key middleware stays scoped to the Write endpoint group (`MapGroup("/api").RequireApiKey()`); the Read group stays unauthenticated; FR-10 / SAD §8 unchanged.
  - **Conceptual change — doc-only.** Documents are updated to use "microservices architecture with container co-location" or context-shortened forms where they previously said "modular monolith." ADR-0006 is the cited framing source; ADR-0002 is cited for the surviving mechanics (co-location specifics, future-split trigger table, project-reference rules, the Decision 11 verbatim text it absorbed from the initial SAD).
  - **ADR-0002 status flips to superseded.** Body preserved as historical record so older PRs / commits / cross-refs referencing ADR-0002 still resolve. Decision 11's verbatim text (which ADR-0002 absorbed out of the initial SAD's §10) stays in ADR-0002, since it is the historical record of the co-location decision — it doesn't need to move into ADR-0006.
  - **Future split is unchanged.** Same mechanics, now framed correctly: it's a packaging change (co-location → per-service-image), not an architectural change (microservices → microservices). The trigger conditions table in ADR-0002 remains the live reference for *when* to do it.
  - **The C4 component diagram is unchanged.** Ingest API / Read API / Real-time Hub / Deployment Store / App Gateway / Dashboard Frontend / Fetcher were always distinct components. The diagram has always reflected the microservices boundary; only the prose narration around it was misframed.
  - **Frontend "modular monolith" wording stays.** `frontend/README.md` and `frontend/package.json` describe the Angular workspace (libraries pattern), a different concept. Out of scope for ADR-0006.

- **Alternatives considered.**

  | Option | Rejected because |
  |---|---|
  | **Amend ADR-0002 in place.** Rewrite the title + decision text in ADR-0002 to use "microservices + co-location" framing; no new ADR. | The framing change is significant — it touches the architectural identity claim, not a mechanics detail. A superseding ADR makes the correction visible in the ADR index (`docs/adr/README.md`) as a discrete entry with its own audit trail. Engineers searching for "why does the project use this framing" land on ADR-0006 directly instead of needing to read ADR-0002's revision history. |
  | **Drop "modular monolith" wording everywhere without a paired ADR.** Search-and-replace the ~15 docs; cite no ADR for the new framing. | Cross-refs to ADR-0002 already exist in five other docs (SAD §7 invariants block, ADR-0004 Context + Decision 3 + References, ADR-0005 References, CR-0009 References, CR-0010 References, WBS §1.0 + §4.5). Removing the framing source without a replacement ADR leaves dangling pointers to a framing the project has implicitly abandoned. The replacement framing needs an ADR of record. |
  | **Keep "modular monolith" framing; explain why it's actually-microservices in a footnote.** | Compounds the confusion. The label is what shows up in skim-reads and in the SAD §7 invariants header. Footnotes do not propagate through index extracts (`adr-index.idx`, `repo-map.idx`) or framework metadata (`stack.yaml`, `framework.config.yaml`). |

- **References.**

  - [ADR-0002](./ADR-0002-modular-monolith-consolidation.md) — the superseded decision; its body remains the historical record of the co-location choice and the future-split mechanics. ADR-0006 reframes the architectural claim around ADR-0002 without invalidating any of its mechanics.
  - SAD §7 "Target Architecture" — receives the corrected invariants block citing ADR-0006.
  - SAD §7 "Backend module architecture" + "Future split — trigger conditions" — still live, still cite ADR-0002 for the mechanics-of-record.
  - SAD §7 "App Gateway" routing matrix — still cites ADR-0002 for the "single `api:8080` upstream today; matrix preserves the path+method discrimination for a future re-split" framing (mechanics-of-record).
  - SAD §7 Azure Container Apps cost table — still cites ADR-0002 for the "3 apps, 1 environment — consolidated from 4 per ADR-0002" historical note.
  - SAD §10 Decision 11 — verbatim text absorbed into ADR-0002 §"Decision 11"; survives unchanged.
  - [`docs/adr/README.md`](./README.md) — ADR index; receives a new ADR-0006 row and the ADR-0002 row flips to `superseded by ADR-0006`.
  - [`docs/WBS.md`](../WBS.md) §1.0 + §4.5 — receives the corrected framing for the backend-host item and the future-split-affordance note.
  - [`README.md`](../../README.md) — receives the corrected one-paragraph framing in the architecture-pointer block.
  - [`.github/workflows/api.yml`](../../.github/workflows/api.yml) header — comment-only update; swap "modular monolith host" for "co-located API host (write + read services per ADR-0006)."
  - [`.agents/ginee/local/*`](../../.agents/ginee/local/) — framework metadata: `bindings.md`, `project-profile.md`, `framework.config.yaml`, and the extracted indexes (`stack.yaml`, `repo-map.idx`, `adr-index.idx`, `manifest.yaml`).
  - Framing-correction conversation — user identified the long-standing misframing on 2026-05-19; this ADR closes the loop.
