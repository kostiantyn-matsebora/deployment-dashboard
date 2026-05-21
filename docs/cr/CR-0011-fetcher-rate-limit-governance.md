---
title: "CR-0011: Fetcher Rate-Limit Governance"
parent: CRs
nav_order: 11
---

# CR-0011 — Fetcher rate-limit governance: configurable self-imposed cap + usage reporting endpoints + dashboard surfacing

- **Status:** proposed
- **Decided on:** 2026-05-21
- **Trigger:** GitHub issue [#28](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/28) — *"Bring fetcher API consumption under explicit, configurable, and observable governance: cap fetcher usage via env-var rate limits (absolute or percentage of the upstream token's allowance), expose current usage + limits via the Read API, and surface the figures in the dashboard stats strip (right-aligned, alongside Services / Failures / Last deploy / Never-reached-PROD)."*

  Today the fetcher reacts only to the upstream provider's rate-limit response headers (e.g. GitHub's `X-RateLimit-Remaining=0` / `429`). There is no self-imposed cap (a single dashboard install can consume the entire shared PAT budget — starving local dev, IDE integrations, and any other tooling on the same token) and no operator-visible read on how saturated the fetcher currently is. This CR closes both gaps inside the existing read-only / single-ingress envelope.

- **Change.** Four co-introduced amendments and one framing decision:

  - **3a — Fetcher-side configuration (governance config).** Two new env vars on `Dashboard.Fetcher.Host`'s `FetcherOptions`:

    | Env var | Type | Meaning | Default |
    |---|---|---|---|
    | `FETCHER_RATE_LIMIT_ABSOLUTE` | integer (requests per upstream window) | Absolute cap on requests issued **per upstream rate-limit window** (GHA: per hour). When omitted (`null`), unused. | `null` (unset) |
    | `FETCHER_RATE_LIMIT_PERCENTAGE` | integer 1..100 (percent) | Percentage of the upstream-reported budget (`X-RateLimit-Limit`) the fetcher is allowed to consume per window. | `30` |

    **Precedence.** When both are set, **`FETCHER_RATE_LIMIT_ABSOLUTE` wins** (explicit absolute number overrides percentage of an upstream-reported total). The fetcher emits one INFO-level startup log line stating which mode is active and the resolved cap.

    **Behaviour when the cap is reached mid-window.**

    1. Stop issuing new CI/CD API requests for the current upstream rate-limit window.
    2. Resume at the upstream `X-RateLimit-Reset` time **without cursor advance** — identical semantics to today's upstream-rate-limit-hit path (`GitHubActionsAdapterTests` Deviation 4).
    3. Log a single `INFO` "self-imposed cap reached" line **per window** (not per request) to keep log volume bounded.

    **Cap accounting — leaky-bucket on observed remaining.** The fetcher derives its budget as `MyBudget := min(SelfImposedCap, UpstreamLimit)` and stops when `(UpstreamLimit − UpstreamRemaining) ≥ MyBudget`. No fetcher-side window counter / sliding window / token bucket; the upstream provider's `X-RateLimit-Remaining` is the single source of truth. Rationale in paired **ADR-0008** Decision 1.

    **Scope of the cap — per upstream token, not per (adapter, source-id).** A single GHA PAT is the rate-limit subject upstream; if the same PAT serves multiple `(adapter, source-id)` pairs (typical for a fetcher polling `owner/repo-a` + `owner/repo-b` on one PAT), splitting the cap per `source-id` would double-account a shared budget. The cap therefore applies **per upstream token** (concretely: per adapter instance, since each adapter is paired with one credential in MVP). **Reporting is still per `(adapter, source-id)`** so the dashboard can show per-repo usage even though they share one budget. Locked in paired **ADR-0008** Decision 3.

  - **3b — Usage-reporting wire surface.** Two new endpoints — one Write, one Read.

    - **`POST /api/fetcher/usage`** — fetcher pushes its observed rate-limit state plus its self-imposed cap to the backend on **every poll tick** (irrespective of whether the tick issued any CI/CD calls). Auth-gated by the same `X-Api-Key` middleware that protects `POST /api/deployments` (FR-10). `X-Progress-Reporter` is **required** (matches CR-0009's pattern on the fetcher-state endpoints). Body shape:

      ```json
      {
        "adapter_id":          "github-actions",
        "source_id":           "owner/repo",
        "upstream_limit":      5000,
        "upstream_remaining":  3247,
        "upstream_reset_at":   "2026-05-21T14:00:00Z",
        "self_imposed_cap":    1500,
        "upstream_used":       1753,
        "observed_at":         "2026-05-21T13:42:18.412Z"
      }
      ```

      Returns `200 OK` with an empty body on success. `422` on missing / over-cap required fields. `401` on missing / invalid `X-Api-Key`.

    - **`GET /api/fetcher/usage`** — backend returns the **latest** snapshot per `(adapter_id, source_id)` it has received. No auth (matches every other Read endpoint per NFR-04). Response shape — a flat array of the latest snapshot per key:

      ```json
      {
        "snapshots": [
          {
            "adapter_id":         "github-actions",
            "source_id":          "owner/repo",
            "upstream_limit":     5000,
            "upstream_remaining": 3247,
            "upstream_reset_at":  "2026-05-21T14:00:00Z",
            "self_imposed_cap":   1500,
            "upstream_used":      1753,
            "observed_at":        "2026-05-21T13:42:18.412Z",
            "received_at":        "2026-05-21T13:42:18.587Z"
          }
        ]
      }
      ```

      `received_at` is the server-side timestamp when the POST landed; lets the SPA distinguish "fresh tick" from "fetcher down for an hour, last known state stale" without needing the SSE wire to carry usage events.

      Empty array (`{ "snapshots": [] }`) when the fetcher has not pushed yet (cold start / no fetcher deployed) — **never** 404. A 404 here would conflate "no fetcher running" with "no such endpoint"; the SPA's stats-strip cluster needs a stable 200-with-empty-array shape to render its empty state cleanly.

    Wire-field semantics:

    | Field | Source | Notes |
    |---|---|---|
    | `adapter_id` | adapter's `AdapterId` (per ADR-0004 Decision 4) | e.g. `github-actions`. Free-form string; same value the host composes into `X-Progress-Reporter` as `dashboard-fetcher/{adapter_id}`. |
    | `source_id` | adapter's per-fetch logical scope | e.g. `owner/repo`. Same shape used as the path segment on `GET`/`PUT /api/fetcher/state/{source-id}` (per CR-0009 § 3b). |
    | `upstream_limit` | provider response header (GHA: `X-RateLimit-Limit`) | The provider-reported budget for the current window. |
    | `upstream_remaining` | provider response header (GHA: `X-RateLimit-Remaining`) | The provider-reported remaining requests for the current window. |
    | `upstream_reset_at` | provider response header (GHA: `X-RateLimit-Reset`, epoch seconds → ISO-8601 UTC by the fetcher) | The provider-reported window reset time. |
    | `self_imposed_cap` | fetcher-resolved from `FETCHER_RATE_LIMIT_ABSOLUTE` / `FETCHER_RATE_LIMIT_PERCENTAGE` | The absolute number of requests the fetcher will allow itself this window after precedence resolution. |
    | `upstream_used` | observed `(upstream_limit − upstream_remaining)` | Computed by the fetcher from the response headers it just observed. **Not** a fetcher-side counter (drifts on restart) — see paired ADR-0008 Decision 1. |
    | `observed_at` | fetcher wall-clock at the moment of observation | The time the headers were read; sent so the backend doesn't need clock-skew correction. |
    | `received_at` | backend wall-clock at POST landing | Added by the backend on the Read response; lets the SPA stale-out the cluster after N seconds without fresh ticks. |

  - **3c — Backend topology: in-memory cache, re-publish-on-tick recovery, no persistence.** The backend caches the latest snapshot per `(adapter_id, source_id)` key in a process-local concurrent dictionary. On replica restart the cache is empty; the **next fetcher tick re-publishes** the current snapshot, re-warming the cache within one poll interval. No new EF entity. No new table. NFR-05 (stateless backend across replicas) is preserved because:
    - The cache is **rebuildable from external input** (re-publish-on-tick) — not durable state the API uniquely holds.
    - Each replica answers `GET /api/fetcher/usage` from its own local cache; transient inconsistency across replicas during the first poll-interval after a restart is acceptable (usage is a "now gauge", not a transactional record).
    - The fetcher already runs as `minReplicas == maxReplicas == 1` per ADR-0004 Decision 3, so the re-publish-on-tick mechanism is single-writer; no cross-fetcher contention.

    Locked in paired **ADR-0008** Decision 2.

  - **3d — Dashboard surfacing: right-aligned rate-limit cluster on the stats strip.** A new visual cluster on the SPA's stats strip (`frontend/matrix/src/lib/stats-bar.component.ts`), **right-aligned** (`ml-auto` sibling to the existing left-aligned Services / Failures / Last deploy / Never-reached-PROD cluster). Minimum content per `(adapter_id, source_id)` row in the cluster:

    - Usage figure — either `42% used` or `1,400 / 5,000` form (final choice falls out of the per-option mockup proposal cycle, see § 3e).
    - Severity affordance — pill / dot colour:
      - **green** when `upstream_used / upstream_limit < 60%`
      - **amber** when `60% ≤ upstream_used / upstream_limit ≤ 85%`
      - **red** when `upstream_used / upstream_limit > 85%`

      Thresholds + final colour tokens are mockup-proposal output (Phase 2b dispatch to `frontend-engineer`); the **band semantics + ordering** are locked by this CR but the colour tokens are a Theme-axis concern (CR-0006).
    - Staleness affordance — when `now() − received_at > 2 × poll_interval` (the SPA reads `poll_interval` from a future config endpoint or hard-codes 60 s for MVP), the cluster MUST visually de-emphasise (e.g. neutral colour + "stale" badge) to avoid presenting a stuck gauge as live truth.

    **Reflow invariant (NFR-09) — strict.** The new right-aligned cluster MUST NOT overlap the left-aligned cluster at any viewport / service-count combo already covered by `testing/mockup-visual/`. The cluster collapses to a single compact pill (just the worst-band figure across snapshots) when horizontal slack is insufficient — collapse threshold is mockup-proposal output.

    **`highlight-hint` reconciliation.** The existing `highlight-hint` element already uses `ml-auto` when a version is hovered. The Phase 2b mockup proposal must reconcile the two right-side occupants — candidate strategies (no preference locked at this CR level):

    | Strategy | Notes |
    |---|---|
    | **Shift-on-hover** | The usage cluster shifts left (or fades) when the hint is active; resumes its position when the hint clears. |
    | **Stack vertically** | The cluster stays put; the hint moves above/below it. |
    | **Replace** | The hint replaces the cluster while active; the cluster restores when hint clears. |

    Defer to `frontend-engineer`'s mockup proposal cycle; SA reviews the resulting option doc (see § 3e) for invariant compliance only.

  - **3e — Mockup-before-implementation discipline.** The Phase 2b mockup proposal lands in `docs/ui/rate-limit-cluster.md` (new file, owned by `frontend-engineer`-author / `solution-architect`-semantics per `bindings.md` → "UI option docs") **plus** the corresponding cluster wiring in `docs/ui/deployment-dashboard.html`. The SPA implementation merges only after the mockup ships — matches the canonical Phase 2 mockup-before-implementation rule already applied to CR-0002 (views + attribute picker) and CR-0003 (layouts).

- **New Functional Requirements.**

  | ID | Requirement |
  |---|---|
  | **FR-18** | The fetcher shall enforce a configurable self-imposed cap on CI/CD API requests per upstream rate-limit window, configurable via `FETCHER_RATE_LIMIT_ABSOLUTE` (absolute requests-per-window, omitted → unused) or `FETCHER_RATE_LIMIT_PERCENTAGE` (1..100 percent of upstream `X-RateLimit-Limit`, default `30`). When both are set, absolute wins. When the cap is reached mid-window the fetcher shall stop issuing requests, log one INFO line, and resume at the upstream `X-RateLimit-Reset` time without cursor advance. |
  | **FR-19** | The system shall expose per-`(adapter, source_id)` rate-limit usage via `POST /api/fetcher/usage` (Write, `X-Api-Key`-gated, `X-Progress-Reporter` required) for fetcher push and `GET /api/fetcher/usage` (Read, no auth) for dashboard / operator consumption. The backend shall cache the latest snapshot per key in-memory and recover the cache after replica restart via the fetcher's re-publish-on-tick. |
  | **FR-20** | The dashboard shall surface per-`(adapter, source_id)` rate-limit usage on the stats strip in a right-aligned cluster (sibling to the existing left-aligned Services / Failures / Last deploy / Never-reached-PROD cluster), with green / amber / red severity bands at 0–60% / 60–85% / 85–100% upstream-used and a stale-affordance when no fresh push has arrived within 2× poll-interval. The reflow invariant (NFR-09) must continue to hold at every viewport / service-count combo already covered by the mockup-visual suite. |

- **Existing FR / NFR — preserved.**

  - **NFR-05 (stateless backend) — preserved.** The new in-memory cache is rebuildable from external input (fetcher re-publishes on every tick); no API replica uniquely holds durable state. See § 3c.
  - **NFR-09 (reflow invariant) — preserved by construction.** Mockup proposal lands before SPA implementation; mockup-visual suite gates the merge. See § 3d.
  - **NFR-02 (≤ $30/month) — preserved.** Zero new infrastructure (no Postgres table, no Redis, no ACA app); the cache lives in the existing API process memory. The fetcher's extra POST per tick to `/api/fetcher/usage` adds ~120 bytes per ~30 s tick = ~12 KB/hour egress; negligible.
  - **NFR-04 (internal-only) — preserved.** `POST` is `X-Api-Key`-gated like every other Write endpoint; `GET` is unauthenticated like every other Read endpoint; the SPA never embeds the API key.

- **Impact.**

  - **Amends [CR-0009](./CR-0009-pull-mode-fetcher-and-progress-reporter.md) — § 3d MVP scope additively.** CR-0009 § 3d's IN-list is extended with: (a) `FETCHER_RATE_LIMIT_ABSOLUTE` + `FETCHER_RATE_LIMIT_PERCENTAGE` env vars on `FetcherOptions`, (b) the leaky-bucket gate inside the host scheduler, (c) the `POST /api/fetcher/usage` push per poll tick. CR-0009 § 3d's three existing endpoints (`/actions/runs/{id}`, `/actions/runs/{id}/jobs`, workflow contents) are unaffected by this CR. The `ICiCdAdapter` plug-in shape from ADR-0004 Decision 4 is also unchanged — rate-limit observation reads response headers the adapter already receives; the host owns the gate (matches ADR-0004's "host owns rate-limit back-off" wording).

  - **Amends [CR-0009](./CR-0009-pull-mode-fetcher-and-progress-reporter.md) — adapter-contract clarification on response-header surfacing.** The adapter implementation must surface the three upstream rate-limit headers it observes (`X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` for GHA; equivalent fields for future adapters) on its `FetchPage` result envelope **or** on a parallel per-adapter helper (concrete shape is implementation detail, recorded in CR-0011's Wave 2 implementation by `backend-engineer`). The host reads them and composes the `POST /api/fetcher/usage` payload. This is a verbatim addendum to CR-0009 § 3d's adapter contract; the existing `FetchPage(Events, NewCursor, HasMore)` record may grow a fourth field, or the host may consume a parallel `IRateLimitObserver` hook from the adapter — locked at Phase 4 by `backend-engineer`.

  - **SAD-level content owned by this CR — verbatim FR additions.** Post-SAD-freeze, CR-defined FRs are sourced from the CR (per `solution-architect` charter § Architecture-doc freeze + change governance). SAD §4's frozen FR-01..FR-11 baseline is unchanged; the FR index (`local/index/architecture-fr.idx`) picks up the new rows below via the CR's source pointer. SAD §4 itself is **not** edited by this CR — readers follow the chain `architecture.md → CR-0011`.

    The new FRs (canonical text below — readers MUST cite this CR, not SAD §4, for FR-18 / FR-19 / FR-20):

    | ID | Requirement |
    |---|---|
    | FR-18 | The fetcher shall enforce a configurable self-imposed cap on CI/CD API requests per upstream rate-limit window, configurable via `FETCHER_RATE_LIMIT_ABSOLUTE` or `FETCHER_RATE_LIMIT_PERCENTAGE` (default 30%); absolute wins when both are set; cap-reached behaviour: stop, log once, resume at upstream reset without cursor advance. (CR-0011) |
    | FR-19 | The system shall expose per-(adapter, source-id) rate-limit usage via `POST /api/fetcher/usage` (Write, `X-Api-Key`) and `GET /api/fetcher/usage` (Read, no auth); backend caches the latest snapshot per key in-memory; re-publish-on-tick recovers the cache after replica restart. (CR-0011) |
    | FR-20 | The dashboard shall surface per-(adapter, source-id) rate-limit usage on the stats strip in a right-aligned cluster with green/amber/red severity bands and stale-affordance when no fresh push has arrived within 2× poll-interval; NFR-09 reflow invariant preserved. (CR-0011) |

  - **SAD §7 API Contract table — verbatim row additions.** Insert two new Write/Read rows immediately after the existing `PUT /api/fetcher/state/{source-id}` row (so the fetcher-related endpoints stay grouped):

    | Method | Path | Success | Description |
    |---|---|---|---|
    | `POST` | `/api/fetcher/usage` | `200 / 422` | **Write group — pull-mode adapter only** (added by [CR-0011](cr/CR-0011-fetcher-rate-limit-governance.md)). Auth-gated by `X-Api-Key`. **Requires** request header `X-Progress-Reporter` (≤ 64, non-whitespace). Fetcher pushes its current rate-limit observation + self-imposed cap on every poll tick. Body: `{ "adapter_id", "source_id", "upstream_limit", "upstream_remaining", "upstream_reset_at", "self_imposed_cap", "upstream_used", "observed_at" }`. `422` on missing / over-cap fields. Returns `200 OK` with empty body. Backend caches the latest snapshot per `(adapter_id, source_id)` in-memory; no persistence (re-publish-on-tick recovers after replica restart). |
    | `GET` | `/api/fetcher/usage` | `200 OK` | **Read group** (added by [CR-0011](cr/CR-0011-fetcher-rate-limit-governance.md)). No auth. Returns the latest cached snapshot per `(adapter_id, source_id)` shaped as `{ "snapshots": [ { ...request fields..., "received_at": "<iso-8601 UTC>" } ] }`. Empty array (`{ "snapshots": [] }`) when no fetcher has pushed yet — never `404`. `received_at` is the server-side timestamp at POST landing; lets clients stale-out the cluster after `2 × poll_interval` without depending on the SSE wire. |

    Both endpoints inherit [CR-0008](./CR-0008-api-validation-and-openapi-scalar.md)'s `ProblemDetails` error contract.

  - **SAD §7 Components — verbatim addendum to `C8 Dashboard.Fetcher` and `C3 API (Write+Read surfaces)`.**

    Append to `C8 Dashboard.Fetcher` description: *"Also enforces a configurable self-imposed rate-limit cap (per CR-0011) via `FETCHER_RATE_LIMIT_ABSOLUTE` / `FETCHER_RATE_LIMIT_PERCENTAGE` (default 30%) and pushes per-tick observations to `POST /api/fetcher/usage`."*

    Append to `C3 API (Write+Read surfaces)` description: *"Hosts the in-memory rate-limit-usage cache per CR-0011 — populated by `POST /api/fetcher/usage`, served by `GET /api/fetcher/usage`. Cache is process-local; NFR-05 preserved because the cache is rebuildable from external input (fetcher re-publishes on every tick)."*

  - **SAD §10 Decisions — no new decision row.** The leaky-bucket-on-observed-remaining + republish-on-tick + per-token-cap-with-per-source-reporting decisions are recorded in paired **ADR-0008**; the SAD §10 decisions table cites the ADR.

  - **New mockup-supporting design record:** `docs/ui/rate-limit-cluster.md` — drafted by `frontend-engineer` per the per-option mockup proposal protocol (matches CR-0002 / CR-0003 / CR-0006 precedent). Lists the chosen visual form (percentage vs ratio vs both), final severity-band colour tokens, `highlight-hint` reconciliation strategy, collapse-threshold, and reflow notes. Not in scope for this CR (which locks the contract); is a Phase 2b dispatch.

  - **`docs/ci-cd-integration.md` — new H3 sub-section under "Pull-mode alternative (optional)":** *"Self-imposed rate-limit cap (CR-0011)"*. Documents the two env vars, default 30%, precedence, behaviour on cap-reached, and a link to `GET /api/fetcher/usage` for visibility. Audience is the operator deploying the fetcher; the section is one paragraph + a small env-var table.

  - **Backend (Wave 2 — backend-engineer):**
    - New endpoint handlers `POST /api/fetcher/usage` (Write group, `X-Api-Key`-gated, `X-Progress-Reporter` required) and `GET /api/fetcher/usage` (Read group, no auth).
    - New DTO pair: `FetcherUsageSnapshotRequest` (POST body) + `FetcherUsageSnapshotResponse` (GET array element). Validation follows CR-0008 (length-only on strings; integer range on percentage / counts).
    - New in-memory cache abstraction `IFetcherUsageCache` (concurrent dictionary keyed by `(adapter_id, source_id)`). Singleton lifetime. No EF entity. No migration.

  - **Fetcher (Wave 2 — backend-engineer, fetcher project):**
    - New options class entries on `FetcherOptions`: `RateLimitAbsolute: int?`, `RateLimitPercentage: int = 30`. Bound from env vars `FETCHER_RATE_LIMIT_ABSOLUTE` / `FETCHER_RATE_LIMIT_PERCENTAGE` (matches the existing fetcher options binding style).
    - Cap-resolution function (`absolute ?? percentage * upstreamLimit / 100`) + leaky-bucket gate inside the host scheduler that consults the last observed `(upstreamLimit, upstreamRemaining)`.
    - Per-tick push to `POST /api/fetcher/usage` after each `FetchPageAsync` cycle (push runs even on no-event ticks; push runs even when the cap-reached path was taken — the snapshot then reflects the cap-reached state).
    - Adapter-contract surface for upstream-rate-limit headers (extension of `FetchPage` or parallel hook — decided at Phase 4).

  - **Frontend (Wave 2 — frontend-engineer):**
    - New service in `frontend/shared/` that polls `GET /api/fetcher/usage` on the same cadence as the existing matrix poll (or subscribes to a future SSE channel — out of scope for this CR per CR-0003 SSE-no-non-slot-payload boundary).
    - New cluster component composed into `frontend/matrix/src/lib/stats-bar.component.ts` (right-aligned, sibling to the existing cluster).
    - Mockup proposal (`docs/ui/rate-limit-cluster.md` + canonical mockup wiring) ships first per § 3e.

  - **Tests (Wave 2 — qa-engineer):**
    - xUnit unit tests in `Dashboard.Fetcher.Tests` for the leaky-bucket gate (cap-reached → stop; reset → resume without cursor advance; precedence absolute > percentage; default 30% when neither set).
    - Functional test in `testing/functional/` for `POST /api/fetcher/usage` → `GET /api/fetcher/usage` round-trip (200 → cache → 200; 401 on missing X-Api-Key; 422 on missing required fields; empty array when no push has occurred).
    - Mockup-visual coverage in `testing/mockup-visual/` for the new cluster at the existing viewport / fixture combinations (added by qa-engineer after the mockup ships).

## Acceptance criteria

- [ ] FR-18, FR-19, FR-20 are sourced from this CR (SAD §4 baseline unchanged per the post-freeze pattern); the FR index (`local/index/architecture-fr.idx`) picks up the new rows from the CR source on reindex.
- [ ] SAD §7 API Contract table gains the two new rows (`POST /api/fetcher/usage`, `GET /api/fetcher/usage`) verbatim from this CR. (SAD §7 is the only frozen-doc table this CR amends directly, matching the CR-0009 precedent where the API-Contract table grew under that CR's direction.)
- [ ] `FETCHER_RATE_LIMIT_ABSOLUTE` + `FETCHER_RATE_LIMIT_PERCENTAGE` documented in `FetcherOptions` XML-doc + `dev_env/docker-compose.local.yml` (commented out — defaults take effect; default value `30` for percentage). Precedence rule (absolute > percentage) documented at both surfaces.
- [ ] xUnit unit test in `Dashboard.Fetcher.Tests` covers: (a) cap not reached → tick issues requests; (b) cap reached mid-window → tick stops; (c) upstream `X-RateLimit-Reset` elapsed → tick resumes without cursor advance; (d) absolute wins over percentage when both set; (e) default 30% when neither set; (f) one INFO log line per window (not per request).
- [ ] Functional test in `testing/functional/` covers: (a) `POST /api/fetcher/usage` 200 on valid payload; (b) `GET /api/fetcher/usage` returns the same snapshot; (c) `GET` returns empty `{ "snapshots": [] }` array (not 404) when no push has happened; (d) 401 on missing / invalid `X-Api-Key`; (e) 422 on missing required fields; (f) replica restart followed by one fetcher tick → cache recovered.
- [ ] Mockup HTML (`docs/ui/deployment-dashboard.html`) ships the right-aligned cluster before the SPA implementation merges (Phase 2b mockup-before-implementation rule, owned by `frontend-engineer`).
- [ ] `docs/ui/rate-limit-cluster.md` ships alongside the mockup change (semantics owned by SA; mockup ownership by `frontend-engineer`).
- [ ] SPA stats strip renders the right-aligned cluster matching the mockup; mockup-visual suite passes at every viewport / service-count combo already covered. Reflow invariant (NFR-09) holds — the new cluster does not overlap the left cluster.
- [ ] `highlight-hint` and the rate-limit cluster reconcile per the strategy locked in `docs/ui/rate-limit-cluster.md`; mockup-visual covers both states (hint active + hint inactive).
- [ ] `docs/ci-cd-integration.md` gains the new H3 sub-section *"Self-imposed rate-limit cap (CR-0011)"* under "Pull-mode alternative (optional)".
- [ ] Paired ADR-0008 ships in `docs/adr/` and is cited from this CR + from SAD §10 (decisions table referencing the ADR for the leaky-bucket + republish-on-tick + per-token-cap decisions).

## Open trade-offs — recommendations (awaiting user sign-off before Wave 2)

### (i) Adapter-contract surface for upstream-rate-limit headers

**Context.** The host needs the three observed values (`upstream_limit`, `upstream_remaining`, `upstream_reset_at`) to compose the `POST /api/fetcher/usage` payload, and the leaky-bucket gate needs the latest `(upstream_limit, upstream_remaining)` pair to decide whether to issue the next request. Two shapes plausible:

| Option | Detail |
|---|---|
| **A — Extend `FetchPage` to `FetchPage(Events, NewCursor, HasMore, RateLimit)` where `RateLimit` is a `RateLimitObservation?` record** | One contract surface; adapter authors implement one method; host reads `result.RateLimit` after every call. Nullable so adapters whose upstream API does not expose a rate-limit window (none in the MVP set; possible future ones) can return `null`. |
| **B — Add a parallel `IRateLimitObserver` interface that adapters MAY implement** | Capability-detection pattern (cast adapter to `IRateLimitObserver`); preserves `FetchPage` shape; adds an interface the host probes on each tick. Slightly more idiomatic .NET but exposes a "second contract" surface for the same fetch cycle. |

**Recommendation: Option A — extend `FetchPage`.** Rationale: the rate-limit observation is a fetch-cycle output by definition (it comes from the same HTTP response as `events` + `new cursor`), not a sideband capability. Bundling it into `FetchPage` keeps "what happened this tick" in one place. Nullable on the record handles the future-adapter "no rate-limit window" case cleanly. Lock at Phase 4 by `backend-engineer`; final shape lands in ADR-0004 as a one-line addendum (or, if Option B is preferred at Phase 4, ADR-0004 stays unchanged and the new interface is documented in CR-0011 § Impact).

### (ii) Visual form — percent vs ratio vs both

**Context.** Issue #28 lists `42% used` and `1,400 / 5,000` as candidate forms. Compactness vs precision trade-off.

**Recommendation: defer to `frontend-engineer`'s mockup proposal (Phase 2b).** SA-level locks: the form must be parsable at a glance from ≥ 1024 px viewport without hover; tooltip-on-hover exposes the full triple `(used, limit, reset_at)` for precision-seeking operators. No CR-level pre-commitment; `docs/ui/rate-limit-cluster.md` records the chosen form with the same rigour as `version-display-options.md`.

### (iii) SSE wire vs polling for the SPA's usage feed

**Context.** The SPA needs to refresh the cluster on roughly the fetcher's poll cadence. Two options: (a) SPA polls `GET /api/fetcher/usage` on a timer (e.g. every 30 s); (b) backend publishes usage updates on the existing SSE channel.

**Recommendation: option (a) — SPA polls.** Rationale: CR-0003 § "SSE carries slot updates only" is an explicit boundary against non-slot payloads on the SSE wire. Adding usage events to SSE would require either a new event type (breaks the single-event-type assumption SPA + harness rely on) or a second SSE endpoint (doubles the LISTEN/NOTIFY load on Postgres for a "now gauge" that doesn't need < 5 s latency). Polling every 30 s costs one cached-cache-hit GET per client per 30 s; negligible. Future "live usage" need (well below 30 s) would justify a CR amending CR-0003's SSE boundary; not for this slice. Lock at Phase 4 by `frontend-engineer`.

---

**All three trade-offs above are recommendations; awaiting user sign-off before Wave 2 implementation begins.** Once signed off, the recommendations move into the body of this CR (locked) and Wave 2 implements against them.

## References

- GitHub issue [#28](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/28) — the trigger.
- [CR-0009](./CR-0009-pull-mode-fetcher-and-progress-reporter.md) — parent CR (introduces the fetcher, the adapter contract, the `X-Progress-Reporter` header). CR-0011 amends § 3d additively for the new env vars + new push.
- [CR-0008](./CR-0008-api-validation-and-openapi-scalar.md) — length-validation + `ProblemDetails` contract reused for the new endpoints.
- [CR-0003](./CR-0003-tree-topology-and-layout-axis.md) — SSE-carries-slot-updates-only boundary (preserved; no usage events on SSE).
- **ADR-0008 (paired)** — leaky-bucket on observed remaining + re-publish-on-tick (no persistence) + per-token cap / per-`(adapter, source-id)` reporting split.
- [ADR-0004](../adr/ADR-0004-opaque-per-progress-reporter-cursor.md) — fetcher envelope (cursor + adapter plug-in shape); CR-0011 amends § Decision 4's `FetchPage` shape additively per Open trade-off (i) recommendation (lock at Phase 4).
- [ADR-0006](../adr/ADR-0006-microservices-architecture-with-container-co-location.md) — microservices architecture; the API host hosting the new in-memory cache is the same co-located Write + Read API image.
- SAD §4 Functional Requirements, §5 Non-Functional Requirements (NFR-05 / NFR-09 / NFR-02 / NFR-04 preserved), §7 API Contract (new endpoint rows), §7 Components C3 + C8 (descriptions extended).
- `frontend/matrix/src/lib/stats-bar.component.ts` — stats-strip insertion point.
- `backend/fetcher/Dashboard.Fetcher/Hosting/FetcherOptions.cs` — options surface for the new env vars.
- `backend/fetcher/Dashboard.Fetcher/Adapters/GitHubActions/GitHubActionsAdapter.cs:56-59` + `:627-635` — existing rate-limit detection (informs the leaky-bucket gate + the adapter contract for header surfacing).
- `docs/ci-cd-integration.md` — new H3 sub-section *"Self-imposed rate-limit cap (CR-0011)"* under "Pull-mode alternative (optional)".
