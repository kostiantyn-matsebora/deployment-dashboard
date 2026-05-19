# ADR-0005 — Release-install migration actuation via tag-pinned `migration.sql` release asset

- **Status:** accepted (paired with GitHub issue [#7](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/7) — *"One-liner install — run a released version without cloning the repo"*)

- **Context.**

  Issue #7 introduces a release-install path: an adopter on a clean machine with Docker installed brings up a released version of the stack via a one-liner (Option A: `install.ps1` / `install.sh` piped from a tag URL), with no `git clone` and no source tree on disk. That breaks the current local-dev migration model.

  Today, schema migrations are run by a one-shot `migrations` service in `dev_env/docker-compose.local.yml:55-108` that:
  1. Uses the `mcr.microsoft.com/dotnet/sdk:10.0` image.
  2. Bind-mounts `../backend` (the source tree) into the container.
  3. Installs `dotnet-ef` and runs `dotnet ef database update` against the `Dashboard.Shared` project.

  Each precondition is broken under the release-install path:
  - **No source tree** — the user has no `backend/` on disk; bind-mounting is impossible.
  - **No SDK in a release stack** — pulling a 1 GB+ SDK image for a one-shot migration runs against the lean, image-only posture the release stack targets.
  - **No assumption that a developer can debug an `ef` failure** — release-install users are evaluators / internal adopters, not contributors.

  A migration-actuation mechanism is therefore required as the contract surface that:
  - `devops-engineer` keys the release compose (`docker-compose.release.yml`) and the installer scripts off.
  - `qa-engineer` validates via manual smoke after the installer brings the stack up.
  - Adopters can re-apply safely when upgrading from an older tag to a newer one.

  Constraints:
  - **No backend source on the install host.** Any approach requiring `backend/` on disk is out.
  - **No SDK in the release stack.** The release stack uses runtime images only (`aspnet:10.0`, `nginx:alpine`, `postgres:16-alpine`).
  - **CI already emits `migration.sql`.** The reusable workflow's `emit-migration-artefact: true` path produces an **idempotent** `migration.sql` per `api.yml` run (`docs/ci-cd-pipelines.md § 7`); the script wraps every DDL statement in existence checks, so re-applying against any historical schema state is a no-op for already-applied steps.
  - **The local-dev flow is not affected.** `dev_env/docker-compose.local.yml` and `dev_env/start.ps1` continue to work unchanged; the freeze-on-source-tree migrations service is the right shape for contributors who *have* the source tree.

  Four options were considered (per issue #7 Phase 2 design brief).

- **Decision.**

  **Adopt Option (c) — release-asset SQL.** The release-install path applies `migration.sql` as a tag-pinned GitHub Release asset against the running `db` container via a one-shot `postgres:16-alpine` container, run *before* the `api` service starts.

  1. **CI's existing `migration.sql` artefact is promoted to a release asset.** On `v*` tag push, the new `release.yml` workflow downloads the `ef-migrations-script-<sha>` artefact produced by the same-commit `api.yml` run (or re-generates it in the release job using the same `dotnet ef migrations script --idempotent` step the reusable workflow already runs) and attaches it as `migration.sql` to the GitHub Release.

  2. **Release compose declares a profile-gated `migrations` one-shot service** keyed off a `migrate` profile (Compose v2 `profiles:`):
     - `image: postgres:16-alpine` — already needed for the `db` service; image is local after `db` pulls.
     - `depends_on: db: service_healthy` — same gate the API uses today.
     - `volumes: ./migration.sql:/migration.sql:ro` — bind-mount the file the installer downloaded into the install directory.
     - `entrypoint: psql -h db -U $POSTGRES_USER -d $POSTGRES_DB -v ON_ERROR_STOP=1 -f /migration.sql`.
     - `restart: "no"` — one-shot, exit-on-success.
     - The `api` service declares `depends_on: migrations: service_completed_successfully` mirroring the local-dev pattern verbatim (`dev_env/docker-compose.local.yml:130-134`).

  3. **Installer applies migrations by default; opt-out flag exists for evaluators who want a stack-up-only smoke.** Default behaviour is `docker compose --profile migrate -f docker-compose.release.yml up -d --wait`. The installer accepts `-SkipMigrations` (PowerShell) / `--skip-migrations` (bash) to bring the stack up without the `migrate` profile; in that mode the API will fail to start cleanly against an unmigrated DB and the URL panel surfaces a one-line yellow notice telling the user to re-run without `-SkipMigrations`. Default-on, opt-out-by-flag is the correct polarity: a forgotten `--apply-migrations` flag silently produces a broken stack; a forgotten `--skip-migrations` flag costs one extra `postgres:16-alpine` container run.

  4. **The installer downloads `migration.sql` from the tag-pinned release asset URL** (`https://github.com/<owner>/<repo>/releases/download/<tag>/migration.sql`), the same canonical pattern the installer uses to fetch `docker-compose.release.yml` and itself (per `docs/ci-cd-pipelines.md § Release pipeline`). The installer refuses to proceed when the release for the resolved tag does not advertise a `migration.sql` asset (defensive failure: would indicate an incomplete release publish).

  5. **The `migration.sql` contract is the `--idempotent` script `dotnet ef migrations script --idempotent` produces.** Re-applying it against an already-migrated DB is a no-op for every applied migration (`IF NOT EXISTS` / `IF EXISTS` guards on every DDL statement, per the EF Core `--idempotent` contract documented in `docs/ci-cd-pipelines.md § 7 → Idempotent contract`). This is what makes upgrade safe: an adopter going from `v1.0.0` to `v1.2.0` runs the installer for `v1.2.0`; the new `migration.sql` includes every migration from `v1.0.0` through `v1.2.0`; already-applied steps no-op; new steps land.

- **Consequences.**

  - **Zero backend code change.** No `Database.Migrate()` call in `Program.cs`. No `RUN_MIGRATIONS` env var. No EF Core `Design` reference added to `Dashboard.Api`. The backend stays runtime-image-only; the migration concern is fully external.
  - **Zero Dockerfile change.** `backend/api/Dockerfile` does not need to `COPY migration.sql` — the installer bind-mounts the file into the one-shot `migrations` container at install-time, the same way local-dev bind-mounts the source tree into the SDK container.
  - **Zero `_build-and-push-image.yml` re-ordering.** The reusable workflow's existing `emit-migration-artefact: true` path stays unchanged; `release.yml` (new) consumes the artefact downstream. The four component pipelines are not touched.
  - **Local-dev `migrations` service stays as-is.** Contributors continue to run `pwsh -NoProfile -File dev_env/start.ps1`; the SDK-image + bind-mount + `dotnet ef database update` posture is the right shape when the source tree is available and immediate feedback on a freshly-authored migration matters.
  - **One extra release asset per tag** — `migration.sql`. Capacity is negligible (~tens of KB per release).
  - **One extra `postgres:16-alpine` container run per install.** The image is already pulled for the `db` service; the second container is a thin `psql` invocation. Wall-clock overhead is single-digit seconds.
  - **Upgrade safety is asserted by the `--idempotent` contract, not by version-tracking.** The installer never reads or writes a "current migration version" file on the install host; every install re-applies the full tag-pinned script and trusts EF Core's existence-check guards. This is the same contract the future CD-to-ACA path will rely on (`docs/ci-cd-pipelines.md § 7 → Idempotent contract`).
  - **A buggy migration applied to an upgraded host is recoverable by manual psql.** Because `migration.sql` is a plain SQL file on the install host (`<InstallDir>/migration.sql` after a successful install), an operator can inspect or replay it without re-running the installer. The installer does not delete it on completion.
  - **Options B and D (raw compose, `docker compose -f <https-url>`) regress on migration actuation, in addition to the secret-handling regressions issue #7 calls out.** Both bypass the installer layer where the `--profile migrate` invocation lives. README for the escape-hatch path must instruct the user to either (i) `curl` the `migration.sql` asset and run `docker compose run --rm migrations` themselves, or (ii) skip migrations and run `psql -f migration.sql` manually against the `db` container. The README warning is symmetric with the `GHA_TOKEN` and `API_TOKEN` warnings already required for B and D.
  - **No FR / NFR amendment.** Migration actuation is an operational concern, not a system-wide contract; the existing `--idempotent` artefact contract carries the load. The new `release.yml` workflow is documented in `docs/ci-cd-pipelines.md § Release pipeline` (see paired CI/CD pipeline-doc update).

- **Alternatives considered.**

  | Option | Rejected because |
  |---|---|
  | (a) Programmatic — `Database.Migrate()` in `Program.cs` gated by `RUN_MIGRATIONS=true` | Creates a permanent dual mode (dev-stack: one-shot SDK service; release-stack: API self-migrate). Adds startup-time DB coupling to the API host: a slow / failing migration blocks every API replica from coming up, instead of being observable as a single one-shot service exit code (`dev_env/docker-compose.local.yml:27-31` calls out *"keeps migration ordering observable from `docker compose logs migrations`"* — that observability survives in Option (c)). Also adds `Microsoft.EntityFrameworkCore.Design` (or the `Migrations` assembly's runtime equivalents) into the API host's published surface, which the host currently doesn't reference. |
  | (b) Bake SQL — `COPY migration.sql` into `backend/api/Dockerfile`; release compose runs `psql -f` from the API image (or a sidecar) | Requires CI re-ordering: `migration.sql` must be generated *before* `docker build`, not as a sibling artefact step. Touches the reusable `_build-and-push-image.yml` workflow + the `api` Dockerfile — blast radius across all four component pipelines. The artefact contract is already in place per `docs/ci-cd-pipelines.md § 7`; baking it into the image trades a published-once-per-release asset for an immutable image binding that complicates upgrade-without-rebuild scenarios. |
  | (d) Other — e.g. ship a separate `migrator` image (`dashboard-migrator`) baking `migration.sql` + `psql` | A fifth component image to build, tag, push, sign, and document. The repository owns four component images today (CR-0010); growing the inventory by 25 % for a one-shot init container is not load-bearing when the existing `postgres:16-alpine` already provides `psql`. |

- **References.**

  - GitHub issue [#7](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/7) — the triggering requirement.
  - GitHub issue [#5](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/5) (closed) — `-Fetcher` / `-AllowMissingGhaToken` precondition pattern the installer inherits verbatim for the `GHA_TOKEN` secret.
  - [CR-0010](../cr/CR-0010-component-ci-pipeline.md) — component CI pipeline; defines the four component images and the `_build-and-push-image.yml` reusable workflow this ADR extends with a sibling `release.yml`.
  - `docs/ci-cd-pipelines.md § 7 — EF migration SQL artefact` — the `--idempotent` script contract this ADR promotes from CI artefact to release asset.
  - `docs/ci-cd-pipelines.md § Release pipeline` — operational companion for the release-publishing workflow that produces `migration.sql` + the other release assets.
  - `dev_env/docker-compose.local.yml:55-108` — local-dev `migrations` service the release-stack `migrations` service mirrors in shape (one-shot, `depends_on: db: service_healthy`, `restart: "no"`) but not in image (SDK → `postgres:16-alpine`) or actuation (`dotnet ef database update` → `psql -f /migration.sql`).
  - [ADR-0002](./ADR-0002-modular-monolith-consolidation.md) — modular monolith; the "one API container" invariant survives unchanged (this ADR adds no code, only an external migration-actuation mechanism).
