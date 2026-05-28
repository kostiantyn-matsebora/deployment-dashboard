# Fetcher Specification — `Dashboard.Fetcher`

**Status:** Draft · **Date:** 2026-05-28

Implementation contract for **`Dashboard.Fetcher`** — the optional, separately-deployed pull-mode adapter that translates a CI/CD tool's **pull** API into the dashboard's **push** ingest. Its defining requirement is a **tool-agnostic abstraction layer**: the polling host knows nothing about any specific CI/CD system; all tool-specifics live behind one interface. This spec defines that abstraction and ships a concrete **GitHub** implementation of it.

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/SAD.md`](SAD.md) §3, §7 | Fetcher as opt-in pull→push edge; backend stays CI-agnostic. |
| [`docs/api/openapi.yaml`](api/openapi.yaml) | `POST /api/deployments`, `GET/PUT /api/fetcher/state/{adapter}`, `X-Progress-Reporter`. |
| [`docs/BACKEND_SPECIFICATION.md`](BACKEND_SPECIFICATION.md) | Wire DTO (`DeploymentEventIngest`), cursor + append-only semantics. |

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

---

## 3. Solution layout

```
backend/
  fetcher/       Dashboard.Fetcher/        # abstraction + adapters + clients + orchestrator (library)
    Abstractions/   ICiCdAdapter, FetchResult
    Adapters/GitHub/  GithubActionsAdapter, GithubClient, mapping, cursor
    Ingest/         IngestClient, FetcherStateClient   (HTTP clients to the API)
    Orchestration/  PollLoop / per-adapter runner
  fetcher-host/  Dashboard.Fetcher.Host/   # BackgroundService worker + DI + config + Dockerfile
  tests/
    Dashboard.Fetcher.Tests/               # owned here, excluded from the API test run
```

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

Auth: `Authorization: Bearer <token>` + `Accept: application/vnd.github+json` + `X-GitHub-Api-Version`. Base URL from config (`https://api.github.com` default; overridable for the integration mock).

### 5.2 Field mapping → `DeploymentEventIngest`

| Contract field | GitHub source |
|---|---|
| `deployment_id` | `gh-deploy-{deployment.id}` (correlation key; all status rows of one deployment share it) |
| `service` | configured mapping `repo → service` (default: repo name) |
| `environment` | `deployment.environment` |
| `status` | mapped from `status.state` (§5.3) |
| `happened_at` | `status.created_at` (UTC) |
| `version` | configurable source: `deployment.payload.version` → `sha[..7]` (default) |
| `sha` | `deployment.sha` |
| `ref` | `deployment.ref` |
| `actor` | `status.creator.login` ?? `deployment.creator.login` |
| `run_url` | `status.target_url` (the Actions run, when present) |
| `run_number` | omitted (not on the Deployments API) |
| `parent_deployments` | omitted — correlation is the client's job (BACKEND D-DAG) |

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

---

## 6. Configuration (env)

| Var | Example | Purpose |
|---|---|---|
| `DASHBOARD_API_BASE_URL` | `http://gateway:8080` | where to POST events + read/write state |
| `API_KEY` | *(secret)* | `X-Api-Key` for ingest + state |
| `POLL_INTERVAL_SECONDS` | `30` | loop cadence (integration uses `1`) |
| `INITIAL_LOOKBACK` | `7.00:00:00` | first-run backfill bound (F7) |
| `GITHUB__BASE_URL` | `https://api.github.com` | overridable for the integration mock |
| `GITHUB__TOKEN` | *(secret)* | PAT / GitHub App token |
| `GITHUB__REPOS` | `acme/api,acme/web` | repos to poll |
| `GITHUB__SERVICE_MAP` | `acme/api=checkout-api` | optional `repo → service` overrides |
| `GITHUB__VERSION_SOURCE` | `sha` | `sha` \| `payload.version` |

Adapter config is namespaced (`GITHUB__…`) so a second adapter (`AZDO__…`, `JENKINS__…`) drops in without collision.

---

## 7. Testing

| Layer | Project | Scope |
|---|---|---|
| Unit | `Dashboard.Fetcher.Tests` | GitHub JSON fixture → `DeploymentEventIngest` mapping; status table; cursor advance / first-run lookback; orchestrator loop (mock `ICiCdAdapter` + mock ingest/state clients); at-least-once on mid-batch failure. |
| Integration | cross-stack suite | Real host against a **mock GitHub API** + real API + Postgres; asserts wire shape (FR-06), the opaque-cursor round-trip, and the NFR-03 latency envelope. |

`Dashboard.Fetcher.Tests` is **excluded from the API test run** and exercised on the fetcher's own pipeline.

---

## 8. Out of scope

- Horizontal scaling of the fetcher (single replica per adapter — F6).
- Adapters other than GitHub (the abstraction is the deliverable; ADO/Jenkins are future drop-ins).
- Any backend change — the fetcher only consumes the existing public contract.
- Triggering/managing deployments (read-only, SAD §3 Non-Goals).
