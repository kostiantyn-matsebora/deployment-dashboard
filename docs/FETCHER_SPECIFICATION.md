# Fetcher Specification — `Dashboard.Fetcher`

**Status:** Draft · **Date:** 2026-05-29

Implementation contract for **`Dashboard.Fetcher`** — the optional, separately-deployed pull-mode adapter that translates a CI/CD tool's **pull** API into the dashboard's **push** ingest. Its defining requirement is a **tool-agnostic abstraction layer**: the polling host knows nothing about any specific CI/CD system; all tool-specifics live behind one interface.

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/SAD.md`](SAD.md) §3, §7 | Fetcher as opt-in pull→push edge; backend stays CI-agnostic. |
| [`docs/api/openapi.yaml`](api/openapi.yaml) | `POST /api/deployments`, `GET/PUT /api/fetcher/state/{adapter}`, `X-Progress-Reporter`. |
| [`docs/API_SPECIFICATION.md`](API_SPECIFICATION.md) | Wire DTO (`DeploymentEventIngest`), cursor + append-only semantics. |
| [`docs/GITHUB_EMULATOR_SPECIFICATION.md`](GITHUB_EMULATOR_SPECIFICATION.md) | GitHub emulator service — the test mock and demo data source the fetcher polls in demo/CI mode. |
| [`docs/diagrams/github-emulation.md`](diagrams/github-emulation.md) | Visual reference for demo-mode topology and seed→backfill→poll sequence. |

> `CR-####` / `ADR-####` documents referenced elsewhere **do not exist** — ignore those citations.

---

## 1. Role

The fetcher is a standalone worker that, on an interval:

1. loads its opaque cursor from `GET /api/fetcher/state/{adapter}`,
2. asks a **CI/CD adapter** for new deployment events since that cursor,
3. `POST`s each event to `/api/deployments` (same `X-Api-Key`, plus `X-Progress-Reporter: dashboard-fetcher/<adapter>`),
4. persists the advanced cursor via `PUT /api/fetcher/state/{adapter}`.

It is **just another pusher** — the backend treats fetcher traffic identically to a CI notify step. No CI/CD-specific code ever enters the backend (SAD §3).

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| F1 | **Pull→push via the public ingest.** Reuses `POST /api/deployments` + `X-Api-Key`; never a private backdoor. | Backend stays tool-agnostic (SAD §3). |
| F2 | **One abstraction — `ICiCdAdapter`.** The host/orchestrator depend only on it + the canonical DTO + an opaque cursor string. **Zero** tool-specifics leak out. | The headline requirement. Adding Azure DevOps / Jenkins = a new adapter, no host changes. |
| F3 | **Adapter owns its cursor shape.** Persisted opaquely via `/api/fetcher/state/{adapter}`; host never parses it. | Matches openapi opaque-cursor contract. |
| F4 | **GitHub adapter sources the Deployments + Deployment Statuses REST API.** `AdapterId = github-actions`. | Those endpoints carry `environment` + the status lifecycle the matrix needs (workflow-runs API lacks `environment`). |
| F5 | **At-least-once delivery per chunk.** Cursor advances after all POSTs in a chunk succeed and the cursor is persisted; a throw mid-chunk leaves the cursor at the previous chunk → next loop re-delivers that chunk (dupes OK, append-only). | Store is append-only / no dedup — duplicates are acceptable, dropped events are not. |
| F6 | **Single replica per adapter.** No leader election; the cursor is shared but unlocked. | Two replicas would double-post. The API (not the fetcher) is the horizontally-scaled tier. |
| F7 | **Bounded initial backfill.** On a `404` (no cursor yet) the adapter starts from `now − INITIAL_LOOKBACK`, not from repo genesis. | Avoids flooding the store with full history on first run. |
| F8 | **Adapter handles conditional requests + rate limits.** ETag / `If-None-Match`, `X-RateLimit-*`, `Retry-After`, backoff. | Keeps polling cheap and a good API citizen — internal to the adapter. |
| F9 | **Config-driven; base URL overridable.** Repos + service/version mapping + GitHub base URL from env. | Integration repoints the GitHub base URL at a mock; production points at `api.github.com`. |
| F10 | **`parent_deployments` derived from workflow `needs` graph.** The adapter fetches the workflow YAML for each run, parses the deployment-job subgraph (`environment:` + `needs:`), and resolves parent edges to `deployment_id` values (§5.6). Any resolution failure → `parent_deployments = []`; ingest is never blocked. | Reproduces the deployment graph GitHub surfaces in the Actions Run UI. `explicit parent` is the Swimlanes default correlation predicate — accurate population here makes it work out of the box. |
| F11 | **Workflow graph cached in-memory per `(repo, run_id)`.** Bounded LRU (≤ 200 entries). Cache entry includes workflow `name` (used as service identity), `path`, `head_sha`, and parsed deployment-job subgraph. | Avoids re-fetching the workflow YAML for each status event that shares a run; workflow runs are immutable so no invalidation is needed. |
| F12 | **Service identity = workflow YAML `name:` field**, resolved via the run's `path` (e.g. `.github/workflows/deploy.yml`) → the active workflow with that path → its YAML `name:` field. `run.Name` (the run-name display value, overridable via `run-name:`) is **not** used for identity. `GITHUB__SERVICE_MAP` overrides at two levels — workflow name (key without `/`) or repo (key = `owner/repo`). Resolution order: path→workflow-name lookup → workflow-level override → repo-level override → workflow name as-is. Non-Actions deployments (no `target_url`) fall back to the repo's short name. | Stable across `run-name:` overrides; SERVICE_MAP handles edge cases without restructuring the pipeline. |
| F13 | **Backfill fills the last `BACKFILL_DEPTH` status events per `(service, environment)` slot** (default 2). Enumerates active workflows and environments per repo; paginates deployments newest-first. For each candidate deployment, fetches its statuses and counts the mapped ones (§5.3; unmapped states like `waiting`/`inactive` don't count). Stops scanning a slot once `eventsSoFar ≥ BACKFILL_DEPTH`. After collecting candidate events, trims to the `BACKFILL_DEPTH` latest by `status.created_at` per slot before posting. Stops for an environment when `consecutiveNoProgress ≥ StallWindow` (20) — a deployment makes no progress when its service is already at depth or is unknown or has zero mapped statuses. The YAML graph is fetched **only** for deployments contributing kept events; discarded deployments cost only statuses + run-metadata. `BACKFILL_MAX_AGE` is the hard backstop. | Controls how many history drawer entries seed each slot at startup; status-event count matches what the history drawer shows. No-progress stop and defer-YAML bounds API cost as before. |
| F14 | **Backfill triggers on null cursor (first run) or `BACKFILL=true`.** After completion cursor advances to `max(status.created_at)` seen, preventing re-post in the subsequent normal poll. | `BACKFILL=true` supports the "reset data" scenario without redeploying or clearing the fetcher-state row manually. |
| F15 | **Version source is `type:key` configurable; no fallback, no truncation except `sha`.** Three types: `attribute` (deployment field; `sha` key → 7-char truncation, all others as-is), `payload` (deployment payload JSON field), `artifact` (Actions artifact archive — archive name = filename, content is a plain-text version string). Missing / null / unreachable source → `version = null`; ingest is never blocked. Default: `attribute:sha`. | Covers the three real-world versioning patterns without a silent fallback that would mask misconfiguration. |
| F16 | **Rate-limit budget on OWN usage.** Adapter self-throttles to at most `GITHUB__RATE_LIMIT_BUDGET_PCT`% (default 30) of its hourly request quota. Quota is read from `GITHUB__RATE_LIMIT` when set; otherwise discovered via `GET /rate_limit` on startup (failure → safe default of 5 000). The fetcher tracks its **own request count since process start** (not `X-RateLimit-Used`, which counts all consumers of the token). When own count reaches the budget, the adapter waits until `X-RateLimit-Reset`. Counter resets after the window rolls over. | Prevents sleeping when the token is heavily used by other consumers; the fetcher is a background process and must not monopolise a shared token. |
| F17 | **Control-plane participant (gated on CONTROL_API_KEY).** When `CONTROL_API_KEY` is set, a second long-lived task subscribes to `GET /api/control/stream` with exponential backoff on failures (1 s → 2 s → 4 s … capped 30 s). When `CONTROL_API_KEY` is empty, the subscriber is never started and a startup log message records the absence. Reacts to: drain + ack on `reset-initiated`, drop cursor + backfill + report `running` on `reset-completed`. Still **just a consumer** of the existing control-plane contract — no backend change (F1, SAD §3). | Prevents 404-looping when the API's control surface is disabled (empty key); backoff avoids hammering on transient failures. |
| F18 | **Per-cycle rate-limit reporting.** After every successful poll cycle, when a `RateLimitSnapshot` is available, the fetcher posts a `rate-limit` component event to `POST /api/control/events`. Reuses the existing `ComponentEventClient` transport. Skipped when snapshot is null (before the first GitHub response). Not gated on `CONTROL_API_KEY` — always active when `API_KEY` is present. Non-fatal: POST failures are logged and swallowed so reporting never breaks the poll loop. | Operators and end-users can observe CI/CD quota consumption in real time without backend change. The snapshot already exists (F16); this adds only the emit step. |

---

## 3. Solution layout

```
backend/
  fetcher/       Dashboard.Fetcher/        # abstraction + adapters + clients + orchestrator (library)
    Abstractions/   ICiCdAdapter, FetchResult
    Adapters/GitHub/  GithubActionsAdapter, GithubClient, mapping, cursor
    Ingest/         IngestClient, FetcherStateClient   (HTTP clients to the API)
    Control/        ControlStreamSubscriber, ComponentEventClient   (§5.10)
    Orchestration/  PollLoop / per-adapter runner
  fetcher-host/  Dashboard.Fetcher.Host/   # BackgroundService worker(s) + DI + config + Dockerfile
                                           # also hosts a minimal HTTP listener for GET /health
  tests/
    Dashboard.Fetcher.Tests/               # owned here, excluded from the API test run
```

- `Control/ControlStreamSubscriber` — the long-lived control-stream reader (`fetch()`+`ReadableStream` equivalent: `HttpClient` + `HttpCompletionOption.ResponseHeadersRead` streaming the body; **not** `EventSource`). Parses SSE frames, tracks `Last-Event-ID`, honours `: ping` heartbeat, dispatches reset events to the poll-loop runner.
- `Control/ComponentEventClient` — HTTP client for `POST /api/control/events` (the `reset-ack` and `status` posts). Distinct from `Ingest/IngestClient`; both target the API but carry different headers (`X-Component-Id` vs `X-Progress-Reporter`).
- The host runs **two concurrent tasks**: the existing per-adapter poll loop (§4) and the `ControlStreamSubscriber`. The subscriber signals the runner to pause/resume; it never fetches or posts deployment events itself.
- **`GET /health`** — host-level liveness endpoint served by the ASP.NET web listener in `Dashboard.Fetcher.Host`. Returns `200 OK` while the host process is running (no body required). This is host-level observability only; the `ICiCdAdapter`/ingest/control-plane logic is **unchanged** (F1, G2). The web listener uses the standard ASP.NET `ASPNETCORE_URLS` / port mechanism; no adapter or library change.
- **`GET /readyz`** — functional readiness endpoint. Reflects actual GitHub poll-cycle health via `IFetcherReadinessIndicator` / `FetcherReadinessIndicator`; see §6.1.

Reuses **`Dashboard.Shared`** for the `DeploymentEventIngest` DTO — the fetcher emits the exact same wire type the contract defines. Stack = **.NET 10** (SAD §6), packaged as a standard container.

---

## 4. The abstraction (F2)

```csharp
namespace Dashboard.Fetcher.Abstractions;

/// The ONLY surface the host knows. No GitHub/ADO/Jenkins type ever appears here.
public interface ICiCdAdapter
{
    /// Stable, lowercase-kebab id. Used as the X-Progress-Reporter suffix
    /// (dashboard-fetcher/<id>) and the /api/fetcher/state/{adapter} key.
    string AdapterId { get; }

    /// Streams chunks of events newer than `cursor` (null = first run).
    /// Each yielded FetchResult carries the events for that chunk plus the full
    /// advanced cursor as of that chunk (opaque to the host).
    /// Backfill yields one chunk per (repo, env) plus a zero-event completion
    /// marker per repo. Normal poll yields a single chunk.
    IAsyncEnumerable<FetchResult> FetchAsync(string? cursor, CancellationToken ct);
}

/// Events are the canonical wire DTO — already tool-neutral.
public sealed record FetchResult(
    IReadOnlyList<DeploymentEventIngest> Events,
    string? Cursor);
```

**Orchestrator (tool-agnostic, one loop per adapter):**

```csharp
var cursor = await state.GetAsync(adapter.AdapterId, ct);     // GET  /api/fetcher/state/{id} (404 -> null)
while (!ct.IsCancellationRequested)
{
    // Iterate chunks; persist cursor after each chunk that advances it.
    // Zero-event chunks (backfill completion markers) are also persisted when cursor changes.
    await foreach (var chunk in adapter.FetchAsync(cursor, ct))
    {
        foreach (var ev in chunk.Events)
            await ingest.PostAsync(ev, adapter.AdapterId, ct);  // POST /api/deployments

        if (chunk.Cursor != cursor)
        {
            await state.PutAsync(adapter.AdapterId, chunk.Cursor!, ct);  // PUT /api/fetcher/state/{id}
            cursor = chunk.Cursor;
        }
    }
    await Task.Delay(pollInterval, ct);
}
```

- Cursor is **persisted after each chunk** whose cursor advances (F5). A throw mid-chunk leaves the cursor at the last completed chunk → next loop re-delivers from that point (dupes OK, append-only).
- Zero-event completion markers (backfill repo-done) ARE persisted when they carry a new cursor.
- The host references **no** `Dashboard.Fetcher.Adapters.GitHub` type — adapters are resolved via DI as `IEnumerable<ICiCdAdapter>`.

---

## 5. GitHub implementation (`GithubActionsAdapter`)

`AdapterId = "github-actions"`. Sources the GitHub REST API; everything below is **encapsulated inside the adapter**.

### 5.1 Endpoints

| Purpose | Call |
|---|---|
| List deployments per repo | `GET /repos/{owner}/{repo}/deployments?environment=&per_page=` |
| Status lifecycle of a deployment | `GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses` |
| Workflow run metadata | `GET /repos/{owner}/{repo}/actions/runs/{run_id}` |
| Workflow file contents | `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}` |
| List active workflows (backfill) | `GET /repos/{owner}/{repo}/actions/workflows?per_page=100` |
| List environments (backfill) | `GET /repos/{owner}/{repo}/environments` |
| List artifacts for a run | `GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts` |
| Download artifact archive | `GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip` |

Auth: `Authorization: Bearer <token>` + `Accept: application/vnd.github+json` + `X-GitHub-Api-Version`. Base URL from config (`https://api.github.com` default; overridable for the integration mock).

### 5.2 Field mapping → `DeploymentEventIngest`

| Contract field | GitHub source |
|---|---|
| `deployment_id` | `gh-deploy-{deployment.id}` (correlation key; all status rows of one deployment share it) |
| `service` | workflow YAML `name:` field from run metadata (§5.6.2 cache); resolved via `ResolveService` (§5.8.3) |
| `environment` | `deployment.environment` |
| `status` | mapped from `status.state` (§5.3) |
| `happened_at` | `status.created_at` (UTC) |
| `version` | resolved via §5.8 — `null` when source yields nothing |
| `sha` | `deployment.sha` |
| `ref` | `deployment.ref` |
| `actor` | `status.creator.login` ?? `deployment.creator.login` |
| `run_url` | `status.target_url` (the Actions run, when present) |
| `run_number` | `run_id` extracted from `status.target_url` via `/actions/runs/(\d+)` (same extraction as §5.6.1; reuse cached value) |
| `parent_deployments` | derived — §5.6 |

One **GitHub deployment status** → one **event row** (matches the append-only lifecycle: `in-progress` → `success`/`failure` rows sharing `deployment_id`).

### 5.3 Status mapping

| GitHub `state` | Contract `status` |
|---|---|
| `queued`, `pending`, `in_progress` | `in-progress` |
| `success` | `success` |
| `failure`, `error` | `failure` |
| `inactive` | *(skipped — supersession marker, not a transition)* |

### 5.4 Cursor shape (opaque to the backend)

Base64 of compact JSON, forward-only, well under the 8 KiB limit.

**Normal / post-backfill shape:**
```json
{ "repos": { "acme/api": { "since": "2026-05-28T10:14:02Z" }, "acme/web": { "since": "2026-05-28T09:50:00Z" } } }
```

**Mid-backfill shape (backfill section present while in progress):**
```json
{
  "repos": { "acme/api": { "since": "2026-05-28T10:14:02Z" } },
  "backfill": {
    "acme/web": { "anchor": "2026-05-28T12:00:00Z", "done_envs": ["dev", "staging"] }
  }
}
```

- `repos[repo].since` = high-water mark on `status.created_at`. Set only on backfill completion or normal poll advance. Never set mid-backfill.
- `backfill[repo].anchor` = UTC timestamp when this repo's backfill pass started. Stable across resumes (prevents scan-window drift on restart).
- `backfill[repo].done_envs` = list of environment names whose per-env scan is complete and emitted. Used to skip already-processed envs on resume.
- `backfill` key absent = no backfill in progress (old cursors decode safely with empty backfill).
- First run (cursor `null`): `since = now − INITIAL_LOOKBACK` (F7).
- ETags cached for the live poll (per-repo deployment list + per-deployment statuses) to short-circuit unchanged pages with `304` (F8); see §5.5.2.

### 5.5 Resilience (inside the adapter)

- GitHub `5xx` / transport error → throw; orchestrator keeps the old cursor and retries next interval.
- `403`/`429` with rate-limit headers → honour `Retry-After` / `X-RateLimit-Reset`, back off.
- `304 Not Modified` → no events, cursor unchanged.
- Workflow run or file fetch non-2xx, YAML parse error, or missing `target_url` → `parent_deployments = []` for the affected events; never throw / never block ingest (F10).
- Artifact list or download non-2xx, or artifact name not found → `version = null`; never throw / never block ingest (F15).

#### 5.5.1 Poll efficiency — terminal deployment skip

`PollRepoAsync` maintains a bounded instance cache (`deploymentId → runId?`, cap 2 000, LRU eviction) across poll cycles. **Terminal** GitHub states: `success`, `failure`, `error`, `inactive`.

| Condition | Behaviour |
|---|---|
| `deployment.Id` in terminal cache | Skip `GET /deployments/{id}/statuses` entirely. Still include the deployment in the `envToDeploymentId` map (§5.6.4) using the cached `runId` so parent edges remain resolvable. Contributes no new events. |
| Not in cache | Fetch statuses as normal. After fetch: if the latest status (newest-first ordering from GitHub) is terminal, record `deploymentId → runId` in the cache. |
| First appearance of any `deployment.Id` | Always fetched (id never in cache). |
| Non-terminal latest status | NOT cached; re-fetched every cycle until terminal. |

The parent-derivation map (§5.6.4) is built from **freshly-fetched deployments ∪ cached-terminal deployments** in the window. This preserves cross-environment parent edges: a `staging` deployment that went terminal in cycle N is still present in the map in cycle N+1, allowing a `production` deployment in the same run to resolve its parent correctly.

Scope: **live poll only**. Backfill is unchanged.

#### 5.5.2 Poll efficiency — conditional requests (ETag)

Scope: **live poll only** (backfill unchanged). Applies to two endpoints per repo per cycle:
- `GET /repos/{owner}/{repo}/deployments` (the per-repo deployment list).
- `GET /repos/{owner}/{repo}/deployments/{id}/statuses` (per non-terminal deployment).

**Mechanism (`GithubClient.GetPagedConditionalAsync<T>`).**

`If-None-Match` is sent on **page 1 only**. A page-1 `304` means the whole list is unchanged — GitHub returns items newest-first, so any new item would change page 1. Pages 2+ are fetched unconditionally. A `304` is free: GitHub does not charge it against the quota (`X-RateLimit-Remaining` is unchanged), so it is **NOT** counted by the fetcher's own-request budget counter (`own_used`). The budget still processes the `X-RateLimit-Reset` / `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers unconditionally so the snapshot stays current.

**Instance caches** (both persist across cycles; adapter is a DI singleton):
- `_deploymentsListCache` — per-repo `(etag, windowed deployments snapshot)`. Capacity 64 entries, LRU eviction.
- `_statusEtagCache` — per-deployment `(etag, runId?)` for in-flight (non-terminal) deployments. Capacity 2 000 entries, LRU eviction.

**Conditions and behaviour:**

| Condition | Behaviour |
|---|---|
| Deployments list `304` | Reuse cached windowed snapshot. Per-deployment status checks still run normally — a list `304` never skips status re-checks. |
| Deployments list `200` | Apply `cutoff` window to fresh items; refresh cache only when a `ETag` header is present. |
| Deployment in terminal cache | Skip `GET /deployments/{id}/statuses` entirely (§5.5.1); terminal-skip wins — the conditional path never runs for it. |
| Non-terminal deployment statuses `304` | Reuse cached `runId` for the env→deploymentId map (§5.6.4); emit no events (list is byte-identical and the cursor has advanced past every cached status's `created_at`). Deployment stays eligible for future conditional fetches — not promoted to terminal. |
| Non-terminal deployment statuses `200` | Process statuses normally; store new ETag + extracted `runId` in `_statusEtagCache`. If latest status is terminal, also record in the terminal cache (§5.5.1). |

**Graceful degradation.** When the server omits the `ETag` header on a `200` response (e.g. the `github-emulator`), nothing is cached and every subsequent cycle is a normal unconditional fetch — correctness is unaffected.

**Interplay with §5.5.1.** Both terminal-skip and ETag-`304` populate the same `reusedRunIds` map, which feeds the `envToDeploymentId` build in §5.6.4. Cross-cycle and cross-environment parent edges are preserved regardless of which path suppressed the status re-fetch.

### 5.6 Parent deployment derivation (F10)

Populates `parent_deployments` by reconstructing the deployment-job subgraph from the workflow YAML. Runs inside `FetchAsync` before the event batch is returned — all events for the same poll window are resolved together.

#### 5.6.1 run_id extraction

For every deployment status, extract `run_id` from `status.target_url` via pattern `/actions/runs/(\d+)`. If absent or no match → `parent_deployments = []` for that event, skip §5.6.2–5.

#### 5.6.2 Workflow graph fetch and parse *(F11 — LRU-cached per `(repo, run_id)`)*

| Step | Call | Use |
|---|---|---|
| 1 | `GET /repos/{owner}/{repo}/actions/runs/{run_id}` | obtain `path` (e.g. `.github/workflows/deploy.yml`) and `head_sha`; `name` (run display name) is used only as a last-resort fallback if the YAML `name:` field is absent |
| 2 | `GET /repos/{owner}/{repo}/contents/{path}?ref={head_sha}` | Base64-decode `content` → workflow YAML; parse top-level `name:` field → **service identity** (F2 / F12) |

Service identity comes from the YAML `name:` field (the workflow's static definition name), **not** `run.Name` (which can be overridden by `run-name:` and changes per run). When the YAML `name:` field is absent, the parser falls back to `run.Name`; if that is also absent, the repo short name.

Parse the `jobs:` map. Normalise per-job fields:

| YAML field | Input form | Normalise to |
|---|---|---|
| `environment` | `"prod"` | `"prod"` |
| `environment` | `{name: "prod", url: "…"}` | `"prod"` |
| `needs` | `"build"` | `["build"]` |
| `needs` | `["build", "test"]` | `["build", "test"]` |
| `needs` | absent | `[]` |

**Deployment jobs** = jobs where `environment` is non-null after normalisation.

Non-2xx on either call or YAML parse error → `parent_deployments = []` for all events in this run; stop.

#### 5.6.3 BFS ancestor search

For each deployment job `J`, find its **parent deployment jobs** — those reachable upward through `needs` that are themselves deployment jobs. Non-deployment jobs are transparent (the search continues through them):

```
FindParentDeploymentJobs(J, deploymentJobs, allJobs):
  queue   ← copy of J.needs
  visited ← {}
  parents ← []
  while queue not empty:
    id ← dequeue
    if id ∈ visited: continue
    visited.add(id)
    if id ∈ deploymentJobs:
      parents.add(id)                      // deployment ancestor — do not recurse further
    else if id ∈ allJobs:
      queue.addAll(allJobs[id].needs)      // non-deployment intermediary — look through it
  return parents
```

> Not recursing through a found deployment ancestor preserves per-environment direct edges. That ancestor's own parents are derived when its event is processed.

#### 5.6.4 Run-scoped deployment_id lookup

Build `envToDeploymentId[run_id][environment]` from **all** deployment objects fetched in the current poll cycle (not only those with new statuses):

- Include deployment `D` in the map for `run_id` if any of `D`'s fetched statuses has a `target_url` matching that `run_id`.
- Collision (matrix strategy — multiple deployments share `(run_id, environment)`): keep the one with the latest `deployment.created_at`.
- Key: `D.environment`; value: `"gh-deploy-{D.id}"`.

Because all deployments in a single workflow run are created within a short window, they will appear in the same or adjacent poll cycle and be present in the map.

#### 5.6.5 Setting parent_deployments

For each event `E` (environment `ENV`, run_id `R`):

1. Find deployment job `J` where `J.environment == ENV`. If none → `E.parent_deployments = []`.
2. `parentJobs ← FindParentDeploymentJobs(J, …)`.
3. For each `P ∈ parentJobs`: resolve `id ← envToDeploymentId[R][P.environment]`.
4. Omit unresolved entries — a parent deployment not yet observed is a forward reference; the Swimlanes view tolerates dangling `parent_deployments` values and resolves them at render time.
5. `E.parent_deployments ← [resolved ids]` (unique; order not significant).

### 5.7 Version resolution (F15)

Determines the `version` field for a deployment event. Returns `null` when the source yields nothing — no fallback. Only `sha` truncates (to 7 chars); all other keys used as-is.

#### 5.7.1 Source types

| Type | Reads | `null` conditions |
|---|---|---|
| `attribute` | `deployment.<key>` — `sha` key truncated to 7 chars; all other attributes used as-is | attribute absent or null on the deployment object |
| `payload` | `deployment.payload.<key>` (payload is free-form JSON) | payload absent, not a JSON object, or field absent/null |
| `artifact` | plain-text content of the GitHub Actions artifact archive named `<key>` | `run_id` absent (non-Actions deployment), artifact not found, list or download non-2xx |

#### 5.7.2 Artifact resolution steps *(type = `artifact` only)*

1. Extract `run_id` from `status.target_url` (§5.6.1). If absent → `version = null`.
2. `GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts` → find artifact where `name == <key>`.
3. If not found → `version = null`.
4. `GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip` → download archive.
5. Extract the single file; trim whitespace → `version`.
6. Non-2xx on either call → `version = null`.

Artifact content is **LRU-cached per `(repo, run_id, artifact_name)`** alongside the workflow graph cache (F11, same ≤ 200-entry bound). Artifact archives are immutable once uploaded, so no invalidation is needed.

---

### 5.8 Backfill (F13, F14)

Fills the store with the most recent deployment per `(service, environment)` slot on first run or explicit reset. Chunked and resumable — the orchestrator persists the cursor after each chunk, so a mid-backfill crash restarts from the last completed env rather than from scratch.

#### 5.8.1 Trigger and lifecycle

| Condition | Behaviour |
|---|---|
| Cursor `null` (adapter's `GET /api/fetcher/state` returned `404`) | Backfill runs automatically in place of the normal first-run empty-window. |
| `BACKFILL=true` env var set | Backfill runs unconditionally, regardless of existing cursor. Existing cursor is overwritten on completion. |
| Cursor present AND `backfill` section non-empty | Resume in-progress backfill from last persisted chunk (see §5.8.2). |
| Normal run (cursor present, `BACKFILL` unset, no `backfill` section) | Backfill skipped entirely. |

#### 5.8.2 Per-repo procedure (chunked + resumable)

Chunk granularity: **one `FetchResult` chunk per (repo, env)** that passes depth-scan, plus a **zero-event completion chunk per repo** that finalises the cursor.

```
depth       ← BACKFILL_DEPTH (default 2)
StallWindow ← 20  // consecutive no-progress deployments before stopping
anchor      ← incoming.BackfillFor(repo)?.anchor ?? UtcNow  // stable across resumes
cutoff      ← anchor − BACKFILL_MAX_AGE
doneEnvs    ← incoming.BackfillFor(repo)?.done_envs ?? []   // skip on resume

envs        ← GET /repos/{owner}/{repo}/environments → [env.name]
              filter: env ∉ doneEnvs                         // resume: skip completed envs

for each remaining env E:
  // Pass 1: collect candidates for this env (depth, no-progress, defer-YAML as before).
  // …(same per-env scan as before)…

  // Pass 2: build + trim events (same trimming logic as before).
  // Parent derivation uses the per-repo envToDeploymentId map accumulated so far
  // (deployments from envs processed earlier in this repo are already in the map).

  runningCursor ← runningCursor.WithBackfillEnvDone(repo, anchor, E)
  yield FetchResult(envEvents sorted oldest-first, runningCursor.Encode())
  // Orchestrator persists cursor here — crash safety: next run skips E

// Zero-event completion marker for this repo:
runningCursor ← runningCursor.WithBackfillComplete(repo, maxSinceForRepo)
  // → sets repos[repo].since = max(status.created_at) of all emitted events
  // → removes backfill[repo] marker
  // → if no events were emitted (empty repo), repos[repo].since is NOT set;
  //   next poll falls back to now − INITIAL_LOOKBACK (safe for empty repos)
yield FetchResult([], runningCursor.Encode())
```

- `repos[repo].since` is set **only by `WithBackfillComplete`** (or normal poll). Never advanced mid-backfill — backfill walks newest-first, so an early `since` would make the next poll skip not-yet-seeded older deployments. The `done_envs` list is the mid-backfill progress marker.
- **Parent-map choice (within-repo edges).** The per-repo `envToDeploymentId` map is accumulated incrementally as each env's deployments are collected. Within-repo parent edges from earlier envs resolve correctly. A parent in a not-yet-processed env is a forward reference (§5.6.5) — Swimlanes resolves dangling ids at render time.
- Discarded deployments cost only statuses + run-metadata; the YAML fetch is deferred until a deployment is kept (F1).

#### 5.8.3 Service resolution

```
ResolveService(workflowName, repo):
  if workflowName ∈ SERVICE_MAP → return SERVICE_MAP[workflowName]   // workflow-level key
  if repo ∈ SERVICE_MAP         → return SERVICE_MAP[repo]           // repo-level key ("owner/repo")
  if workflowName ≠ null        → return workflowName                // default: YAML name field
  return repo.Split("/").Last()                                        // non-Actions fallback
```

- Keys without `/` → workflow-level; keys matching `owner/repo` → repo-level.
- GitHub workflow names cannot contain `/` — no key ambiguity.
- `workflowName` here is the YAML `name:` field — resolved via `path → active-workflow` lookup (F2 / F12), NOT the run's display name.

---

#### 5.8.4 Rate-limit profile *(5 repos × 10 workflows × 4 environments, first page covers all services)*

| Call type | Count |
|---|---|
| Workflow + environment discovery | 5 + 5 = 10 |
| Deployment list pages (1 per env per repo) | ~20 |
| Status fetches (one per filled slot max) | ≤ 200 |
| Workflow graph calls (run metadata + YAML) | nearly all absorbed by F11 LRU cache |

---

### 5.9 Rate-limit budget (F16)

#### Discovery (startup)

1. If `GITHUB__RATE_LIMIT` is set → `total_limit = GITHUB__RATE_LIMIT`.
2. Else → `GET /rate_limit` (same auth headers as §5.1); read `resources.core.limit` → `total_limit`.
3. On non-2xx or parse error → log warning; `total_limit = 5000` (GitHub authenticated PAT default).
4. `budget = floor(total_limit × GITHUB__RATE_LIMIT_BUDGET_PCT / 100)`.

#### Per-request enforcement

After every HTTP call to the GitHub API:

1. Read `X-RateLimit-Reset` → `reset_at` (UTC). The window has rolled over when **`now ≥ previously-observed reset_at`** AND the new `reset_at` is later than the previously observed one — reset own counter to 0. (`X-RateLimit-Reset` always points to the end of the *current* window, i.e. always in the future; checking whether the new value is in the past would never fire.)
2. Update `_resetAt` unconditionally (even for 304 responses).
3. Increment the fetcher's **own request counter** — **only for quota-consuming responses** (all except `304 Not Modified`). A `304` is free (GitHub does not charge it; `X-RateLimit-Remaining` is unchanged), so counting it would over-report usage and over-throttle against F16's "must not monopolise a shared token" rationale.
4. Capture `X-RateLimit-Limit` / `X-RateLimit-Remaining` unconditionally for the F18 snapshot.

If `own_count ≥ budget`:

1. `wait_until = reset_at + 1 s` (margin to let GitHub's counter roll over).
2. Log: `[RateLimit] budget exhausted (own_count=N/M); sleeping until {wait_until}`.
3. Pause until `wait_until`.
4. Reset own counter to 0.

#### Notes

- The own counter tracks this **fetcher process's** calls only — `X-RateLimit-Used` (cumulative across all token consumers) is deliberately NOT used for the budget check. A token already partly used by other consumers does not trigger an immediate pause.
- `X-RateLimit-Reset` is still read from response headers to determine sleep duration.
- `total_limit` is constant for the process lifetime — PAT limits do not change without token rotation.
- Budget enforcement applies uniformly — backfill and normal poll share the same counter.
- `GET /rate_limit` costs 1 request against the quota (startup only).
- Existing `403`/`429` + `Retry-After` handling (§5.5) remains the last-resort fallback for unexpected limit hits.

---

### 5.10 Control-plane participation (F17)

The fetcher joins the reset choreography as the **`dashboard-fetcher`** participant. Visual reference: [`reset-choreography.md`](diagrams/reset-choreography.md). Contract source: [`api-guidelines.md`](api/api-guidelines.md) §11 + [`API_SPECIFICATION.md`](API_SPECIFICATION.md) §5/§7. The fetcher only **consumes** this contract — no backend change (F1).

#### 5.10.1 Component identity

- **Component id = `dashboard-fetcher`** (fixed; matches the API's default `ExpectedComponents`, so the orchestrator's ack fan-in counts this component).
- Sent as `X-Component-Id: dashboard-fetcher` on every `POST /api/control/events`.
- Configurable via `COMPONENT_ID` (default `dashboard-fetcher`); the default MUST NOT be changed without also changing the API's `ExpectedComponents`, or the orchestrator will time out waiting for an ack that never matches.

#### 5.10.2 Subscriber

The subscriber is **only started when `CONTROL_API_KEY` is non-empty**. When the key is absent the listener is never registered; the poll loop (`FetcherWorker`) still runs as normal. A single startup log message records the absence.

A second long-lived task (alongside the poll loop) holds an open control stream:

| Property | Value |
|---|---|
| Request | `GET /api/control/stream?component=dashboard-fetcher` |
| Auth | `X-Control-API-Key: <CONTROL_API_KEY>` (distinct from `API_KEY`; new config key) |
| HTTP client | `HttpClient` streaming the response body (`ResponseHeadersRead`); **not** `EventSource` — custom headers required |
| Heartbeat | server emits `: ping` every 15 s — treat as liveness; reset the read-idle timer, no other action |
| Reconnect | on drop, reconnect with `Last-Event-ID: <last-seen-event-id>` and **exponential backoff** (1 s → 2 s → 4 s … capped at 30 s); backoff resets to 1 s after a successful connect |
| Unknown `event:` | **no-op** (forward-compat; new orchestration types may appear) |
| Filter scope | server delivers only `component == dashboard-fetcher` OR `component == "*"`; all three reset events are `*` |

#### 5.10.3 Event handling

| Event | Fetcher action |
|---|---|
| `reset-initiated` | 1. Pause the poll loop + any in-flight ingestion (stop the `FetchAsync` → `POST /api/deployments` → cursor-`PUT` cycle; let the current POST finish, then hold). 2. `POST /api/control/events` `reset-ack` (§5.10.4). |
| `reset-started` | **No action.** The fetcher already paused on `reset-initiated`; do not add redundant handling. (The API briefly returns `503` on ingest here — the paused fetcher never sees it.) |
| `reset-completed` | Recover (§5.10.5): drop the in-memory cursor, resume, and report `running`. |
| *(unknown type)* | No-op (forward-compat). |

#### 5.10.4 Ack on `reset-initiated`

`POST /api/control/events`:

| Part | Value |
|---|---|
| Headers | `X-Api-Key: <API_KEY>`, `X-Component-Id: dashboard-fetcher`, `Content-Type: application/json; charset=utf-8` |
| Body | `{ "event_type": "reset-ack", "state": "paused", "occurred_at": "<now UTC RFC 3339>", "payload": { "reset_id": "<reset-initiated event id>" } }` |

- `reset_id` = the `id` of the received `reset-initiated` event (the orchestrator correlates the ack to the in-flight cycle by this value).
- Expected response `204`. Treat `4xx`/`5xx`/transport error as non-fatal: log, stay paused, await `reset-completed` (the orchestrator proceeds on `AckTimeoutSeconds` regardless — the reset is not blocked by a lost ack).

#### 5.10.5 Recovery on `reset-completed`

1. **Drop the in-memory cursor** (set to `null`). Do **not** `PUT` a cursor.
2. Resume the poll loop.
3. The next iteration calls `GET /api/fetcher/state/{adapter}`. Because the API cleared `fetcher_state` during the reset window (API_SPECIFICATION §5/§7), this returns **`404` → null cursor**.
4. A null cursor is exactly the **backfill trigger** (F14, §5.8.1): the runner performs the bounded backfill (F13) as the initial ingestion, advances the cursor to `max(status.created_at)`, then normal polling continues.
5. After the poll loop has resumed, `POST /api/control/events` a `status` event (reuse the existing `status` type — **not** a new type):

| Part | Value |
|---|---|
| Headers | `X-Api-Key`, `X-Component-Id: dashboard-fetcher`, `Content-Type` |
| Body | `{ "event_type": "status", "state": "running", "occurred_at": "<now UTC>", "payload": { "reset_id": "<reset-completed reset_id>" } }` |

> The reset linkage to backfill is **implicit by design**: the fetcher does not call a "backfill" API: it simply drops the cursor and lets the existing F14 null-cursor path do the work. This keeps the reset handler tiny and reuses the tested backfill flow.

#### 5.10.6 Resilience and self-heal

| Scenario | Behaviour |
|---|---|
| Subscriber connection drops mid-cycle | Reconnect with `Last-Event-ID`; the server replays any missed events (including a missed `reset-completed`) within the 2 h window — recovery still fires. |
| Fetcher down for the entire reset cycle | On next startup the poll loop sees an empty store + `404` cursor and **backfills anyway** (F14) — no event needed; the reset self-heals via the same null-cursor path. |
| Ack POST fails | Stay paused; orchestrator proceeds on `AckTimeoutSeconds`. Recovery still triggers on the eventual `reset-completed`. |
| `reset-completed` arrives while already running (duplicate/replay) | Idempotent: dropping an already-advanced cursor and re-checking state at worst re-backfills the most-recent slot per `(service, environment)` — duplicates are acceptable (F5, append-only). |

---

### 5.11 Per-cycle rate-limit reporting (F18)

After each successful poll cycle, when a `RateLimitSnapshot` is available, the fetcher posts a `rate-limit` component event to the existing `POST /api/control/events` surface. See [`api/api-guidelines.md`](api/api-guidelines.md) §11 "Rate-limit report payload" and [`diagrams/fetcher-rate-limit.md`](diagrams/fetcher-rate-limit.md).

**Multi-adapter note.** With multiple adapters each adapter emits its own `rate-limit` event carrying a distinct `payload.adapter` value under the shared `component_id`. Consumers must key on `payload.adapter`, not on `component_id`, to distinguish per-adapter counters.

#### Trigger and gate

| Condition | Behaviour |
|---|---|
| Snapshot present after `PollOnceAsync` | Post `rate-limit` event immediately. |
| Snapshot null (before first GitHub response) | Skip — no all-null reports. |
| `CONTROL_API_KEY` absent | **Not** a gate — the report uses `X-Api-Key` (same as ingest); always active when `API_KEY` is present. |

#### Extended `RateLimitSnapshot`

`RateLimitSnapshot` carries two additional fields populated from GitHub response headers after each call (`GithubClient` → `RateLimitBudget.RecordAndWaitIfNeededAsync`):

| Field | Source | Null when |
|---|---|---|
| `CiLimit` | `X-RateLimit-Limit` | Before first GitHub response. |
| `CiRemaining` | `X-RateLimit-Remaining` | Before first GitHub response. |

Existing fields (`Used`, `Budget`, `ResetAt`) are unchanged.

#### Payload mapping

The `payload` object maps the snapshot to the api-guidelines `rate-limit` contract:

| Payload field | Source |
|---|---|
| `adapter` | `ICiCdAdapter.AdapterId` (e.g. `github-actions`) |
| `ci_limit` | `snapshot.CiLimit` (null when not yet received) |
| `ci_remaining` | `snapshot.CiRemaining` (null when not yet received) |
| `own_budget` | `snapshot.Budget` |
| `own_used` | `snapshot.Used` |
| `reset_at` | `snapshot.ResetAt`; serialised as RFC 3339 UTC; **null** when `ResetAt == DateTimeOffset.MinValue` |

`state` = `"running"` normally. The delegate closure in DI supplies the adapter id and state; `PollLoop` itself remains free of the `Control` namespace dependency.

#### Resilience

Non-fatal. Transport errors and non-2xx responses are logged at `Warning` level and swallowed. The poll loop continues regardless. This mirrors `PostAckAsync` / `PostRunningAsync` behaviour (§5.10.4, §5.10.5).

#### Wiring (no `Orchestration` → `Control` dependency)

`PollLoop` accepts an optional `Func<RateLimitSnapshot, CancellationToken, Task>? reportCycleAsync` parameter. `Program.cs` DI wires it to `IComponentEventClient.PostRateLimitAsync`, closing over the adapter id. This preserves the existing dependency direction: `Control` → `Orchestration`, never the reverse.

---

## 6. Configuration (env)

| Var | Example | Purpose |
|---|---|---|
| `DASHBOARD_API_BASE_URL` | `http://gateway:8080` | where to POST events + read/write state + open the control stream |
| `API_KEY` | *(secret)* | `X-Api-Key` for ingest + state + `POST /api/control/events` |
| `CONTROL_API_KEY` | *(secret)* | `X-Control-API-Key` for the control stream subscription (`GET /api/control/stream`); distinct from `API_KEY` (§5.10.2) |
| `COMPONENT_ID` | `dashboard-fetcher` | `X-Component-Id` on component-event posts; MUST match the API's `ExpectedComponents` (§5.10.1) |
| `POLL_INTERVAL_SECONDS` | `30` | loop cadence (integration uses `1`) |
| `INITIAL_LOOKBACK` | `7.00:00:00` | normal poll first-run window (F7); also the default for `BACKFILL_MAX_AGE` when unset |
| `BACKFILL` | `false` | set `true` to force a backfill run regardless of cursor state (F14) |
| `BACKFILL_MAX_AGE` | `30.00:00:00` | how far back backfill scans per environment; defaults to `INITIAL_LOOKBACK` |
| `BACKFILL_DEPTH` | `2` | number of latest status events to seed per `(service, environment)` slot during backfill (F13); default 2 |
| `GITHUB__BaseUrl` | `https://api.github.com` | overridable for the integration mock |
| `GITHUB__Token` | *(secret)* | PAT / GitHub App token |
| `GITHUB__Repos` | `acme/api,acme/web` | repos to poll |
| `GITHUB__ServiceMap` | `Deploy Checkout API=checkout-api,acme/api=api` | optional overrides; key without `/` = workflow-level, key with `/` = repo-level (§5.8.3) |
| `GITHUB__VersionSource` | `attribute:sha` | `attribute:<attr>` \| `payload:<field>` \| `artifact:<filename>` — see §5.7 |
| `GITHUB__RateLimit` | *(unset)* | Total hourly request quota for the token. Unset = discovered via `GET /rate_limit` on startup; discovery failure → 5 000. |
| `GITHUB__RateLimitBudgetPct` | `30` | Percentage of the quota the fetcher may consume per hour (1–100). Default `30` (e.g. 1 500 of 5 000). |

Adapter config is namespaced (`GITHUB__…`) so a second adapter (`AZDO__…`, `JENKINS__…`) drops in without collision.

> **Env var binding rule.** The segment after `__` must match the C# property name exactly (PascalCase). .NET config maps `__` to a section separator and binds by property name — not by SCREAMING_SNAKE. Example: `GITHUB__BaseUrl` → section `GitHub`, property `BaseUrl`; `GITHUB__BASE_URL` does NOT bind and the property keeps its default.

**Health endpoint port.** The `GET /health` listener uses the standard ASP.NET `ASPNETCORE_URLS` environment variable (e.g. `http://+:8080`). Default container port is `8080`; the demo driver's `FETCHER_URL` (DEMO_DRIVER_SPEC §9) must match.

**Demo mode.** Set `GITHUB__BaseUrl=http://github-emulator:3100` (the `github-emulator` service — [`GITHUB_EMULATOR_SPECIFICATION.md`](GITHUB_EMULATOR_SPECIFICATION.md)) and `GITHUB__Token` to any placeholder value (the emulator does not validate it). No other fetcher config change is needed.

### 6.1 Functional readiness — `GET /readyz`

Reflects actual GitHub poll-cycle health. Distinct from the liveness `/health` which is always `200`.

**Response shape:**

```json
{
  "status": "ready" | "degraded",
  "github": {
    "reachable": true | false,
    "last_outcome": "ok" | "auth_failed" | "rate_limited" | "error" | null,
    "last_success_at": "<RFC 3339 UTC>" | null,
    "last_error": "<string>" | null,
    "paused_for_reset": false,
    "rate_limit": {
      "used": 150,
      "budget": 1500,
      "reset_at": "<RFC 3339 UTC>",
      "ci_limit": 5000,
      "ci_remaining": 4830
    } | null
  }
}
```

**Status codes:**

| Condition | HTTP | `status` |
|---|---|---|
| Last outcome is `ok` | 200 | `ready` |
| Last outcome is `rate_limited` or never polled | 200 | `degraded` |
| Paused for reset (any prior outcome) | 200 | `ready` or `degraded` per outcome |
| Last outcome is `auth_failed` or `error` AND NOT paused | 503 | `degraded` |

**Paused-for-reset is healthy.** A loop paused during the reset choreography (§5.10.3) never produces a `503` — `paused_for_reset: true` signals the expected transient state regardless of the last recorded outcome.

**Rate-limit snapshot.** `rate_limit` is populated after the first GitHub HTTP response that carries `X-RateLimit-*` headers. `null` before the first response.

**Indicator.** `IFetcherReadinessIndicator` / `FetcherReadinessIndicator` live in `Dashboard.Fetcher.Orchestration`. `PollLoop` calls `RecordSuccess` / `RecordAuthFailed` / `RecordRateLimited` / `RecordError` after every cycle, and `SetPausedForReset(true/false)` on pause / resume events.

---

## 7. Testing

| Layer | Project | Scope |
|---|---|---|
| Unit | `Dashboard.Fetcher.Tests` | §7.1 |
| Integration | cross-stack suite | §7.2 |

`Dashboard.Fetcher.Tests` is **excluded from the API test run** and exercised on the fetcher's own pipeline.

### 7.1 Unit test cases

**Mapping:** GitHub JSON fixture → `DeploymentEventIngest`; status table (§5.3); cursor advance / first-run lookback; orchestrator loop (mock `ICiCdAdapter` + mock ingest/state clients); at-least-once on mid-batch failure.

**Parent derivation:** linear chain (`dev → staging → prod`); parallel branches (two envs with shared root); non-deployment intermediary job (BFS look-through); matrix collision (two deployments same env same run → latest wins); `environment` as object vs string; `needs` as string vs array; no matching deployment job (→ `[]`); non-Actions `target_url` (→ `[]`); workflow fetch non-2xx (→ `[]`); YAML parse error (→ `[]`).

**Service resolution:** workflow-level SERVICE_MAP hit; repo-level hit; default (workflow name as-is); non-Actions fallback (repo short name).

**Version resolution:** `attribute:sha` → 7-char truncation; `attribute:ref` → value as-is; `payload:version` → field value; payload field absent → `null`; payload not a JSON object → `null`; `artifact:version.txt` → trimmed file content; artifact not found → `null`; artifact list non-2xx → `null`; artifact download non-2xx → `null`; `artifact` source + no `run_id` → `null`; artifact result LRU-cached for same `(repo, run_id, artifact_name)`.

**Backfill:** all services covered on first page (early exit); rarely-deployed service found on page 2 (pagination); service not deployed to env within `BACKFILL_MAX_AGE` (skipped); `BACKFILL=true` overwrites existing cursor; events posted oldest-first.

**Rate-limit budget:** `GET /rate_limit` response → correct `total_limit` and `budget`; `GITHUB__RateLimit` set → discovery call skipped; `GET /rate_limit` non-2xx → `total_limit = 5000`; `budget = floor(total_limit × pct / 100)` (boundary cases: pct = 1, pct = 100); adapter pauses until `reset_at + 1 s` when `used ≥ budget`; internal counter resets to 0 after window rollover; backfill and normal poll share the same budget counter.

**Conditional requests (ETag, §5.5.2):**
- In-flight statuses `304` across cycles → no event emitted in cycle 2; `If-None-Match` was sent for the statuses URL.
- Statuses `200` after payload change → new event emitted; statuses endpoint did NOT return `304` (ETag rotated).
- Deployments-list `304` → cached snapshot reused; per-deployment status endpoint still called in cycle 2 (list `304` does not skip status checks).
- Parent edge preserved when staging statuses return `304` in cycle 2 — prod event resolves `parent_deployments` via the cached `runId`.
- No ETag from server → no `If-None-Match` sent on the next cycle; no `304`s served (graceful degradation, behaviour identical to unconditional fetch).
- Rate-limit budget does **NOT** increment the own counter for `304` responses (304 consumes no quota); a `200` does. Rollover bookkeeping and header capture (`X-RateLimit-Limit` / `X-RateLimit-Remaining`) remain unconditional.

**Control-plane participation (F17, §5.10):**
- `reset-initiated` received → poll loop paused (no further `FetchAsync` / ingest POST) AND `reset-ack` posted with headers `X-Api-Key` + `X-Component-Id: dashboard-fetcher` + `Content-Type`, body `{event_type:reset-ack, state:paused, occurred_at, payload.reset_id}` where `reset_id` = the `reset-initiated` event id.
- `reset-completed` received → in-memory cursor dropped; next `GET /api/fetcher/state` mock returns `404` → backfill (F14) triggered; `status`/`running` event posted afterwards with `payload.reset_id` = the `reset-completed` reset_id.
- `reset-started` received → **no** ack, no extra POST, poll loop stays paused (asserts no redundant handling).
- Unknown `event:` type → no-op (no POST, poll loop unaffected).
- Reconnect after a dropped stream sends `Last-Event-ID` = last seen event id.
- `: ping` frame → treated as heartbeat, no event dispatched.
- Ack POST returns non-2xx → subscriber stays paused, does not throw, still recovers on subsequent `reset-completed`.
- Component id overridden via `COMPONENT_ID` → header reflects the override.

**Per-cycle rate-limit reporting (F18, §5.11):**
- `RateLimitBudget.CiLimit` and `CiRemaining` are null before the first GitHub response; populated from `X-RateLimit-Limit` / `X-RateLimit-Remaining` on first response; updated on subsequent responses; remain null when headers are absent.
- `PostRateLimitAsync` emits body with `event_type:"rate-limit"`, correct `state`, `occurred_at`; payload contains `adapter`, `ci_limit`, `ci_remaining`, `own_budget`, `own_used`, `reset_at`; `reset_at` is null when snapshot `ResetAt == DateTimeOffset.MinValue`; `X-Api-Key` and `X-Component-Id` headers present.
- `PostRateLimitAsync` non-2xx response → does not throw.
- `PostRateLimitAsync` transport error → does not throw.
- Per-cycle `reportCycleAsync` delegate fires once per successful cycle when snapshot is non-null.
- Per-cycle `reportCycleAsync` delegate NOT invoked when snapshot is null.
- `reportCycleAsync` throws → loop continues next cycle (non-fatal).

**Functional readiness indicator (§6.1):**
- Initial state → `LastOutcome = null`, `LastSuccessAt = null`, `IsPausedForReset = false`.
- `RecordSuccess` → `LastOutcome = ok`, `LastSuccessAt` set, `LastErrorSummary = null`.
- `RecordSuccess` with snapshot → `RateLimit` populated; without snapshot → existing snapshot retained.
- `ok → auth_failed → ok` transition: outcome and error summary follow latest record; success clears error.
- `RecordAuthFailed` → `LastOutcome = auth_failed`, summary populated.
- `RecordRateLimited` → `LastOutcome = rate_limited`, snapshot and summary populated.
- `RecordError` → `LastOutcome = error`, summary populated.
- `SetPausedForReset(true)` → `IsPausedForReset = true`; does NOT change `LastOutcome` (orthogonal flags).
- `SetPausedForReset(false)` → flag clears.
- Paused while `auth_failed` → both flags independent; handler applies its own 503 logic.
- `PollLoop.Pause()` → calls `SetPausedForReset(true)` on indicator.
- `PollLoop.DropCursorAndResume()` → calls `SetPausedForReset(false)` on indicator.

### 7.2 Integration test cases

The **mock GitHub API** referenced in this section is the **`github-emulator` service** ([`GITHUB_EMULATOR_SPECIFICATION.md`](GITHUB_EMULATOR_SPECIFICATION.md)). Integration tests seed it via `POST /_github/seed {dataset:"demo"}` and run the real fetcher-host against `http://github-emulator:3100`. See [`docs/diagrams/github-emulation.md`](diagrams/github-emulation.md) for the topology.

Real fetcher-host against the `github-emulator` + real `Dashboard.Api` + Postgres. Asserts:

- Wire shape (FR-06) and opaque-cursor round-trip.
- Populated `parent_deployments` on a two-environment chain.
- Backfill populates `(service, environment)` slots correctly.
- NFR-03 latency envelope.
- **Full reset cycle (F17, §5.10)** against the **real** API + Postgres: fetcher subscribes to `GET /api/control/stream`; operator triggers `POST /api/control/reset`; assert the fetcher (a) receives `reset-initiated` and posts a `reset-ack` (`paused`, correct `reset_id`) visible via `GET /api/control/events`; (b) on `reset-completed` drops its cursor, re-backfills against the mock GitHub API after the store + `fetcher_state` were cleared, and posts a `status`/`running` event. Confirms the orchestrator counts the `dashboard-fetcher` ack and the store is re-populated post-reset.

---

## 8. Out of scope

- Horizontal scaling of the fetcher (single replica per adapter — F6).
- Adapters other than GitHub (the abstraction is the deliverable; ADO/Jenkins are future drop-ins).
- Any backend change — the fetcher only consumes the existing public contract.
- Triggering/managing deployments (read-only, SAD §3 Non-Goals).
