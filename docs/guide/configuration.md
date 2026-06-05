# Configuration

Every environment variable, grouped by concern. Source of truth: [`compose/.env.example`](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/compose/.env.example). Copy it to `compose/.env` and set the values for your [profile](./install.md#deployment-shapes-compose-profiles).

## Stack version

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DASHBOARD_VERSION` | no | `latest` | Image tag applied to all six stack images. **Set without a leading `v`** — the git tag `v0.7.0` publishes images as `0.7.0`. `latest` tracks the newest push to main. For a reproducible deploy, pin to a published release (e.g. `0.7.0`). |

See [Install — Pinning a release version](./install.md#pinning-a-release-version) for the full workflow, and [RELEASING.md](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/RELEASING.md) for the release process.

## Which vars does my profile need?

| Profile | Required |
|---|---|
| `standalone` | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST` |
| `standalone-pull` | as `standalone` + `GITHUB_*` |
| `full` | `API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD` |
| `full-pull` | as `full` + `GITHUB_*` |
| `demo` | none (insecure defaults applied) |

## API

| Var | Required | Default | Purpose |
|---|---|---|---|
| `API_KEY` | **yes** | — | Write-endpoint shared secret (`X-Api-Key` header). Every write is `401` without it. |
| `CONTROL_API_KEY` | no | unset | Control-surface secret (`X-Control-API-Key`). **Unset hides `POST /api/control/reset` (returns 404).** When set, keep it **distinct** from `API_KEY` (least-privilege: write creds must not trigger a destructive reset). |
| `GATEWAY_PORT` | no | `8080` | Host port the gateway (the single public surface) binds to. |
| `CORS_ALLOWED_ORIGINS` | no | empty (off) | Comma-separated allowed origins. Empty (default) disables CORS — use when the App Gateway fronts the API on the same origin. Set only for split-domain deployments. |
| `HISTORY_RETENTION_DAYS` | no | `365` | Deployment history retention window. **Minimum 90.** Pruned daily by a background job. |
| `RESET_ACK_TIMEOUT_SECONDS` | no | `10` | Max seconds to await component acks before forcing drain (D13). |
| `RESET_GATE_MAX_TTL_SECONDS` | no | `60` | Hard wall-clock ceiling on a reset cycle (D12). |
| `RESET_EXPECTED_COMPONENTS` | no | `dashboard-fetcher,demo-driver` | CSV of component ids whose acks are awaited during reset (D13). |

## PostgreSQL: bundled profiles

Used by `full`, `full-pull`, and `demo`.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `POSTGRES_USER` | **yes** | — | Database user. |
| `POSTGRES_PASSWORD` | **yes** | — | Database password. |
| `POSTGRES_DB` | no | `deployment_dashboard` | Database name. |

## PostgreSQL: external profiles

Used by `standalone` and `standalone-pull`.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `POSTGRES_HOST` | **yes** | `postgres` | Hostname/IP of your external PostgreSQL. Override the bundled-service default. |
| `POSTGRES_PORT` | no | `5432` | External PostgreSQL port. |
| `POSTGRES_USER` | **yes** | — | Database user. |
| `POSTGRES_PASSWORD` | **yes** | — | Database password. |

## Fetcher: pull mode

Pull mode applies to `standalone-pull` and `full-pull` only.

Opt-in pull→push edge. Only needed on a `-pull` profile against real GitHub. The `demo` profile repoints the fetcher at the in-stack GitHub Emulator and supplies its own values, so none of these are required for demo.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `GITHUB_TOKEN` | **yes** (pull) | — | GitHub token (PAT / App token) for polling real GitHub. |
| `GITHUB_REPOS` | **yes** (pull) | — | Comma-separated `owner/repo` list to poll, e.g. `acme/api,acme/web`. |
| `GITHUB_BASE_URL` | no | `https://api.github.com` | REST base URL. GitHub Enterprise Server: `https://<host>/api/v3`. |
| `GITHUB_VERSION_SOURCE` | no | `attribute:sha` | Where the version string comes from: `attribute:<attr>` \| `payload:<field>` \| `artifact:<filename>`. |
| `GITHUB_RATE_LIMIT_BUDGET_PCT` | no | `30` | Percent of the GitHub hourly quota the fetcher may consume (1–100). |
| `GITHUB_RATE_LIMIT` | no | `0` | Total hourly GitHub request quota. `0` = auto-discover via `GET /rate_limit` on startup (F16). |
| `GITHUB_SERVICE_MAP` | no | (empty) | Optional service-identity overrides: comma-sep `key=value`. Key without `/` = workflow-level; key with `/` = repo-level (§5.8.3). |
| `POLL_INTERVAL_SECONDS` | no | `30` | Poll cadence (the demo profile uses `10`). |
| `BACKFILL` | no | `false` | Force a one-time backfill run regardless of cursor state (F14). |
| `INITIAL_LOOKBACK` | no | `7.00:00:00` | Normal-poll first-run lookback (TimeSpan `d.hh:mm:ss`); also backfill fallback when `BACKFILL_MAX_AGE` is unset (F7). |
| `BACKFILL_MAX_AGE` | no | (uses `INITIAL_LOOKBACK`) | How far back backfill scans per environment (TimeSpan `d.hh:mm:ss`). |
| `BACKFILL_DEPTH` | no | `2` | Latest status events to seed per (service, environment) slot during backfill. |

> **Container-side binding (don't rename `GITHUB_*`).** `docker-compose.yaml` maps each `GITHUB_*` host var to a `GITHUB__<PascalCase>` container env var (e.g. `GITHUB_BASE_URL` → `GITHUB__BaseUrl`). The segment after `__` must match the C# property name — .NET config maps `__` to a section separator and binds by property name, not by `SCREAMING_SNAKE`.

## Demo / dev only

Set by [`docker-compose.demo.yaml`](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/compose/docker-compose.demo.yaml) for the zero-config `demo` profile — **not required for any production profile.** Override only to tune the simulated deployment stream.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `EMIT_INTERVAL_MS` | no | `8000` | Interval (ms) between simulated deployment events from the demo driver / emulator. |
| `EMIT_DELAY_MS` | no | `0` | Startup delay (ms) before the demo driver begins emitting. |
| `GITHUB_SIM_RATE_LIMIT` | no | `5000` | Simulated GitHub hourly request quota the emulator advertises. |

Other demo vars (`WRITE_API_URL`, `FETCHER_URL`, `GITHUB_EMULATOR_URL`, `MOCK_URL`, `PORT`, `SEED_ON_STARTUP`, `SCENARIOS_DIR`) are fixed internal wiring set by the overlay and are not meant to be overridden.
