# CR-0010 — Component CI pipeline (GitHub Actions — build, test, package)

- **Status:** accepted (Phase 7 doc-amend pass — reflects as-built contract on PR #2 head `39641b5`)
- **Decided on:** 2026-05-18
- **Trigger:** user direct-instruction freeform task — *"introduce CI/CD pipeline for components, to build, test and package"*. Picks up deferred work from [CR-0009](./CR-0009-pull-mode-fetcher-and-progress-reporter.md) § 3d (ACR + Terraform wiring deferred) and `docs/WBS.md` §1.5.8 (fetcher image build deferred to a general component CI track). Today's repo has `.github/actions/notify/` (composite action) but no `.github/workflows/` — every Dockerfile (`backend/api/Dockerfile`, `backend/fetcher-host/Dockerfile`, `frontend/dashboard/Dockerfile`, `gateway/Dockerfile`) is built manually or by `dev_env/start.ps1`; no automated test runs on PRs; no image is published anywhere; the dashboard does not eat its own dogfood (the `notify` composite is documented for callers but never invoked from this repo's own pipelines).

- **Change.** Introduce a **hybrid GitHub Actions topology**: per-component thin workflow files driven by path filters, invoking one (or two) shared reusable workflow(s) that centralise the build / test / image / push mechanics. CI only — build + test + package — no deploy. Container images only — no NuGet, no npm. Decisions broken out below; each cites the Phase 3 question it answers.

  - **3a — Topology (Q1).** **Hybrid.** Per-component thin workflows under `.github/workflows/`:
    - `api.yml` — owns `backend/**` (the modular monolith — `Dashboard.Api` host + `Dashboard.WriteApi` + `Dashboard.ReadApi` + `Dashboard.Shared` libraries all build under `backend/Dashboard.sln`)
    - `fetcher.yml` — owns `backend/fetcher/**` + `backend/fetcher-host/**` (replaces WBS §1.5.8's standalone "build the fetcher image" item)
    - `frontend.yml` — owns `frontend/**`
    - `gateway.yml` — owns `gateway/**`

    Each thin workflow declares `on:` triggers + path filters + `concurrency:` + permissions, then immediately `uses:` a single reusable workflow at `.github/workflows/_build-and-push-image.yml` for the actual mechanics. **As-built (Phase 4 Wave 4b — DevOps Option A landed):** one reusable workflow parameterised by `build-kind: dotnet|static` (instead of the two-workflow option originally surfaced in Open trade-off (i)). The `dotnet` path runs SDK setup → NuGet cache → `dotnet format --verify-no-changes` → `dotnet test` (optional) → EF migration script artefact (optional, `api.yml` only); the `static` path runs Node setup → `npm ci` (optional) → `ng test` (optional, `frontend.yml` only) → mockup-visual (optional, `frontend.yml` only). Justification: per-component triggers stay readable + path-filtered (a PR touching only `frontend/` does not re-run the .NET unit suite); image-build mechanics live in one place so a change to (say) BuildKit cache config is one PR not four.

  - **3b — Triggers (Q2).** Identical across all four thin workflows:

    ```yaml
    on:
      push:
        branches: [main]
        tags:     ['v*']
      pull_request:
        branches: [main]
      workflow_dispatch:
    ```

    **PR runs build + test only — no push.** Tags + push-to-main run build + test + push. `workflow_dispatch` available for manual reruns (e.g. a transient registry hiccup).

  - **3c — Package scope (Q3).** **Container images only.** No NuGet package publish. No npm package publish. The frontend libraries under `frontend/shared/`, `frontend/matrix/`, `frontend/drawer/` are workspace-internal; they ship inside the `frontend/dashboard/` image, not as standalone packages. Revisit when an external consumer materialises (no consumer today, no anticipated consumer in MVP scope).

  - **3d — Registry + auth (Q4) — explicit deviation from CR-0009 § 3d.** **GHCR** (`ghcr.io/<owner>/<image>`). Authentication via the repo-scoped `GITHUB_TOKEN` (no PAT, no Azure-side credential). No new repo secrets required for the registry path.

    **This deviates from CR-0009 § 3d's implicit expectation that the fetcher image would land in ACR alongside the API.** Rationale for the deviation, recorded explicitly:

    - **NFR-06 (Terraform IaC) — no click-ops.** Provisioning ACR today would require either a Terraform plan that does not yet exist (Terraform §4 is unfilled; WBS §4.3 is the planned ACR resource) or a manual Portal click. Provisioning ACR by Portal click violates NFR-06; provisioning ACR by Terraform first means CR-0010 cannot land until Terraform §4 ships, which inverts the user's freeform-task scope ("introduce a CI pipeline now"). GHCR is provisioned automatically by GitHub for every repo at no marginal cost; no infra-as-code is required.
    - **NFR-02 (cost cap ≤ $30/month).** GHCR is free for public repos and free up to generous limits for private repos. ACR Basic SKU is ~$5/month standing — small in absolute terms, but unnecessary while no ACA app pulls from it.
    - **Clean swap path.** The reusable workflow accepts an input `registry:` (default `ghcr.io`). When Terraform §4 lands and provisions ACR, the swap is **one input value + one login-action swap** (from `docker/login-action` against `ghcr.io` to `azure/login` + `docker/login-action` against `<acr-name>.azurecr.io`). Caller workflows (`api.yml` / `fetcher.yml` / `frontend.yml` / `gateway.yml`) need zero changes. Image tag conventions (3e) are registry-agnostic and survive the swap.

    Permissions for GHCR push: `packages: write` on the push job only (3j).

  - **3e — Tagging (Q5) — verbatim.** All tags are produced from `github.ref` / `github.sha` deterministically; no manually-supplied version strings:

    | Trigger | Tags pushed |
    |---|---|
    | Tag push `v*` (e.g. `v1.2.3`) | `vX.Y.Z` + `sha-<7>` + `latest` |
    | Push to `main` | `main-sha-<7>` + `latest` |
    | Pull request | `pr-<N>-sha-<7>` — **built but not pushed** (PR runs verify the build is green; nothing leaks to the public registry for an unmerged PR) |

    `<7>` = the first seven characters of `github.sha`. `latest` is overwritten on both tag-pushes and main-pushes; consumers that pin should use the `vX.Y.Z` or `sha-<7>` form. Conventions are registry-agnostic so a future GHCR → ACR swap (3d) does not change the tag set.

  - **3f — Test scope in CI (Q6).** Unit + lint + format-check + mockup-visual; no integration / e2e:

    | Tier | Commands run in CI |
    |---|---|
    | Backend (`api.yml`, also `fetcher.yml` once the projects exist) | `dotnet restore` + `dotnet build` + `dotnet format --verify-no-changes` (3h) + `dotnet test` (covers all `backend/**/Dashboard.*.Tests/` projects under the solution) |
    | Frontend (`frontend.yml`) | `npm ci` + `ng lint` (3h, blocking) + `ng test --watch=false --browsers=ChromeHeadless` + Playwright `testing/mockup-visual/` (no stack needed — mockup-visual asserts against `docs/ui/deployment-dashboard.html` as a static asset; `testing/e2e/` is NOT run in CI because it needs the compose stack) |
    | Gateway (`gateway.yml`) | Image build only — no test step; gateway is config-only (nginx + Dockerfile), no test surface |

    `testing/functional/` (xUnit functional API tests) + `testing/e2e/` (Playwright against the live SPA + API + gateway) require the docker-compose stack and are **deferred to a future `integration.yml`** workflow (TODO — separate CR or WBS pickup). Note in Phase 4 PR description so the deferral is visible.

  - **3g — Caching (Q7).** Three caches turned on, all standard:

    | Tier | Cache mechanism |
    |---|---|
    | NuGet | `actions/cache@v4` keyed on `hashFiles('backend/**/*.csproj')` against `~/.nuget/packages` (the `actions/setup-dotnet@v4` built-in cache requires `packages.lock.json` files which this repo does not currently maintain; the `actions/cache@v4` fallback keyed on the csproj hash is the as-built choice and gives the same hit-rate at the cost of one extra `uses:` step) |
    | npm | `actions/setup-node@v4` built-in (`cache: 'npm'` + `cache-dependency-path: frontend/package-lock.json`) |
    | Docker layers | BuildKit `cache-type: gha` (`type=gha,mode=max` on both source and destination — uses the GitHub Actions cache backend; works equally for GHCR and a future ACR swap) |

  - **3h — Quality gates (Q8).** Blocking + non-blocking split:

    | Gate | Severity | Mechanism |
    |---|---|---|
    | Backend format | **blocking** | `dotnet format --verify-no-changes` |
    | Backend lint (analyzer warnings as errors per project) | **blocking** | inherited from project `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` if set; otherwise warnings remain non-blocking and a follow-up CR can promote them |
    | Frontend lint | **blocking** | `ng lint` (Angular project lint config) |
    | Backend unit tests | **blocking** | `dotnet test` non-zero exit fails the job |
    | Frontend unit tests | **blocking** | `ng test` non-zero exit fails the job |
    | Mockup-visual | **blocking** | Playwright run; visual-diff threshold per `testing/mockup-visual/playwright.config.ts` |
    | Code coverage | **non-blocking** | `dotnet test --collect:"XPlat Code Coverage"` + `ng test --code-coverage`; reports uploaded as workflow artefacts. **No threshold gate for MVP-CI** — review after a representative coverage baseline is observed; promote to blocking via a future CR. |

  - **3i — Concurrency (Q9).** Identical on every thin workflow:

    ```yaml
    concurrency:
      group: ${{ github.workflow }}-${{ github.ref }}
      cancel-in-progress: true
    ```

    Effect: a fresh push to a PR cancels the still-running CI for the previous commit of the same PR; main-branch runs do not cancel each other across distinct commits because their `github.ref` differs from the in-flight PR ref. Tag pushes also serialise per-tag (cancel-on-rerun is a benign no-op because tag pushes are normally one-shot).

  - **3j — Permissions (Q10).** Least-privilege baseline. **Amended in Phase 5 (as-built):** callers SHALL declare the **minimum explicit scopes required by the reusable's per-job permissions block**; the originally-proposed `permissions: read-all` is insufficient when the reusable escalates per-job to write scopes (GHA rejects a called workflow whose per-job permissions exceed the caller's grant).

    Caller (every thin workflow — `api.yml` / `fetcher.yml` / `frontend.yml` / `gateway.yml`) top-level permissions block:

    ```yaml
    permissions:
      contents: read
      packages: write
      id-token: write
    ```

    Per-job overrides on the reusable's `build` job:

    | Job | Permissions | Why |
    |---|---|---|
    | Image push (GHCR) | `contents: read` + `packages: write` + `id-token: write` (the latter so the reusable workflow can use OIDC if we later swap to ACR or another OIDC-capable registry without re-templating) | GHCR push via `GITHUB_TOKEN`; per-job permissions are evaluated against the caller's grant |
    | Build / test only | inherited from the reusable's job-level block (writes are a no-op when `push: false`) | reads checkout + caches |

    **Reusable workflow top-level `permissions:` (new in Phase 5).** The reusable workflow `_build-and-push-image.yml` MUST NOT declare a top-level `permissions:` block of any kind — and explicitly MUST NOT declare `permissions: read-all`. GHA treats the reusable's top-level permissions as a *request from the caller*: `read-all` expands to a long list of read scopes (`actions`, `artifact-metadata`, `checks`, `code-quality`, `deployments`, `discussions`, `issues`, `models`, `pages`, `pull-requests`, `repository-projects`, `statuses`, `security`, `vulnerability-alerts`, etc.) that the caller is unlikely to grant. Only the **per-job** `permissions:` block on the `build` job is evaluated against the caller's grant, and that block is the only one that matters.

  - **3k — CI scope (Q11) — no deploy.** **CI only.** No `azure/container-apps-deploy-action`. No `az containerapp update`. No deploy step of any kind. Building and pushing an image is the workflow's last action. CD (revision-update + smoke + rollback) lands as a **future TODO / CR** once Terraform §4 (ACA + ACR) is provisioned. This explicitly splits WBS §5.1 ("GitHub Actions workflow — Docker build, push to ACR, update Container App revision on merge to main") into two halves: the **build + push** half is CR-0010 (with GHCR substituting for ACR per 3d); the **update Container App revision** half is deferred.

  - **3l — EF migration validation (Q13).** The `api.yml` workflow runs `dotnet ef migrations script --idempotent --output migration.sql --project backend/shared/Dashboard.Shared/Dashboard.Shared.csproj --startup-project backend/api/Dashboard.Api/Dashboard.Api.csproj` after the build step, then uploads `migration.sql` as a workflow artefact named `ef-migrations-script-<sha>`. **The inner filename is `migration.sql` (singular) as-built** — operational only; the externally-visible artefact name `ef-migrations-script-<sha>` is the contract surface and is unchanged. The job **does not execute** the script — it only validates that EF can generate it (catches missing migration files, conflicting model snapshots, design-time DbContext failures before they hit a deploy). Estimated ~30 LOC in the reusable workflow. Idempotent flag ensures the artefact is safe to apply against any historical schema state — useful for the future CD step (3k) and for ops review.

    Caveat: if `Dashboard.Api`'s composition root requires runtime env vars to bind `IOptions` before the design-time `DbContext` is constructable, the `migrations script` invocation will fail in CI. Mitigation (if it surfaces): mock or stub the env-bind step for migration-script generation only — see Open trade-off (iii).

  - **3m — Dogfooding hook.** After each successful **push** job (3b: tag + main push), the workflow invokes the project's own `.github/actions/notify/` composite action, posting the just-built image as a deployment event to the dashboard itself. Wire shape:

    | `notify` input | CR-0010 value |
    |---|---|
    | `service` | the component name — `dashboard-api`, `dashboard-fetcher`, `dashboard-frontend`, `dashboard-gateway` (one POST per component, from each thin workflow) |
    | `environment` | `ci-build` (a synthetic env representing "freshly built image, not yet deployed") |
    | `version` | the image tag per 3e — `v1.2.3` on a tag push, `main-sha-<7>` on a main push |
    | `status` | `success` (the push job only invokes notify on its own success path) |
    | `deployment_id` | `gh-${{ github.run_id }}-${{ github.run_attempt }}` — per the notify action's own recommended pattern (`action.yml` line 47) |
    | `dashboard_url`, `api_token` | from existing `DEPLOYMENT_DASHBOARD_URL` + `DEPLOYMENT_DASHBOARD_TOKEN` repo secrets (per the notify action's input contract) |
    | `parent_deployments` | empty for MVP (no cross-component dependency tracking yet) |
    | `ref` | default — `${{ github.ref }}` |
    | `sha` | default — `${{ github.sha }}` |

    Closes a long-standing "the project doesn't eat its own dogfood" gap: the notify action is shipped to external callers but never invoked by this repo's own pipelines. CR-0010 makes the dashboard the **first consumer** of its own integration surface, which gives the project free continuous validation of the notify action against the live backend on every merge / tag.

- **Impact.** All deliverables below; each item names its owning role and the phase in which it lands.

  - **NEW `.github/workflows/_build-and-push-image.yml`** (single reusable workflow — Option A; resolves Open trade-off (i)). Inputs: `image-name`, `build-kind` (`dotnet` | `static`), `dockerfile-path`, `context-path`, `test-filter` (string, default empty), `run-dotnet-tests` (bool, default false), `run-ng-tests` (bool, default false), `run-mockup-visual` (bool, default false), `emit-migration-artefact` (bool, default false — only `api.yml` flips this on), `registry` (default `ghcr.io`), `push` (default `false`). Outputs: `image-digest`, `pushed-tags`. Owns: checkout / language setup (dotnet OR node, conditional on `build-kind`) / NuGet cache / `dotnet-tools.json` restore / `dotnet format` gate / `npm ci` / unit tests / mockup-visual / coverage upload / EF migration SQL artefact / mockup-visual report + traces / Buildx / registry login / docker metadata (tag rules per § 3e) / build + push. **Owner:** `devops-engineer` (Phase 4 deliverable; Phase 5 amendments per § 3j). Note: dogfooding notify hook (§ 3m) was **dropped** in Wave 4b — see follow-up TODOs.

  - **NEW `.github/workflows/api.yml`** — thin caller. Path filter: `backend/**`, `.github/workflows/api.yml`, `.github/workflows/_build-*.yml`. **Owner:** `devops-engineer`.
  - **NEW `.github/workflows/fetcher.yml`** — thin caller. Path filter: `backend/fetcher/**`, `backend/fetcher-host/**`, `.github/workflows/fetcher.yml`, `.github/workflows/_build-*.yml`. **Owner:** `devops-engineer`.
  - **NEW `.github/workflows/frontend.yml`** — thin caller. Path filter: `frontend/**`, `.github/workflows/frontend.yml`, `.github/workflows/_build-*.yml`. **Owner:** `devops-engineer`.
  - **NEW `.github/workflows/gateway.yml`** — thin caller. Path filter: `gateway/**`, `.github/workflows/gateway.yml`, `.github/workflows/_build-*.yml`. **Owner:** `devops-engineer`.

  - **NEW `docs/ci-cd-pipelines.md`** — new operational companion doc. **Owner:** `devops-engineer` (semantics + operational examples; Phase 4 deliverable). Scope:
    - What triggers what (per-component path-filter table; the trigger matrix from 3b).
    - How to read the GHCR registry (image names, tag conventions per 3e, how to pin a specific build).
    - How to invoke `workflow_dispatch` manually (when + how + which inputs).
    - How to bump a version tag (the `git tag vX.Y.Z && git push --tags` flow + which workflows it fires).
    - How the EF-migrations-script artefact is consumed downstream (3l).
    - How the dogfooding notify call appears in the dashboard (3m) — what `service` / `environment` to filter on.
    - The GHCR → ACR swap procedure (one-liner per 3d) — kept short; the procedure becomes the canonical reference when Terraform §4 lands.

    **NOT** an extension of `docs/ci-cd-integration.md` — that doc is the **inbound** companion to SAD §7 (how external CI/CD tools push events to the dashboard). `docs/ci-cd-pipelines.md` is the **outbound** companion (how the dashboard's own components are built and shipped). Different concern, different audience, different role-ownership shape on the registry / image surface — keep them separate. (User-approved doc split.)

  - **NEW Phase 5/6 amendments to existing project files (as-built; recorded here for traceability — these are not Phase 7 SA edits, they shipped earlier in the lifecycle).**

    - **`backend/api/Dashboard.Api/Dashboard.Api.csproj`** — adds `Microsoft.EntityFrameworkCore.Design` PackageReference with `PrivateAssets=all`. Required by the `dotnet ef migrations script` invocation per § 3l (the EF tooling resolves the design-time `DbContext` from the startup project's references). `PrivateAssets=all` keeps the design-time package off the runtime closure — tests, image build, and runtime are unaffected. **Owner:** `backend-engineer` (Phase 4).
    - **`backend/fetcher/Dashboard.Fetcher.Tests/FetcherWorkerTests.cs`** — `PeriodicTimer_LongTickDoesNotCauseBackToBackBurstOfTicks` flake-threshold tuned from 250 ms → 100 ms for CI scheduler jitter. Still 5–10× larger than the queueing-bug regression case (~10–20 ms), preserves the regression signal. Lineage: WBS §1.5.10 (scheduler-drift xUnit tests added by CR-0009). **Owner:** `qa-engineer` (Phase 6).
    - **`.config/dotnet-tools.json`** — NEW; pins `dotnet-ef` to the .NET 10 release line. Consumed by `_build-and-push-image.yml` step 4 (`dotnet tool restore`) and step 10 (`dotnet ef migrations script`). **Owner:** `devops-engineer` (Phase 4).
    - **`frontend/karma.conf.js`** — NEW; emits cobertura + lcov, declares `ChromeHeadlessNoSandbox` custom launcher. Consumed by `_build-and-push-image.yml` step 7b (`ng test`) + step 9b (coverage artefact upload — `frontend/coverage/**/cobertura.xml`). **Owner:** `qa-engineer` (Phase 4).
    - **`frontend/angular.json`** — `karmaConfig` wired across all four projects to point at the new shared `karma.conf.js`. **Owner:** `qa-engineer` (Phase 4).
    - **`dotnet format` baseline applied to 10 backend files** — one-shot Phase 4 cleanup so the `dotnet format --verify-no-changes` gate (§ 3h) passes from day one. **Owner:** `backend-engineer` (Phase 4).

  - **Amends `docs/architecture.md` §9 (Phasing) — CI/CD Integration table.** The current rows ("Inline HTTP step", "GitHub Actions composite action", "Webhook receiver", "Pull-mode fetcher (optional, CR-0009)", "Secrets") are **inbound** integration; CR-0010 adds the **outbound** component-CI track. Replace the implicit "CI/CD Integration — planned" framing with a concrete component CI inventory row (or new sub-table) listing the four thin workflows + the reusable workflow + the GHCR image set. **Phase 7 SA edit** (this CR locks the decision; the SAD edit is the Phase 7 cleanup).

  - **Amends `docs/WBS.md`:**
    - **§1.5.8** — current text "`backend/fetcher-host/Dockerfile` — multi-stage build mirroring `backend/api/Dockerfile` posture (SDK build → aspnet runtime). Image: `dashboard-fetcher`. Owner: `devops-engineer`." Marks **"image build absorbed into CR-0010 / §1.6 component CI track — Dockerfile itself remains a 1.5.8 deliverable, but the build + push + tag are owned by `fetcher.yml`"**. Cross-link to §1.6 + CR-0010.
    - **§5.1** — current text "GitHub Actions workflow — Docker build, push to ACR, update Container App revision on merge to main". Mark **split**: the **build + push** half is delivered by CR-0010 (with GHCR substituting for ACR per 3d; GHCR → ACR swap when §4 lands); the **update Container App revision** half remains deferred to Terraform §4 + a future CD CR (3k). Cross-link to §1.6 + CR-0010.
    - **NEW §1.6 "Component CI" track** — as-built items in WBS §1.6 mirror the §1.5 structure (1.6.1 through 1.6.9). The canonical list lives in `docs/WBS.md` §1.6; the row mapping below is a CR-side cross-reference, not the source of truth.

    **Phase 7 SA edit** (CR-0010 locks the items; the WBS rows land in Phase 7).

  - **Amends `local/bindings.md`** — Source-of-truth ownership table gains a row:

    | `docs/ci-cd-pipelines.md` | Operational companion to SAD §9 (Phasing → component CI track) — workflow inventory, GHCR usage, version-tag flow, GHCR → ACR swap procedure | `devops-engineer` |

    (Mirrors the existing `docs/ci-cd-integration.md` row pattern.) `bindings.md` is `project-manager`-owned during discovery — flag for **Phase 8 PM doc-co-ownership maintenance**, not Phase 7.

  - **Amends `local/index/manifest.yaml` + adds `local/index/ci-pipelines-index.idx`** (novel class — `class: ci-pipelines`). The new operational doc `docs/ci-cd-pipelines.md` is a new source-doc class; the index extraction and per-class inline recipe are `ai-engineer`'s authoritative call per `core/index-protocol.md § Consumer coupling`. CR-0010 does **not** prescribe the index contents or recipe shape — that's the index protocol's job. Surface as a follow-up task for `ai-engineer` in Phase 7 / 8 (between-phase invocation per `bindings.md` "ai-engineer | always available (between-phase invocation)").

  - **No FR or NFR amendments.** CR-0010 adds operational tooling — no functional requirement changes, no NFR changes. NFR-02 (cost) is **upheld** (GHCR is free at this scale). NFR-06 (Terraform IaC) is **upheld** (GHCR requires no infra; no Portal clicks). NFR-04 (internal-only) is unaffected (the new workflows do not change the runtime surface area). The fetcher's `minReplicas: 1, maxReplicas: 1` constraint from CR-0009 SAD §7 is preserved (CR-0010 only builds + pushes the image; deploy is out of scope per 3k).

- **Open trade-offs — resolved in Phase 2/4 unless noted.**

  - **(i) One reusable workflow or two? — RESOLVED Phase 2 (DevOps trade-off proposal — Option A, user-approved).** One reusable workflow `_build-and-push-image.yml` parameterised by `build-kind: dotnet|static`. The `if: inputs.build-kind == 'dotnet' | 'static'` branches are well-localised (language setup, NuGet cache, dotnet-tools restore, format gate, dotnet test, EF script — all on `dotnet`; node setup, npm ci, ng test — all on `static`; Buildx + login + metadata + build/push shared). Single-workflow win: BuildKit cache config, tag rules, registry login posture all live in one place.

  - **(ii) Branch-protection enforcement.** Should the new workflows be **required** for PR merge to `main` (GitHub repo settings → Branch protection rules → Require status checks to pass before merging)? **Recommendation: yes, once they're proven green for a calendar week of normal-volume PR activity.** Not a CR-0010 deliverable (no code change — it's a repo-settings flip). Flagged as a **Phase 8 acceptance follow-up** (see WBS §1.6.8 above). Defer the decision until the workflows have actual signal — gating PRs on a flaky workflow is worse than no gate.

  - **(iii) EF migrations script generation needs runtime env vars.** If `Dashboard.Api`'s composition root runs `Bind` against `IConfiguration` for required settings (e.g. `ConnectionStrings__DefaultConnection`) at design-time before the EF tooling can resolve the `DbContext`, the `dotnet ef migrations script --idempotent` invocation will fail in CI with no DB available. **Recommendation: stub the env-bind path with a CI-only placeholder (`ConnectionStrings__DefaultConnection=Host=ci;Database=ci;Username=ci;Password=ci`) — the migration tooling only needs a syntactically-valid connection string to resolve the provider; it does not connect.** If a deeper composition-root coupling surfaces (e.g. the API host requires Postgres to be reachable at startup), defer to `backend-engineer` for a small CI-friendly `IDesignTimeDbContextFactory<TContext>` shim. Not a CR-0010 deliverable — flagged for Phase 4 in case it surfaces.

- **References.**
  - User Phase 1 freeform task — *"introduce CI/CD pipeline for components, to build, test and package"*.
  - [CR-0008](./CR-0008-api-validation-and-openapi-scalar.md) — validation + DataAnnotations pattern (precedent if CR-0010 ever validates runtime config; not used today, retained for symmetry with future CD work).
  - [CR-0009](./CR-0009-pull-mode-fetcher-and-progress-reporter.md) § 3d — deferred ACR / Terraform framing for the fetcher image; CR-0010 absorbs the build + publish half (GHCR substitute), defers the ACA-revision half.
  - [ADR-0002](../adr/ADR-0002-modular-monolith-consolidation.md) — modular monolith; explains why `backend/Dashboard.sln` builds as one container target (`api.yml` is one workflow, not three).
  - `docs/WBS.md` §1.4 (CI/CD Integration phase — composite action + secrets, the inbound surface), §1.5.8 (fetcher Dockerfile — image build absorbed into CR-0010), §5.1 (the row being split — build+push half → CR-0010, ACA-revision half → future CD CR + Terraform §4).
  - `docs/architecture.md` §3 NFR-06 (IaC posture — rationale for the GHCR-not-ACR deviation in 3d), §5 NFR-02 (cost cap — rationale for GHCR), §9 (Phasing — receives the new component-CI track row).
  - `.github/actions/notify/action.yml` — composite action invoked by the dogfooding hook (3m); CR-0010 makes this repo the first consumer of its own integration surface.
  - `core/index-protocol.md § Consumer coupling` — new `ci-pipelines-index.idx` extraction (`ai-engineer` Phase 7 / 8 follow-up).
