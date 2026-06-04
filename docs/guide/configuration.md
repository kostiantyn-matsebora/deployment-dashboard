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
| `API_PORT` | no | `8080` | Host port the API container binds to. |
| `CORS_ALLOWED_ORIGINS` | no | `*` | Comma-separated allowed origins. Empty string disables CORS (use when the App Gateway fronts the API on the same origin). `*` is for demo/local only. |
| `HISTORY_RETENTION_DAYS` | no | `30` | Deployment history retention window. **Minimum 90**; `365` recommended for production. The `30` default is demo-friendly. |

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
| `POLL_INTERVAL_SECONDS` | no | `30` | Poll cadence (the demo profile uses `10`). |

> **Container-side binding (don't rename `GITHUB_*`).** `docker-compose.yaml` maps each `GITHUB_*` host var to a `GITHUB__<PascalCase>` container env var (e.g. `GITHUB_BASE_URL` → `GITHUB__BaseUrl`). The segment after `__` must match the C# property name — .NET config maps `__` to a section separator and binds by property name, not by `SCREAMING_SNAKE`.
