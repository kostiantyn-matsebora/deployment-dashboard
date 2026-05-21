---
title: "ADR-0009: Startup-Applied EF Migrations"
parent: ADRs
nav_order: 9
---

# ADR-0009 — API host applies EF migrations on startup; external `migrations` service + `migration.sql` release asset retired

- **Status:** accepted (paired with GitHub issue [#22](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/22) — *"Move DB migrations into the API image; apply on application startup"*) — supersedes [ADR-0005](./ADR-0005-release-install-migration-actuation.md).

- **Context.**

  [ADR-0005](./ADR-0005-release-install-migration-actuation.md) settled the release-install migration-actuation problem with an **external one-shot model**: a profile-gated `migrations` service in `dev_env/docker-compose.release.yml` running `psql -f /migration.sql` against `db`, sourced from a tag-pinned `migration.sql` GitHub Release asset, paired with a sibling `migrations` SDK service in `dev_env/docker-compose.local.yml` running `dotnet ef database update` against the source tree. Six month later, the operational cost of that model is observable:

  | Cost | Surface |
  |---|---|
  | Two services per stack | `migrations` (one-shot) + `api` (long-running); `api` waits on `migrations: service_completed_successfully` |
  | `--profile migrate` UX trap | A forgotten `--profile migrate` flag silently brings up an `api` against an unmigrated DB; failure mode is the API crashing on the first query, not a clear "migrations skipped" signal |
  | Sixth release asset | `migration.sql` published per `v*` tag; inline `dotnet ef migrations script --idempotent` step in `release.yml`; dotnet-setup chain to run it; `emit-migration-artefact: true` machinery in `_build-and-push-image.yml` consumed by `api.yml` |
  | Installer surface | `-SkipMigrations` (PowerShell) / `--skip-migrations` (bash) flags; release-asset fetch step + checksum-not-verified failure mode if GH outage drops the asset; install-host file artefact (`<InstallDir>/migration.sql`) outliving the install |
  | Local-dev SDK image | 1 GB+ `mcr.microsoft.com/dotnet/sdk:10.0` pulled to run `dotnet ef database update` once; not used at runtime |

  The architectural argument that justified externalising actuation in [ADR-0005](./ADR-0005-release-install-migration-actuation.md) — observability of a one-shot exit code — was rooted in a multi-writer concern that does **not** exist here. Per [ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) (microservices + container co-location), the `deployment-dashboard-api` host is the **sole DB writer**: Fetcher writes only via `POST /api/deployments` and `PUT /api/fetcher/state/{source-id}` (write-API), Frontend never touches the DB, Gateway is a config-only nginx. There is no coordination requirement between a migration step and concurrent writers — the API host can safely own the migration step itself.

  EF Core's `Migrate()` carries the **same idempotency guarantee** as the `--idempotent` SQL script ADR-0005 relied on: applied steps tracked in `__EFMigrationsHistory`, re-apply is a no-op for any step whose row is present. Concurrent replicas calling `Migrate()` race-safely against the `__EFMigrationsHistory` row insert (Postgres unique-constraint; losing replica sees a no-op exception path and proceeds). NFR-05 (stateless backend across replicas) is preserved — each replica self-migrates idempotently on its own startup; no cross-replica state shared.

  Constraints:

  - **NFR-05 (stateless backend across replicas).** Each replica must self-bootstrap without coordinating through anything other than the DB itself. `Migrate()` satisfies this — the only shared state is the `__EFMigrationsHistory` row, already a DB-level coordination point.
  - **NFR-02 (≤ $30/month).** No new infra component. Removing a one-shot container per install reduces resource budget marginally; no offsetting cost.
  - **[ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) — `deployment-dashboard-api` is the sole DB writer.** Co-locating the migration step in the same host is the natural fit; no external coordinator needed.
  - **EF migrations idempotency contract.** Re-applying a migration whose `__EFMigrationsHistory` row exists is a no-op. Same property the `--idempotent` SQL script offered, now actuated through the EF runtime path instead of generated SQL.
  - **No new runtime dependency.** EF Core `Migrate()` ships with `Microsoft.EntityFrameworkCore.Relational` (transitive via `Npgsql.EntityFrameworkCore.PostgreSQL`, already referenced by `Dashboard.Shared`). **`Microsoft.EntityFrameworkCore.Design` is NOT required** — that package supports the `dotnet ef` tooling (script generation, scaffold), not the runtime `Migrate()` call.

- **Decision.**

  > **The `deployment-dashboard-api` host applies pending EF migrations on startup, between `app.Build()` and `app.Run()`, against the configured `DefaultConnection`. Failure aborts the process with a single `ILogger` error before `app.Run()`. No opt-out — no env-var chicken-bit, no flag, no profile gate.**

  The actuation shape:

  1. `backend/api/Dashboard.Api/Program.cs` resolves the `DashboardDbContext` from a temporary scope after `app.Build()` and calls `Database.Migrate()`. Logs `ILogger<Program>` info-level start + completion lines (`"applying EF migrations…"` / `"EF migrations applied (N applied / M total)"`).
  2. Failure path: caught exception logged at `LogLevel.Critical`, process exits non-zero **before** `app.Run()` — no half-started replica serving requests against an unmigrated DB.
  3. The migration assembly is `Dashboard.Shared` (unchanged from local-dev today); the `DashboardDbContext` already lives there.
  4. No conditional gate. Every replica's startup includes the migration step. EF idempotency makes this a no-op on every restart after the first apply per schema version.

  **What gets retired:**

  | Surface | Action |
  |---|---|
  | `dev_env/docker-compose.local.yml` — `migrations` SDK service + `api`'s `depends_on: migrations: service_completed_successfully` | Removed |
  | `dev_env/docker-compose.release.yml` — `migrations` `postgres:16-alpine` service + `--profile migrate` gate | Removed (devops-engineer owns the rewrite) |
  | `install/install.ps1` `-SkipMigrations`, `install/install.sh` `--skip-migrations` | Removed (devops-engineer owns the rewrite) |
  | Installer's release-asset fetch step for `migration.sql` | Removed (devops-engineer owns the rewrite) |
  | `.github/workflows/_build-and-push-image.yml` — `emit-migration-artefact` input + `dotnet ef migrations script --idempotent` step | Removed (devops-engineer owns the rewrite) |
  | `.github/workflows/api.yml` — `emit-migration-artefact: true` | Removed (devops-engineer owns the rewrite) |
  | `.github/workflows/release.yml` — inline `dotnet ef migrations script --idempotent` + asset upload of `migration.sql` | Removed (devops-engineer owns the rewrite) |
  | Local-dev contributor toolchain | Contributors authoring new migrations now need `.NET 10 SDK` + `dotnet-ef 10.0.0` on the host (no SDK container) |

- **Consequences.**

  - **One service consumes and migrates the DB.** `api` is the only image that touches the schema. Sequencing collapses from `db → migrations → api` to `db → api`.
  - **Retired surfaces eliminated.** See § Decision "What gets retired" for the full table — compose `migrations` services + `--profile migrate` gate, installer `-SkipMigrations` / `--skip-migrations` flags + release-asset fetch step, reusable-workflow `emit-migration-artefact` + `dotnet ef migrations script --idempotent` + `release.yml` asset upload.
  - **Failure mode is loud, not silent.** A bad migration aborts startup with a non-zero exit (ACA replica restarts in `CrashLoopBackOff`-equivalent) instead of silently producing an API against an unmigrated DB (the prior forgotten-`--profile migrate` failure mode). Faster diagnosis.
  - **No backend code dependency growth.** `Database.Migrate()` is provided by `Microsoft.EntityFrameworkCore.Relational`, transitively present via `Npgsql.EntityFrameworkCore.PostgreSQL` in `Dashboard.Shared`. **No `Microsoft.EntityFrameworkCore.Design` reference added.**
  - **Slower API startup, one-time per schema version.** First-replica startup against an empty / outdated DB pays the full migration cost (estimated **5–30 s on a fresh DB**; sub-second on an up-to-date DB — `__EFMigrationsHistory` SELECT only). Subsequent restarts are no-ops. Acceptable: ACA scale-from-zero already amortises ~3–8 s of cold start; the migration step is on the same wall-clock budget. Documented in SAD § 7 release-stack notes.
  - **Concurrent replicas race-safely.** N replicas calling `Migrate()` in parallel against the same empty DB → one wins the `__EFMigrationsHistory` insert; losers see a unique-constraint violation, retry the history SELECT, find the row, proceed as no-op. EF Core handles this internally. NFR-05 preserved.
  - **Local-dev contributor onboarding shifts.** Today: SDK container handles `dotnet ef database update`. New: contributors authoring migrations install `.NET 10 SDK` + `dotnet-ef 10.0.0` on the host (`dotnet tool install --global dotnet-ef --version 10.0.0`). Accepted — most contributors authoring migrations already have the SDK; running-the-stack contributors (no migration authoring) need nothing extra (`Migrate()` runs inside the API container).
  - **A buggy migration is no longer recoverable by inspecting `<InstallDir>/migration.sql`.** The SQL is not materialised on the install host. Recovery path for a bad migration: roll back to the previous image tag (which contains the previous migration set), or hand-author a corrective migration in a follow-up release. Acceptable — the failure mode is rare and the rollback path is the same image-tag-pin pattern operators already use for any release regression.
  - **NFR-05 stateless invariant preserved.** Each replica self-migrates idempotently on its own startup; no cross-replica coordination beyond the DB-level `__EFMigrationsHistory` row. The "running multiple replicas is undefined" concern that motivates `minReplicas == maxReplicas == 1` on the **fetcher** (ADR-0004 Decision 3) does **not** apply here — the API is multi-replica safe with `Migrate()`.
  - **No FR / NFR amendment.** Migration actuation remains an operational concern; the existing NFR-05 invariant covers the multi-replica safety claim verbatim. The issue body's "amends FR-10" line is a numbering slip — FR-10 governs API-key auth (`MapGroup("/api").RequireApiKey()`), not migration actuation. No SAD-frozen requirement changes.
  - **Docs:** SAD § 7 compose snippet updated (this ADR); `docs/ci-cd-pipelines.md § 7 — EF migration SQL artefact` deleted (devops-engineer); ADR-0005 status flipped to `superseded by ADR-0009`; `docs/adr/README.md` index gets a new ADR-0009 row + the ADR-0005 row updated.

- **Alternatives considered.**

  | Option | Rejected because |
  |---|---|
  | **(a) Keep ADR-0005's external profile-gated `migrations` service + `migration.sql` release asset** | The cost surface (two services, `--profile migrate` UX trap, six release assets, installer flags, dotnet-setup in release.yml, reusable-workflow `emit-migration-artefact` plumbing) is not justified when the API host is the sole DB writer per [ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md). The original motivation in ADR-0005 (one-shot observability of a separate exit code) addresses a multi-writer coordination concern that does not exist in this system. |
  | **(b) Bake `migration.sql` into the API image; run `psql -f` on container start** | Reintroduces the SQL artefact ADR-0009 retires (moved from release asset to image layer, but same surface). Adds a `psql` binary to the `aspnet:10.0` runtime image (image bloat + supply-chain surface). Adds a startup shell entrypoint (`docker-entrypoint.sh` wrapping `dotnet Dashboard.Api.dll`) that the runtime image currently does not need. EF `Migrate()` actuates the same DDL through the existing EF runtime with no extra binaries. |
  | **(c) Flyway / sqitch sidecar** | Adds a third migration tool to the system (EF generates migrations; Flyway applies them). The translation layer (EF C# migrations → Flyway-readable SQL files) re-introduces the `migration.sql` artefact in a different form, plus a new tool-version drift surface. No upside over native EF `Migrate()`. |
  | **(d) Env-var opt-out (`ASPNETCORE_SKIP_DB_MIGRATIONS=true`)** | Re-introduces the polarity bug ADR-0005 already had (`--profile migrate` skip). A forgotten env-var flip in a deployment manifest silently produces a broken stack. The cost saved (re-applying a no-op `Migrate()` call against an up-to-date DB) is sub-second per startup. Not load-bearing. |

- **References.**

  - GitHub issue [#22](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/22) — the triggering requirement.
  - [ADR-0005](./ADR-0005-release-install-migration-actuation.md) — **superseded** by this ADR; the external one-shot model is retired. Body preserved as historical record of the prior decision.
  - [ADR-0006](./ADR-0006-microservices-architecture-with-container-co-location.md) — microservices framing; establishes that `deployment-dashboard-api` is the sole DB writer, which is the structural premise this ADR rests on.
  - [ADR-0002](./ADR-0002-modular-monolith-consolidation.md) — co-location mechanics; one API host = one migration actuator (no per-co-located-service migration step).
  - [ADR-0004](./ADR-0004-opaque-per-progress-reporter-cursor.md) Decision 3 — fetcher `minReplicas == maxReplicas == 1`; cited to disambiguate why the multi-replica safety argument here is API-specific and does not change the fetcher posture.
  - [`docs/architecture.md` § 7](../architecture.md) — SAD compose snippet updated in this commit; the `migrations:` service block is replaced with a note that the API self-migrates on startup.
  - [`docs/ci-cd-pipelines.md` § 7 — EF migration SQL artefact](../ci-cd-pipelines.md) — the now-defunct artefact contract; operational doc rewrite owned by devops-engineer in parallel.
