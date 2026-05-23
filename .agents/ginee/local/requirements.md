# Requirements register - Deployment Dashboard

**Seeded:** 2026-05-23 by `team-lead` (rediscovery, D25 initialization).
**Source:** `docs/architecture.md` §4 (FRs), §5 (NFRs), §6 (Constraints).
**Owner:** `solution-architect` (semantics). Updates land via CR per `docs/cr/` -> `team-lead` authors -> SA applies the diff.

## Functional Requirements (FRs)

What the system must do - user-visible behaviour, business logic, integration contracts.

| ID | Requirement | Source | Status |
|---|---|---|---|
| `FR-001` | Display a real-time deployment matrix organised by service (one row per service), showing the current state of each (service, environment) slot. | `docs/architecture.md` §4 FR-01 | `Accepted` |
| `FR-002` | Each slot shall be capable of showing: version, status (success / in-progress / failure), actor, elapsed time since deployment, and a link to the CI/CD run. | `docs/architecture.md` §4 FR-02 | `Accepted` |
| `FR-003` | When the current state is in-progress or failed, the slot shall also show the last successfully deployed version in a split section below the current state. | `docs/architecture.md` §4 FR-03 | `Accepted` |
| `FR-004` | Maintain a full deployment history per slot and expose it on demand via a history drawer. | `docs/architecture.md` §4 FR-04 | `Accepted` |
| `FR-005` | Receive deployment events through a push-based HTTP ingest API (`POST /api/deployments`) accepting: service, environment, version, status, run URL, run number, and actor. | `docs/architecture.md` §4 FR-05 | `Accepted` |
| `FR-006` | Integrating the notify step shall require no changes to existing CI/CD pipelines beyond adding a single step. | `docs/architecture.md` §4 FR-06 | `Accepted` |
| `FR-007` | Support filtering by service name and by failure state only. | `docs/architecture.md` §4 FR-07 | `Accepted` |
| `FR-008` | All connected browser clients shall receive live updates when a new deployment event is ingested - no page reload required. | `docs/architecture.md` §4 FR-08 | `Accepted` |
| `FR-009` | Support any set of services and environments without hardcoded values; service and environment lists derived from stored data. | `docs/architecture.md` §4 FR-09 | `Accepted` |
| `FR-010` | The ingest API shall authenticate every write request with an API key; requests with a missing or invalid key rejected with HTTP 401. | `docs/architecture.md` §4 FR-10 | `Accepted` |
| `FR-011` | (v2.0) Desktop notification client shall alert developers via OS notifications when a deployment slot changes state, with a click-through to the dashboard. | `docs/architecture.md` §4 FR-11 | `Accepted` (v2.0 - WBS Phase 2.0) |

## Non-Functional Requirements (NFRs)

Quality attributes the system must satisfy - measurable, with explicit targets.

| ID | Quality attribute | Statement | Measure | Target | Source | Status |
|---|---|---|---|---|---|---|
| `NFR-001` | Hosting | All infrastructure shall run on Microsoft Azure. | Hosting cloud | Azure-only | `docs/architecture.md` §5 NFR-01 | `Accepted` |
| `NFR-002` | Cost | Total Azure infrastructure cost shall not exceed $30/month. | Monthly Azure invoice (compute + DB + storage) | <= 30 USD / mo | `docs/architecture.md` §5 NFR-02 | `Accepted` |
| `NFR-003` | Latency | Live updates shall be delivered to all connected clients within 5 seconds of a successful ingest event. | End-to-end ingest -> SSE delivery time | <= 5 s | `docs/architecture.md` §5 NFR-03 | `Accepted` |
| `NFR-004` | Security / Internal-only | Internal tooling - no public internet exposure required; SPA read-only against API; dev API key never embedded in SPA bundle. | Public-ingress presence | none required | `docs/architecture.md` §5 NFR-04 | `Accepted` |
| `NFR-005` | Scalability | Backend shall be stateless; any number of instances may run behind a load balancer without sticky sessions. | Replica count / sticky-session config | unbounded; no sticky | `docs/architecture.md` §5 NFR-05 | `Accepted` |
| `NFR-006` | Operability | All infrastructure shall be defined as code using Terraform. | IaC tool | Terraform azurerm >= 4.x | `docs/architecture.md` §5 NFR-06 | `Accepted` |
| `NFR-007` | Retention | Deployment history shall be retained for a minimum of 90 days per slot. | Per-slot history age floor | >= 90 days | `docs/architecture.md` §5 NFR-07 | `Accepted` |
| `NFR-008` | Usability | Dashboard shall load in a browser with no build step - no bundler or compilation required. | Browser build step | none | `docs/architecture.md` §5 NFR-08 | `Accepted` |
| `NFR-009` | Usability / UX-RESPONSIVENESS INVARIANT | Layout shall reflow correctly under any combination of: service count (1..N), env count per service (1..N), env-name length (1..32 chars), version-string length (1..50 chars), viewport width (>= 1024 px). No visual overlap; no clipping; no occlusion. | Visual-regression suite + manual matrix | zero overlap under all combos | `docs/architecture.md` §5 NFR-09; mirrored verbatim atop `docs/ui/mockups/deployment-dashboard.html` | `Accepted` |

**Quality-attribute categories present:** performance · scalability · cost · security · operability · retention · usability.

## Constraints

External or contextual limits the architecture must respect - technical, regulatory, organizational.

| ID | Type | Constraint | Rationale | Source | Status |
|---|---|---|---|---|---|
| `CON-001` | technical | Hosting platform: Azure only - all infrastructure must run on Microsoft Azure. | Single-cloud cost + ops envelope. | `docs/architecture.md` §6 | `Accepted` |
| `CON-002` | organizational | Budget: <= $30/month total (compute + database + storage combined). | Personal-project envelope. | `docs/architecture.md` §6 | `Accepted` |
| `CON-003` | organizational | Network: system deployed inside organisation's internal network or a private Azure-hosted container; not publicly accessible. | Internal-tooling posture. | `docs/architecture.md` §6 | `Accepted` |
| `CON-004` | technical | Technology stack: Angular 20+ for the frontend; .NET 10 for all backend components. | Maintainer skill set + ecosystem fit. | `docs/architecture.md` §6 | `Accepted` |
| `CON-005` | technical | Platform agnosticism: must not depend on proprietary cloud compute models (e.g. serverless Functions). All backend components deployable as standard containerised applications on any OCI-compliant container host. | Portability + escape hatch from single-cloud lock-in. | `docs/architecture.md` §6 | `Accepted` |

## Cross-references

- **Architecturally Significant Requirements (ASRs)** - the subset of NFRs + Constraints that shapes architecture lives in `local/asr-utility-tree.md` (derived via ATAM utility tree per `core/templates/asr-utility-tree.md`). ASR-001 / -002 / ... cite the source `NFR-NNN` / `CON-NNN` here.
- **ADRs** - `docs/adr/ADR-NNNN-*.md` cite the FR / NFR / Constraint they realize or amend (10 ADRs through ADR-0010 as of 2026-05-23).
- **CRs** - `docs/cr/CR-NNNN-*.md` propose additions / modifications / retirements to entries above (13 CRs through CR-0013 as of 2026-05-23). Per D25, CRs are authored by `team-lead`; SA reviews for architectural coherence and applies the requirements-register diff.
