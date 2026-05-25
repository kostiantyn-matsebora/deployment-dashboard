---
title: "ADR-0004: Opaque Per-Progress-Reporter Cursor"
parent: ADRs
nav_order: 4
---

# ADR-0004 — Opaque per-`progress_reporter` cursor; backend-held; out-of-process fetcher; plug-in adapter shape

- **Status:** accepted (paired with the pull-mode fetcher and progress-reporter change request)
- **Context:** The pull-mode fetcher requirement introduces an optional out-of-process pull-mode adapter (`Dashboard.Fetcher`) and the universal `X-Progress-Reporter` event-attribution header. Four technical decisions are co-introduced by that requirement and need a single anchor so future adapter authors (Wave-2 backend-engineer + every later CI/CD adapter implementation) don't relitigate them:

  1. **Where does the fetcher's restart-cursor live — backend or fetcher container?**
  2. **What shape is the cursor on the wire — typed per adapter, or opaque blob?**
  3. **Does the fetcher run as a separate container or as an in-process `BackgroundService` inside the API host?**
  4. **What is the plug-in interface adapter authors implement?**

  Constraints:
  - **NFR-05 (stateless backend across replicas).** The backend must remain replica-fungible: any API instance can serve any request, no sticky sessions, no instance-local state. This constrains where the cursor lives **and** how many fetcher instances may run.
  - **NFR-04 (internal-only).** The fetcher reaches out to a public CI/CD API; the backend stays inside the internal network. The fetcher's credential surface (CI/CD PAT) must not bleed into the API host's credential surface (`X-Api-Key`).
  - **NFR-02 (≤ $30/month).** One additional Consumption-plan ACA app when the fetcher is enabled — acceptable. Opt-in deployment means adopters who don't deploy the fetcher pay nothing extra.
  - **[ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) — microservices architecture with container co-location** (supersedes [ADR-0002](./ADR-0002-modular-monolith-consolidation.md) on framing; ADR-0002 retains the co-location mechanics). The Write and Read API services are co-located in one container (`deployment-dashboard-api`). ADR-0004 must explain why the Fetcher microservice is **not** co-located into the same container.
  - **Universal `X-Progress-Reporter` header (pull-mode fetcher requirement § 3a).** Whatever discriminator the cursor table uses must be the **same** concept the adapter uses on its push events — one concept across attribution and state, not two.

- **Decision.**

  ### Decision 1 — Cursor lives on the **backend**, not the fetcher

  The fetcher persists no durable state in its own container. The opaque cursor blob is read and written via `GET`/`PUT /api/fetcher/state/{source-id}` on the backend's existing Write endpoint group.

  **Rationale.** The fetcher is a stateless workhorse that can be killed and restarted at any moment (`docker compose --profile fetcher up` cycles, ACA revision swaps, image pulls, etc.). Putting the cursor on the fetcher's local disk would tie restart-safety to container-local storage — a fragile contract on ACA (Consumption plan ephemeral filesystem) and a deployment-mode-specific contract everywhere else. Putting it on the backend means restart-safety is one HTTP call away from anywhere the fetcher runs.

  This does **not** violate NFR-05. NFR-05's stateless guarantee is about **API replica fungibility** — any of N API replicas can serve any request — not "the backend persists no per-pusher state". The `fetcher_state` table is row-stored persistent state, accessed identically by every API replica via the same `DbContext`; replica-fungibility is preserved.

  **Trade-off.** One extra round-trip per poll cycle (read cursor → fetch → write cursor → repeat). At the default 30 s poll interval this is negligible; even at a hypothetical 5 s poll the round-trip cost (~ms) is invisible against the CI/CD API call cost (~100 ms).

  ### Decision 2 — Cursor is an **opaque per-`progress_reporter` blob**

  The `fetcher_state` table stores the cursor as `VARCHAR(4096) NOT NULL` keyed by `(progress_reporter, source_id)`. The backend treats the cursor as a length-capped string; it never parses, validates, or interprets the blob content beyond length.

  **Rationale.** Different CI/CD tools use radically different cursor shapes:
  - GitHub Actions deployments: highest seen `deployment.id` (a positive integer).
  - Azure DevOps releases: a `(definition_id, release_id, modified_on)` tuple.
  - Jenkins builds: a build-number watermark, possibly per-job.
  - GitLab CI: a `(project_id, pipeline_id)` pair.
  - CircleCI: a workflow id (UUID string).

  Forcing a typed shape on the backend means every new adapter requires a backend migration. Treating the cursor as an opaque blob means each adapter owns its own cursor shape; the backend never needs to learn what a "GitHub deployment id" is. Adapter authors serialise their cursor into a string however they like (raw integer, JSON, base64-encoded protobuf, anything that fits ≤ 4 KB) and write it.

  **The discriminator `progress_reporter` is the same universal header** the adapter uses on its push events (pull-mode is a strict subset of push-mode). One concept across attribution and state — not two. An adapter calling itself `dashboard-fetcher/github-actions` on `X-Progress-Reporter` for push events stores its cursor under the same `progress_reporter` key on the `fetcher_state` table.

  **The `source-id` path segment** is the per-fetcher logical scope (e.g. an `owner/repo` pair, an ADO project name, a Jenkins job path). The fetcher chooses what `source-id` means within its own adapter; the backend treats it as a path parameter and the cursor is keyed by `(progress_reporter, source_id)` so one fetcher tracking N repositories has N rows in `fetcher_state`.

  **Trade-off.** The backend cannot offer cursor-shape validation; an adapter that writes garbage to its own cursor breaks itself, not other adapters. This is acceptable — adapters are first-party code in this repo; a buggy cursor is a unit-test failure caught at adapter level, not a runtime hazard for the backend.

  **Demo profile (issue #46).** Every per-tick `list-deployments` mapping body — after sidecar ID rewriting — carries `deployment.id` values strictly greater than both the persisted fetcher cursor and the static base maximum 10065.

  ### Decision 3 — Fetcher runs in a **separate container**, not as an in-process `BackgroundService`

  The fetcher is shipped as a separate ASP.NET Core Worker (`Microsoft.NET.Sdk.Worker`) in `backend/fetcher-host/Dashboard.Fetcher.Host/`, built into a separate container image (`deployment-dashboard-fetcher`). It is **not** co-located into the `deployment-dashboard-api` host with the Write + Read services (see [ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) for the microservices framing; co-location mechanics for Write + Read live in [ADR-0002](./ADR-0002-modular-monolith-consolidation.md)).

  **Rationale.**

  | Reason | Detail |
  |---|---|
  | **NFR-05 preservation.** | Running the fetcher as an in-process `BackgroundService` would mean **N pollers in N API replicas** — each one independently hammering the CI/CD API. The dashboard's API is designed to scale horizontally; the fetcher must scale vertically (`maxReplicas == 1` when enabled). Different scaling envelopes → different processes. |
  | **Opt-in deployment.** | The fetcher is optional. A separate image means adopters who don't want pull-mode deploy zero fetcher bits; an in-process variant would bloat the API container with code that almost no deployment uses. |
  | **Failure isolation.** | A failing fetcher (crashed adapter, runaway retry loop, CI/CD API rate-limit storm) must not take the API host down. Separate process = separate crash domain. |
  | **Credential isolation.** | The fetcher needs a CI/CD-tool credential (e.g. GitHub PAT). Keeping that credential out of the API host's environment surface narrows the API host's blast radius if it is ever compromised. The API host needs only its `X-Api-Key` self-credential; the fetcher needs both `X-Api-Key` (to push) and a CI/CD-tool credential (to pull). Separate processes = separate env-var surfaces. |

  **Constraint: `minReplicas == maxReplicas == 1` when enabled.** Running multiple fetcher replicas is undefined behaviour for MVP and is not supported (would cause N× CI/CD API calls and N× cursor-write races). This is enforced at the ACA app definition (deferred to Wave 2 ACA + Terraform work).

  ### Decision 4 — Plug-in interface shape

  Each CI/CD-tool adapter implements:

  ```csharp
  public interface ICiCdAdapter
  {
      string AdapterId { get; }     // e.g. "github-actions"; the host composes the default X-Progress-Reporter value as $"dashboard-fetcher/{AdapterId}"

      Task<FetchPage> FetchPageAsync(
          string sourceId,             // e.g. "owner/repo"; opaque to the host beyond logging
          string? opaqueCursor,        // null on first fetch; otherwise the blob written on the previous successful round
          int pageSize,                // bounded by INITIAL_FETCH_LIMIT on the first fetch; per-adapter "natural page size" thereafter
          CancellationToken ct);
  }

  public sealed record FetchPage(
      IReadOnlyList<DeploymentEventRequest> Events,
      string NewCursor,                // returned even when Events is empty — advances the watermark past empty pages
      bool HasMore);                   // host re-invokes FetchPageAsync immediately when true (no scheduler delay), respecting rate-limit back-off
  ```

  **2026-05-21 amendment (historical CR-0011 — rate-limit governance).** `FetchPage` grows a nullable `RateLimit: RateLimitObservation?` field carrying the upstream-observed `(limit, remaining, reset_at)` triple from the same HTTP response that produced `Events`. The host reads it to drive the leaky-bucket cap gate and the per-tick push to `POST /api/fetcher/usage`. Consumers treat `null` as "this adapter does not observe an upstream rate-limit window" — the host then skips both the gate and the usage push for that tick. Per [ADR-0008](./ADR-0008-leaky-bucket-cap-and-republish-on-tick.md) Decision 1 — Option A (extend `FetchPage`, chosen over a parallel `IRateLimitObserver` capability interface so "what happened this tick" lives in one record).

  **Host responsibilities** (owned by `Dashboard.Fetcher.Host`, not the adapter):
  - Scheduler (default 30 s interval; configurable via env var).
  - Retry with exponential back-off + jitter on transient failures (HTTP 5xx, network timeouts). Realised in code via `Microsoft.Extensions.Http.Resilience` (`AddStandardResilienceHandler`), which bundles retry-with-jitter, per-attempt timeout, and circuit-breaker on top of the Polly v8 engine. Treat "Polly" and `Microsoft.Extensions.Http.Resilience` as the same family for the purpose of this decision — the latter is the modern .NET 10 packaging of the former with sensible defaults.
  - Rate-limit back-off (CI/CD-tool-specific headers like GitHub's `X-RateLimit-Remaining` / `X-RateLimit-Reset` are surfaced via a small per-adapter helper, but the host owns the decision to back off).
  - Write API dispatch — calls `POST /api/deployments` with `X-Api-Key` + `X-Progress-Reporter: dashboard-fetcher/{AdapterId}` for every event in `FetchPage.Events`. **`409 Conflict` on the POST is treated as success** by the host: a `409` means the `(service, deployment_id)` is already persisted from a previous (partial-page) round, so the row already exists and the cursor may safely advance past it. This preserves at-least-once semantics under retry / page-replay without forcing the fetcher to track which events it has already pushed.
  - Cursor lifecycle — calls `GET /api/fetcher/state/{source-id}` before the first fetch of a poll cycle, and `PUT /api/fetcher/state/{source-id}` with `NewCursor` after a successful fetch + dispatch.

  **Adapter responsibilities** (owned by each `ICiCdAdapter` implementation):
  - One CI/CD API call (or several, for multi-step fetches like GHA's deployments + statuses).
  - Translate the tool's native event shape into `DeploymentEventRequest` (reuse `Dashboard.Shared` DTOs).
  - Maintain its own cursor shape (string-serialised — see Decision 2).
  - Report `HasMore == true` when the page was full and the next page is known to exist.

  **Rationale.** Cleanly separates "what changed in the CI/CD tool" (adapter) from "how to retry, dispatch, and persist progress" (host). Backend remains adapter-agnostic — it only sees the resulting `POST` calls and the opaque cursor writes. Adding a new adapter (Azure DevOps, Jenkins, etc.) means writing one `ICiCdAdapter` implementation and one composition-root line in the host; no backend change.

- **Consequences:**
  - **Backend grows by**: two endpoints (`GET`/`PUT /api/fetcher/state/{source-id}` on the Write group), one EF entity + table (`fetcher_state`), one nullable column on the existing events / deployments table (`progress_reporter`), and one DTO field on the three Read event-attribute surfaces (`DeploymentEventResponse`, `CurrentDeployment`, `LastSuccessfulDeployment`). No code change to existing endpoint behaviour — only the new optional header validation lands on `POST /api/deployments`.
  - **No FR / NFR amendment** required. The cursor table is **persistent state** (NFR-05 talks about replica fungibility, not persistence), the fetcher is opt-in (NFR-02), credential isolation is improved (NFR-04-adjacent), and the fetcher's `min/maxReplicas == 1` constraint is documented at the SAD §7 sub-section level (not as an NFR).
  - **Fetcher repo footprint:** two new project directories (`backend/fetcher/` library + `backend/fetcher-host/` Worker host + Dockerfile). Reuses `Dashboard.Shared` for DTO contracts — no DTO duplication.
  - **Adapter extensibility comes for free.** Adding Azure DevOps / Jenkins / GitLab / Circle CI later is a single `ICiCdAdapter` implementation + composition-root wiring; no backend migration, no new endpoint, no new auth surface. Per the original change request, these are explicitly deferred to post-MVP.
  - **Single concept across attribution + state.** Operators see one identifier (`progress_reporter`) on dashboard event rows, on the `fetcher_state` table, and on log searches — not two parallel namespaces ("which adapter" vs "which attribution source").
  - **Future Control API (TODO Item 12) integration.** When the Control API lands, the fetcher will become a managed component (start / stop / status reporting). The cursor model in this ADR is unaffected — Control API operations are orthogonal to cursor reads / writes. The fetcher's existing `ICiCdAdapter` shape and `min/maxReplicas == 1` constraint persist.
  - **The opaque-cursor decision means the backend cannot enforce cursor format correctness.** A buggy adapter that writes nonsense to its own cursor (e.g. an unparseable string after a code change) self-recovers on the next deploy + cursor reset (an operator can `PUT` a fresh cursor manually or wipe the row to trigger an `INITIAL_FETCH_LIMIT` first-fetch). This is acceptable: adapter authors own the cursor contract for their adapter; the backend is the storage layer.

- **References:**
  - Pull-mode fetcher + progress-reporter change request (historical CR-0009) — the paired requirement (introduces the fetcher, the new header, and the cursor endpoints).
  - API validation + OpenAPI/Scalar change request (historical CR-0008) — `ProblemDetails` + length-validation pattern reused verbatim for the new `X-Progress-Reporter` header and the new cursor endpoints.
  - [ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) — microservices architecture + co-location framing (supersedes [ADR-0002](./ADR-0002-modular-monolith-consolidation.md) on framing; ADR-0002 retains the co-location mechanics for Write + Read); this ADR documents the explicit non-co-location of the Fetcher microservice into the `deployment-dashboard-api` host (Decision 3 above).
  - SAD §7 "Dashboard.Fetcher (optional pull-mode adapter)" — per-component attribute card.
  - SAD §10 Decision 6 — *"Push-by-default with optional pull-mode adapter"*.
  - `backend/shared/Dashboard.Shared/Dto/DeploymentEventResponse.cs`, `MatrixSlot.cs`, `SlotUpdatePayload.cs` — Read-surface DTOs that the new `progress_reporter` field extends.
