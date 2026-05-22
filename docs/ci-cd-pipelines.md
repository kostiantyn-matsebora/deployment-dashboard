---
title: "CI/CD Pipelines (outbound)"
nav_order: 11
---

# CI/CD Pipelines — Deployment Dashboard

Operational companion to `docs/architecture.md` §9 (Phasing) → component-CI
track. **Outbound** view: how this repo's own components (`deployment-dashboard-api`,
`deployment-dashboard-fetcher`, `deployment-dashboard-frontend`, `deployment-dashboard-gateway`) are built,
tested, and shipped on every PR / push / tag.

Implements CR-0010 (`docs/cr/CR-0010-component-ci-pipeline.md`). MVP-CI:
build + test + package only — **no deploy** (CR-0010 § 3k). The CD half
(ACA revision update + smoke + rollback) is deferred until Terraform §4
provisions the platform.

## 1. Two CI/CD docs — different concerns

This repo carries two CI/CD docs. They are not duplicates; they look at
opposite sides of the same wire:

| Doc | Direction | Audience |
|---|---|---|
| `docs/ci-cd-integration.md` | **Inbound.** How an external CI/CD pipeline (adopter's repo) posts a deployment event into this dashboard via `POST /api/deployments` + the `.github/actions/notify/` composite. | External adopters integrating with the dashboard. |
| `docs/ci-cd-pipelines.md` (this doc) | **Outbound.** How this repo's own four components are built and pushed to GHCR. | Maintainers of this repo. |

If you are looking for "how do I report a deploy to the dashboard," read
`ci-cd-integration.md`. If you are looking for "how does this repo build
its own images," you are in the right place.

## 2. Topology — five thin callers, one reusable workflow

```
.github/workflows/
├── _build-and-push-image.yml    reusable — build, test, push (1 file, 5 callers)
├── api.yml                       caller — deployment-dashboard-api      (paths: backend/{api,write-api,read-api,shared}/**)
├── fetcher.yml                   caller — deployment-dashboard-fetcher  (paths: backend/{fetcher,fetcher-host,shared}/**)
├── frontend.yml                  caller — deployment-dashboard-frontend (paths: frontend/**)
├── gateway.yml                   caller — deployment-dashboard-gateway  (paths: gateway/**)
└── demo-gha.yml                  caller — deployment-dashboard-demo-gha (paths: gateway/demo-gha/**, testing/fixtures/gha/demo/**) — CR-0013, content-only image
```

The reusable workflow's `build-kind` input (`dotnet` | `static`) selects the
build path. The five callers stay path-filtered and minimal — a frontend-only
PR runs only `frontend` jobs.

### Component → image → Dockerfile

| Caller | Image (GHCR) | Dockerfile | Build context |
|---|---|---|---|
| `api.yml` | `ghcr.io/<owner>/deployment-dashboard-api` | `backend/api/Dockerfile` | `backend/` |
| `fetcher.yml` | `ghcr.io/<owner>/deployment-dashboard-fetcher` | `backend/fetcher-host/Dockerfile` | `backend/` |
| `frontend.yml` | `ghcr.io/<owner>/deployment-dashboard-frontend` | `frontend/dashboard/Dockerfile` | `frontend/` |
| `gateway.yml` | `ghcr.io/<owner>/deployment-dashboard-gateway` | `gateway/Dockerfile` | `gateway/` |
| `demo-gha.yml` (CR-0013) | `ghcr.io/<owner>/deployment-dashboard-demo-gha` | `gateway/demo-gha/Dockerfile` | `.` (repo root — `COPY` reaches into `testing/fixtures/gha/demo/`) |

## 3. Triggers

Identical across all four callers (CR-0010 § 3b):

| Event | What fires | Push to GHCR? |
|---|---|---|
| `push` to `main` | build + test + push | yes |
| `push` of tag `v*` (e.g. `v1.2.3`) | build + test + push | yes |
| `pull_request` to `main` | build + test only | **no** (PR-from-fork safe) |
| `workflow_dispatch` | build + test + push (from default branch) | yes |

Path filters scope each workflow to its component — a PR touching only
`frontend/` does not re-run the .NET unit suite.

`concurrency:` is `${{ github.workflow }}-${{ github.ref }}` with
`cancel-in-progress: true` (CR-0010 § 3i) — a fresh push to a PR cancels the
still-running CI for the previous commit on the same PR; distinct main-branch
commits never cancel each other.

## 4. Tag scheme (Q5)

Tags are produced deterministically by `docker/metadata-action@v5`:

| Trigger | Tags pushed |
|---|---|
| Tag push `v1.2.3` | `v1.2.3` + `v1.2` + `sha-<7>` + `latest` |
| Push to `main` | `sha-<7>` + `latest` |
| PR | `pr-<N>-sha-<full>` (built — **not** pushed) |

The 7-character SHA literal comes from `type=sha,prefix=sha-,format=short`.
`latest` is enabled only on the default branch + on tag pushes (the
metadata action's `enable={{is_default_branch}}` rule + the semver tag).

Consumers that need reproducibility should pin to `vX.Y.Z` or `sha-<7>`,
never `latest`.

The `demo-gha` component (CR-0013) uses the identical tag scheme — the
`docker/metadata-action@v5` invocation in `demo-gha.yml` is registry-agnostic
in the same way the four sibling callers are. Adopters opting in to the
demo-default install path inherit pinning via the `${DASHBOARD_VERSION}`
substitution in `install/docker-compose.release.yml`'s `demo` profile, exactly
matching the api/fetcher/frontend/gateway round-trip.

## 5. Quality gates

Per CR-0010 § 3h, with Wave 4b decision locks applied:

| Gate | Severity | Mechanism | Notes |
|---|---|---|---|
| Backend format | **blocking** | `dotnet format backend/Dashboard.sln --verify-no-changes --severity warn` | Baseline landed in Wave 4a — clean from day one. |
| Backend unit tests | **blocking** | `dotnet test backend/Dashboard.sln --filter "<expr>"` | One combined run per workflow; `api.yml` filters OUT `Dashboard.Fetcher.Tests`, `fetcher.yml` filters IN only `Dashboard.Fetcher.Tests`. |
| Frontend unit tests | **blocking** | `npx ng test <project> --watch=false --browsers=ChromeHeadlessNoSandbox --code-coverage` for each of `dashboard` / `shared` / `matrix` / `drawer` | Karma launcher is `ChromeHeadlessNoSandbox` (NOT raw `ChromeHeadless`) — required for the GHA runner sandbox. |
| Mockup-visual | **blocking** | `pwsh -NoProfile -File testing/mockup-visual/run-tests.ps1` | Frontend only. Runs `@playwright/test 1.49.1` against `docs/ui/deployment-dashboard.html` via file:// — zero stack needed. |
| Backend coverage | **non-blocking artefact** | `--collect:"XPlat Code Coverage"` | Cobertura uploaded as `coverage-backend-<image>-<run>-<attempt>`. No threshold today. |
| Frontend coverage | **non-blocking artefact** | `--code-coverage` | Cobertura uploaded as `coverage-frontend-<image>-<run>-<attempt>`. No threshold today. |
| Frontend lint | **not gated in MVP-CI** | — | D3 lock: deferred. Listed in § 13. |
| Integration suite (`integration.yml`) | **watching-week non-blocking → promoted to blocking after green normal-volume calendar week** | `.github/workflows/integration.yml` brings up the stack with the `integration` compose profile and runs `testing/integration/run-tests.ps1` (cross-stack: fetcher → mock-gha → gateway → API → DB → SSE) | Per [CR-0012](./cr/CR-0012-integration-test-substrate.md) + CR-0010 Open trade-off (ii). Branch-protection promotion is a repo-settings change (not a workflow-config change) — see [`docs/integration-tests.md § 7.3`](./integration-tests.md#73-severity-posture--non-blocking-watching-week). |
| `demo-gha` content-only image (`demo-gha.yml`) | **build + push only** — no .NET build, no unit tests, no integration suite | The caller workflow's only quality gate is a successful `docker build` of `gateway/demo-gha/Dockerfile` (which `COPY`s `testing/fixtures/gha/demo/`); image content is exercised end-to-end on demo-default install runs and indirectly by the integration suite (shared WireMock.Net mapping conventions per CR-0012 § 4). | Per [CR-0013](./cr/CR-0013-demo-mode-default-installer.md). Content-only image — the caller is thin and may differ from the four sibling callers (`build-kind` may not match the `dotnet` / `static` taxonomy; devops to lock the exact shape during the Phase 4 devops slice). |

## 6. Caching

Three caches turned on, all standard (CR-0010 § 3g):

| Tier | Cache | Key |
|---|---|---|
| NuGet | `actions/cache@v4` | `${{ runner.os }}-nuget-${{ hashFiles('backend/**/*.csproj') }}` |
| npm | `actions/setup-node@v4` built-in | `frontend/package-lock.json` |
| Playwright browsers | `actions/cache@v4` | `${{ runner.os }}-playwright-${{ hashFiles('testing/mockup-visual/package.json') }}` (pinned `@playwright/test 1.49.1`) |
| Docker layers | BuildKit `type=gha,mode=max` | per-image scope (`scope=${{ inputs.image-name }}`) so the four components do not stomp each other |

## 7. Migrations — applied at API startup

Schema migrations are no longer a CI artefact. The API host applies them at
process start, against the database it depends on, before the first request
is served. See [ADR-0009](./adr/ADR-0009-startup-applied-ef-migrations.md) for
the decision record.

**Contract.**

| Aspect | Behaviour |
|---|---|
| When | Between `app.Build()` and `app.Run()` in `backend/api/Dashboard.Api/Program.cs`. |
| How | `DbContext.Database.Migrate()` — applies every pending EF Core migration in order. |
| Re-apply | Idempotent — already-applied migrations are skipped via the EF Core `__EFMigrationsHistory` table. |
| Failure | Aborts startup with a single `ILogger` error line; process exits non-zero; orchestrator restart-loops back-off normally. |
| Opt-out | None. The API always migrates on start; there is no env-var chicken-bit. |

**No CI artefact.** Neither the component CI (`api.yml` →
`_build-and-push-image.yml`) nor the release pipeline (`release.yml`)
generates a `migration.sql` script. The `dotnet-ef` design-time tool is no
longer invoked in CI; `.config/dotnet-tools.json` is retained because
contributors authoring new migrations still need it on the host (see
`docs/CONTRIBUTING.md` if present; otherwise `dotnet tool restore && dotnet ef
migrations add <Name>` from a clone).

**Why startup-applied.** ADR-0009 captures the full rationale — the short
version: a single deployable carries its own schema; release-install and
local-dev share one actuation mechanism; rollback on failure-to-migrate is
the orchestrator's normal restart-loop rather than a separate compose
profile.

## 8. Manual reruns — `workflow_dispatch`

Each of the four callers exposes `workflow_dispatch`. To trigger:

1. GitHub → Actions → pick the workflow (`api` / `fetcher` / `frontend` / `gateway`).
2. **Run workflow** dropdown → pick branch (default: `main`) → **Run**.

Inputs: none — the workflow is parameterised entirely by the chosen ref.
A manual run from `main` pushes `latest` + `sha-<7>`; from a non-default
branch the only tag is `sha-<7>` (latest is enabled only for the default branch).

Use cases: transient registry hiccup, force a rebuild after a base-image CVE
update, validate that a long-quiet workflow still works.

## 9. Bumping a version — tag flow

```bash
git tag v1.2.3
git push origin v1.2.3
```

The tag push fires **all four** workflows whose paths match (in practice all
four — every tag is a release of the whole repo). Each emits `v1.2.3`,
`v1.2`, `sha-<7>`, and `latest`. No code change is needed in the workflows
themselves — the tag scheme is event-driven.

To roll back to an earlier tag in the registry: pull the image by its
`vX.Y.Z` tag; the digest is immutable per tag.

## 10. Release pipeline — `v*` tag → release assets

A separate workflow (`.github/workflows/release.yml`) fires on `v*` tag push and
publishes the assets the one-liner installer (per GitHub issue [#7](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/7))
consumes. The four component workflows (§ 2) handle image-building on the
same tag push; `release.yml` runs alongside them and attaches release-side
artefacts to the GitHub Release object.

This section is **outbound** in the same sense § 1 defines — it describes how
this repo publishes the release-install surface. The inbound consumer view —
how an adopter brings up a released stack — lives in the per-release README
the installer prints + the issue-#7 install documentation.

### Asset visibility + fetch auth

The release repo (`kostiantyn-matsebora/deployment-dashboard`) and the GHCR
image registry are both **private**. Anonymous fetches against either
surface return `404`; everything the installer touches has to flow through
an authenticated GitHub identity.

The transport-layer choice for that auth is the **GitHub CLI (`gh`)**, run on
the adopter's host. The release-install surface gets a fresh `gh`-mediated
identity on every invocation; no long-lived tokens on disk; no PAT in
`docker-compose.release.yml` env-vars.

| Step | Surface | Auth mechanism |
|---|---|---|
| Fetch `install.ps1` / `install.sh` (the bootstrap one-liner) | GitHub Releases API | `gh release download` (adopter's gh session) |
| Fetch `docker-compose.release.yml` (asset download inside the installer) | GitHub Releases API | `gh release download` inside `install.ps1` / `install.sh` |
| Pull pinned GHCR images (`docker compose pull` inside the installer) | GHCR (`ghcr.io`) | `gh auth token \| docker login ghcr.io --username <gh-login> --password-stdin`, run by the installer before `docker compose pull` |
| `release.yml` workflow's own job (publishing the assets) | GitHub Releases API + GHCR | Workflow's default `GITHUB_TOKEN` -- unchanged; the gh-CLI change is on the **adopter** side only |

The `release.yml` workflow's auth model has not changed: it still uses the
runner-supplied `GITHUB_TOKEN` with `contents: write` + `packages: write`
permissions to publish the release object + push tagged images. The gh-CLI
prereq applies to the installer scripts (run on the adopter's host), not to
the publishing pipeline.

**Required `gh` scope on the adopter side:** any of `read:packages`,
`write:packages`, or `admin:packages`. GitHub's OAuth scopes are
hierarchical (`write:packages` ⊃ `read:packages`; `admin:packages` ⊃ both),
and `gh auth status --show-token` only lists the highest granted scope.
The installer's precondition matches the union to avoid rejecting tokens
that can pull from GHCR but only show the higher-tier scope. The default
`gh auth login` scope set does not include any of them; the README install
instructions surface a `gh auth refresh --hostname github.com --scopes
read:packages` step before the bootstrap one-liner (the minimum grant).

### Trigger

| Event | What fires |
|---|---|
| `push` of tag `v*` (e.g. `v1.2.3`) | `release.yml` — creates GitHub Release, attaches assets |

`release.yml` does not run on `push: main`, on PRs, or via `workflow_dispatch`
from a non-tag ref. Tag push is the sole trigger — release publishing is a
deliberate, tag-pinned event, not a continuous-publish event.

### Assets published

Every `vX.Y.Z` release object carries the five assets below. The set is fixed
— the installer refuses to proceed when any required asset is missing for the
resolved tag (defensive failure: indicates an incomplete release publish).

| Asset | Source | Purpose |
|---|---|---|
| `docker-compose.release.yml` | `install/` | The image-only Compose file the installer brings up. Image refs are templated with `${DASHBOARD_VERSION}` at publish time so the asset for tag `v1.2.3` already pins `ghcr.io/<owner>/deployment-dashboard-{api,fetcher,frontend,gateway}:v1.2.3`. Uploaded flat (basename) as the release asset `docker-compose.release.yml`. |
| `install.ps1` | `install/` | The PowerShell installer (Option A per issue #7). Mirrors `dev_env/start.ps1`'s health-poll + URL-panel UX. Inherits issue [#5](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/5)'s `-Fetcher` precondition (bare `-Fetcher` without `$env:GHA_TOKEN` red-errors and exits 1); the zero-PAT escape is `-Demo`, which implies `-Fetcher` and routes the fetcher through the anonymous-mode transport documented in `docs/ci-cd-integration.md` § Anonymous-mode transport. Uploaded flat as `install.ps1`. |
| `install.sh` | `install/` | The bash installer (Option A per issue #7) — Linux / macOS equivalent of `install.ps1`. Uploaded flat as `install.sh`. |
| `uninstall.ps1` | `install/` | One-liner tear-down — `docker compose -f docker-compose.release.yml down` + clean-up of the install directory. Uploaded flat as `uninstall.ps1`. |
| `uninstall.sh` | `install/` | Linux / macOS equivalent of `uninstall.ps1`. Uploaded flat as `uninstall.sh`. |

Migration actuation is **not** an asset surface — the API self-migrates at
startup (§ 7 + [ADR-0009](./adr/ADR-0009-startup-applied-ef-migrations.md)).
Older releases (pre-ADR-0009) shipped a sixth `migration.sql` asset; the
current installer no longer downloads it.

### Canonical asset URL

Adopters fetch assets via the GitHub Release asset URL:

```
https://github.com/<owner>/<repo>/releases/download/<tag>/<asset-name>
```

Example (tag `v1.2.3`):

```
https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/install.ps1
https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/docker-compose.release.yml
```

**This is the canonical URL pattern. Adopters use it; the installer scripts
use it; the README documents it.** Two reasons over the raw-content
alternative below:

1. **GitHub Releases are durable, immutable per-tag objects.** A release asset
   bound to `v1.2.3` cannot be replaced without an explicit re-publish event;
   the SHA-256 the user pulls today is the SHA-256 they pull next month.
2. **Adopters expect releases for versioned downloads.** A "Releases" tab is
   the discovery surface for any tagged artefact; raw-content URLs are an
   internal-to-the-repo convention.

**The URL pattern requires authenticated fetch.** Because the repo is private
(§ Asset visibility + fetch auth above), the `releases/download/<tag>/<asset-name>`
URL returns `404` to any anonymous client. The pattern still applies — but
adopters reach it via `gh release download <tag> --repo <owner>/<repo>
--pattern <asset-name>`, not via `curl -fsSL` / `irm`. The installer scripts
use `gh release download` internally; the README's bootstrap one-liner
uses `gh release download` to fetch `install.ps1` / `install.sh` itself.

#### Fallback — raw GitHub at the tag

The alternative pattern resolves the asset off the tag's tree rather than the
Release object:

```
https://raw.githubusercontent.com/<owner>/<repo>/<tag>/<asset-path>
```

The two URLs resolve to the same content when `release.yml` commits the
templated assets to the tag's tree (which it does, so the `docker-compose.release.yml`
+ installer scripts are tag-checkout-friendly). The raw-content URL is
**fallback only**: do not document it as the primary install path; do not
hard-code it into installer scripts.

The raw-content URL is **also private-repo-gated** — it 404s anonymously
against this repo. `gh api repos/<owner>/<repo>/contents/<asset-path>?ref=<tag>`
is the gh-mediated equivalent; raw-content is therefore no longer a "works
without gh" escape hatch in this codebase.

### Migration actuation

No install-time actuation. The API container self-migrates against the `db`
service it depends on, as a normal step of process start (§ 7 +
[ADR-0009](./adr/ADR-0009-startup-applied-ef-migrations.md)).

What the installer does **not** do anymore:

- It does **not** download `migration.sql` (the asset is no longer published).
- It does **not** activate a `--profile migrate` on the compose bring-up
  (the profile and the `migrations` service no longer exist).
- It does **not** carry a `-SkipMigrations` / `--skip-migrations` flag
  (there is no actuation to skip).

What the operator observes on a fresh install or an upgrade:

| Phase | What runs |
|---|---|
| `db` starts | `service_healthy` per its `pg_isready` probe. |
| `api` starts | Resolves pending EF Core migrations, applies them, then begins serving requests. The first request returns 200 only after migrations complete. |
| Already-migrated DB | EF Core's `__EFMigrationsHistory` table skips re-application; startup time is effectively unaffected. |
| Migration fails | API logs a single `ILogger` error, exits non-zero; the container's `restart: unless-stopped` policy back-offs naturally. |

Upgrade `v1.0.0` → `v1.2.0` is therefore transparent — `docker compose pull
&& docker compose up -d` is sufficient; the new API image carries the new
migrations and applies them against the existing DB on its first start.

### Release notes

`release.yml` populates the GitHub Release body from `CHANGELOG.md` (when
present) plus an auto-generated "Install / upgrade" section pointing at the
canonical asset URLs above. The body is the user-facing install surface
documented in issue #7's acceptance criterion "Quick start (release install)
section above the contributor-oriented one."

### Cross-references

| Surface | Pointer |
|---|---|
| Migration actuation decision | [ADR-0009](./adr/ADR-0009-startup-applied-ef-migrations.md) (supersedes ADR-0005 for actuation mechanics) |
| Triggering requirement | GitHub issue [#7](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/7) |
| `-Fetcher` / `-Demo` precondition matrix the installer enforces | GitHub issue [#5](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/5) + `install/install.ps1` § 1 (`GHA_TOKEN` precondition); anonymous-mode transport: `docs/ci-cd-integration.md` § Anonymous-mode transport |
| Startup-applied migration contract | § 7 of this doc |
| Tag scheme (`v1.2.3` + `v1.2` + `sha-<7>` + `latest`) | § 4 of this doc |
| `API_TOKEN` install-time generation | `docs/architecture.md § 8` footnote |

## 11. GHCR → ACR cutover (Q4 deferred)

The reusable workflow's `registry` input defaults to `ghcr.io`. When
Terraform §4 lands and provisions ACR, the swap is **one input value +
one login step**:

1. Caller workflows pass `registry: <acr-name>.azurecr.io`.
2. The reusable workflow swaps `docker/login-action@v3` (GHCR via
   `GITHUB_TOKEN`) for `azure/login@v2` + `docker/login-action@v3` (ACR
   via OIDC federated credentials).
3. Tag scheme (§ 4) is registry-agnostic — no other changes.

Once ACR is live, the future CD CR adds the ACA revision update step
downstream of the build job.

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `dotnet format` fails on a recent change | New code violates the `editorconfig` style; baseline drift since Wave 4a. | Run `dotnet format backend/Dashboard.sln` locally, commit the formatted output. |
| Playwright `chromium` install slow on every run | Browser cache miss (cache key includes `testing/mockup-visual/package.json` — bumping `@playwright/test` invalidates it). | Expected on version bumps; no action. If unexpected, check the **Cache Playwright browsers** step in the run log for the key mismatch. |
| Docker layer cache cold after a `Dockerfile` edit | BuildKit invalidates the cache from the first changed instruction onwards. | Expected; minimise by keeping `COPY *.csproj` before `COPY .` (already the case in `backend/api/Dockerfile` and `backend/fetcher-host/Dockerfile`). |
| GHCR push fails with `403 Forbidden` on PR-from-fork | `secrets.GITHUB_TOKEN` for a forked PR has no `packages: write` scope by design. | Expected — the caller sets `push: github.event_name != 'pull_request'`, so PRs build but never push. No action; merge the PR via `main` to publish. |
| Frontend coverage artefact empty | QA's `karma.conf.js` + `angular.json` `karmaConfig` wiring (D4) not yet landed. | Expected during Wave 4b; resolves when the parallel QA changes merge. |
| `ng test` exits with `No provider for Browser` or sandbox errors | Karma launcher is `ChromeHeadless` (raw) instead of `ChromeHeadlessNoSandbox`. | The workflows use `ChromeHeadlessNoSandbox`; verify QA's `karma.conf.js` declares this launcher with `--no-sandbox` flags (sandbox is unavailable inside the GHA runner container). |

## 13. Future work

| Item | Defer reason | Tracking |
|---|---|---|
| Dogfooding notify hook | D1 lock — kept Q11 clean (no deploy in MVP-CI). The dashboard will call its own `.github/actions/notify/` from these workflows once the dogfooding CR lands. | New CR — to be filed. |
| Frontend lint gate (`ng lint`) | D3 lock — Angular CLI ships no ESLint config by default; introducing `@angular-eslint` is a non-trivial setup outside the MVP-CI scope. | TODO: "Introduce `@angular-eslint` + add `ng lint` gate to `frontend.yml`". |
| GHCR → ACR cutover (Q4) | ACR provisioning needs Terraform §4 first (per NFR-06; no Portal clicks). | Tracked in § 11 + Terraform §4. |
| CD — ACA revision update | Q11 lock: CI only in MVP. Needs Terraform §4 (ACA + image-pull identity). | WBS §5.1 (the half deferred when CR-0010 split that row). |
| Trivy / SBOM | Out of scope for MVP-CI; add as a non-blocking gate first. | New CR — to be filed when security posture is reviewed. |
| Branch protection requiring CI green | Wait one calendar week of normal-volume PRs for signal stability (CR-0010 Open trade-off (ii)). | WBS §1.6.8. |
