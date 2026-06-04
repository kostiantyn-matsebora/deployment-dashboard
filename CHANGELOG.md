# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — currently pre-1.0, expect breaking changes between minor versions.

## [Unreleased]


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
