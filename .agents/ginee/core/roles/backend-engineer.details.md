# Backend Engineer — Domain Elaboration

Companion to `core/roles/backend-engineer.md`. The kernel file holds normative rules; this file holds elaboration, patterns, and stack-specific guidance.

## Workspace layout

Tree + dependency rules: `local/bindings.md` → "Repository structure" → server tier. Generic invariants:

- Executable / deployable host(s) and library projects are separated as the architecture mandates.
  - Don't conflate them.
- Cross-tier shared code lives in a `shared/` (or equivalent) tier.
  - Do not import from one feature library into another.
- Auth / API-key / authz middleware:
  - Applied at composition time at the host boundary.
  - On the specific endpoint groups the architecture doc names.
  - Never global when the architecture says scoped; never scoped when the architecture says global.
- Unit tests live alongside their source project.

## Declarative configuration — backend specifics

Per `core/process.md` § Configuration vs. data:

- Configuration → app-settings / env-files / environment variables.
  - Never as string literals inside controllers, services, or middleware.
- Hosted-service defaults (e.g. retention windows) come from configuration.
  - Single explicit default at the binding site.
  - Not hardcoded fallbacks scattered through code.
- Test fixtures and expected data live in declarative resources. Examples:
  - `*.json` test resources
  - data-driven test rows derived from a documented source
  - No inline literals when the source is a documented fixture file.
- "For production X, for dev Y" inside source code is a configuration concern — push into config files or env vars.

## Stack — generic rules

Canonical stack: `local/bindings.md` → "Stack". The specific language, web framework, ORM, database, and realtime mechanism are project-specific. Generic invariants:

| Concern | Rule |
|---|---|
| Web framework | Whatever `local/bindings.md` records. Do not introduce a parallel framework. |
| ORM / persistence | Whatever `local/bindings.md` records. Honour migration conventions. |
| Storage for unit tests | Whatever `local/bindings.md` records (in-memory, embedded, or Testcontainers). |
| Auth on writes | Per architecture-doc § Security. |
| Container port | Per `local/bindings.md`. |

Do NOT introduce (unless the architecture doc mandates):

- In-memory event buses.
- Caching layers.
- Mapper libraries.
- Validation libraries when built-ins suffice.
- Any cloud-proprietary SDK that breaks platform agnosticism.

## Network topology — what the service serves

Read `local/bindings.md` → "Network topology" for project specifics. Common patterns:

- Service serves wire data (JSON / RPC) only.
  - No static-asset middleware.
  - No SPA fallback route.
  - Client SPA ships in its own container behind the same gateway.
- Service container is **internal-only** in dev/prod orchestration.
  - Reached exclusively via a reverse-proxy / gateway.
  - No CORS headers if the project is single-origin via gateway.
- Adjust per project: if the project hosts the SPA inside the service, the architecture doc says so and the rules above do not apply.

## Coverage tooling — per-stack invocation (D19)

Per `backend-engineer.md § Coverage obligation`. The framework does not mandate a specific tool; pick the stack-native one and wire it into `local/framework.config.yaml § unit-backend.runner`:

| Stack | Tool | Invocation example |
|---|---|---|
| .NET | `coverlet` (built-in to `dotnet test`) | `dotnet test --collect:"XPlat Code Coverage"` + `reportgenerator` |
| Node / TS | `jest --coverage` / `vitest --coverage` | `npm test -- --coverage` |
| Python | `pytest-cov` | `pytest --cov=<pkg> --cov-report=term --cov-fail-under=90` |
| Go | native `go test -cover` | `go test -cover -coverprofile=cover.out ./...` |
| Java | `jacoco` | Gradle / Maven plugin per project |
| Ruby | `simplecov` | `require 'simplecov'; SimpleCov.start` |
| Rust | `cargo-llvm-cov` | `cargo llvm-cov --fail-under-lines 90` |

**Coverage on changed + added lines** (not whole-repo):

- Most tools report per-file/per-line. Use the PR-diff intersection — many CI providers (Codecov, Coveralls) ship a "patch coverage" view that does this directly.
- Locally, run the runner with coverage enabled and inspect the output for changed files (`git diff --name-only origin/main...HEAD`).
- A 1-line change either hits 100% (covered) or 0% (not) — no special handling needed; the rule degrades naturally.

**No-tooling fallback flow:**

1. Engineer detects no coverage tool wired (no `unit-backend.runner` declared, or runner exists but reports no coverage).
2. Stop the iteration; surface to `team-lead` as a discovery gap.
3. `team-lead` files a one-shot backfill task: wire the tool + add `coverage-threshold` to `local/framework.config.yaml` + verify CI invokes the same runner.
4. Once the backfill lands, the engineer resumes the original task under the now-enforceable threshold.

## Real-time path (when the project has one)

Generic shape (adapt to the project's specific mechanism):

1. After a successful write commit, publish a notification — never before commit.
2. Read side opens a long-lived subscription to the broker via a dedicated connection (not from the request-scoped pool).
3. Realtime writer formats per the architecture-doc event-format section.
   - Honour resume-token / replay semantics.
   - A small in-memory ring buffer for best-effort replay is acceptable when the broker doesn't replay.
