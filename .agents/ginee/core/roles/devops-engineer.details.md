# DevOps Engineer — Domain Elaboration

Companion to `core/roles/devops-engineer.md`. The kernel file holds normative rules; this file holds elaboration, patterns, and stack-specific guidance.

## Hard constraints — devops implications

Canonical NFR list: `local/bindings.md` → "Hard constraints". Common devops-relevant patterns:

| Constraint | Implication |
|---|---|
| Single-cloud constraint | <ul><li>Stay within the project's chosen cloud.</li><li>No mixing providers without an architecture-doc update.</li></ul> |
| Cost cap | <ul><li>Stay within the documented monthly budget.</li><li>Any SKU bump needs explicit approval + doc update.</li></ul> |
| Internal-only / private networking | <ul><li>No public ingress on the application tier.</li><li>External access via VPN, private endpoint, or a single hardened gateway.</li></ul> |
| Statelessness | <ul><li>Load-balancer / ingress config must not pin realtime clients to instances.</li><li>Reconnects use resume tokens.</li></ul> |
| IaC-defined | <ul><li>No clickops in the cloud console.</li><li>Every resource has an IaC definition.</li></ul> |
| Platform agnosticism | <ul><li>Standard containerised app on any OCI-compliant host.</li><li>No proprietary compute-model bindings unless the architecture doc explicitly allows.</li></ul> |
| Retention (data) | <ul><li>Storage / backup settings preserve recoverability.</li><li>Any pruning job (typically backend-owned) defaults to the documented window.</li></ul> |

## IaC layout (generic shape)

Adapt to the project's chosen IaC tool. Common patterns:

- One root module per environment workspace (`dev`, `prod`) with per-environment variable files.
- Submodules for cross-cutting concerns:
  - `naming`
  - `network`
  - `<database>`
  - `<container-registry>`
  - `<container-runtime>-environment`
  - `<container-runtime>-app` (reused per service)
  - `<secret-vault>`
- Backend state:
  - Stored remotely (cloud-storage / IaC-tool-cloud / etc.).
  - One state per workspace.
  - State files **never** in repo.
- Every secret read from the secret vault by reference at runtime, not from variable files.
- Pin provider / module versions.
  - Pin patch versions to avoid drift.

## Container ownership

Files you own beyond the application-tier repo-structure tree (paths per `local/bindings.md`):

| File class | Notes |
|---|---|
| Gateway / reverse-proxy container | <ul><li>Single public-facing edge.</li><li>Routes by path + method per architecture doc.</li><li>Only container with public ingress in the typical topology.</li></ul> |
| Client SPA container (when SPA is statically hosted) | <ul><li>Multi-stage: build stage runs the SPA build → runtime stage copies the dist into a static-serving image.</li><li>Runtime image serves static + SPA history fallback.</li><li>NO upstream proxying — gateway handles that.</li></ul> |
| Service container(s) | <ul><li>SDK → runtime.</li><li>No SPA stage when the service is wire-only.</li><li>Internal-only at runtime.</li></ul> |
| Local-dev compose / orchestration | `dev_env/` (or per-project equivalent). |
| Scaled-validation compose / orchestration | Multi-replica setup to validate statelessness. |
| Local startup / teardown scripts | `start`, `stop` scripts (PowerShell / shell). |
| Script-quality artefacts | <ul><li>Unit tests next to devops-owned scripts: `*.Tests.ps1` (Pester) / `*.bats` (bats-core).</li><li>Lint config beside them: `PSScriptAnalyzerSettings.psd1` (PowerShell) / `.shellcheckrc` (bash).</li><li>Test directory path: `local/framework.config.yaml § devops-scripts.tests-path` (default sibling `tests/` next to each script root).</li><li>Coverage gate: `devops-scripts.coverage-threshold` (default `90`) on changed/added lines.</li></ul> |
| IaC modules + per-env roots | Per the project's IaC tool. |
| CI workflows | Release + PR validation. |
| Composite / reusable CI actions | Per the project's CI tool. |

## Container images

Generic rules:

- One image per deployable component.
  - All share one orchestration environment.
- Multi-stage builds.
  - Runtime images stay minimal.
- Each runtime image `EXPOSE`s the documented port.
- Tag with the git SHA and (optionally) `latest`.
  - Production references by digest, not tag.

## CI/CD pipelines

Generic shape (adapt to the project's CI tool):

- **PR validation workflow** — steps:
  1. Restore deps.
  2. Build.
  3. Unit test.
  4. Integration build (no push).
  5. IaC-tool `fmt` + `validate`.
  6. **Script lint + unit tests + coverage** (per `devops-engineer.md § Script-quality obligation`):
     - PowerShell — `PSScriptAnalyzer` (error-level fails the build); `Invoke-Pester -CodeCoverage` against `local/framework.config.yaml § devops-scripts.tests-path`; coverage on changed/added lines must meet `devops-scripts.coverage-threshold`.
     - bash — `shellcheck` (error-level fails the build); `bats` + `devops-scripts.coverage-tool-bash` (`bashcov` or `kcov`); same threshold.
     - The runners DevOps invokes locally and the runners CI invokes are the same — no parallel CI-only implementation.
- **Release workflow** (on merge to the project's release branch) — steps:
  1. Build images.
  2. Push to the project's registry.
  3. Run schema migrations as a one-shot job against target DB.
  4. Update the deployed application to the new image digest.
  5. Run the smoke suite owned by `qa-engineer`.
- Secrets:
  - Stored in the CI tool's environment-secret mechanism with required reviewers on `prod`.
  - Never in workflow files or repo source.
- Document which secrets are required in the architecture doc:
  - which secrets the application requires
  - which secrets each integration step requires
  - Mirror summaries in `local/bindings.md`.

## Database operational notes (when the project has one)

- SKU sized per the cost cap.
- HA/replica strategy per NFRs.
- Private access (vnet-injected / VPC-private).
  - No public IP unless the architecture doc allows.
- Enable point-in-time restore (PITR) / equivalent — covers retention NFR from an ops perspective.
- Backups:
  - Keep automatic backups on.
  - Document the restore runbook alongside the IaC.

## Smoke after every deploy

- You own deploy mechanics.
- `qa-engineer` provides the smoke suite.

After IaC apply + image update:

1. Health endpoint returns success.
2. Real-time endpoint check:
   1. Accepts subscriptions.
   2. Post a tagged event.
   3. Receive it within the documented latency budget.
3. Client loads from the gateway endpoint.
4. Persistence-layer schema matches the migration (run a schema diff).

Adjust per project specifics.
