---
title: "ADR-0008: Leaky-Bucket Cap and Re-publish-on-Tick Usage Reporting"
parent: ADRs
nav_order: 8
---

# ADR-0008 — Leaky-bucket cap on observed remaining; re-publish-on-tick (no persistence); per-token cap with per-(adapter, source-id) reporting

- **Status:** accepted (paired with the fetcher rate-limit governance change request, historical CR-0011)

- **Context.** The fetcher rate-limit governance change request introduces a configurable self-imposed rate-limit cap on the fetcher, plus a `POST /api/fetcher/usage` → in-memory cache → `GET /api/fetcher/usage` reporting flow, plus a dashboard surfacing. Three cross-cutting technical decisions are co-introduced by that change request and need a single anchor so Wave-2 backend + every future vendor adapter implementing this posture do not relitigate them:

  1. **How does the fetcher account for its self-imposed cap — fetcher-side counter, sliding window, token bucket, or leaky-bucket-on-observed-remaining?**
  2. **Where does the per-`(adapter, source_id)` usage snapshot live on the backend — durable table, distributed cache, or in-memory process-local with re-publish-on-tick?**
  3. **What is the scope of the cap — per upstream token, per `(adapter, source_id)`, or per adapter?**

  Constraints:

  - **NFR-05 (stateless backend across replicas).** Any API instance must be able to serve any request without instance-local durable state. New state shape must either be replica-fungible (e.g. persisted in the existing Postgres database, read by every replica) **or** rebuildable from external input (re-publish-on-tick from a single-writer source).
  - **NFR-02 (≤ $30/month).** No new infra-tier components (no Redis, no second Postgres, no new ACA app) for a "now gauge" that does not need durability.
  - **NFR-09 (reflow invariant).** Applies to the SPA surface this ADR enables — not to the backend / fetcher decisions here directly, but the staleness affordance the cache exposes (`received_at`) is consumed by the SPA rate-limit cluster.
  - **[ADR-0004](./ADR-0004-opaque-per-progress-reporter-cursor.md) Decision 3 — fetcher `minReplicas == maxReplicas == 1`.** The fetcher is a single-writer process by construction when enabled. Whatever cache mechanism the backend uses can rely on single-writer semantics from the upstream push.
  - **[ADR-0004](./ADR-0004-opaque-per-progress-reporter-cursor.md) Decision 4 — host owns rate-limit back-off.** The leaky-bucket gate sits in the host, not the adapter. Adapters surface observation; host owns the decision to issue or skip the next request.
  - **Pull-mode is a strict subset of push-mode.** Whatever discriminator the usage cache uses must compose cleanly with the `progress_reporter` + `source_id` identifiers already established by the pull-mode fetcher change request + ADR-0004 — one concept across attribution, cursor state, and now usage state.

- **Decision.**

  ### Decision 1 — Cap accounting is **leaky-bucket on the upstream-observed `Remaining`**, not a fetcher-side counter

  The fetcher derives its cap as:

  ```
  SelfImposedCap := absolute     when FETCHER_RATE_LIMIT_ABSOLUTE is set
                 OR (percentage / 100) * upstream_limit   otherwise
  ```

  And gates the next request as:

  ```
  skip-this-request := (upstream_limit - upstream_remaining) >= SelfImposedCap
                       AND now < upstream_reset_at
  ```

  The fetcher holds **no window state** beyond the latest observed `(upstream_limit, upstream_remaining, upstream_reset_at)` triple from the most recent CI/CD API response. There is no internal counter, no sliding window, no token bucket.

  **Rationale.**

  | Reason | Detail |
  |---|---|
  | **NFR-05 preservation at the fetcher level.** | The fetcher already runs `minReplicas == maxReplicas == 1` (ADR-0004 Decision 3), but its restart-safety contract — "kill at any time, restart, resume from cursor + last response" — would be violated by an in-memory window counter. After a restart the counter resets to 0, the fetcher believes it has issued zero requests, and barrels past the cap until the upstream's next 429. Leaky-bucket on observed `Remaining` has no fetcher-side state to lose; restart-safety is preserved without effort. |
  | **Single source of truth for "how much has been used".** | The upstream's `X-RateLimit-Remaining` is *authoritative* — it is the same counter the upstream uses to decide whether to 429 the next request. Any fetcher-side counter is necessarily a *replica* of that counter with drift potential (request counted on send but the upstream never billed it; vice versa). Two counters that disagree are a debugging nightmare; one counter that is upstream-truth is a non-issue. |
  | **Lockstep with the existing upstream-rate-limit-hit path.** | Today the fetcher already backs off on `X-RateLimit-Remaining == 0` / `429`. The leaky-bucket cap on observed remaining is **the same path, gated earlier** — `Remaining < (UpstreamLimit - SelfImposedCap)` instead of `Remaining == 0`. One mechanism, two thresholds. The cursor-non-advance + INFO-log-on-resume semantics survive verbatim from the existing rate-limit-hit handling (`GitHubActionsAdapterTests` Deviation 4). |
  | **Simplicity / testability.** | The gate is a pure function of three numbers. Unit tests don't need to spin up a fake clock, replay a stream of timestamps into a window, or model fetcher restart. They construct a `(limit, remaining, reset_at, cap)` tuple and assert "issue" or "skip". |

  **Trade-off (acknowledged).** The fetcher's view of `(upstream_limit - upstream_remaining)` lags reality by one request — after issuing request N, the fetcher doesn't see the upstream's updated `Remaining` until N's response arrives. In the worst case this lets the fetcher overshoot the cap by one in-flight request. At the default 30s poll interval + 1 concurrent fetch this is at most 1 request per window (e.g. 1/5000 = 0.02% slop on a GHA token). For an "operator-visible budget governance" use case (not a hard regulatory limit) this is acceptable.

  **Naming note.** Calling this "leaky-bucket" follows the issue #28 wording. Technically it's neither a textbook leaky bucket (which has a fixed drain rate) nor a token bucket (which has a fixed refill rate) — it's "a watermark on a counter the upstream owns". The name is a label, not a literal algorithm description. The original change-request wording is preserved verbatim.

  ### Decision 2 — Reporting topology is **in-memory cache per API process + re-publish-on-tick** — no persistence

  The backend caches the latest `FetcherUsageSnapshot` per `(adapter_id, source_id)` key in a process-local `ConcurrentDictionary` registered as a singleton (`IFetcherUsageCache`). On `POST /api/fetcher/usage` the cache writes (or overwrites) the entry for that key + stamps `received_at` from server clock. On `GET /api/fetcher/usage` the cache returns its current contents as a JSON array.

  On API replica restart the cache is **empty**. Recovery is **the next fetcher tick**, which re-publishes the current snapshot (single-writer, by construction of ADR-0004 Decision 3). At the default 30 s poll interval the cache is re-warmed within 30 s of restart in the worst case.

  No new EF entity. No new table. No migration. No Redis. No second persistence tier.

  **Rationale.**

  | Reason | Detail |
  |---|---|
  | **NFR-05 preservation at the backend level.** | NFR-05 forbids replica-local durable state. The cache *is* replica-local but *not* durable — it's rebuildable from external input within one poll interval. This is the same shape as the existing `Real-time Hub` component (SAD §7 C5), which holds per-replica subscriber state recovered via SSE `Last-Event-ID` reconnect. Replica fungibility is preserved: each replica answers GET from its own cache; transient inconsistency during the post-restart re-warm window is acceptable for a "now gauge". |
  | **NFR-02 preservation.** | Adding a persistence tier for a "now gauge" would multiply storage + replication + backup cost for a value that is meaningful for ≤ 1 poll interval. The cache costs one in-process dictionary + N snapshots × (8 string fields + 6 numeric fields) ≈ < 1 KB per `(adapter, source-id)` pair; negligible. |
  | **No multi-replica write-contention.** | The fetcher runs `minReplicas == maxReplicas == 1` (ADR-0004 Decision 3). One writer; N readers (each API replica). The cache's write path needs no distributed coordination; the `ConcurrentDictionary` handles the local concurrent read/write within one replica trivially. |
  | **Failure mode = bounded staleness, not data loss.** | The cache is a derived view of a continuous stream of fetcher pushes. Losing it is not "data loss" — it's "we forget the latest reading for ≤ 30 s". The fetcher's next push restores it. Comparable to losing a chart's last frame: the chart re-draws on the next sample. |
  | **No "where does the source of truth live?" ambiguity.** | The fetcher's observation of the upstream API is the source of truth. The backend cache is a forwarding mechanism, not a record-keeper. Treating it as durable would invite read-back queries the system never needs to answer ("what was usage 7 hours ago?") — explicitly out of scope per issue #28 ("the feature is 'now' gauge only, not a time-series"). |

  **Trade-off (acknowledged).** During the first poll-interval after an API replica restart, `GET /api/fetcher/usage` returns `{ "snapshots": [] }` even though the system is healthy. The SPA's stale-affordance (`now - received_at > 2 × poll_interval`) consumes this case naturally — a missing snapshot reads as "not yet observed", which is *truer* than a fabricated zero. The SPA cluster shows its empty / cold-start state during the re-warm window and transitions to live data when the next push arrives. ≤ 30 s of "no live reading" on a "now gauge" that exists primarily to help operators see saturation is acceptable.

  ### Decision 3 — Cap scope is **per upstream token (= per adapter)**; reporting scope is **per `(adapter_id, source_id)`**

  The self-imposed cap (`FETCHER_RATE_LIMIT_ABSOLUTE` / `FETCHER_RATE_LIMIT_PERCENTAGE`) applies to **one upstream credential's window**. In MVP, "one credential" = "one adapter" (each adapter is paired with one PAT in `Dashboard.Fetcher.Host`). When an adapter polls N source-ids on one PAT — e.g. the GHA adapter polling `acme/widget-a` + `acme/widget-b` on one PAT — the cap is shared across all N source-ids because the upstream PAT's rate-limit window is shared.

  **Reporting** stays at `(adapter_id, source_id)` granularity. The SPA shows per-repo usage rows; the cap value (`self_imposed_cap`) is the **same number** on every row from the same PAT — that is correct, not a bug. The dashboard makes the shared-budget reality visible: an operator looking at the cluster sees both rows referencing the same 1,500-request cap and understands the rows compete for that budget.

  **Rationale.**

  | Reason | Detail |
  |---|---|
  | **Avoid double-accounting.** | If the cap were per `(adapter, source_id)`, the GHA adapter polling 4 repos on one PAT with a 30% cap would behave as 4 × 30% = 120% of the upstream limit — meaningless. The upstream PAT has one window; the cap must align with the window. |
  | **Match the upstream's rate-limit subject.** | GHA's rate-limit is per *user* (per *PAT*), not per *repo*. ADO's is per *organisation* per *service-connection*. Jenkins / GitLab / CircleCI similarly: the rate-limit subject is the credential, not the polled resource. Per-token cap aligns the cap to the actual subject. |
  | **Per-`(adapter, source_id)` reporting still distinguishes which repo "ate the budget".** | The fetcher pushes `upstream_used` from the response headers it observed *after each call*; the cache holds the latest snapshot per `(adapter, source-id)`. Two repos sharing a PAT will show different `upstream_remaining` only when their respective last polls happened at different times — but they will converge to the same `upstream_remaining` value (because they ARE the same window) within ≤ 2 poll cycles. The dashboard interpretation is "these rows share a budget"; the visual treatment (e.g. a small "shared budget" indicator) is a `frontend-engineer` mockup decision. |
  | **Future-proof against per-credential adapter splits.** | A future adapter implementation that wires N PATs to one adapter (e.g. GHA-with-org-fan-out) becomes a new adapter (or a new adapter instance with a new `AdapterId`); each instance has its own cap. The "per upstream token = per adapter instance" identity stays true. |

  **Trade-off (acknowledged).** An operator who *wants* per-repo caps (e.g. "cap `acme/widget-a` at 500/hr separately from `acme/widget-b`") cannot get that with this CR. The workaround is to deploy two adapter instances each with its own PAT and its own cap — but that doubles the credential surface and is undocumented in MVP. If this need surfaces post-MVP, a future CR amends FR-18 to support per-`(adapter, source_id)` caps with explicit overflow accounting; the wire shape (`self_imposed_cap` on `GET /api/fetcher/usage` already per-`(adapter, source_id)`) absorbs that change without further amendment.

  ### Decision 4 — `upstream_used` is **observed**, not counted; the field name is **`upstream_used`**, not `self_imposed_used`

  `upstream_used` on the wire is derived as `upstream_used := upstream_limit - upstream_remaining` from each upstream response. It reflects the upstream's accounting of how much of the window has been consumed across all callers using the same credential — including this fetcher *and* any other consumer of the same PAT (local dev, IDE integrations, CI workflows, …).

  Issue #28 proposed a field `self_imposed_used` defined as "requests issued in the current window". This decision **renames** that field to `upstream_used` because:

  1. The fetcher does not have a reliable count of "requests it issued in this window" — there is no fetcher-side counter (Decision 1). It only knows what the upstream tells it via headers, which counts **all callers** on this PAT, not just the fetcher.
  2. The operator viewing the dashboard wants to see "how much of the PAT's budget is gone" — which is the upstream-observed value. A separate "how many did *this fetcher* spend" number would be more accurate to the field name `self_imposed_used` but less useful (the operator already accepts shared-PAT realities by deploying one).
  3. Renaming clarifies the semantics on the wire. Both producer (fetcher) and consumer (SPA) read `upstream_used` and know exactly what it counts.

  The cap-reached gate (Decision 1) uses **`upstream_used` vs `self_imposed_cap`** as its threshold — meaning the fetcher self-imposes its cap **against the shared upstream window**. If another consumer is already at 30% of the PAT and the fetcher's cap is 30%, the fetcher will refuse to issue requests at all this window. This is **correct** for the issue's stated motivation ("starving any other tooling that shares the same PAT"): the fetcher must reserve PAT headroom for other consumers, which means counting *every* request against the cap regardless of who issued it.

  **Rationale: the cap is a cap on PAT consumption, not on this fetcher's own consumption.** That is the issue's stated motivation; renaming the field aligns the semantics with the goal.

- **Consequences:**

  - **Wire-shape implications.** The `POST /api/fetcher/usage` body field is `upstream_used` (not `self_imposed_used`). Documented verbatim in the rate-limit governance change request.

  - **Backend grows by:** two endpoints (`POST` + `GET /api/fetcher/usage`), one DTO pair (`FetcherUsageSnapshotRequest` + `FetcherUsageSnapshotResponse`), one singleton service (`IFetcherUsageCache`). No EF entity. No migration. No second persistence tier.

  - **Fetcher grows by:** two `FetcherOptions` properties (`RateLimitAbsolute`, `RateLimitPercentage`), one cap-resolution function, one leaky-bucket gate inside the host scheduler, one per-tick push to `POST /api/fetcher/usage`. Adapter contract gains a surface for upstream rate-limit headers (extension of `FetchPage` or parallel hook — see ADR-0004 Decision 4 amendment).

  - **NFR alignment.**
    - NFR-05 preserved — cache is rebuildable from external input within one poll interval; comparable to the existing Real-time Hub recovery via SSE `Last-Event-ID`.
    - NFR-02 preserved — no new infra tier; ~< 1 KB per `(adapter, source-id)` in process memory.
    - NFR-09 preserved — backend / fetcher decisions don't touch UI geometry; the consumed `received_at` field gates the SPA stale-affordance on the rate-limit cluster.
    - NFR-04 preserved — POST `X-Api-Key`-gated; GET unauthenticated like every other Read endpoint.

  - **Operator visibility implications.** Operators reading the dashboard see "how much of the PAT is gone" not "how much this fetcher spent". The interpretation aligns with the issue's stated goal: surface PAT saturation, not fetcher-local accounting. The `INFO` log line on cap-reached states the resolved cap + the observed `upstream_used` at the moment of trip, so operator debugging is unambiguous.

  - **Multi-replica fetcher is undefined behaviour (unchanged from ADR-0004).** Running N fetcher replicas with one PAT would cause both N× CI/CD API calls (already documented at ADR-0004 Decision 3) AND N× usage pushes to the backend with potential ordering glitches in which "latest" wins. The `minReplicas == maxReplicas == 1` constraint inherited from ADR-0004 preserves single-writer semantics for this cache.

  - **No backend persistence means no historical usage queries.** This is **intentional** per issue #28 ("Historical retention of usage figures beyond the current window — the feature is 'now' gauge only, not a time-series"). If a future use case needs historical usage (e.g. "show me the last 7 days of GHA budget consumption"), a future CR pairs with a new ADR introducing a time-series sink (Postgres table or external metric store); the wire shape (`POST /api/fetcher/usage`) is forward-compatible because nothing about the current shape prevents adding a downstream historical writer in parallel with the in-memory cache.

  - **Future Control API integration (TODO Item 12).** When the Control API lands, it MAY use `GET /api/fetcher/usage` directly to drive cap-reached alerts, throttling decisions, or fetcher health rollups. The wire shape is stable; the in-memory cache topology is an implementation detail the Control API never needs to know about.

- **Alternatives considered.**

  | Option | Rejected because |
  |---|---|
  | **Fetcher-side window counter + sliding window per upstream window** | Drifts on restart (cleared in-memory counter → fetcher believes it has issued 0 requests until first upstream 429). Requires fake-clock infrastructure in tests. Duplicates the upstream's own counter with no observability benefit (a divergent fetcher-counter vs upstream-`Remaining` is harder to debug than one upstream-truth source). |
  | **Token-bucket cap with fetcher-managed refill rate** | Adds an algorithmic abstraction (refill rate, bucket size) where the upstream already provides the equivalent via `X-RateLimit-Reset`. Two parameters per adapter (rate + cap) where one (cap) is sufficient. Issue #28 explicitly defers this ("Token-bucket / sliding-window cap accounting; the leaky-bucket approach is chosen here. Revisit only if accuracy proves insufficient — would need a CR + ADR pair given NFR-05"). |
  | **Persist usage to a Postgres table (`fetcher_usage_history`)** | NFR-02 cost (one more table + retention pruning); NFR-05 violation surface (cache writes become DB writes on every tick — adds DB load proportional to the fetch cadence × number of source-ids); semantically wrong for a "now gauge" (the value's TTL is one poll cycle, not 90+ days). Time-series sink is explicitly out of scope (issue #28). |
  | **Distributed cache (Redis) for the snapshot** | Adds a new infra tier (NFR-02 cost + NFR-01 single-cloud envelope) for state that the fetcher itself can re-publish within 30 s. Solves a multi-writer concurrency problem this system explicitly does not have (fetcher is `minReplicas == maxReplicas == 1` per ADR-0004 Decision 3). |
  | **SSE channel for usage events** | The "SSE carries slot updates only" boundary is an explicit architectural constraint (see SAD §7 SSE semantics). Adding non-slot payloads to SSE would require either a new event type (breaks the single-event-type assumption SPA + harness rely on) or a second SSE endpoint (doubles the LISTEN/NOTIFY load on Postgres). Polling `GET /api/fetcher/usage` on the SPA cadence is sufficient — usage is a "now gauge", not a real-time stream. |
  | **Per-`(adapter, source_id)` cap (one cap per polled repo)** | Multiplies effective consumption beyond the upstream window (e.g. 4 source-ids × 30% cap = 120% of one PAT's window). Aligns the cap to the polled resource instead of the rate-limit subject (the credential); makes the cap meaningless for the issue's stated goal of preserving headroom for other consumers of the same PAT. Per-repo cap can be re-introduced post-MVP via two adapter instances with their own PATs, or via a future CR amending FR-18 with overflow accounting. |
  | **Field name `self_imposed_used` per issue #28 verbatim** | Implies a fetcher-local counter (drifts on restart, doesn't exist). Misleading on the wire — the value is `upstream_limit - upstream_remaining`, which counts *every* consumer of the PAT. Renamed to `upstream_used` to match the semantic. |

- **References.**

  - Fetcher rate-limit governance change request (historical CR-0011) — the paired requirement (introduces the cap, the endpoints, the dashboard surfacing).
  - Pull-mode fetcher change request (historical CR-0009) — fetcher charter (`X-Progress-Reporter` reused on the new POST; pull-mode-is-strict-subset-of-push-mode framing preserved).
  - Tree-topology and layout-axis change request (historical CR-0003) — SSE-carries-slot-updates-only boundary (referenced in Alternatives Considered).
  - API validation + OpenAPI/Scalar change request (historical CR-0008) — length-validation + `ProblemDetails` contract reused for the new endpoints.
  - [ADR-0004](./ADR-0004-opaque-per-progress-reporter-cursor.md) — fetcher plug-in shape (Decision 4 `FetchPage` shape grew a fourth `RateLimit` field — see ADR-0004 § Decision 4 amendment; ADR-0004 stays the canonical source of the adapter contract) + fetcher `minReplicas == maxReplicas == 1` (Decision 3) which guarantees single-writer semantics for the new cache.
  - [ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) — microservices architecture; the API host hosting the new in-memory cache is the same co-located Write + Read API image.
  - [ADR-0007](./ADR-0007-vendor-adapters-emit-parent-deployments.md) — vendor-adapter posture precedent (negative-space discipline + silent-degrade-with-INFO-log pattern reused here for the cap-reached log shape).
  - GitHub issue [#28](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/28) — the trigger; explicit out-of-scope list informs this ADR's "no persistence / no time-series / no token-bucket" decisions.
  - `backend/fetcher/Dashboard.Fetcher/Adapters/GitHubActions/GitHubActionsAdapter.cs:56-59` + `:627-635` — existing upstream-rate-limit detection. The leaky-bucket gate sits at the same observation point with a different threshold (`upstream_used >= self_imposed_cap` instead of `Remaining == 0`).
  - SAD §5 NFR-05 (stateless backend), NFR-02 (cost cap), NFR-04 (internal-only); SAD §7 Components C3 (API host holds the cache) + C8 (fetcher pushes per tick); SAD §10 Decisions table (cites this ADR for the leaky-bucket + republish-on-tick + per-token-cap decisions).
