# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — currently pre-1.0, expect breaking changes between minor versions.

## [Unreleased]


## [0.15.0] - 2026-06-17

### Added

- **Opt-in desktop browser notifications for deployment status changes.** A new bell toggle in the dashboard top bar enables native desktop notifications (Web Notifications API) that fire when a deployment changes status, driven by the existing live event stream — no backend and no extra configuration. A settings popover mirrors the controls from the browser extension: a master on/off switch plus per-status, per-service, and per-environment filters, all persisted in the browser. Notifications stay off until you enable them and grant the browser permission.

## [0.14.0] - 2026-06-17

### Added

- **Deployed version and a documentation link, surfaced in the dashboard footer.** A new fixed footer shows the running version and links to the official documentation, and the header is simplified to the brand name. The version is served by a new unauthenticated `GET /api/version` and baked into the API image at build time, so it reflects exactly what is deployed with no extra configuration: published releases report `vX.Y.Z`, `:latest` / `main` builds report `main+<commit>`, and local builds report `0.0.0-dev`.

## [0.13.1] - 2026-06-16

### Changed

- **Routine dependency maintenance.** Bumped build- and runtime dependencies across the frontend and demo packages — including `form-data`, `tar`, `esbuild`/`vite`, `hono`, `jest`, and the Node base image — to pick up upstream security and bug-fix releases. No functional, API, or contract change.

## [0.13.0] - 2026-06-16

### Changed

- **The gateway now deploys to Azure Container Apps as well as Docker Compose, from a single config — no per-platform edits.** The production gateway sets the proxied `Host` header per-location to the upstream FQDN (Azure Container Apps' internal ingress routes by `Host`; the gateway's public hostname would 404 at the upstream), resolves the API and frontend upstreams at startup, and no longer carries the Docker-only DNS resolver. The same image routes `/`, `/api/*`, and the SSE stream correctly on both platforms.

### Added

- **Separate demo-gateway image.** Demo-only `/demo/*` routing now lives in a dedicated `…-gateway-demo` image layered on top of the production gateway, so the production image carries no demo routes, DNS resolver, or demo-driver upstream. The `demo` Compose profile selects the demo image automatically; no adopter action is required.

## [0.12.1] - 2026-06-15

### Fixed

- **Managed-identity Postgres connections now enforce SSL.** The assembled connection string omitted the `SslMode` keyword, so Npgsql fell back to its `Prefer` default (silent non-SSL) — which Azure Database for PostgreSQL rejects for AAD / managed-identity users, with no knob to force it. Managed-identity connections now default to `SslMode=Require`, so AAD auth works out of the box; static-password mode is unchanged (local/bundled non-SSL container still works). A new `POSTGRES_SSL_MODE` env var (and matching `Postgres:SslMode` appsettings key) overrides the SSL mode for either auth mode, passed verbatim to Npgsql. See [Configuration](https://kostiantyn-matsebora.github.io/deployment-dashboard/guide/configuration/#postgresql-auth-modes).

## [0.12.0] - 2026-06-14

### Added

- **Swimlanes — collapsible service lanes.** Each service lane in the Swimlanes view can now collapse to a compact single-chain "vector" (the deployment chain ending at the service's newest event) and expand back to the full promotion DAG — via per-lane chevrons plus Collapse-all / Expand-all controls. An Auto-scroll-to-change toggle (on by default) keeps the latest change in view, and a card flashes to highlight a live status change in either state. Per-lane collapse state and the auto-scroll preference persist across reloads (lanes start collapsed). This is a Swimlanes-view enhancement only — no API or contract change.

## [0.11.0] - 2026-06-14

### Added

- **Analytics view — DORA Four Keys dashboard.** A third dashboard view (alongside Matrix and Swimlanes) surfacing deployment frequency, lead time (approximated from `parent_deployments` promotion chains), change failure rate, and mean time to restore (MTTR). Supported by eight charts: deployment frequency over time, change-failure-rate trend, deployment-duration distribution (p50/p95), promotion funnel (per-stage counts + conversion), status distribution, deploy heatmap (day-of-week × hour), top deployers, and time-to-restore incidents. The period control covers 7 / 14 / 30 days, bounded by `HISTORY_RETENTION_DAYS`.
- **`ANALYTICS_WINDOW_GRANULARITY` config var.** Controls the UTC boundary the analytics window is truncated to (`day` | `hour`), governing ETag stability and data freshness. See [Configuration — API](https://kostiantyn-matsebora.github.io/deployment-dashboard/guide/configuration/#api).
- **`ANALYTICS_FUNNEL_ENVIRONMENTS` config var.** Comma-separated, ordered promotion-funnel ladder; the last entry is the production terminal used for DORA lead-time measurement. Values matched case-insensitively against the deployment `environment` field. See [Configuration — API](https://kostiantyn-matsebora.github.io/deployment-dashboard/guide/configuration/#api).

### Fixed

- **Demo dashboard no longer empties out as time passes.** The github-emulator seeded its deployments with hard-coded absolute timestamps, which eventually aged past the fetcher's initial lookback window — so a fresh demo (or a reset + re-seed) could backfill nothing and render an empty dashboard. Seed timestamps are now shifted relative to load time (anchoring the newest event to "now"), so the demo always presents recent activity.

## [0.10.0] - 2026-06-13

### Added

- **Passwordless (managed-identity) Postgres authentication.** PostgreSQL auth is now credential-optional, with the mode auto-detected from credential presence — no new toggle. With `POSTGRES_PASSWORD` set, services use the static user/password as before (the default — local Compose, CI, and tests are unchanged). With it omitted or blank, each service authenticates as its ambient cloud identity (e.g. Azure Workload Identity / Managed Identity), obtaining a short-lived access token at connection time and refreshing it transparently; `POSTGRES_USER` is then the identity's PostgreSQL role name. This removes static-secret storage and rotation for the Azure target, behind a provider-agnostic token-provider seam.
- **Browser extension (MVP).** A cross-browser MV3 WebExtension (`frontend/extension`) that surfaces deployment status from a configured dashboard — a toolbar badge, a status filter, and a popup listing the most recent runs — with its own build and packaging CI. It is loaded manually in developer mode for now, ships outside the six published stack images, and follows its own release cycle.

### Documentation

- Restructured and visually redesigned the adopter guide — install, configuration, quickstart, and screenshots — with paste-safe download steps, per-profile tabbed run cards, and clearer release-pinning guidance.
- Added a "Built by Claude" showcase page that tells the zero-to-hero story of the project as built by an AI engineering team under minimal human steering.


## [0.9.0] - 2026-06-06

### Added

- **Five new deployment statuses, surfaced end-to-end.** Beyond `in-progress` / `success` / `failure`, the dashboard now distinguishes `pending`, `queued`, `waiting`, `cancelled`, and `rejected` (an 8-value status enum). The three *effective* statuses (`success` / `in-progress` / `failure`) still drive the matrix tile and swimlane card colour; the five new statuses surface as a distinct **"next"** badge for a deployment beyond the live one, and all eight appear in deployment history and the inspector. The contract gains `MatrixSlot.next` (the latest non-effective deployment, when newer than the current effective one) and `MatrixSlot.prev_failed`.
- **Cancelled and not-approved deployments are distinguished from plain failures.** The fetcher derives `cancelled` from the associated workflow-run conclusion and `rejected` from pending-deployment reviews — signals that live beyond GitHub's `deployment_status` pipeline, which has no `cancelled`/`rejected` state of its own.
- **"Never deployed" neutral state.** A slot whose only/latest deployment is non-effective with no effective baseline now renders a neutral tile and status chip instead of a spinner or a failure.
- **Universal correlation id across the control plane.** Every control command now carries a `correlation_id` that ties a user-initiated action to all of its downstream events. For a reset it is born on `reset-initiated` and flows through `reset-started`, `reset-completed`, every component `reset-ack`, and the post-reset status events; the component-event stream and the demo driver's event feed surface it as a chip, and clicking a chip filters the feed to a single correlated process. Component events accept an optional `X-Correlation-Id` header (≤128 chars) that is persisted and echoed on the SSE frame.

### Changed

- **Breaking — `reset_id` retired in favour of `correlation_id`.** The control contract no longer exposes `reset_id`: the `POST /api/control/reset` `202` body returns `correlation_id`, the control-stream frames carry `correlation_id`, and the reset ack-gate now matches on the `X-Correlation-Id` request header instead of a `payload.reset_id` body field. The `component_events`, `control_stream_events`, and `reset_cycle` tables rename their `reset_id` column to `correlation_id` (handled by an EF migration). The demo's "reset on ingest/seed" checkboxes are removed — ingest never triggers a reset; use the dedicated Reset System control.

### Fixed

- **Demo rate-limit count no longer inflates on unchanged polls.** The github-emulator now honours `If-None-Match` (returning `304` with a content ETag) and exempts `GET /rate_limit`, so repeated fetcher polls of unchanged data no longer grow the dashboard's reported request count.

### Security

- `.gitignore` now ignores all `**/.env.*` files (while keeping `.env.example`), so environment files containing secrets cannot be committed accidentally.


## [0.8.0] - 2026-06-05

### Added

- **Deployment-history retention is now enforced.** A daily background job prunes `deployment_events` older than `HISTORY_RETENTION_DAYS` (default 365, minimum 90 — smaller values clamp up), alongside the short-lived control/component event logs (fixed 2-hour window). Previously `HISTORY_RETENTION_DAYS` was documented and wired into the API container but read by nothing, so deployment history grew unbounded.
- **Previously-undocumented configuration is now documented.** `GATEWAY_PORT`, `BACKFILL`, `INITIAL_LOOKBACK`, `GITHUB_SERVICE_MAP`, `GITHUB_RATE_LIMIT`, and the reset-choreography knobs (`RESET_ACK_TIMEOUT_SECONDS`, `RESET_GATE_MAX_TTL_SECONDS`, `RESET_EXPECTED_COMPONENTS`) are now in `compose/.env.example` and the configuration guide, with demo-only variables grouped in their own section.

### Changed

- **Breaking — unified, flat environment-variable convention.** Every setting now reads as a flat `SCREAMING_SNAKE` variable (an appsettings section still provides the defaults; the environment variable overrides it). The previous .NET `Section__Property` env forms are removed:
  - `Reset__AckTimeoutSeconds` / `Reset__GateMaxTtlSeconds` / `Reset__ExpectedComponents__N` → `RESET_ACK_TIMEOUT_SECONDS` / `RESET_GATE_MAX_TTL_SECONDS` / `RESET_EXPECTED_COMPONENTS` (now a comma-separated list, which also removes the old array-append footgun).
  - every `GITHUB__<Pascal>` (e.g. `GITHUB__BaseUrl`, `GITHUB__Token`) → flat `GITHUB_*` (`GITHUB_BASE_URL`, `GITHUB_TOKEN`, …).
  - `ConnectionStrings__Postgres` → assembled by the app from `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`.
  - **Action required:** adopters setting any of the old `__` forms must switch to the new flat names.
- **Breaking — `API_PORT` renamed to `GATEWAY_PORT`.** `API_PORT` was documented but never had any effect (the gateway is the single public surface); the host port is now correctly named `GATEWAY_PORT`.

### Documentation

- Documented the GitHub deployment-status → contract-status mapping decisions — `error` collapses into `failure`, and `inactive` is skipped as a supersession marker — so they are not re-discovered as bugs.
- The project home/README now leads with a views switcher and a light/dark C4 architecture diagram.


## [0.7.0] - 2026-06-05

### Added

- **Matrix environment-column controls.** Per-user control over the matrix's environment columns: a **Columns** picker (matrix view) to show/hide individual environments — a hidden column is removed from the grid entirely — and **drag-to-reorder** of the column headers via a grip handle. The Fields and Columns buttons show a count badge when items are hidden, and "Show all · reset order" restores the defaults. Column order and visibility persist client-side and survive reloads. No API or contract change — the matrix response still carries every environment; this is purely a per-user view preference.


## [0.6.1] - 2026-06-04

### Fixed

- **Matrix tile showed an in-progress spinner for a deployment that had actually failed.** A (service, environment) slot whose latest deployment failed and which had no earlier successful deployment was rendered with the amber in-progress spinner instead of a failed tile. The history drawer and swimlanes were unaffected (they read the status directly); only the matrix tile mis-derived its state. Failures now always render as a failed tile, with or without prior success history. Surfaced by backfilling a real repository whose environment had only ever failed.

### Documentation

- **GitHub authentication for organizations that disable fine-grained PATs.** The install guide now gives the classic PAT first-class standing for private/organization repositories (previously a parenthetical), adds an over-grant caveat (the classic `repo` scope grants full read/write — broader than the read-only access the Fetcher uses), and documents authorizing a classic PAT for **SAML SSO** — including re-authorizing after every token rotation. A new FAQ entry covers the `403` / `X-GitHub-SSO` symptom of an unauthorized token.


## [0.6.0] - 2026-06-04

### Added

- **Fetcher rate-limit telemetry on the dashboard.** The pull-mode Fetcher now reports its CI/CD API consumption after every poll cycle — a new `rate-limit` component event carrying the CI/CD API quota, the Fetcher's self-imposed budget, and its own usage. It is surfaced two ways: a usage chip with a click-to-expand popover in the dashboard header, and a "Fetcher · Rate Limit" card on the demo-driver panel. One indicator per configured CI/CD adapter, the last value persists across reloads, and it reuses the existing component-event stream — no `Dashboard.Api` change.

### Changed

- **Fetcher live poll stops paginating at the cursor window.** The deployments-list fetch now stops as soon as it crosses the cursor cutoff (GitHub returns newest-first), instead of paging the entire repository history and trimming afterwards — turning a ~40-page scan on large, active repos into ~1 page, while keeping the page-1 ETag short-circuit. Backfill was already bounded; the live path now matches it.
- **Fetcher self-throttle no longer counts free requests.** Conditional `304 Not Modified` responses — which consume no GitHub quota — are excluded from the Fetcher's own-usage counter, so the reported `own_used` reflects real quota consumption and the budget is not tripped by free polls. The own-usage counter also resets correctly when the rate-limit window rolls over.

### Fixed

- **Fetcher re-fetched finished deployments on every poll cycle.** A deployment's latest status was read by array position, but the GitHub deployment-statuses endpoint ordering is not guaranteed — so terminal deployments were never recorded in the skip cache and were re-polled (and their old statuses re-processed) indefinitely. The latest status is now selected by `created_at`; finished deployments are fetched once and then skipped.
- **Fetcher top-level environment variables were silently ignored.** `POLL_INTERVAL_SECONDS`, `INITIAL_LOOKBACK`, `BACKFILL_MAX_AGE`, and `BACKFILL_DEPTH` did not bind (configuration binding does not strip underscores from the documented `SCREAMING_SNAKE` names), so they fell back to their defaults regardless of what was set. They are now read explicitly by their documented names.


## [0.5.0] - 2026-06-03

### Changed

- **Fetcher live poll now uses conditional requests (ETag / `If-None-Match`).** The per-repo deployments list and in-flight deployment status re-reads send `If-None-Match`; an unchanged response comes back `304 Not Modified`, which does **not** count against the GitHub rate limit. Building on the terminal-deployment skip from 0.4.0, an idle poll cycle now returns cheap 304s instead of re-downloading the deployments list and statuses. Parent-deployment edges are preserved across cycles, and the optimization degrades gracefully to full fetches when the upstream does not supply ETags (e.g. the github-emulator). (Implements Fetcher spec F8.)


## [0.4.0] - 2026-06-03

### Changed

- **Fetcher backfill is now chunked and resumable.** Backfill streams one chunk per (repo, environment), posted and checkpointed incrementally instead of all-or-nothing. A large repo fills the store across multiple rate-limit windows and, after an interruption (crash or rate-limit pause + restart), resumes without re-scanning already-completed environments. (`ICiCdAdapter.FetchAsync` now returns `IAsyncEnumerable<FetchResult>`; the opaque cursor carries backfill progress and decodes backward-compatibly. GitHub API usage is identical on an uninterrupted pass and strictly lower on resume.)
- **Fetcher live poll no longer re-reads finished deployments.** Deployments already in a terminal state (`success`/`failure`/`error`/`inactive`) are cached and skipped on subsequent poll cycles, cutting an idle cycle from ~14 GitHub calls to ~1; new and in-flight deployments are still polled every cycle. Parent-deployment edges for promotion chains are preserved (terminal deployments stay in the run→environment map via a cached run id).


## [0.3.0] - 2026-06-03

### Added

- **Fetcher backfill depth.** `BACKFILL_DEPTH` (default 2) controls how many of the latest status events seed each (service, environment) slot during backfill. `BACKFILL_DEPTH` and `BACKFILL_MAX_AGE` are now configurable via Compose / `.env`.

### Changed

- **Fetcher backfill reworked** to seed the latest `BACKFILL_DEPTH` status events per (service, environment) slot — with a no-progress per-environment stop and workflow-YAML fetched only for kept deployments. Bounds backfill cost to the matrix size instead of raw deployment volume, and yields clean history (no duplicate or stale `in-progress` rows for completed deployments). The live poll path is unchanged.
- **Fetcher service identity** now resolves from the workflow's stable name/path instead of the run's display name, so workflows that set `run-name:` map to the correct service.
- **Fetcher rate-limit budget** now tracks the fetcher's own request count since start rather than GitHub's shared `X-RateLimit-Used`, so a partially-used token no longer forces an immediate pause.
- **Fetcher control-plane** participation is skipped entirely when `CONTROL_API_KEY` is unset (no reconnect loop); when enabled, the control-stream reconnect uses exponential backoff.

### Fixed

- **Fetcher backfill cursor** was never advanced (a nullable `DateTimeOffset?` comparison was always false), so the first poll re-ingested the whole lookback window; the cursor now tracks the latest seeded status.
- **Swimlanes** rendered the full 40-character commit SHA; truncated to 7 to match the matrix and history views.


## [0.2.1] - 2026-06-03

### Fixed

- **Gateway startup in non-demo profiles.** The gateway nginx template references `${DEMO_DRIVER_UPSTREAM}` (listed in `NGINX_ENVSUBST_FILTER`), but the base compose only set it under the `demo` profile — so `full` / `full-pull` / `standalone*` left the literal unsubstituted and nginx refused to start (`unknown variable "demo_driver_upstream"`). The variable is now defaulted in the gateway environment; `/demo/*` still returns 502 in non-demo profiles, as intended.
- Local build compose (`docker-compose.local.yaml`): `demo-driver` and `github-emulator` are now gated behind their own profiles, so a production-like profile (`full` / `full-pull` / `standalone`) runs locally-built images without starting demo components.

### Documentation

- Install guide reworked for adopters — the local-file (curl) path is now the recommended way to deploy production / secret-bearing profiles (`oci:// up` does not load `.env` or `--env-file`, a Docker Compose limitation); the `oci://` one-liner remains the demo path in the Quickstart.
- Pull-mode (Fetcher) install elevated with its security rationale — the Fetcher is outbound-only, suited to locked-down networks that forbid inbound WAN traffic — plus GitHub token-scope guidance. The "Why Deployment Dashboard?" highlight notes the same.


## [0.2.0] - 2026-06-02

### Added

- **Control API — component event stream.** `GET /api/control/events/stream` is a live SSE fan-out of component-reported events — event name `component`, `Last-Event-ID` replay within the 2-hour retention window, unauthenticated — mirroring the deployment event stream. Backed by a PostgreSQL `LISTEN/NOTIFY` broadcaster (id-only NOTIFY → DB fetch → fan-out); `/readyz` now covers the `component_events` channel.

### Changed

- Demo Driver now consumes component events over SSE instead of a 5-second poll; `GET /demo/control-events` is an SSE re-broadcast and the driver panel shows a live badge.

### Removed

- **Breaking — Control API.** Removed the paginated `GET /api/control/events` listing and its cursor/page types. Component events are now observed via `GET /api/control/events/stream`.

### Fixed

- Release workflow: build the compose bundle with the runner's `zip` instead of PowerShell, fixing the GitHub Release job on the Linux runner.

### Documentation

- Contributing guide now owns the local-development workflow — running the full stack from source (`docker-compose.local.yaml --build`) and per-component out-of-container debug loops. The install guide stays operator-only and redirects there.
- README release badge pinned to the semver tag, busting the stale camo image cache.

## [0.1.1] - 2026-06-02

### Security

- Bump `multer` to `2.1.1`, resolving 9 high-severity denial-of-service advisories (transitive via `@nestjs/platform-express`) in the demo/mock packages (`frontend/mock`, `demo/driver`, `demo/github-emulator`).

### Fixed

- Release workflow: the GitHub Release job failed on the Linux runner — PowerShell hides dot-files, so the compose-bundle step couldn't find `.env.example`; added `-Force`.
- OCI deploy: some Compose builds (notably on Windows) misread a bare `-f oci://…` reference as a local path. Documented the required `--project-directory .` flag in the quickstart and install commands.

### Documentation

- Adopter-first README restructure (hero + badges, live matrix screenshot, "why" highlights, 2-minute OCI demo, Mermaid architecture), plus "Built with Claude Code" and static MIT-license badges.
- Install guide now warns that production secrets (`API_KEY`, `POSTGRES_USER`, `POSTGRES_PASSWORD`) are required — Compose starts with blanks and the stack crash-loops if they're unset.
- Documentation site now shows a footer copyright.

## [0.1.0] - 2026-06-02

Initial public release — a real-time **services × environments** deployment dashboard, sourced straight from CI/CD pipeline events. Pre-1.0: expect breaking changes between minor versions.

### Added

**Dashboard**

- Live deployment **matrix** — one row per service, one column per environment; each slot shows version, status (success / in-progress / failure), actor, elapsed time, and a link to the CI/CD run.
- **Swimlanes** view — per-service deployment graphs showing how a version flows across environments.
- **Live updates over SSE** — state changes stream to every open browser within seconds, no reload; fan-out works across API instances via PostgreSQL `LISTEN/NOTIFY`.
- **Per-slot history** with a history drawer; configurable retention (minimum 90 days).
- **Auto-discovered topology** — services and environments are derived from incoming events; no registration or hardcoded lists.

**Ingestion & API**

- **Push-first ingestion** — a single `POST /api/deployments` step from any CI/CD tool (Write API, gated by `X-Api-Key`). Tool-agnostic: GitHub Actions, Azure DevOps, GitLab CI, Jenkins, or a shell script.
- **Read API + SSE** stream — unauthenticated by design, for internal/trusted-network tooling.
- **Optional pull-mode Fetcher** — polls a CI/CD source (GitHub Actions) and posts via the same endpoint, with rate-limit awareness, for when you can't add a push step.
- **Control surface** — `POST /api/control/reset` (gated by a separate `X-Control-API-Key`) with reset choreography across components, plus component event streams.

**Architecture & deployment**

- **nginx App Gateway** as the single public surface (`:8080`); frontend, API, and PostgreSQL stay internal. The API is stateless and scales horizontally behind the gateway.
- Stack: **.NET 10** backend · **Angular 20** SPA · **PostgreSQL**.
- **Docker Compose profiles** — `standalone` / `full` (plus `-pull` variants that add the Fetcher) and a zero-config `demo`.
- **Six published GHCR images**; `DASHBOARD_VERSION` pins the whole stack to a release.
- **OCI Compose artifacts** (`deployment-dashboard-compose`, `deployment-dashboard-compose-demo`) for one-command, clone-free deploys (`docker compose -f oci://… up`), plus a compose bundle attached to each release.
- **Demo stack** — Demo Driver + GitHub Emulator + scenario data drive a realistic, dependency-free evaluation.

**Project & release infrastructure**

- **Release pipeline** — tag-triggered `release.yml` (six images + two OCI artifacts + GitHub Release) and the `New-Release.ps1` prep script; `RELEASING.md` guide.
- **CI** — per-service build/test/publish workflows plus a single `_ci-green` aggregate pull-request gate; PowerShell + Pester script suite; documentation drift gate.
- **Documentation site** (MkDocs Material on GitHub Pages) — adopter guides (quickstart, install, configuration, CI/CD integration, architecture, FAQ) and full specifications (architecture/SAD, OpenAPI contract, frontend design, service specs).
- **OSS baseline** — MIT license, Code of Conduct, Contributing guide, Security policy, issue/PR templates, Dependabot, secret scanning + push protection, and branch protection on `main`.
