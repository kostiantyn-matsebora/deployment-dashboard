# Migration — D20: Automatic mode post-PR CI watch

**Target release:** next minor after 2026-05-19 (`core/VERSION` → `0.3.0`).
**Affected adopters:** every adopter project that uses automatic mode with Mode 1 delivery (branch + PR).
**Closes:** [#34](https://github.com/kostiantyn-matsebora/ginee/issues/34).

## What changed

Automatic mode + Mode 1 no longer exits at `gh pr create`. With `automatic-mode.ci-watch: enabled` (the framework default), `team-lead` enters a CI-watch state per `core/ci-watch.md` and runs an iterate-fix-recheck loop on attributable failures until all required checks are green or a forced-handback trigger fires.

| Aspect | Behaviour |
|---|---|
| Default policy | `poll` — synchronous polling inside the current turn. |
| Iterate-fix-recheck | Active for `poll` / `async` / `hybrid`; skipped for `disabled`. |
| Loop cap | `ci-watch-max-fix-cycles` (default `3`). |
| Per-cycle timeout | `ci-watch-timeout-minutes` (default `15`). |
| "All green" rule | `ci-required-checks: strict` (default) or `branch-protection-aware`. |
| Flake retry | One auto-rerun per cycle when `ci-auto-retry-flakes: true` (default) AND failure matches `ci-flake-patterns`. |
| Auto-merge | Never. Merging stays human. |

## Modified

- `core/ci-watch.md` (new) — full spec: activation, policies, watch loop, classification, iterate-fix-recheck, forced-handback, exit-clean, config-key reference.
- `core/automatic-mode.md` — § Delivery handoff Accept row + § Orchestrator-duties Accept step reference the new spec for Mode 1 + `ci-watch: enabled`.
- `core/delivery-modes.md` — § Mode 1 Phase-8 finalize gains a step 5 ("enter CI-watch"); § Auto-mode integration table reflects the same.
- `core/github-integration.md` — § PR linkage describes the post-create watch and the three permitted PR-comment surfaces.
- `core/roles/team-lead.md` — § Automatic mode adds a step 3 for CI-watch.
- `core/templates/framework.config.yaml` — new `automatic-mode:` block with all `ci-watch-*` knobs.
- `core/templates/pr-description.md` — optional `## CI status` placeholder section.

## Action required

### Adopters

After re-fetching framework files on upgrade:

1. **Decide whether to opt out.** Default is `ci-watch: enabled, ci-watch-policy: poll` — this changes the auto-mode flow visibly (orchestrator stays engaged through CI). To preserve pre-D20 behaviour exactly, set in `local/framework.config.yaml`:
   ```yaml
   automatic-mode:
     ci-watch: disabled
   ```
2. **Tune CI duration vs. policy choice.**

   | Adopter situation | Recommended config |
   |---|---|
   | CI < 5 min, single workflow | Defaults — `poll`, 20-second polling, 15-min timeout. |
   | CI 5–15 min, multiple workflows | `poll` with `ci-watch-timeout-minutes: 30`. |
   | CI > 15 min or flaky | `hybrid` with `ci-watch-sync-probe-minutes: 3`. |
   | CI lives outside GitHub | `ci-watch: disabled`. |

3. **Extend flake patterns** if your CI fails on adopter-specific transient patterns. Add to `ci-flake-patterns:` — your patterns merge with the framework defaults.

4. **Set `ci-required-checks: branch-protection-aware`** when your repo has optional / experimental checks that should not block CI-watch exit. Default `strict` requires every reported check green.

5. **Adopt the `## CI status` placeholder** in the PR description template (if you maintain a project-specific overlay of `core/templates/pr-description.md`). The watcher updates it only on exit-clean or final handback — never mid-cycle.

## Backward compatibility

- **Soft break.** Existing adopters using auto mode + Mode 1 will see CI-watch start automatically after the next upgrade. Three options to address before merge:
  - **Accept the change** — observe the watch on the next PR; tune thresholds based on real CI timing.
  - **Opt out** — set `automatic-mode.ci-watch: disabled` to preserve pre-D20 behaviour exactly.
  - **Slow-roll** — set `ci-watch-policy: async` so the watch resumes on the next prompt rather than blocking the current turn.
- **Interactive mode unchanged.** D20 applies only to auto mode + Mode 1. Interactive mode still exits Phase 8 at the user's Accept after `gh pr create`.
- **Mode 2 / Mode 3 unchanged.** No PR exists for the watcher to track.

## Rationale

Pre-D20, the recurring symptom across adopter projects was: PR lands → CI red → user opens new turn pasting the log → orchestrator finally does Phase 6. The five minutes of human triage was exactly the per-iteration confirmation cadence automatic mode was designed to eliminate. The orchestrator already had the context to read the failing workflow log, attribute the failure, and route to Phase 6 — it just stopped one step too early.

The four policies cover the real adopter axes:

- `poll` is the default because it best honours the "single delivery handoff" invariant for typical CI durations.
- `async` exists because long-running CI on `poll` routinely hits `ci-watch-timeout-minutes`.
- `hybrid` exists because real adopters have mixed CI durations on the same PR.
- `disabled` exists because some adopters run CI outside GitHub or have policies forbidding agent-driven retries.

Auto-merge stays out of scope on purpose — per `core/process.md § Executing actions with care`, merging is irreversible from the agent's perspective and stays human.
