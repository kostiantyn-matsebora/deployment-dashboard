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

## 2. Topology — four thin callers, one reusable workflow

```
.github/workflows/
├── _build-and-push-image.yml    reusable — build, test, push (1 file, 4 callers)
├── api.yml                       caller — deployment-dashboard-api    (paths: backend/{api,write-api,read-api,shared}/**)
├── fetcher.yml                   caller — deployment-dashboard-fetcher (paths: backend/{fetcher,fetcher-host,shared}/**)
├── frontend.yml                  caller — deployment-dashboard-frontend (paths: frontend/**)
└── gateway.yml                   caller — deployment-dashboard-gateway  (paths: gateway/**)
```

The reusable workflow's `build-kind` input (`dotnet` | `static`) selects the
build path. The four callers stay path-filtered and minimal — a frontend-only
PR runs only `frontend` jobs.

### Component → image → Dockerfile

| Caller | Image (GHCR) | Dockerfile | Build context |
|---|---|---|---|
| `api.yml` | `ghcr.io/<owner>/deployment-dashboard-api` | `backend/api/Dockerfile` | `backend/` |
| `fetcher.yml` | `ghcr.io/<owner>/deployment-dashboard-fetcher` | `backend/fetcher-host/Dockerfile` | `backend/` |
| `frontend.yml` | `ghcr.io/<owner>/deployment-dashboard-frontend` | `frontend/dashboard/Dockerfile` | `frontend/` |
| `gateway.yml` | `ghcr.io/<owner>/deployment-dashboard-gateway` | `gateway/Dockerfile` | `gateway/` |

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

## 6. Caching

Three caches turned on, all standard (CR-0010 § 3g):

| Tier | Cache | Key |
|---|---|---|
| NuGet | `actions/cache@v4` | `${{ runner.os }}-nuget-${{ hashFiles('backend/**/*.csproj') }}` |
| npm | `actions/setup-node@v4` built-in | `frontend/package-lock.json` |
| Playwright browsers | `actions/cache@v4` | `${{ runner.os }}-playwright-${{ hashFiles('testing/mockup-visual/package.json') }}` (pinned `@playwright/test 1.49.1`) |
| Docker layers | BuildKit `type=gha,mode=max` | per-image scope (`scope=${{ inputs.image-name }}`) so the four components do not stomp each other |

## 7. EF migration SQL artefact

`api.yml` calls the reusable workflow with `emit-migration-artefact: true`.
That step:

1. Restores `dotnet-ef` 10.0.0 from `.config/dotnet-tools.json` (`dotnet tool restore`).
2. Runs `dotnet ef migrations script --idempotent --project backend/shared/Dashboard.Shared/Dashboard.Shared.csproj --startup-project backend/api/Dashboard.Api/Dashboard.Api.csproj --output migration.sql`.
3. Uploads the result as artefact `ef-migrations-script-<sha>` (90-day retention).

**Idempotent contract.** The `--idempotent` flag wraps every DDL statement in
existence checks (`IF NOT EXISTS` / `IF EXISTS` patterns). The script is
therefore safe to re-apply against any historical schema state — it no-ops
when the target object is already in place. This is the contract the future
CD step will rely on (apply-then-deploy without coordinating with prior
schema versions).

**Generation only — never executed in CI.** The job catches missing migration
files, conflicting model snapshots, and design-time `DbContext` failures
before they reach a deploy. The CI step uses a placeholder
`ConnectionStrings__DefaultConnection=Host=ci;...` because the design-time
factory only needs to resolve the provider — it never connects.

**How to download.** From a successful run:
1. Open the run in GitHub → Actions tab.
2. Scroll to **Artifacts** at the bottom of the summary.
3. Download `ef-migrations-script-<sha>` → unzip → `migration.sql`.

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
publishes the assets the one-liner installer (per GitHub issue [#7](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/7) and
[ADR-0005](./adr/ADR-0005-release-install-migration-actuation.md)) consumes. The four component workflows (§ 2) handle
image-building on the same tag push; `release.yml` runs alongside them and
attaches release-side artefacts to the GitHub Release object.

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
| Fetch `docker-compose.release.yml` + `migration.sql` (asset downloads in step 1 of Migration actuation, below) | GitHub Releases API | `gh release download` inside `install.ps1` / `install.sh` |
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

Every `vX.Y.Z` release object carries the six assets below. The set is fixed
— the installer refuses to proceed when any required asset is missing for the
resolved tag (defensive failure: indicates an incomplete release publish, per
ADR-0005).

| Asset | Source | Purpose |
|---|---|---|
| `docker-compose.release.yml` | `install/` | The image-only Compose file the installer brings up. Image refs are templated with `${DASHBOARD_VERSION}` at publish time so the asset for tag `v1.2.3` already pins `ghcr.io/<owner>/deployment-dashboard-{api,fetcher,frontend,gateway}:v1.2.3`. Uploaded flat (basename) as the release asset `docker-compose.release.yml`. |
| `install.ps1` | `install/` | The PowerShell installer (Option A per issue #7). Mirrors `dev_env/start.ps1`'s health-poll + URL-panel UX. Inherits issue [#5](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/5)'s `-Fetcher` / `-AllowMissingGhaToken` precondition verbatim. Uploaded flat as `install.ps1`. |
| `install.sh` | `install/` | The bash installer (Option A per issue #7) — Linux / macOS equivalent of `install.ps1`. Uploaded flat as `install.sh`. |
| `uninstall.ps1` | `install/` | One-liner tear-down — `docker compose -f docker-compose.release.yml down` + clean-up of the install directory. Uploaded flat as `uninstall.ps1`. |
| `uninstall.sh` | `install/` | Linux / macOS equivalent of `uninstall.ps1`. Uploaded flat as `uninstall.sh`. |
| `migration.sql` | downloaded from the same-commit `api.yml` artefact (`ef-migrations-script-<sha>`), OR re-generated inline by the release job using `dotnet ef migrations script --idempotent` (per § 7) | Tag-pinned idempotent migration script. The installer downloads this asset and applies it via a one-shot `postgres:16-alpine` container before the `api` service starts (per ADR-0005 Decision 1–5). |

The `migration.sql` asset is the load-bearing surface for release-install
migration actuation. See § 7 for the idempotent-script contract — it is the
same artefact, promoted from a 90-day workflow artefact to a tag-pinned
release asset.

### Canonical asset URL

Adopters fetch assets via the GitHub Release asset URL:

```
https://github.com/<owner>/<repo>/releases/download/<tag>/<asset-name>
```

Example (tag `v1.2.3`):

```
https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/install.ps1
https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/docker-compose.release.yml
https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/migration.sql
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

The `migration.sql` asset is **not** mirrored to the raw-content path —
because the artefact is generated by the workflow (not committed to the
repo), the raw-content URL would 404. Adopters blocked from release-asset
downloads cannot use the release-install path for migration actuation; they
must fall back to manual `psql -f` (per ADR-0005 Consequences → "Options B
and D regress on migration actuation").

### Migration actuation

The release-install path actuates schema migrations via a one-shot
`migrations` service declared in `docker-compose.release.yml` under the
`migrate` Compose profile, per [ADR-0005](./adr/ADR-0005-release-install-migration-actuation.md):

| Step | What runs |
|---|---|
| 1. Installer downloads `migration.sql` from the release asset URL into `<InstallDir>/migration.sql`. | Asset fetch step in `install.ps1` / `install.sh`. |
| 2. Installer brings up the stack with the `migrate` profile active: `docker compose --profile migrate -f docker-compose.release.yml up -d --wait`. | One-shot `migrations` service (`postgres:16-alpine`) runs `psql -h db -U $POSTGRES_USER -d $POSTGRES_DB -v ON_ERROR_STOP=1 -f /migration.sql` after `db: service_healthy`. |
| 3. `api` service waits for `migrations: service_completed_successfully` before starting. | Mirrors `dev_env/docker-compose.local.yml:130-134` verbatim. |

The installer applies migrations by **default**. `-SkipMigrations` (PowerShell)
/ `--skip-migrations` (bash) brings the stack up without the `migrate`
profile; the API will fail to start cleanly against an unmigrated DB and the
URL panel surfaces a yellow notice. Default-on / opt-out-by-flag is the
correct polarity (per ADR-0005 Decision 3).

The idempotent-script contract (§ 7 → "Idempotent contract") guarantees that
re-applying `migration.sql` against an already-migrated DB is a no-op for
every applied migration, which is what makes upgrade (`v1.0.0` → `v1.2.0`)
safe without manual version tracking.

### Release notes

`release.yml` populates the GitHub Release body from `CHANGELOG.md` (when
present) plus an auto-generated "Install / upgrade" section pointing at the
canonical asset URLs above. The body is the user-facing install surface
documented in issue #7's acceptance criterion "Quick start (release install)
section above the contributor-oriented one."

### Cross-references

| Surface | Pointer |
|---|---|
| Migration actuation decision | [ADR-0005](./adr/ADR-0005-release-install-migration-actuation.md) |
| Triggering requirement | GitHub issue [#7](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/7) |
| `-Fetcher` / `-AllowMissingGhaToken` precondition the installer inherits | GitHub issue [#5](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/5) + `dev_env/start.ps1:28-37` |
| `migration.sql` generation step | § 7 of this doc |
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
| Backend `dotnet ef migrations script` fails with `Unable to bind connection` | The design-time factory was unable to resolve the placeholder connection string. | Verify `ConnectionStrings__DefaultConnection` env-var on the **Generate EF migration script** step matches the format the factory expects (`Host=ci;Port=5432;Database=ci;Username=ci;Password=ci`). |
| `ng test` exits with `No provider for Browser` or sandbox errors | Karma launcher is `ChromeHeadless` (raw) instead of `ChromeHeadlessNoSandbox`. | The workflows use `ChromeHeadlessNoSandbox`; verify QA's `karma.conf.js` declares this launcher with `--no-sandbox` flags (sandbox is unavailable inside the GHA runner container). |

## 13. Future work

| Item | Defer reason | Tracking |
|---|---|---|
| Dogfooding notify hook | D1 lock — kept Q11 clean (no deploy in MVP-CI). The dashboard will call its own `.github/actions/notify/` from these workflows once the dogfooding CR lands. | New CR — to be filed. |
| Frontend lint gate (`ng lint`) | D3 lock — Angular CLI ships no ESLint config by default; introducing `@angular-eslint` is a non-trivial setup outside the MVP-CI scope. | TODO: "Introduce `@angular-eslint` + add `ng lint` gate to `frontend.yml`". |
| Integration smoke / e2e (Q12) | `testing/functional/` (xUnit functional API tests) + `testing/e2e/` (Playwright vs SPA + API + gateway) need the compose stack — too heavy for per-PR CI. | New `integration.yml` workflow; runs on schedule or label trigger. |
| GHCR → ACR cutover (Q4) | ACR provisioning needs Terraform §4 first (per NFR-06; no Portal clicks). | Tracked in § 11 + Terraform §4. |
| CD — ACA revision update | Q11 lock: CI only in MVP. Needs Terraform §4 (ACA + image-pull identity). | WBS §5.1 (the half deferred when CR-0010 split that row). |
| Trivy / SBOM | Out of scope for MVP-CI; add as a non-blocking gate first. | New CR — to be filed when security posture is reviewed. |
| Branch protection requiring CI green | Wait one calendar week of normal-volume PRs for signal stability (CR-0010 Open trade-off (ii)). | WBS §1.6.8. |
