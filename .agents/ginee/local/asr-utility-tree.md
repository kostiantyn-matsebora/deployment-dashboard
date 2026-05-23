# ASR utility tree - Deployment Dashboard

**Seeded:** 2026-05-23 by `team-lead` (rediscovery, D25 initialization).
**Source:** derived from `local/requirements.md` NFRs + Constraints via ATAM utility-tree technique.
**Owner:** `solution-architect`. Updates land via SA Phase 1 / Phase 2 work or via CR-driven amendment.

## How to read this file

Each branch is a **quality attribute**. Each leaf is a **scenario** rated `(business value, architectural impact)`. Scenarios rated `(H, H)` are **Architecturally Significant Requirements (ASRs)** and drive architecture decisions.

ATAM convention: rate on H / M / L. Per `core/triage-scoring.md` numeric mapping: `H=3, M=2, L=1`.

## Utility tree

### Cost

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-001` | Production hosting fits within $30/month Azure budget across compute, database, storage. Forces minimal SKU sizing (ACA + B1ms Postgres baseline); precludes managed real-time services (e.g. SignalR Service, ServiceBus) and serverless-tier compute. Drives co-location of Write + Read API per ADR-0002 mechanics / ADR-0006 framing. | `NFR-002` / `CON-002` | H | H | yes |

### Security / posture

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-002` | System is deployed inside the organisation's internal network with no public ingress required. Precludes public ACA ingress + public load balancer; SPA never embeds the dev API key. Write group is API-key gated; Read group is unauthenticated by design. WireMock admin port published only under the `integration` compose profile, never by release-install. | `NFR-004` / `CON-003` | H | H | yes |

### Scalability

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-003` | Backend is stateless; any number of replicas may run behind a load balancer with no sticky sessions. SSE clients reconnect via `Last-Event-ID`. Each replica self-bootstraps idempotently via EF Core `Migrate()` against `__EFMigrationsHistory` on startup per ADR-0009. Validated by `dev_env/docker-compose.scaled.yml` + `testing/integration/Nfr05ReplicaRestartTests.cs`. | `NFR-005` | H | H | yes |

### Latency

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-004` | Live updates delivered to all connected clients within 5 seconds of a successful ingest event. Drives SSE + PostgreSQL `LISTEN/NOTIFY` over a polling-based mechanism; precludes a separate real-time service (Azure Container Apps imposes no HTTP timeout on long-lived SSE). Validated by `testing/integration/Nfr03LatencyTests.cs`. | `NFR-003` | H | H | yes |

### Operability

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-005` | All Azure infrastructure defined as code via Terraform `azurerm` >= 4.x; no Portal-clicks. Drives `infrastructure/` directory (planned per WBS §4); precludes hand-managed Azure resources. | `NFR-006` | H | H | yes |
| `ASR-006` | Migrations applied idempotently on API host startup (`Migrate()` against `__EFMigrationsHistory`) per ADR-0009. Removes the external one-shot `migrations` service + the sixth release asset (`migration.sql`) + the `-SkipMigrations` flag + the SDK image dependency that ADR-0005 introduced. Preserves NFR-005 - each replica self-migrates without cross-replica coordination. | `NFR-005` | M | H | (no - low-medium business value but high architectural impact; tracked for ADR coverage but not an ASR) |

### Usability

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-007` | UX-RESPONSIVENESS INVARIANT - layout reflows correctly under any combination of (services, envs, env-name length, version length, viewport width). Enforced by construction via CSS Grid `auto`-env / fixed-leaf-width box; connector geometry anchored to live `getBoundingClientRect()` measurements re-evaluated via `ResizeObserver` + window-resize listener. Mirrored verbatim atop `docs/ui/mockups/deployment-dashboard.html`. Validated by `testing/mockup-visual/` (Playwright). | `NFR-009` | H | H | yes |
| `ASR-008` | Dashboard loads in a browser with no build step (SPA shipped as a static bundle into the Read API `wwwroot`). Drives static-bundle build + serve; precludes a runtime bundler / compilation step. | `NFR-008` | M | M | (no - tracked but not an ASR) |

### Retention

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-009` | Deployment history retained for >= 90 days per slot. Drives `HISTORY_RETENTION_DAYS` default of 365 + a daily pruning job. | `NFR-007` | M | L | (no) |

### Portability

| ASR ID | Scenario | Source (NFR / CON) | Business value | Architectural impact | ASR? |
|---|---|---|---|---|---|
| `ASR-010` | All backend components run on standard OCI containers; no proprietary cloud compute model (e.g. Functions, Lambda). Preserves escape hatch from single-cloud lock-in despite NFR-001 Azure-only mandate. | `CON-005` | M | H | (no - tracked) |

## ASR summary - quick reference

The architecturally significant scenarios (`(H, H)` only):

| ASR ID | Scenario (one-line) | Addressed by |
|---|---|---|
| `ASR-001` | Production fits within $30/month Azure budget. | `docs/architecture.md` §7 cost table + ADR-0002 (co-location mechanics) + ADR-0006 (microservices framing) + ADR-0010 (compose merge eliminates duplication) |
| `ASR-002` | Internal-only posture; no public ingress; admin ports gated. | `docs/architecture.md` §8 (auth model) + `docs/integration-tests.md` § Admin port publishing rule + `local/roles/devops-engineer.md` (gh auth + anonymous-vs-authed split) |
| `ASR-003` | Stateless backend; replicas without sticky sessions; idempotent startup. | `docs/architecture.md` §7 + ADR-0009 (startup-applied migrations) + `dev_env/docker-compose.scaled.yml` |
| `ASR-004` | Live updates within 5 s via SSE + LISTEN/NOTIFY. | `docs/architecture.md` §7 + `testing/integration/Nfr03LatencyTests.cs` |
| `ASR-005` | All infra defined via Terraform. | WBS §4 (planned `infrastructure/` directory) - **no ADR yet; gap to address when Terraform lands** |
| `ASR-007` | UX-responsiveness invariant - no overlap under any combo. | `docs/architecture.md` §5 NFR-09 + mockup mirror + `testing/mockup-visual/` |

## Cross-references

- **Requirements register** - `local/requirements.md` holds the NFRs + Constraints these ASRs derive from.
- **ADRs** - each `(H, H)` ASR must be addressed by >= 1 ADR or existing architecture-doc section. SA Phase 7 review verifies coverage per `core/process.md § Phase 7`.
  - ASR-005 (Terraform IaC) currently lacks ADR coverage - flagged for follow-up when `infrastructure/` lands.
- **Phase 1 design dip** - SA derives + maintains this tree at Phase 1 per `core/roles/solution-architect.md § Design`. Updates land at Phase 2 (delta mode -> ADR + ASR amendment) or Phase 4 (engineer proposes architectural change -> SA review -> ASR amendment).
