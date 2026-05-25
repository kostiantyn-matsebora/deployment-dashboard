---
title: "ADR-0010: dev_env Compose Derives from Release"
parent: ADRs
nav_order: 10
---

# ADR-0010 — `dev_env/docker-compose.local.yml` layered on `install/docker-compose.release.yml` via Compose merge

- **Status:** accepted (2026-05-22) — paired with GitHub issue [#21](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/21) — *"Derive dev_env Docker compose from installation compose to eliminate duplication"*.

- **Context.**

  The contributor flow (`dev_env/docker-compose.local.yml`) and the release-install flow (`install/docker-compose.release.yml`) describe the same service inventory: `db`, `api`, `dashboard`, `gateway`, optional profile-gated `fetcher`. They share the env-var contract (write-API key, GHA token + repositories, fetcher poll interval), the same NFR-04 wire shape (gateway is the single host-published port), the same `fetcher` profile model, and the same migration actuation path (API self-migrates on startup per [ADR-0009](./ADR-0009-startup-applied-ef-migrations.md)). They diverge on three axes only:

  | Axis | Release | Contributor |
  |---|---|---|
  | Image source | `ghcr.io/.../<component>:${DASHBOARD_VERSION:-latest}` | Local `build:` block against the source tree (`../backend`, `../frontend`, `../gateway`) tagged `deployment-dashboard/<component>:dev` |
  | Secret values | Read from `dashboard.env` (`POSTGRES_PASSWORD`, `API_TOKEN`, `ConnectionStrings__DefaultConnection`) written by `install.ps1` from random hex | Hard-coded dev literals (`local-dev-password`, `local-dev-token-not-for-production`) per the "zero-setup, no .env files" invariant |
  | Convenience services | None | `pgadmin` (host port 5050) |

  Before this ADR, the two files duplicated every shared detail. Each installer-side improvement therefore required a parallel edit in `dev_env/`. The drift was observable in the commit history:

  - `-Demo` flag landed in `install.ps1` first; `start.ps1 -Demo` was a follow-up commit on a separate branch (pull-mode fetcher demo-mode landing sequence).
  - `GHA_REPOSITORIES` + `FETCHER_POLL_INTERVAL_SECONDS` substitution syntax shipped to the release compose ahead of the dev compose.
  - Anonymous-mode fetcher (`-AllowMissingGhaToken`) reached parity only after a dedicated catch-up edit.

  Constraints:

  - **Zero-setup, no `.env` files** (`dev_env/README.md § Topology`). Contributors must not need to copy / template / source any env file before `start.ps1`.
  - **Idiomatic Docker Compose** (no custom preprocessor). Adopters new to the project should recognise the pattern.
  - **`-Scaled` stack stays standalone.** The NFR-05 validation variant uses a different project `name:`, container-name suffixes, 3-replica `api`, no fetcher / no pgadmin — structurally distinct enough that forcing it through the same merge buys no reuse.
  - **No backend code change.** Migration actuation already self-contained in the API container per [ADR-0009](./ADR-0009-startup-applied-ef-migrations.md); no `migrations:` service in either file before or after this ADR.

  Three options were considered. Compose's native `-f` chaining (Option a) is the idiomatic, in-tree mechanism for exactly this pattern.

- **Decision.**

  > **`install/docker-compose.release.yml` is the canonical inventory of solution app services (`db`, `api`, `dashboard`, `gateway`, `fetcher`); the demo overlay (`install/docker-compose.demo.yml`) carries demo-only services (`demo-gha`, `demo-driver`); the integration substrate lives under `dev_env/` (`dev_env/docker-compose.integration.yml`, owning `mock-gha`). Each overlay layers via compose `-f` merge per the same mechanic. `dev_env/docker-compose.local.yml` is the contributor-flow OVERRIDE for app services on top of those bases; `dev_env/docker-compose.demo-local.yml` is the sibling demo-mode build-override (factored out so non-demo dev chains do not pull demo service blocks in). The default contributor invocation (demo) is `docker compose -f install/docker-compose.release.yml -f install/docker-compose.demo.yml -f dev_env/docker-compose.local.yml -f dev_env/docker-compose.demo-local.yml up -d --build`. The override files carry only the contributor-flow deltas (build blocks, `pgadmin` convenience service) plus `pull_policy: never` on every overridden image.**

  Mechanics:

  1. **The release file is the canonical inventory of solution app services.**
     - Solution app services live there: `db`, `api`, `dashboard`, `gateway`, `fetcher`.
     - Demo-only services (`demo-gha`, `demo-driver`) live in `install/docker-compose.demo.yml`.
     - Integration substrate (`mock-gha`) lives in `dev_env/docker-compose.integration.yml`.
     - Every env-var contract for app services lives in the release file: substitutions like `${FETCHER_POLL_INTERVAL_SECONDS:-30}`, `${GHA_TOKEN:-…placeholder}`.
     - Every profile gate + structural detail for app services lives there: `fetcher` profile, `container_name`, `depends_on`, healthchecks, the `pg-data` volume, port mapping `${DASHBOARD_PORT:-8080}:80`.
  2. **The override file states only what differs.**
     - **Service delta** — `build:` block + `image:` tag override + `pull_policy: never`.
     - **Env-var delta** — a single key under that service's `environment:` block (Compose merges by key; the override wins without re-stating the rest of the env).
     - **New service** (e.g. `pgadmin`) — a full service entry (Compose appends services not in the base).
  3. **Profile-gating is the standard activation pattern for opt-in stack components within a single compose file.**
     - `db` carries `profiles: ["db"]` in the release file; activated by `--profile db` on `-LocalDb` / `-Demo` install paths. External-Postgres paths (default release install) omit the profile and skip the local `db` container entirely.
     - `fetcher` carries `profiles: ["fetcher"]` in the release file (existing gate); activated by `--profile fetcher` on `-RealGha` / `-Demo` install paths.
     - **Profile gating vs overlay activation are distinct mechanisms.** Profile gating opts a service in or out within a single compose file. Overlay activation (demo / integration overlays) is purely a function of the `-f` flag count on the compose invocation — services in `docker-compose.demo.yml` / `docker-compose.integration.yml` carry NO profile gate on their relocated blocks; their activation is binary on overlay presence.
  4. **Cosmetic warnings accepted.**
     - **Symptom.** Compose interpolates each `-f` file independently. The three secret substitutions the release file expects from `dashboard.env` (`POSTGRES_PASSWORD`, `API_TOKEN`, `ConnectionStrings__DefaultConnection`) interpolate to empty strings when `start.ps1` runs without an env-file, producing one-line `variable XXX not set` warnings on stderr.
     - **Why functional behaviour stays correct.** The override merge then re-sets the keys to the dev literals — only the warnings are visible.
     - **Why not suppressed.** Suppressing them would require either an env-file (violates the "no `.env`" invariant) or in-script `$env:VAR =` exports (creates a second source of truth for the dev literals).
  5. **`start.ps1` + `stop.ps1` pass the required `-f` flags per the resolved chain (see § Consequences table for the full per-invocation matrix).**
     - `-Scaled` keeps a single `-f` against the standalone scaled compose.
     - The argument order is fixed by Compose's later-wins merge rule: release → demo → local → demo-local (contributor demo / default) · release → local → integration (contributor `-Integration`) · release → local (contributor `-LocalDb` / `-RealGha`).

- **Consequences.**

  - **`dev_env/start.ps1` mirrors `install.ps1`'s switch surface 1-for-1** (`-LocalDb`, `-RealGha`, `-Demo`, default), so contributor flow and release install are parity-tested by construction. Cites ASR-C from issue [#72](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/72).
  - **`install/docker-compose.demo.yml` extends the compose-merge override pattern from the two-file shape this ADR was authored for (`release` + `local`) to a multi-file overlay stack** (per the release/demo overlay split — issue [#72](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/72)). Resolved per-invocation:

    | Invocation | Overlay chain | File count |
    |---|---|---|
    | Release install — default | `release.yml` | 1 |
    | Release install — `-LocalDb` / `-RealGha` | `release.yml` | 1 (profile gating adds services within the same file) |
    | Release install — `-Demo` | `release.yml` + `demo.yml` | 2 |
    | Contributor flow — `-LocalDb` / `-RealGha` | `release.yml` + `local.yml` | 2 |
    | Contributor flow — `-Integration` | `release.yml` + `local.yml` + `integration.yml` | 3 |
    | Contributor flow — `-Demo` / default | `release.yml` + `demo.yml` + `local.yml` + `demo-local.yml` | 4 |

    Order-of-application follows Compose's later-wins rule, fixed by the invoking script. The merge mechanic itself is unchanged; only the overlay count grows. The contributor demo chain peaks at four files because demo-only build overrides are factored into `dev_env/docker-compose.demo-local.yml` to keep non-demo dev chains (LocalDb / RealGha / Integration) free of the demo service blocks.
  - **Single source of truth for the shared inventory.** Installer-side env-var additions, profile additions, image-name renames propagate to the contributor flow automatically. The duplication drift documented in the issue body is structurally eliminated.
  - **Override file shrinks.** From ~175 declarative lines to ~95 (comment-heavy; ~45 lines body). Below the issue's <50-line target if comments are stripped; the comments are retained because the file is the canonical reading entry-point for contributors learning the override pattern.
  - **No backend / frontend / gateway source change.** Build contexts, Dockerfiles, image structure, NFR contracts unchanged.
  - **One new docs surface — `dev_env/README.md § Compose-merge override`.** Lists what the override exists to express, how to add a dev-only service, how to add a contributor-flow env-var override.
  - **Test-contract update.** `testing/scripts/start.Tests.ps1` + `testing/scripts/stop.Tests.ps1` previously asserted a single `-f` against `docker-compose.local.yml`. Updated to assert both `-f` slots in order (release.yml first, local.yml second) and to seed the new repo-layout fake (dev_env/ + install/ as siblings inside the per-test tmpdir).
  - **`start.ps1 -Scaled` unchanged.** Scaled stack remains a single-file compose; the merge applies only to the default contributor stack.
  - **`fetcher` profile is inherited.** `start.ps1 -Fetcher` continues to add `--profile fetcher` to the compose args; the `fetcher` service definition lives in `install/docker-compose.release.yml` (`profiles: ["fetcher"]`), and the override carries only the `build:` + dev-literal `DASHBOARD_WRITE_API_KEY` deltas.
  - **One-line stderr noise from variable interpolation.** Cosmetic; see § Decision § Mechanics #3 above for symptom + trade-off analysis.
  - **No FR / NFR amendment.** The change records a structural decision about contributor-flow composition, not a user-facing system requirement. Existing FRs all describe SPA / API behaviour — this concern belongs in an ADR. The issue body's *"new: FR-15"* framing is reclassified here.
  - **bash sibling (`start.sh` / `stop.sh`) deferred.** Out of scope per issue #21's own *"Out of scope — Cross-OS shell sugar (PS-vs-bash parity for start/stop)"*. PowerShell 7+ remains the documented contributor-flow prerequisite.

- **Supersession.**

  - Cross-referenced by the release/demo overlay split (historical CR-0015; coordination record per issue [#72](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/72)). That change request amends the canonical-inventory framing this ADR was authored under; the compose-merge override mechanic itself stands unchanged.

- **Alternatives considered.**

  | Option | Rejected because |
  |---|---|
  | (b) Keep two full compose files; add a CI lint that diffs them and fails on drift | Builds tooling against a problem the platform already solves. Lint catches the symptom (drift) after a PR is already opened; the merge approach prevents drift by construction. Adds a CI surface for every adopter to maintain. |
  | (c) Generate `dev_env/docker-compose.local.yml` from `install/docker-compose.release.yml` via a build-time script (e.g. yq / jq overlay) | Adds a non-Docker preprocessor adopters must run before `start.ps1`. Violates the "zero-setup" invariant: contributors would need yq installed on the host. Compose's `-f` chaining gives the same result with no extra tool. |
  | (d) Hoist the contributor deltas into the release file behind env-var defaults (e.g. `image: ${API_IMAGE:-deployment-dashboard/api:dev}`) | Bloats the release file with concerns the release path doesn't have (no `build:` blocks ever apply on a release install; `pull_policy: never` is wrong for release). Mixes audiences. The override pattern is the standard separation. |

- **References.**

  - GitHub issue [#21](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/21) — the triggering requirement.
  - GitHub issue [#7](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/7) — *"One-liner install"* — established the release-install path that the override layers on.
  - [ADR-0005](./ADR-0005-release-install-migration-actuation.md) (superseded by ADR-0009) — the issue body references ADR-0005's SDK-vs-psql runner concern; that concern is moot under ADR-0009 (no `migrations:` service in either compose file).
  - [ADR-0009](./ADR-0009-startup-applied-ef-migrations.md) — startup-applied EF migrations; removes the migration-runner co-existence question from this ADR's scope.
  - `dev_env/README.md § Compose-merge override` — operational companion: how to add a dev-only service, how to add a contributor-flow env-var override.
  - `install/docker-compose.release.yml` — the canonical service inventory the override layers on.
  - `testing/scripts/start.Tests.ps1`, `testing/scripts/stop.Tests.ps1` — Pester suites that exercise the two-file invocation contract.
