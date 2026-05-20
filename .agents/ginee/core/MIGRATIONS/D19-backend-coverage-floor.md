# Migration — D19: Backend coverage floor

**Target release:** next minor after 2026-05-19 (`core/VERSION` → `0.2.0`).
**Affected adopters:** every adopter project with a backend tier.
**Closes:** [#29](https://github.com/kostiantyn-matsebora/ginee/issues/29).

## What changed

Every changed or added backend source file must be covered by unit tests at **≥ `unit-backend.coverage-threshold` line coverage on the changed + added line set** (framework default `90`, adopter-configurable). Tests are executed and pass via the project's backend unit-test runner before the engineer reports the iteration complete.

Authorship rule:

| Aspect | Rule |
|---|---|
| Scope | Changed + added lines only (not whole-repo / whole-file). |
| Floor | `local/framework.config.yaml § unit-backend.coverage-threshold` (default `90`). |
| Ordering | Functionality-first: behavioural paths → error / status-code branches → edge / boundary → wiring last (smoke-only). |
| Exemptions | DTOs / records / pure data types; generated code; configuration-binding classes. |
| Waiver | SA may grant a per-task waiver documented in the PR description for mechanical / infrastructure-adjacent / baseline-matching changes. Never silent; never retroactive. |
| Gate | Failed run / sub-threshold coverage = stoppable intermediate state per `core/iteration-protocol.md`. |

## Modified

- `core/roles/backend-engineer.md` — new `## Coverage obligation` section after `## Testing` with threshold, functionality-first ordering, exemptions, SA waiver, no-tooling fallback.
- `core/roles/backend-engineer.details.md` — new `## Coverage tooling — per-stack invocation` section with per-stack tool + invocation table + changed-lines measurement guidance + no-tooling fallback flow.
- `core/templates/framework.config.yaml` — new `unit-backend:` block (`runner`, `coverage-threshold`).

## Action required

### Adopters

After re-fetching framework files on upgrade:

1. **Wire `unit-backend:` in `local/framework.config.yaml`:**
   ```yaml
   unit-backend:
     runner: <stack-native test+coverage command>
     coverage-threshold: 90    # framework default; lower temporarily for catch-up
   ```
   Stack-native examples:

   | Stack | Runner |
   |---|---|
   | .NET | `dotnet test --collect:"XPlat Code Coverage"` |
   | Node / TS | `npm test -- --coverage` |
   | Python | `pytest --cov=<pkg> --cov-fail-under=90` |
   | Go | `go test -cover ./...` |
   | Java | Gradle / Maven `jacoco` plugin task |
   | Ruby | `simplecov` (rspec wrapper) |
   | Rust | `cargo llvm-cov --fail-under-lines 90` |
2. **Wire the same gate into CI** — local + CI invoke the same runner with the same threshold. No duplicate CI-only implementation.
3. **Optional baseline survey** — if the existing project is below threshold, decide between:
   - Raise the project to ≥ 90 in a backfill task (preferred where feasible).
   - Lower the threshold temporarily to the current baseline (visible in `local/framework.config.yaml`, reviewable in PR). Raise as backfill lands.
4. **Add a "Coverage waivers" section to the PR template** when adopters routinely need waivers — keeps the audit trail one-click.

## Backward compatibility

- **Soft break.** Adopters whose baseline is below threshold start the next backend task with a coverage debt. Mitigations:
  - **Grandfather.** Rule applies only to changed + added lines.
  - **Threshold lower.** Temporarily set `unit-backend.coverage-threshold` below 90 — visible in PR.
  - **SA waiver.** Per-task waivers for infrastructure-adjacent / mechanical changes.
- **No-tooling escape valve.** Adopters without a coverage tool configured surface this as a discovery gap to `team-lead`; adopter wires the runner via a one-shot backfill task before the next backend change. Rule never silently lowers the bar.

## Rationale

Pre-D19, `backend-engineer.md § Testing` was qualitative ("cover every documented UI state and every documented status code") — no objective gate, no "run and pass" obligation. Handlers shipped with happy-path-only coverage; tests were authored but never executed; SA reviews spent budget on "did you actually run the unit tests?" round-trips that the engineer should have closed in Phase 4.

**Option B** chosen (per the issue owner's comment) — hard threshold + SA waiver escape hatch. Option A (no waiver) is too brittle for mechanical / DI changes; Option C (tiered by code category) is too prescriptive and doesn't map across adopter layering.

**DTO exemption** (also per the issue comment) — coverage chasing on pure data types delivers no test value and dilutes the metric. Same principle applies to generated code and option-binding classes; integration tests cover those surfaces.

**Functionality-first ordering** is the safeguard against the failure mode coverage thresholds usually create: tests that exercise getters and DI wiring to hit the number while leaving real logic shallow.
