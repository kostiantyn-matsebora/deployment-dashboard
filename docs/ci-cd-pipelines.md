# CI/CD Pipelines — Deployment Dashboard

Operational companion to `docs/architecture.md` §9 (Phasing) → component-CI
track. **Outbound** view: how this repo's own components (`dashboard-api`,
`dashboard-fetcher`, `dashboard-frontend`, `dashboard-gateway`) are built,
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
├── api.yml                       caller — dashboard-api    (paths: backend/{api,write-api,read-api,shared}/**)
├── fetcher.yml                   caller — dashboard-fetcher (paths: backend/{fetcher,fetcher-host,shared}/**)
├── frontend.yml                  caller — dashboard-frontend (paths: frontend/**)
└── gateway.yml                   caller — dashboard-gateway  (paths: gateway/**)
```

The reusable workflow's `build-kind` input (`dotnet` | `static`) selects the
build path. The four callers stay path-filtered and minimal — a frontend-only
PR runs only `frontend` jobs.

### Component → image → Dockerfile

| Caller | Image (GHCR) | Dockerfile | Build context |
|---|---|---|---|
| `api.yml` | `ghcr.io/<owner>/dashboard-api` | `backend/api/Dockerfile` | `backend/` |
| `fetcher.yml` | `ghcr.io/<owner>/dashboard-fetcher` | `backend/fetcher-host/Dockerfile` | `backend/` |
| `frontend.yml` | `ghcr.io/<owner>/dashboard-frontend` | `frontend/dashboard/Dockerfile` | `frontend/` |
| `gateway.yml` | `ghcr.io/<owner>/dashboard-gateway` | `gateway/Dockerfile` | `gateway/` |

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
| Frontend lint | **not gated in MVP-CI** | — | D3 lock: deferred. Listed in § 12. |

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

## 10. GHCR → ACR cutover (Q4 deferred)

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

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `dotnet format` fails on a recent change | New code violates the `editorconfig` style; baseline drift since Wave 4a. | Run `dotnet format backend/Dashboard.sln` locally, commit the formatted output. |
| Playwright `chromium` install slow on every run | Browser cache miss (cache key includes `testing/mockup-visual/package.json` — bumping `@playwright/test` invalidates it). | Expected on version bumps; no action. If unexpected, check the **Cache Playwright browsers** step in the run log for the key mismatch. |
| Docker layer cache cold after a `Dockerfile` edit | BuildKit invalidates the cache from the first changed instruction onwards. | Expected; minimise by keeping `COPY *.csproj` before `COPY .` (already the case in `backend/api/Dockerfile` and `backend/fetcher-host/Dockerfile`). |
| GHCR push fails with `403 Forbidden` on PR-from-fork | `secrets.GITHUB_TOKEN` for a forked PR has no `packages: write` scope by design. | Expected — the caller sets `push: github.event_name != 'pull_request'`, so PRs build but never push. No action; merge the PR via `main` to publish. |
| Frontend coverage artefact empty | QA's `karma.conf.js` + `angular.json` `karmaConfig` wiring (D4) not yet landed. | Expected during Wave 4b; resolves when the parallel QA changes merge. |
| Backend `dotnet ef migrations script` fails with `Unable to bind connection` | The design-time factory was unable to resolve the placeholder connection string. | Verify `ConnectionStrings__DefaultConnection` env-var on the **Generate EF migration script** step matches the format the factory expects (`Host=ci;Port=5432;Database=ci;Username=ci;Password=ci`). |
| `ng test` exits with `No provider for Browser` or sandbox errors | Karma launcher is `ChromeHeadless` (raw) instead of `ChromeHeadlessNoSandbox`. | The workflows use `ChromeHeadlessNoSandbox`; verify QA's `karma.conf.js` declares this launcher with `--no-sandbox` flags (sandbox is unavailable inside the GHA runner container). |

## 12. Future work

| Item | Defer reason | Tracking |
|---|---|---|
| Dogfooding notify hook | D1 lock — kept Q11 clean (no deploy in MVP-CI). The dashboard will call its own `.github/actions/notify/` from these workflows once the dogfooding CR lands. | New CR — to be filed. |
| Frontend lint gate (`ng lint`) | D3 lock — Angular CLI ships no ESLint config by default; introducing `@angular-eslint` is a non-trivial setup outside the MVP-CI scope. | TODO: "Introduce `@angular-eslint` + add `ng lint` gate to `frontend.yml`". |
| Integration smoke / e2e (Q12) | `testing/functional/` (xUnit functional API tests) + `testing/e2e/` (Playwright vs SPA + API + gateway) need the compose stack — too heavy for per-PR CI. | New `integration.yml` workflow; runs on schedule or label trigger. |
| GHCR → ACR cutover (Q4) | ACR provisioning needs Terraform §4 first (per NFR-06; no Portal clicks). | Tracked in § 10 + Terraform §4. |
| CD — ACA revision update | Q11 lock: CI only in MVP. Needs Terraform §4 (ACA + image-pull identity). | WBS §5.1 (the half deferred when CR-0010 split that row). |
| Trivy / SBOM | Out of scope for MVP-CI; add as a non-blocking gate first. | New CR — to be filed when security posture is reviewed. |
| Branch protection requiring CI green | Wait one calendar week of normal-volume PRs for signal stability (CR-0010 Open trade-off (ii)). | WBS §1.6.8. |
