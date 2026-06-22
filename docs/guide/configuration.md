# Configuration

Every environment variable, grouped by concern. Source of truth: [`compose/.env.example`](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/compose/.env.example). Copy it to `compose/.env` and set the values for your [profile](./install/docker-compose.md#2-configure--run).

## :material-tag-outline: Stack version { #stack-version }

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DASHBOARD_VERSION` | no | `latest` | Image tag applied to all six stack images. Pin to a published release for reproducible deploys (e.g. `0.13.1`). **Set without a leading `v`** — the git tag `v0.17.0` publishes images as `0.17.0`. `:latest` tracks whichever pipeline (release or CI main build) ran most recently. The API assembly version is baked at build time and reported by the dashboard footer via `GET /api/version`: release images → `vX.Y.Z` (e.g. `v0.13.1`); CI/main `:latest` images → `main+<short-sha>` (e.g. `main+a947098`); local/unstamped → `0.0.0-dev`. No separate runtime env var is needed. |

See [Install — Pinning a release version](./install/docker-compose.md#pinning-a-release-version) for the full workflow, and [RELEASING.md](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/RELEASING.md) for the release process.

## :material-key-variant: API { #api }

| Var | Required | Default | Purpose |
|---|---|---|---|
| `API_KEY` | **yes** | — | Write-endpoint shared secret (`X-Api-Key` header). Every write is `401` without it. |
| `CONTROL_API_KEY` | no | unset | Control-surface secret (`X-Control-API-Key`). **Unset hides `POST /api/control/reset` (returns 404).** When set, keep it **distinct** from `API_KEY` (least-privilege: write creds must not trigger a destructive reset). |
| `GATEWAY_PORT` | no | `8080` | Host port the gateway (the single public surface) binds to. |
| `CORS_ALLOWED_ORIGINS` | no | empty (off) | Comma-separated allowed origins. Empty (default) disables CORS — use when the App Gateway fronts the API on the same origin. Set only for split-domain deployments. |
| `HISTORY_RETENTION_DAYS` | no | `365` | Deployment history retention window. **Minimum 90.** Pruned daily by a background job. |
| `ANALYTICS_WINDOW_GRANULARITY` | no | `day` | Granularity to which the analytics `window.to` boundary is truncated: `day` (start of UTC day) or `hour` (start of UTC hour). Controls ETag stability — `day` keeps the ETag stable for the whole UTC day (today's deploys appear in DORA trends at the next UTC day boundary); `hour` yields fresher data, stable within the hour. Matrix / Swimlanes are unaffected (always real-time). |
| `ANALYTICS_FUNNEL_ENVIRONMENTS` | no | `dev,staging,qa,preprod,prod` | Comma-separated, ordered list of environments forming the promotion-funnel ladder (per-stage counts + conversion chart). The **last** entry is the production terminal that the DORA lead-time metric measures promotion chains to. Values are matched **case-insensitively** against the deployment `environment` field. Environments outside this list are excluded from funnel stages. Lets projects with non-standard stage names or fewer stages shape the funnel. |
| `RESET_ACK_TIMEOUT_SECONDS` | no | `10` | Max seconds to await component acks before forcing drain (D13). |
| `RESET_GATE_MAX_TTL_SECONDS` | no | `60` | Hard wall-clock ceiling on a reset cycle (D12). |
| `RESET_EXPECTED_COMPONENTS` | no | `dashboard-fetcher,demo-driver` | CSV of component ids whose acks are awaited during reset (D13). |

## :material-database: PostgreSQL: bundled profiles { #postgresql-bundled-profiles }

Used by `full`, `full-pull`, and `demo`.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `POSTGRES_USER` | **yes** | — | Database user / cloud identity DB role name. |
| `POSTGRES_PASSWORD` | conditional | — | Database password. Set for static-credential auth (local/CI). **Omit or leave empty** to activate managed-identity passwordless auth. See [Auth modes](#postgresql-auth-modes) below. |
| `POSTGRES_DB` | no | `deployment_dashboard` | Database name. |
| `POSTGRES_SSL_MODE` | no | managed-identity: `Require`; password: *(omitted)* | Npgsql `SslMode` override. Passed verbatim when set. Valid values (case-insensitive): `Disable`, `Allow`, `Prefer`, `Require`, `VerifyCA`, `VerifyFull`. See [Auth modes](#postgresql-auth-modes). |

## :material-database-outline: PostgreSQL: external profiles { #postgresql-external-profiles }

Used by `standalone` and `standalone-pull`.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `POSTGRES_HOST` | **yes** | `postgres` | Hostname/IP of your external PostgreSQL. Override the bundled-service default. |
| `POSTGRES_PORT` | no | `5432` | External PostgreSQL port. |
| `POSTGRES_USER` | **yes** | — | Database user / cloud identity DB role name. |
| `POSTGRES_PASSWORD` | conditional | — | Database password. Set for static-credential auth (local/CI). **Omit or leave empty** to activate managed-identity passwordless auth. See [Auth modes](#postgresql-auth-modes) below. |
| `POSTGRES_SSL_MODE` | no | managed-identity: `Require`; password: *(omitted)* | Npgsql `SslMode` override. Passed verbatim when set. Valid values (case-insensitive): `Disable`, `Allow`, `Prefer`, `Require`, `VerifyCA`, `VerifyFull`. See [Auth modes](#postgresql-auth-modes). |

## :material-shield-key-outline: PostgreSQL: auth modes { #postgresql-auth-modes }

Auth mode is **auto-detected from credential presence** — no explicit toggle.

| `POSTGRES_PASSWORD` | Mode | How it works |
|---|---|---|
| Set (non-empty) | Static password | `POSTGRES_USER` + `POSTGRES_PASSWORD` used verbatim. Default behavior; suitable for local Compose, CI, and tests. |
| Omitted / empty | Managed identity | No static password. The service authenticates as its ambient cloud identity (e.g. Azure Workload Identity / Managed Identity) and obtains a short-lived access token at connection time, refreshed transparently. Set `POSTGRES_USER` to the identity's PostgreSQL role name. |

**SSL mode.** Precedence: `POSTGRES_SSL_MODE` env → `Postgres:SslMode` appsettings.

- **Unset, managed-identity mode:** `SslMode=Require` (Azure-managed PostgreSQL enforces TLS; explicit opt-out requires `POSTGRES_SSL_MODE=Disable`).
- **Unset, static-password mode:** `SslMode` omitted (local/bundled non-SSL container unchanged).
- **Set:** value passed verbatim to Npgsql regardless of auth mode.

!!! tip "Cloud deployment — Azure target (NFR-01 / NFR-06)"
    Omit `POSTGRES_PASSWORD` to eliminate static credential management. The seam is provider-agnostic; any identity system that supplies a bearer token to the Npgsql password provider is compatible.

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
| `BACKFILL` | no | `false` | Force a one-time backfill run regardless of cursor state (F14). |
| `INITIAL_LOOKBACK` | no | `7.00:00:00` | Normal-poll first-run lookback (TimeSpan `d.hh:mm:ss`); also backfill fallback when `BACKFILL_MAX_AGE` is unset (F7). |
| `BACKFILL_MAX_AGE` | no | (uses `INITIAL_LOOKBACK`) | How far back backfill scans per environment (TimeSpan `d.hh:mm:ss`). |
| `BACKFILL_DEPTH` | no | `2` | Latest status events to seed per (service, environment) slot during backfill. |

!!! note "Settings layering"
    An appsettings `GitHub` section provides base values; `GITHUB_*` env vars override it (same pattern as the rest of the stack).

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

## :material-filter-outline: API: service exclude { #service-scope-filter }

Deployment-wide filter that hides a subset of services across **all** API read and write surfaces. Configured on the API container only — the fetcher does not use this var.

**`SERVICE_EXCLUDE`.** A CSV of glob patterns matched against the event's opaque `namespace/service` identity. `namespace` is emitter-supplied and adopter-defined; the identity may itself contain `/`. Glob semantics match the Matrix `service` filter:

| Pattern form | Matches |
|---|---|
| Without `/` (e.g. `canary`) | `service` segment across all namespaces |
| With `/` (e.g. `acme/*`, `*/canary`) | full `namespace/service` composite; `*` spans `/` |

| Var | Required | Default | Purpose |
|---|---|---|---|
| `SERVICE_EXCLUDE` | no | *(empty — exclude nothing)* | CSV of `namespace/service` glob patterns. Empty = exclude nothing. |

**API write effect.** `POST /api/deployments` **rejects** a matching event with `403` (problem+json).

**API read effect.** Matching events are filtered from `/api/services`, `/api/matrix`, `/api/deployments`, the SSE stream (live + replay), and `/api/analytics/*` (excluded services contribute to no analytics aggregate). By-id (`/api/deployments/{id}`) returns `404`. Already-stored events for a now-excluded service remain in storage but are never surfaced; storage-clearing (reset / backfill) semantics are unchanged.

## :material-bookmark-box-multiple-outline: UI settings presets { #ui-settings-presets }

Presets are a **client-side feature** — no env vars, no backend, no accounts. State lives in `localStorage` in the browser. Nothing here needs to be configured on the server.

### What a preset saves

A preset captures the full UI settings snapshot at the moment it is saved:

- active service, environment, and notification glob filter patterns
- view and display preferences (visible columns, layout options)
- notification filter settings (status, service, environment axes)

### Working with presets

| Action | How |
|---|---|
| **Save** | Open the preset panel; type a name; click **Save current settings**. |
| **Apply** | Click a preset name — all captured settings take effect immediately. |
| **Clone** | Open a preset's context menu; choose **Clone** — saves a copy with `(copy)` appended. |
| **Rename** | Open the context menu; choose **Rename**; confirm. |
| **Delete** | Open the context menu; choose **Delete** — a confirmation prompt prevents accidental removal. |

### File-based sharing

Presets can be shared without a server. Each preset exports as a single `dd-preset-<slug>.json` file.

**Sharing flow:**

1. Open the preset context menu and choose **Export** — the file downloads instantly.
2. Share the file by email, Slack, or by committing it to a git repo alongside your pipeline config.
3. The recipient opens the preset panel, clicks **Import**, and selects the file — the preset appears in their list immediately.

The app **never fetches preset files from the network**. Import is always an explicit user action. There is no central registry and no sync — each browser holds its own presets independently.

!!! tip "Team starter kit"
    Commit a `presets/` directory to your repo with a `dd-preset-<name>.json` for each standard view (e.g. `dd-preset-prod-services.json`, `dd-preset-on-call.json`). New team members import them on first launch and are up to speed in seconds.

[:octicons-arrow-right-24: See the preset panel in action](./screenshots.md#ui-settings-presets)

## :material-flask-outline: Demo / dev only { #demo-dev-only }

Set by [`docker-compose.demo.yaml`](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/compose/docker-compose.demo.yaml) for the zero-config `demo` profile — **not required for any production profile.** Override only to tune the simulated deployment stream.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `EMIT_INTERVAL_MS` | no | `8000` | Interval (ms) between simulated deployment events from the demo driver / emulator. |
| `EMIT_DELAY_MS` | no | `0` | Startup delay (ms) before the demo driver begins emitting. |
| `GITHUB_SIM_RATE_LIMIT` | no | `5000` | Simulated GitHub hourly request quota the emulator advertises. |

Other demo vars (`WRITE_API_URL`, `FETCHER_URL`, `GITHUB_EMULATOR_URL`, `MOCK_URL`, `PORT`, `SEED_ON_STARTUP`, `SCENARIOS_DIR`) are fixed internal wiring set by the overlay and are not meant to be overridden.

### Demo-gateway image vars

The `demo` profile uses the `deployment-dashboard-gateway-demo` image instead of the production gateway. Two additional vars are specific to that image and are set by the demo overlay:

| Var | Default (in image) | Set by demo overlay | Purpose |
|---|---|---|---|
| `DNS_RESOLVER` | `127.0.0.11` | `127.0.0.11` (override with `168.63.129.16` for Azure Container Apps) | DNS resolver for variable-based `proxy_pass` in the demo snippet — required because the demo-driver is an optional service. |
| `DEMO_DRIVER_UPSTREAM` | — | `demo-driver:3001` | Demo driver upstream `host:port`. |

These vars are **absent from the production gateway image** — its `NGINX_ENVSUBST_FILTER` excludes them.
