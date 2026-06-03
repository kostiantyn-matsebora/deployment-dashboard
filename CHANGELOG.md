# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — currently pre-1.0, expect breaking changes between minor versions.

## [Unreleased]


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
