# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — currently pre-1.0, expect breaking changes between minor versions.

## [Unreleased]


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
