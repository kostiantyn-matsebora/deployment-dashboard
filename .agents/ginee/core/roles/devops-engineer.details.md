---
audience: devops-engineer
load: on-demand
triggers: [devops-details, infrastructure, iac, ci-cd, container]
cap-bytes: 8192
reads-before-applying: []
---

# DevOps Engineer — Domain Elaboration

Companion to `core/roles/devops-engineer.md`. The kernel file holds normative rules; this file holds elaboration, patterns, and stack-specific guidance.

## Hard constraints — devops implications

Canonical NFR list: `local/bindings.md § Hard constraints`. Common patterns:

| Constraint | Implication |
|---|---|
| Single-cloud | Stay within chosen cloud; no mixing providers without architecture-doc update. |
| Cost cap | Stay within monthly budget; SKU bump needs approval + doc update. |
| Internal-only / private networking | No public ingress on app tier; external access via VPN · private endpoint · single hardened gateway. |
| Statelessness | LB / ingress must not pin realtime clients to instances; reconnects use resume tokens. |
| IaC-defined | No clickops; every resource has IaC definition. |
| Platform agnosticism | Standard containerised app on any OCI host; no proprietary compute-model bindings unless architecture doc allows. |
| Retention (data) | Storage / backup settings preserve recoverability; pruning job (typically backend-owned) defaults to documented window. |

## IaC layout (generic)

- One root module per env workspace (`dev` · `prod`) with per-env variable files.
- Submodules for cross-cutting: `naming` · `network` · `<database>` · `<container-registry>` · `<container-runtime>-environment` · `<container-runtime>-app` (reused per service) · `<secret-vault>`.
- Backend state stored remotely (cloud-storage · IaC-tool cloud); one per workspace; **never** in repo.
- Every secret read from vault at runtime, not variable files.
- Pin provider / module versions (patch-level pinning).

## Container ownership

Files beyond app-tier repo tree (paths per `local/bindings.md`):

| Class | Notes |
|---|---|
| Gateway / reverse-proxy container | Single public-facing edge; routes by path + method per architecture doc; only container with public ingress in typical topology. |
| Client SPA container (statically hosted) | Multi-stage: build stage runs SPA build → runtime stage copies dist into static-serving image. Runtime serves static + SPA history fallback. NO upstream proxying — gateway handles. |
| Service container(s) | SDK → runtime · no SPA stage for wire-only · internal-only. |
| Local-dev compose / orchestration | `dev_env/` (or per-project equivalent). |
| Scaled-validation compose | Multi-replica setup validating statelessness. |
| Local startup / teardown scripts | `start` · `stop` (PowerShell / shell). |
| Script-quality artefacts | Unit tests (`*.Tests.ps1` Pester · `*.bats` bats-core) · lint config (`PSScriptAnalyzerSettings.psd1` · `.shellcheckrc`) next to scripts. Test dir: `devops-scripts.tests-path` (default sibling `tests/`). Coverage gate: `devops-scripts.coverage-threshold` (default `90`) on changed/added. |
| IaC modules + per-env roots | Per project's IaC tool. |
| CI workflows · composite/reusable CI actions | Per project's CI tool. |

## Container images

One image per deployable component · all share one orchestration env · multi-stage builds (runtime images minimal) · each `EXPOSE`s documented port · tagged with git SHA + optionally `latest` · production references by digest, not tag.

## CI/CD pipelines

Adapt to project's CI tool.

**PR validation workflow:** restore deps · build · unit test · integration build (no push) · IaC `fmt` + `validate` · **script lint + tests + coverage** per `devops-engineer.md § Script-quality obligation` (PowerShell: `PSScriptAnalyzer` error-level fails build + `Invoke-Pester -CodeCoverage` ≥ threshold; bash: `shellcheck` error-level fails build + `bats` + `bashcov`/`kcov` ≥ threshold). Local + CI invoke same runners — no parallel CI-only implementation.

**Release workflow** (on merge to release branch): build images · push to registry · run schema migrations as one-shot job · update deployed app to new image digest · run smoke suite (owned by `qa-engineer`).

**Secrets** — CI environment-secret mechanism with required reviewers on `prod`; never in workflow files or repo source. Document required secrets in architecture doc (app + per-integration step); mirror summaries in `local/bindings.md`.

## Database operational notes (when present)

SKU sized per cost cap · HA/replica per NFRs · private access (vnet-injected / VPC-private; no public IP unless architecture doc allows) · enable PITR / equivalent (covers retention NFR ops-side) · automatic backups on · document restore runbook alongside IaC.

## Smoke after every deploy

You own deploy mechanics; `qa-engineer` provides smoke suite. After IaC apply + image update:

1. Health endpoint returns success.
2. Real-time endpoint — accepts subscriptions · post tagged event · receive within latency budget.
3. Client loads from gateway endpoint.
4. Persistence-layer schema matches migration (schema diff).
