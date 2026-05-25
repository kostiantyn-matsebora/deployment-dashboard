---
title: "ADR-0007: Vendor Adapters Emit Parent Deployments"
parent: ADRs
nav_order: 7
---

# ADR-0007 — Vendor adapters convert vendor correlation signals into `parent_deployments` edges; read-side five-pass remains backstop

- **Status:** accepted (2026-05-20) — paired with feature issue [#19](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/19) and amends the pull-mode fetcher change request's §3d endpoint-list verbatim.

- **Context.**

  The pull-mode fetcher change request introduced the optional pull-mode `Dashboard.Fetcher` and locked the GitHub Actions adapter as the MVP vendor adapter. The adapter's MVP slice — `GET /repos/{o}/{r}/deployments` + `GET /repos/{o}/{r}/deployments/{id}/statuses` with the highest seen `deployment.id` as cursor — translates pulled events into the canonical `DeploymentEventRequest` wire shape (per [ADR-0004](./ADR-0004-opaque-per-progress-reporter-cursor.md) Decision 4). One field it does **not** populate today is `DeploymentEventRequest.ParentDeployments` — every fetcher-emitted event leaves the lineage array `null`, forcing the read side to derive every lineage edge via [ADR-0001](./ADR-0001-topology-derivation-five-pass.md)'s correlation-fallback pass.

  That posture is correct as a default — push-path adopters who do not assert lineage rely on the same fallback, and [ADR-0001](./ADR-0001-topology-derivation-five-pass.md)'s pass 5 (dangling-reference self-heal) means a missing explicit edge today and a present one tomorrow both produce the right topology. But it is **strictly weaker than what the vendor signals support** when the vendor itself models lineage:

  | Vendor | Signal the vendor asserts | Currently used by the dashboard? |
  |---|---|---|
  | GitHub Actions | Workflow-run `needs:` DAG between jobs (intra-run) | No — pulled events drop the relationship; read side re-correlates by attribute |
  | GitHub Actions | Per-environment chronological history of deployments (the same series the GHA "Deployments" UI renders per-env) | No — read side re-derives the same predecessor by correlation attribute |
  | GitHub Actions | Same-`sha` deployments across environments (UI groups them visually) | **Not asserted — rendered for viewers to infer.** See § Negative-space rule below. |

  The intra-run `needs:` DAG is **authoritative** — every GHA workflow run is constrained by it (jobs literally cannot start before their `needs:` parents finish; GHA's scheduler enforces it). The per-env predecessor series is **authoritative** for the same reason — the cursor state already orders deployments per `(service, environment)` by `deployed_at`, and the previous terminal event is unambiguous from that ordering alone. Both signals are convertible to `parent_deployments` edges directly in the adapter, without any new HTTP round-trips beyond the YAML-fetch needed for `needs:` parsing.

  The third row — same-`sha` grouping across environments — is **not** a vendor-asserted edge. GitHub Actions renders deployments grouped by sha for the viewer's convenience in the "Deployments" UI; the GHA API itself never asserts a "deployment X promoted Y" link between two same-sha deployments. The read-side five-pass already handles this via pass-3 correlation with per-service topology-override visibility ([ADR-0001](./ADR-0001-topology-derivation-five-pass.md) — three-tier correlation-attribute precedence, Decision 7 in ADR-0001 § Context). Duplicating that pass in the fetcher would be strictly weaker (the fetcher has no per-request `correlationAttribute` and no per-service override map).

  Three architectural questions surface from this gap, and each one will repeat for every future vendor adapter (Azure DevOps, Jenkins, GitLab, CircleCI):

  1. **Where do we mirror vendor lineage signals — in the adapter (vendor side) or in the read side?**
  2. **Which vendor signals do we convert — the asserted DAG only, or also the visually-rendered groupings?**
  3. **What happens when the vendor signal exists in principle but cannot be retrieved or parsed (API failure, YAML unparseable, file deleted)? Do we fall back to timing inference or emit nothing?**

  Constraints:

  - **No wire-contract change.** `DeploymentEventRequest.ParentDeployments` already exists per the canonical DTO doc. This decision changes how an adapter fills it — not what is on the wire. Push-path adopters' current behaviour (set the array explicitly themselves) is the precedent.
  - **[ADR-0004](./ADR-0004-opaque-per-progress-reporter-cursor.md) Decision 4 — plug-in shape preserved.** Each adapter is still one `ICiCdAdapter` implementation; the host stays adapter-agnostic; backend stays vendor-agnostic. This ADR governs adapter *content*, not adapter *shape*.
  - **[ADR-0001](./ADR-0001-topology-derivation-five-pass.md) — read-side five-pass must remain runnable.** It is the only correlation mechanism for adopters who don't assert lineage (push-path callers who pass `null`, and non-GHA adapters before they implement vendor-correlation mirroring per this ADR). Pass 2 (explicit-first) consumes adapter-emitted edges; pass 3 (correlation fallback) is bypassed for events that already carry explicit edges; passes 1, 4, 5 are oblivious to the edge source.
  - **NFR-02 (≤ $30/month) — HTTP-call budget.** Each adapter implementing this ADR will add cacheable, per-cycle endpoint calls (for GHA: `/actions/runs/{id}` run metadata + `/actions/runs/{id}/jobs` + workflow YAML contents at the run's `head_sha`). The added calls must be documented in the adapter's owning issue or change request so the per-cycle endpoint budget remains auditable.
  - **NFR-05 (stateless backend) — preserved.** The cursor model and `fetcher_state` table are unchanged. Adapters derive edges from data already in hand (cursor + this-cycle's fetched events + cacheable YAML) — no new persistent state.

- **Decision.**

  > **Vendor adapters convert their vendor's correlation signals into `DeploymentEventRequest.ParentDeployments` edges.** Mirroring lineage happens on the vendor side — where the signals are richest — not on the read side. The read-side five-pass remains as a backstop for adopters and adapter slices that don't (yet) assert lineage.

  Three rules govern *which* signals an adapter is allowed to convert:

  ### Rule 1 — Convert what the vendor *asserts*, not what the vendor *renders*

  An adapter emits an edge **only when the vendor itself asserts the lineage** between two deployments (via a DAG declaration, a typed parent reference, a workflow constraint, or a cursor-ordered predecessor relationship the adapter already maintains).

  The adapter does **not** emit edges that the vendor only *renders* visually for viewers to infer — e.g. same-attribute grouping in the vendor's UI, same-sha deployments listed under one "release" view, or any visual lineage the vendor's API does not return as a typed relationship. Those inferences are the read-side five-pass's job ([ADR-0001](./ADR-0001-topology-derivation-five-pass.md) pass 3) precisely because they depend on per-request inputs (`correlationAttribute`) and per-service overrides (`Topology.PerServiceOverrides[service]`) the fetcher does not see.

  Worked example (GHA adapter, per issue [#19](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/19)):

  | GHA signal | Vendor-asserted? | Adapter emits edge? |
  |---|---|---|
  | Workflow-run `needs:` between deployment-producing jobs (intra-run DAG) | **Yes** — GHA's scheduler enforces the DAG | Yes — convert each `(parent_job, child_job)` pair where both produced deployments into a `(parent_deployment_id, child_deployment_id)` edge |
  | Per-`(service, environment)` predecessor — the previous terminal event for the same pair, ordered by `deployed_at` | **Yes** — the cursor state already orders per `(service, environment)` and the previous terminal event is unambiguous | Yes — emit one edge `[previous_deployment_id]` for each new deployment; empty array on the first deployment in an env (not `null`) |
  | Same-`sha` deployments across environments (UI grouping) | **No** — vendor-rendered only; the GHA API does not return a "promoted-from" relationship | No — defer to read-side five-pass pass 3 |

  **Endpoints required for the intra-run `needs:` signal (GHA).** Three GHA endpoints — all read-only, all cacheable per fetch cycle — combine to recover the asserted DAG:

  | # | Endpoint | Role |
  |---|---|---|
  | 1 | `GET /repos/{o}/{r}/actions/runs/{run_id}` | Run metadata — returns the workflow YAML's repo-relative `path` and the run's `head_sha`. **Both are required to fetch the YAML at the exact commit revision the run executed against** — a later edit to the workflow file on the default branch must not change the `needs:` declaration attributed to a past run. Strictly aligned with rule 1: convert what the vendor asserts (the YAML *as the run saw it*), not what is rendered later (the YAML on `HEAD`). |
  | 2 | `GET /repos/{o}/{r}/actions/runs/{run_id}/jobs` | Run jobs — maps deployment-producing `job_id` values to stable `job_name` values for matching against the YAML's `jobs.<name>.needs:` declaration. |
  | 3 | `GET /repos/{o}/{r}/contents/.github/workflows/{path}?ref={head_sha}` | Workflow YAML at the run revision — parameterised by the `path` + `head_sha` from endpoint 1. Parsed for the `needs:` graph. |

  All three silent-degrade independently per rule 2 (any single failure → no edges from the intra-run signal for the affected run; INFO log; the per-env-predecessor signal still emits; the fetch cycle does not fail).

  ### Rule 2 — When the explicit signal is unavailable, emit nothing — never substitute timing inference

  When an adapter can prove the vendor *would have* asserted lineage in principle but cannot recover the signal (API failure, YAML unparseable, file deleted, content-API 404, transient 5xx after retries, …), the adapter emits **no edge** from that signal for the affected events.

  > **Silent-skip degrade only.** Log at `INFO` (operator visibility); do not log at `WARN` / `ERROR`; never hard-fail the fetch cycle (cursor / auth errors remain the only fetch-cycle-fail conditions per [ADR-0004](./ADR-0004-opaque-per-progress-reporter-cursor.md) Decision 4 host responsibilities).

  Timing inference (e.g. "job A finished before job B started, so A → B even though `needs:` couldn't be parsed") is **explicitly rejected** as a fallback. Parallel jobs make `started_at` / `completed_at` ordering ambiguous: two `needs:`-independent jobs in the same run can finish in either order depending on runner scheduling, network latency, or just runner-pool contention; deriving a `needs:`-equivalent edge from that ordering manufactures a relationship the vendor itself does not assert. **A missing edge is strictly better than a fabricated edge**, because:

  - The downstream read-side five-pass pass 3 will fall back to attribute-correlation and produce the right topology when an attribute (`version` / `sha` / `ref` / `run_number`) genuinely matches.
  - A fabricated edge from timing inference, by contrast, *blocks* pass 3 (pass 2's explicit-first rule wins over pass 3) and may pin an incorrect parent that the read side has no way to correct.
  - Fabricated edges are indistinguishable on the wire from real edges; they survive into the topology output (`source: "explicit"`) and propagate to UI views as if the vendor had asserted them.

  ### Rule 3 — Read-side five-pass remains a backstop, not a competitor

  [ADR-0001](./ADR-0001-topology-derivation-five-pass.md)'s read-side five-pass remains live and unchanged. Adapter-emitted edges enter pass 2 (explicit-first); pass 3 (correlation fallback) is bypassed for those events (`parent_deployments` non-empty); passes 1, 4, 5 are oblivious to whether edges came from an adapter or a push-mode caller. Adopters who don't deploy the fetcher, and adapter slices that haven't (yet) implemented vendor-correlation mirroring, get the same five-pass behaviour they get today.

  This means the fetcher and the read-side correlation are **not duplicating work** — they are layered:

  | Layer | Owns | When it fires |
  |---|---|---|
  | Vendor adapter (this ADR) | Vendor-asserted lineage → `parent_deployments` | Per-event, at ingest, when the vendor signal exists |
  | Read-side five-pass ([ADR-0001](./ADR-0001-topology-derivation-five-pass.md)) | Attribute-correlation fallback for events without explicit edges; cycle defence; dangling-reference resolution | Every matrix read, every NOTIFY-triggered slot recompute |

  Adapter-emitted edges *prevent* pass 3 from firing for those events (correct — the vendor said so); they do *not* prevent passes 4 (merge) and 5 (dangling resolution) from running.

- **Consequences.**

  - **Per-adapter discipline.** For each new vendor adapter (today: GHA per issue [#19](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/19); tomorrow: ADO, Jenkins, GitLab, CircleCI), the implementing engineer must re-confirm the **negative-space rule** explicitly before writing the conversion: "what does this vendor *assert* vs. *render*?" Only the asserted lineage is converted. This goes in the adapter's owning feature issue alongside the endpoint-list addition.

  - **Endpoint-budget growth, documented per adapter.** Each adapter implementing this ADR will add cacheable, per-cycle endpoint calls — for GHA, three: `/actions/runs/{id}` per distinct workflow-run-id (to recover the workflow `path` + `head_sha`); `/actions/runs/{id}/jobs` per distinct workflow-run-id (to map `job_id` → `job_name`); `/repos/{o}/{r}/contents/.github/workflows/{path}?ref={head_sha}` per distinct `(workflow_path, head_sha)` pair (to fetch the YAML at the exact run revision). Per-cycle cache keyed by run-id collapses these to O(M) calls in the number of distinct runs seen in a cycle, not O(N) in deployments. The added endpoints must be appended to the adapter's owning feature issue. Future adapters (ADO / Jenkins / GitLab / CircleCI) must document their endpoint additions similarly. NFR-02 (≤ $30/month) remains in budget: GHA's authenticated rate limit is 5000/hr, and three cacheable per-run + per-`(workflow, sha)` calls stay well inside it.

  - **Adapter test surface grows.** Each adapter shipping vendor-correlation mirroring must test:
    - Happy path per signal (e.g. intra-run `needs:` resolves to an edge; per-env predecessor resolves to an edge).
    - Silent-degrade per signal (API 404 / 5xx after retries / YAML parse failure → no edge + INFO log; cycle does not fail).
    - Negative-space signals are NOT converted (e.g. same-sha-across-envs produces no edge from the adapter; relies on read-side pass 3).
    - Combined edges remain acyclic (per-signal acyclic guarantees + their union must remain acyclic — for GHA: intra-run `needs:` is DAG-enforced by GHA's scheduler; per-env predecessor is acyclic by strict temporal ordering; their union targets disjoint vertex pairs in practice, but adapter tests must include a mixed case).

  - **Read-side five-pass — semantics preserved, reach narrowed.** [ADR-0001](./ADR-0001-topology-derivation-five-pass.md) is unchanged. Pass 2 (explicit-first) consumes adapter-emitted edges identically to push-mode-emitted ones; pass 3 (correlation fallback) bypasses events that already carry explicit edges (unchanged behaviour per [ADR-0001](./ADR-0001-topology-derivation-five-pass.md)'s "deployment *without* `parent_deployments`" gate). Effective consequence: as more adapters implement vendor-correlation mirroring, the share of events hitting pass 3 falls — but pass 3 remains the only mechanism for adopters who don't assert lineage and for signal-types this ADR explicitly defers to the read side (cross-env-by-sha and similar viewer-rendered groupings).

  - **No DTO / wire-shape change.** `DeploymentEventRequest.ParentDeployments` already exists; this ADR governs *how* an adapter populates it. The 400-on-cycle and 400-on-cross-service rules in the DTO (`backend/shared/Dashboard.Shared/Dto/DeploymentEventRequest.cs:46-64`) remain the contract; the adapter relies on its own per-signal acyclic guarantees rather than depending on the DTO check as a backstop (defensive layering, not different correctness).

  - **No backend, schema, or read-side code change.** This ADR is a *posture* decision binding adapter authors. The backend's ingest endpoint, the `fetcher_state` table, the read-side five-pass, and the topology output shape are all unchanged. Implementation lands inside the adapter projects (`backend/fetcher/Dashboard.Fetcher/Adapters/<vendor>/`) per the WBS item that owns the adapter slice.

  - **One canonical reference for future adapter authors.** Adding the second vendor adapter (e.g. Azure DevOps) should not require relitigating "do we convert same-attribute groupings the vendor shows in the UI?" The negative-space rule and the timing-inference rejection are recorded here once and cited from each new adapter's CR.

- **Alternatives considered.**

  | Option | Rejected because |
  |---|---|
  | **Leave all correlation to the read-side five-pass; never have adapters emit `parent_deployments`.** Status-quo posture for the GHA adapter today. | Strictly weaker than the vendor signals support. The GHA `needs:` DAG is authoritative lineage the vendor itself enforces; deriving it via attribute-correlation on the read side requires that the attribute (`version` / `sha` / `ref` / `run_number`) happens to match across the parent and child job's emitted deployments, which is not guaranteed (jobs in the same workflow run can deploy different artefacts with different `version` values to different services). Discarding the vendor's explicit DAG and re-inferring it from attributes regresses precision. |
  | **Convert every vendor correlation signal the vendor exposes, including same-attribute groupings the vendor renders visually.** Maximalist posture. | Removes the negative-space discipline. Same-sha grouping is the canonical viewer-inferred relationship — GHA renders it but does not assert it. Converting it in the adapter blocks read-side pass 3 (which has per-request `correlationAttribute` and per-service override visibility the adapter lacks), making the resulting topology *worse* in deployments where the correlation attribute should be `version` or `ref` rather than `sha`. The five-pass exists precisely so per-request inputs can drive correlation; pre-baking same-sha edges in the adapter strips that affordance. |
  | **Convert what the vendor asserts AND fall back to timing inference when the explicit signal is unrecoverable.** Hybrid posture — "always emit something; the read side can't be expected to recover from a missing YAML." | Manufactures relationships the vendor does not assert. Parallel jobs make timing ordering ambiguous; the resulting edges are indistinguishable on the wire from authentic ones and propagate as `source: "explicit"`. A missing edge falls cleanly back to read-side pass 3 (correct); a fabricated edge from timing pins an incorrect parent that pass 2 cannot correct. Silent-degrade-with-INFO-log is the right shape: operator-visible (the log line), surfaced via the existing fetcher health surface, but does not pollute the topology. |
  | **Add a new adapter-output flag — "emit-edge-from-vendor-rendered-signals: bool" — and let operators choose.** Configuration-driven posture. | Punts an architectural decision to each operator, who lacks the read-side context to choose well. The negative-space rule is a property of the correctness model (what does the vendor assert vs render?), not an operator preference. Configuration would also explode the test surface (every per-vendor signal × on/off becomes a tested path). Locking the rule in this ADR keeps the adapter surface small and the read-side five-pass meaningful. |

- **References.**

  - [ADR-0001](./ADR-0001-topology-derivation-five-pass.md) — Read-side five-pass; backstop semantics preserved unchanged. Adapter-emitted edges consumed by pass 2; pass 3 fallback bypassed for events with explicit edges (unchanged behaviour).
  - [ADR-0004](./ADR-0004-opaque-per-progress-reporter-cursor.md) — Fetcher envelope (cursor + adapter plug-in shape). Unchanged by this ADR; this ADR governs adapter *content*, not adapter *shape*.
  - [ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) — Microservices architecture. The Fetcher microservice is the host running the adapters this ADR binds; co-location of Write + Read API services is unrelated.
  - Pull-mode fetcher change request (historical CR-0009) — Fetcher charter. §3d's endpoint list was amended in parallel with this ADR to add `/actions/runs/{id}` run metadata + `/actions/runs/{id}/jobs` + workflow YAML contents at the run's `head_sha` (the GHA adapter's first instantiation of this ADR's posture). Future adapters must document their own endpoint additions similarly.
  - Tree-topology and layout-axis change request (historical CR-0003) — Source of `deployment_id` + `parent_deployments` on the wire and the per-service topology + correlation-attribute precedence the read-side five-pass consumes. Unchanged.
  - `backend/shared/Dashboard.Shared/Dto/DeploymentEventRequest.cs:46-64` — Canonical `parent_deployments` DTO doc + per-element validation rules. Adapter relies on per-signal acyclic guarantees; DTO rules remain the backstop.
  - `backend/fetcher/Dashboard.Fetcher/Adapters/GitHubActions/` — First adapter instantiating this ADR (per issue [#19](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/19); implementation in Phase 3 of that issue's lifecycle).
  - Issue [#19](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/19) — Implementation tracking for the first adapter applying this ADR.
