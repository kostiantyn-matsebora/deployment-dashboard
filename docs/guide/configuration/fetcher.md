# Configuration — Fetcher

Fetcher pull-mode variables for the `-pull` profiles, plus the workflow exclude filter for the GitHub adapter.

## :material-sync: Fetcher: pull mode { #fetcher-pull-mode }

Pull mode applies to `standalone-pull` and `full-pull` only.

Opt-in pull→push edge. Only needed on a `-pull` profile against real GitHub. The `demo` profile repoints the fetcher at the in-stack GitHub Emulator and supplies its own values, so none of these are required for demo.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `GITHUB_TOKEN` | **yes** (pull) | — | GitHub token (PAT / App token) for polling real GitHub. |
| `GITHUB_REPOS` | **yes** (pull) | — | Repos to poll. Accepts exact `owner/repo`, `owner/*` (all repos of one owner), or bare `*` (every repo the token can access). Glob forms trigger GitHub API discovery within the existing rate-limit budget. **Empty = no repos polled** — empty is NOT equivalent to `*`. |
| `GITHUB_BASE_URL` | no | `https://api.github.com` | REST base URL. GitHub Enterprise Server: `https://<host>/api/v3`. |
| `GITHUB_VERSION_SOURCE` | no | `attribute:sha` | Where the version string comes from: `attribute:<attr>` \| `payload:<field>` \| `artifact:<filename>`. |
| `GITHUB_RATE_LIMIT_BUDGET_PCT` | no | `30` | Percent of the GitHub hourly quota the fetcher may consume (1–100). |
| `GITHUB_RATE_LIMIT` | no | `0` | Total hourly GitHub request quota. `0` = auto-discover via `GET /rate_limit` on startup (F16). |
| `GITHUB_SERVICE_MAP` | no | (empty) | Optional service-identity overrides: comma-sep `key=value`. Key without `/` = workflow-level; key with `/` = repo-level (§5.8.3). |
| *(no var)* | — | *(auto)* | The fetcher sets `namespace` on every deployment event it posts. For GitHub, `namespace` = the repository short name (e.g. the `acme/api` repo → `namespace: "api"`). No configuration is required; existing `GITHUB_REPOS` entries are used as-is. Services from different repos that share a workflow name appear as distinct `(namespace, service)` rows in the dashboard and are disambiguated via the `namespace/service` prefix when there is a name collision. |
| `POLL_INTERVAL_SECONDS` | no | `30` | Poll cadence (the demo profile uses `10`). |
| `DISCOVERY_INTERVAL_SECONDS` | no | `3600` | Cadence of the slow, separate [provided-presets discovery loop](../provided-presets.md#automatic-discovery-pull-mode) (issue #391) — independent of `POLL_INTERVAL_SECONDS`. Reuses the same `GITHUB_REPOS` list and `GITHUB_TOKEN`; requires `Contents:read` (below) to actually discover anything — see [Fetcher spec § Preset discovery](../../FETCHER_SPECIFICATION.md#8-preset-discovery-issue-391). |
| `BACKFILL` | no | `false` | Force a one-time backfill run regardless of cursor state (F14). |
| `INITIAL_LOOKBACK` | no | `7.00:00:00` | Normal-poll first-run lookback (TimeSpan `d.hh:mm:ss`); also backfill fallback when `BACKFILL_MAX_AGE` is unset (F7). |
| `BACKFILL_MAX_AGE` | no | (uses `INITIAL_LOOKBACK`) | How far back backfill scans per environment (TimeSpan `d.hh:mm:ss`). |
| `BACKFILL_DEPTH` | no | `2` | Latest status events to seed per (service, environment) slot during backfill. |

!!! note "Settings layering"
    An appsettings `GitHub` section provides base values; `GITHUB_*` env vars override it (same pattern as the rest of the stack).

## :material-key: Fetcher: GitHub token permissions { #github-token-permissions }

`GITHUB_TOKEN` is **read-only** — the Fetcher only polls GitHub and never writes. Grant the least it needs.

| Repos | Classic PAT | Fine-grained PAT |
|---|---|---|
| Public only | no scopes | **Public repositories** → read-only |
| Private / org — minimal | `repo` scope | **Repository permissions** → Deployments · Actions, both **Read-only** (Metadata: Read-only is mandatory and auto-included) |
| Private / org — full Swimlanes | `repo` scope | the minimal set **+ Contents: Read-only** |

**Two tiers for private/org repos (fine-grained PAT):**

- **Minimal — `Deployments + Actions: Read-only`.** Full-fidelity Matrix (stable service identity, version, status, actor) and a working Swimlanes view via non-explicit correlation. No source-code access — service identity resolves from the Actions *workflows* endpoint, not the workflow YAML.
- **Full Swimlanes — `+ Contents: Read-only` (opt-in).** Adds explicit `parent_deployments` edges derived from the workflow `needs:` graph, enabling the Swimlanes explicit-parent correlation predicate. Without it the needs-graph fetch is skipped (parent edges empty) and identity is **unaffected** — ingest never blocks. Public repos read `contents` without a scope, so they get explicit edges regardless. This same grant also unlocks **automatic [provided-presets](../provided-presets.md) discovery** (issue #391) — the `.deployment-dashboard` directory listing is a Contents-API call too. Without it, presets for that repo still work via the [push-mode `curl PUT` recipe](../provided-presets.md#publishing-presets-push-mode) — see [Provided presets § Three permission tiers](../provided-presets.md#three-permission-tiers).

What each permission unlocks — the endpoints the Fetcher polls:

| Fine-grained permission | Used for |
|---|---|
| **Deployments: Read-only** | Deployments, deployment statuses + reviews — `GET …/deployments`, `…/deployments/{id}/statuses`, `…/deployments/{id}/reviews` |
| **Actions: Read-only** | Workflow runs, **service identity** (workflow name), workflows, artifacts — `GET …/actions/runs/{id}`, `…/actions/workflows/{workflow_id}`, `…/actions/workflows`, `…/actions/runs/{id}/artifacts`, `…/actions/artifacts/{id}/zip` |
| **Contents: Read-only** *(opt-in)* | Workflow YAML for the `needs:` graph — explicit Swimlanes `parent_deployments` edges only — `GET …/contents/{path}`. Omit it and parent edges resolve to `[]`; everything else is unaffected. |
| **Metadata: Read-only** *(mandatory)* | Repo discovery for `owner/*` / `*` globs and environment listing — `GET /orgs/{owner}/repos`, `GET …/environments` |

For a single classic PAT the `repo` scope covers all of the above on private repos; public-only tokens need no scopes. The startup rate-limit probe (`GET /rate_limit`, F16) works with any token.

!!! warning "Classic `repo` over-grants"
    The classic `repo` scope grants full read/**write** to every private repo — far beyond the read-only access the Fetcher uses. Prefer a fine-grained PAT where org policy allows.

!!! note "Org repos with SAML SSO"
    After creating a classic `repo` PAT, click **Configure SSO → Authorize**, then re-authorize after every rotation. An unauthorized token returns **HTTP 403** (`X-GitHub-SSO` header), not 401.

The [install guide](../install/docker-compose.md) links here when setting `GITHUB_TOKEN` for the `-pull` profiles.

## :material-filter-outline: Fetcher: workflow exclude { #github-workflow-exclude }

GitHub-adapter filter that prevents specific workflows from being polled or ingested. Reduces CI/CD API rate-limit consumption for unwanted pipelines.

**`GITHUB_WORKFLOW_EXCLUDE`.** A CSV of glob patterns over `owner/repo/workflow`. GitHub owner, repo, and workflow names never contain `/`, so each segment is clean and `*` matches within the segment only.

| Example | Excludes |
|---|---|
| `acme/web/legacy-*` | workflows starting `legacy-` in `acme/web` |
| `acme/*/internal` | the `internal` workflow in any `acme` repo |
| `*/*/canary` | the `canary` workflow in any repo |
| `acme/web/*` | all workflows in `acme/web` |

| Var | Required | Default | Purpose |
|---|---|---|---|
| `GITHUB_WORKFLOW_EXCLUDE` | no | *(empty — exclude nothing)* | CSV of `owner/repo/workflow` glob patterns. Matching workflows are **never ingested** by the GitHub fetcher. Empty = exclude nothing. |

This exclude is **GitHub-specific** — it lives in the GitHub adapter. Future CI/CD provider adapters (Azure DevOps, Jenkins, …) will each expose their own analogous exclude over their own provider entity identifiers.
