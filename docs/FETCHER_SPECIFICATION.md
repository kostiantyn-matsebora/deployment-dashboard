# Fetcher Specification — `Dashboard.Fetcher`

**Status:** Draft · **Date:** 2026-05-29

Implementation contract for **`Dashboard.Fetcher`** — the optional, separately-deployed pull-mode adapter that translates a CI/CD tool's **pull** API into the dashboard's **push** ingest. Its defining requirement is a **tool-agnostic abstraction layer**: the polling host knows nothing about any specific CI/CD system; all tool-specifics live behind one interface.

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/SAD.md`](SAD.md) §3, §7 | Fetcher as opt-in pull→push edge; backend stays CI-agnostic. |
| [`docs/api/openapi.yaml`](api/openapi.yaml) | `POST /api/deployments`, `GET/PUT /api/fetcher/state/{adapter}`, `X-Progress-Reporter`. |
| [`docs/API_SPECIFICATION.md`](API_SPECIFICATION.md) | Wire DTO (`DeploymentEventIngest`), cursor + append-only semantics. |

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
| F5 | **At-least-once delivery.** Cursor advances *only* after a successful `POST`; a mid-batch failure re-polls and may re-post. | Store is append-only / no dedup — duplicates are acceptable, dropped events are not. |
| F6 | **Single replica per adapter.** No leader election; the cursor is shared but unlocked. | Two replicas would double-post. The API (not the fetcher) is the horizontally-scaled tier. |
| F7 | **Bounded initial backfill.** On a `404` (no cursor yet) the adapter starts from `now − INITIAL_LOOKBACK`, not from repo genesis. | Avoids flooding the store with full history on first run. |
| F8 | **Adapter handles conditional requests + rate limits.** ETag / `If-None-Match`, `X-RateLimit-*`, `Retry-After`, backoff. | Keeps polling cheap and a good API citizen — internal to the adapter. |
| F9 | **Config-driven; base URL overridable.** Repos + service/version mapping + GitHub base URL from env. | Integration repoints the GitHub base URL at a mock; production points at `api.github.com`. |
| F10 | **`parent_deployments` derived from workflow `needs` graph.** The adapter fetches the workflow YAML for each run, parses the deployment-job subgraph (`environment:` + `needs:`), and resolves parent edges to `deployment_id` values (§5.6). Any resolution failure → `parent_deployments = []`; ingest is never blocked. | Reproduces the deployment graph GitHub surfaces in the Actions Run UI. `explicit parent` is the Swimlanes default correlation predicate — accurate population here makes it work out of the box. |
| F11 | **Workflow graph cached in-memory per `(repo, run_id)`.** Bounded LRU (≤ 200 entries). Cache entry includes workflow `name` (used as service identity), `path`, `head_sha`, and parsed deployment-job subgraph. | Avoids re-fetching the workflow YAML for each status event that shares a run; workflow runs are immutable so no invalidation is needed. |
| F12 | **Service identity = workflow YAML `name:` field** (how the workflow appears in the GitHub UI). `GITHUB__SERVICE_MAP` overrides at two levels — workflow name (key without `/`) or repo (key = `owner/repo`). Resolution order: workflow-level override → repo-level override → workflow name as-is. Non-Actions deployments (no `target_url`) fall back to the repo's short name. | Requires zero config for the common case (workflow name = service name); SERVICE_MAP handles edge cases without restructuring the pipeline. |
| F13 | **Backfill fills the most recent deployment per `(service, environment)` slot.** Enumerates active workflows (services) and environments per repo; paginates deployments per environment newest-first, stopping when all services are covered or `deployment.created_at < now − BACKFILL_MAX_AGE`. | Per-environment pagination + early-exit on full coverage minimises API calls. Guarantees every service is represented regardless of deployment frequency — fixes the gap where last-N-per-env misses rarely-deployed services. |
| F14 | **Backfill triggers on null cursor (first run) or `BACKFILL=true`.** After completion cursor advances to `max(status.created_at)` seen, preventing re-post in the subsequent normal poll. | `BACKFILL=true` supports the "reset data" scenario without redeploying or clearing the fetcher-state row manually. |
| F15 | **Version source is `type:key` configurable; no fallback, no truncation except `sha`.** Three types: `attribute` (deployment field; `sha` key → 7-char truncation, all others as-is), `payload` (deployment payload JSON field), `artifact` (Actions artifact archive — archive name = filename, content is a plain-text version string). Missing / null / unreachable source → `version = null`; ingest is never blocked. Default: `attribute:sha`. | Covers the three real-world versioning patterns without a silent fallback that would mask misconfiguration. |
| F16 | **Rate-limit budget.** Adapter self-throttles to at most `GITHUB__RATE_LIMIT_BUDGET_PCT`% (default 30) of its hourly request quota. Quota is read from `GITHUB__RATE_LIMIT` when set; otherwise discovered via `GET /rate_limit` on startup (failure → safe default of 5 000). When the consumed-request count reaches the budget, the adapter waits until `X-RateLimit-Reset`. | Prevents crowding out other consumers of the same PAT; the fetcher is a background process and must not monopolise a shared token. |
| F17 | **Control-plane participant.** A second long-lived task subscribes to `GET /api/control/stream` and reacts to the reset choreography: drain + ack on `reset-initiated`, drop cursor + backfill + report `running` on `reset-completed`. Still **just a consumer** of the existing control-plane contract — no backend change (F1, SAD §3). | Lets the API orchestrate a system-wide data reset (API_SPECIFICATION §5/§7); the fetcher must pause cleanly and re-seed afterwards rather than fight the data-clearing window. |

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
  tests/
    Dashboard.Fetcher.Tests/               # owned here, excluded from the API test run
```

- `Control/ControlStreamSubscriber` — the long-lived control-stream reader (`fetch()`+`ReadableStream` equivalent: `HttpClient` + `HttpCompletionOption.ResponseHeadersRead` streaming the body; **not** `EventSource`). Parses SSE frames, tracks `Last-Event-ID`, honours `: ping` heartbeat, dispatches reset events to the poll-loop runner.
- `Control/ComponentEventClient` — HTTP client for `POST /api/control/events` (the `reset-ack` and `status` posts). Distinct from `Ingest/IngestClient`; both target the API but carry different headers (`X-Component-Id` vs `X-Progress-Reporter`).
- The host runs **two concurrent tasks**: the existing per-adapter poll loop (§4) and the `ControlStreamSubscriber`. The subscriber signals the runner to pause/resume; it never fetches or posts deployment events itself.

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

    /// Poll the source for events newer than `cursor` (null = first run).
    /// Returns the events to push and the advanced cursor (opaque to the host).
    Task<FetchResult> FetchAsync(string? cursor, CancellationToken ct);
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
    var result = await adapter.FetchAsync(cursor, ct);        // ALL tool logic is inside here
    foreach (var ev in result.Events)                          // ordered oldest-first
        await ingest.PostAsync(ev, adapter.AdapterId, ct);     // POST /api/deployments (X-Api-Key + X-Progress-Reporter)

    if (result.Events.Count > 0 && result.Cursor != cursor)
    {
        await state.PutAsync(adapter.AdapterId, result.Cursor, ct);  // PUT /api/fetcher/state/{id}
        cursor = result.Cursor;
    }
    await Task.Delay(pollInterval, ct);
}
```

- Cursor is **persisted only after** the batch's POSTs succeed (F5). A throw mid-batch leaves the cursor where it was → next loop re-polls and re-pushes the tail (dupes OK, append-only).
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

Base64 of compact JSON, forward-only, well under the 8 KiB limit:

```json
{ "repos": { "acme/api": { "since": "2026-05-28T10:14:02Z" }, "acme/web": { "since": "2026-05-28T09:50:00Z" } } }
```

- `since` = high-water mark on `status.created_at` per repo. Each poll emits statuses with `created_at > since`, oldest-first, then advances `since` to the max emitted.
- First run (cursor `null`): `since = now − INITIAL_LOOKBACK` (F7).
- ETags cached alongside (optional) to short-circuit unchanged pages with `304` (F8).

### 5.5 Resilience (inside the adapter)

- GitHub `5xx` / transport error → throw; orchestrator keeps the old cursor and retries next interval.
- `403`/`429` with rate-limit headers → honour `Retry-After` / `X-RateLimit-Reset`, back off.
- `304 Not Modified` → no events, cursor unchanged.
- Workflow run or file fetch non-2xx, YAML parse error, or missing `target_url` → `parent_deployments = []` for the affected events; never throw / never block ingest (F10).
- Artifact list or download non-2xx, or artifact name not found → `version = null`; never throw / never block ingest (F15).

### 5.6 Parent deployment derivation (F10)

Populates `parent_deployments` by reconstructing the deployment-job subgraph from the workflow YAML. Runs inside `FetchAsync` before the event batch is returned — all events for the same poll window are resolved together.

#### 5.6.1 run_id extraction

For every deployment status, extract `run_id` from `status.target_url` via pattern `/actions/runs/(\d+)`. If absent or no match → `parent_deployments = []` for that event, skip §5.6.2–5.

#### 5.6.2 Workflow graph fetch and parse *(F11 — LRU-cached per `(repo, run_id)`)*

| Step | Call | Use |
|---|---|---|
| 1 | `GET /repos/{owner}/{repo}/actions/runs/{run_id}` | obtain `name` (workflow display name → service identity), `path` (e.g. `.github/workflows/deploy.yml`), and `head_sha` |
| 2 | `GET /repos/{owner}/{repo}/contents/{path}?ref={head_sha}` | Base64-decode `content` → workflow YAML |

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

Fills the store with the most recent deployment per `(service, environment)` slot on first run or explicit reset. Runs once before the normal poll loop; the poll loop then resumes from the advanced cursor.

#### 5.8.1 Trigger and lifecycle

| Condition | Behaviour |
|---|---|
| Cursor `null` (adapter's `GET /api/fetcher/state` returned `404`) | Backfill runs automatically in place of the normal first-run empty-window. |
| `BACKFILL=true` env var set | Backfill runs unconditionally, regardless of existing cursor. Existing cursor is overwritten on completion. |
| Normal run (cursor present, `BACKFILL` unset) | Backfill skipped entirely. |

#### 5.8.2 Per-repo procedure

```
services ← GET /repos/{owner}/{repo}/actions/workflows?per_page=100
             filter: state == "active"
             → Set of { wf.name → ResolveService(wf.name, repo) }

envs     ← GET /repos/{owner}/{repo}/environments → [env.name]

events   ← []
cutoff   ← now − BACKFILL_MAX_AGE

for each env E in envs:
  filled ← {}   // service → true

  paginate GET /repos/{owner}/{repo}/deployments?environment={E}&per_page=100 newest-first:
    for each deployment D:
      if D.created_at < cutoff: stop paginating this env

      statuses ← fetch D's statuses                              // also needed for event data
      run_id   ← extract from any status.target_url (§5.6.1)
      wf_name  ← run_id != null ? GetWorkflowName(repo, run_id) : null   // §5.6.2 LRU cache
      service  ← ResolveService(wf_name, repo)                  // §5.8.3

      if service ∈ services AND service ∉ filled:
        events.AddAll(BuildEvents(D, statuses))   // §5.3 status mapping + §5.6 parent derivation
        filled[service] ← true

    if filled.keys == services.keys: break        // all services covered for this env
```

- Sort collected `events` by `happened_at` ascending before posting (preserves append-only log ordering).
- Advance cursor to `max(status.created_at)` across all events.

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

After every HTTP call to the GitHub API, read response headers:

- `X-RateLimit-Used` — requests consumed since the window opened (preferred).
- `X-RateLimit-Remaining` + `X-RateLimit-Limit` — fallback: `used = limit − remaining`.

If `used ≥ budget`:

1. Read `X-RateLimit-Reset` → Unix epoch → `reset_at` (UTC).
2. `wait_until = reset_at + 1 s` (margin to let GitHub's counter roll over).
3. Log: `[GithubActionsAdapter] rate-limit budget exhausted; sleeping until {wait_until}`.
4. Pause until `wait_until`.
5. Reset internal `used` counter to 0.

#### Notes

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

A second long-lived task (alongside the poll loop) holds an open control stream:

| Property | Value |
|---|---|
| Request | `GET /api/control/stream?component=dashboard-fetcher` |
| Auth | `X-Control-API-Key: <CONTROL_API_KEY>` (distinct from `API_KEY`; new config key) |
| HTTP client | `HttpClient` streaming the response body (`ResponseHeadersRead`); **not** `EventSource` — custom headers required |
| Heartbeat | server emits `: ping` every 15 s — treat as liveness; reset the read-idle timer, no other action |
| Reconnect | on drop, reconnect sending `Last-Event-ID: <last-seen-event-id>`; server replays `id > last` within the 2 h window |
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
| `GITHUB__BASE_URL` | `https://api.github.com` | overridable for the integration mock |
| `GITHUB__TOKEN` | *(secret)* | PAT / GitHub App token |
| `GITHUB__REPOS` | `acme/api,acme/web` | repos to poll |
| `GITHUB__SERVICE_MAP` | `Deploy Checkout API=checkout-api,acme/api=api` | optional overrides; key without `/` = workflow-level, key with `/` = repo-level (§5.8.3) |
| `GITHUB__VERSION_SOURCE` | `attribute:sha` | `attribute:<attr>` \| `payload:<field>` \| `artifact:<filename>` — see §5.7 |
| `GITHUB__RATE_LIMIT` | *(unset)* | Total hourly request quota for the token. Unset = discovered via `GET /rate_limit` on startup; discovery failure → 5 000. |
| `GITHUB__RATE_LIMIT_BUDGET_PCT` | `30` | Percentage of the quota the fetcher may consume per hour (1–100). Default `30` (e.g. 1 500 of 5 000). |

Adapter config is namespaced (`GITHUB__…`) so a second adapter (`AZDO__…`, `JENKINS__…`) drops in without collision.

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

**Rate-limit budget:** `GET /rate_limit` response → correct `total_limit` and `budget`; `GITHUB__RATE_LIMIT` set → discovery call skipped; `GET /rate_limit` non-2xx → `total_limit = 5000`; `budget = floor(total_limit × pct / 100)` (boundary cases: pct = 1, pct = 100); adapter pauses until `reset_at + 1 s` when `used ≥ budget`; internal counter resets to 0 after window rollover; backfill and normal poll share the same budget counter.

**Control-plane participation (F17, §5.10):**
- `reset-initiated` received → poll loop paused (no further `FetchAsync` / ingest POST) AND `reset-ack` posted with headers `X-Api-Key` + `X-Component-Id: dashboard-fetcher` + `Content-Type`, body `{event_type:reset-ack, state:paused, occurred_at, payload.reset_id}` where `reset_id` = the `reset-initiated` event id.
- `reset-completed` received → in-memory cursor dropped; next `GET /api/fetcher/state` mock returns `404` → backfill (F14) triggered; `status`/`running` event posted afterwards with `payload.reset_id` = the `reset-completed` reset_id.
- `reset-started` received → **no** ack, no extra POST, poll loop stays paused (asserts no redundant handling).
- Unknown `event:` type → no-op (no POST, poll loop unaffected).
- Reconnect after a dropped stream sends `Last-Event-ID` = last seen event id.
- `: ping` frame → treated as heartbeat, no event dispatched.
- Ack POST returns non-2xx → subscriber stays paused, does not throw, still recovers on subsequent `reset-completed`.
- Component id overridden via `COMPONENT_ID` → header reflects the override.

### 7.2 Integration test cases

Real host against a **mock GitHub API** (serves deployments, statuses, workflow-run metadata, workflow YAML, workflow list, environment list, and artifact fixtures) + real API + Postgres. Asserts:

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
