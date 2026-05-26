---
audience: team-lead-only
load: on-demand
triggers: [ci-watch, post-pr, auto]
cap-bytes: 12000
reads-before-applying: []
---

# CI watch — post-PR iterate-fix-recheck loop

Load triggers: Mode 1 finalize in auto mode + `ci-watch: enabled` (framework default) · delivery-handoff Accept that pushes branch + opens PR · specialist Phase 6 fix routed from CI-attributable failure. Default short tasks (Mode 2/3 · `ci-watch: disabled`) do not load.

## Activation

| Resolved mode | `ci-watch` | Action |
|---|---|---|
| Mode 1 (branch + PR) | `enabled` (default) | Enter watch state immediately after `gh pr create`. |
| Mode 1 (branch + PR) | `disabled` | Exit Phase 8 at "PR opened" — previously behaviour. |
| Mode 2 (wt) / Mode 3 (commit-no-push) | any | Not applicable — no PR exists for the orchestrator to watch. |
| Interactive mode (no `auto:`) | any | Not applicable — CI-watch is an automatic-mode extension. |

The four policy variants below apply when CI-watch is active.

## Policies

| Policy | Mechanism | When |
|---|---|---|
| **`poll`** (default) | Synchronous polling + iterate-fix-recheck inside the current turn. | Default fit — keeps orchestrator engaged through the CI cycle. |
| `async` | Exit the turn after `gh pr create`; CI-watch resumes on the user's next prompt (any prompt). Failure handling identical, shifted in time. | Long-running CI that would routinely time out on `poll`. |
| `hybrid` | Synchronous probe for `ci-watch-sync-probe-minutes` (default 3); fall through to `async` if not terminal. | Mixed CI durations — fast paths feel synchronous, slow paths don't block. |
| `disabled` | Skip the entire watch. Phase 8 exits at "PR opened." | Adopters who don't want the framework touching CI. |

`poll` / `async` / `hybrid` share the iterate-fix-recheck loop and the failure-classification rules; only the **wait mechanism** differs.

## Watch state — the polling loop

Entered after `gh pr create` succeeds (or on the resume prompt for `async`).

1. **Discover** check runs with `gh pr checks <N> --json name,state,conclusion,workflow,detailsUrl`.
2. **Poll** every `ci-watch-poll-seconds` (default 20). For `async`, the "poll" is one read per resume prompt — not a sleep loop.
3. **Progress updates** — at most one user-visible "X of Y checks complete" line per minute. No per-poll spam.
4. **Terminal check** every poll:
   - **All green** (per `ci-required-checks`, see § "All green" definition) → § Exit clean.
   - **Any terminal red** → § Failure classification.
   - **Still running + within timeout** → continue.
   - **`ci-watch-timeout-minutes` exceeded** → § Forced-handback triggers.
5. **At most three PR comments per fix cycle:**
   - `"CI watch started"` — once, on entering the loop.
   - `"CI fix pushed (cycle N of M)"` — once per Phase 6 fix.
   - `"CI complete — all green"` — once, on exit-clean.

## Failure classification

Each terminal-red check_run is classified before any auto-fix:

| Class | Heuristic | Action |
|---|---|---|
| **Attributable** | <ul><li>Workflow `paths:` filter overlaps the changeset diff, OR</li><li>Failure log cites a file in the changeset diff, OR</li><li>Test name in the failure cites a test file added / modified in the changeset.</li></ul> | Enter § Iterate-fix-recheck loop. |
| **Flake** | Failure message matches `ci-flake-patterns` (defaults: `runner timed out`, `5\d{2}\s+(Bad Gateway\|Service Unavailable)`, `ECONNRESET`, `Could not resolve host`). Adopter-extensible. | If `ci-auto-retry-flakes: true` (default) AND not yet retried in this cycle → re-run via `gh run rerun --failed`. Otherwise re-classify on next terminal as attributable-or-unattributable. |
| **Unattributable** | Neither attributable nor flake. | § Forced-handback triggers. |

Mixed runs (one attributable + one unattributable) → handback wins — never auto-fix while an unattributable failure is open.

## Iterate-fix-recheck loop

Triggered when first watch cycle returns ≥ 1 attributable (or auto-retried-flake-still-failing-but-attributable) failure:

1. **Phase 6 dispatch** — team-lead reads `gh run view <id> --log-failed`, routes to owning specialist per `local/bindings.md § Project role boundaries` by touched paths + failure category.
2. **Fix commits** on same branch — standard Mode 1 cadence per `core/protocols/delivery-modes.md § Mode 1`.
3. **Push** new commits → fresh CI run on PR.
4. **Re-enter watch state** at step 1 of § Watch state. `gh pr checks` reports latest run; stale results ignored.
5. **Loop terminates** on: all green (§ Exit clean) · `ci-watch-max-fix-cycles` reached (default 3) → handback · same check fails twice consecutively after a fix attempt → handback · forced-interactive trigger fires.

## Forced-handback triggers

Scoped variant of `core/protocols/automatic-mode.md § Forced-interactive triggers`:

| Trigger | Action |
|---|---|
| Failure unattributable to changeset | Surface log verbatim; ask user. |
| Same check fails twice consecutively after fix attempt | Surface before/after diff of failing assertion + new log; ask user. No third Phase 6 for that surface. |
| Flake recurs after one allowed auto-retry | Re-classify; unattributable → hand back. |
| `ci-watch-timeout-minutes` exceeded mid-cycle | Post `"CI still running after N minutes, handing back"`; record stoppable-intermediate-state. |
| `ci-watch-max-fix-cycles` reached (default 3) | Post cumulative fix-cycle log; ask user. |
| User interrupts at any poll boundary | Record state; exit per `core/protocols/iteration-protocol.md § Stoppable intermediate states`. No orphaned watch threads. |
| Token-budget / wall-clock exceeds `automatic-mode.md § Forced-interactive triggers` ceilings | Inherit existing escalation. |

On any trigger: team-lead halts watch · surfaces structured report (last green check · failing check · commits attempted · cycle count) · resumes only on explicit direction.

## Exit clean

All checks reach terminal-green per the `ci-required-checks` policy:

1. Post `"CI complete — all green"` comment on the PR (once).
2. Post Phase 8 follow-up comment on the source issue: `"all checks green — merge when ready."`
3. Mark the task fully delivered in the orchestrator's plan.
4. Exit the watch.

**Never auto-merge.** Merging stays a human decision per `core/process.md § Executing actions with care`.

## "All green" definition (`ci-required-checks`)

| Value | Behaviour |
|---|---|
| `strict` (default) | All check_runs reported by `gh pr checks` must reach `success`. |
| `branch-protection-aware` | Only "required" checks must succeed; reads from `gh api repos/<o>/<r>/branches/<b>/protection`. Non-required checks reported but don't gate exit-clean. |

## Configuration

All keys under `local/framework.config.yaml § automatic-mode`; full keys + defaults in the template. Schema: `ci-watch` (`enabled`/`disabled`) · `ci-watch-policy` (`poll`/`async`/`hybrid`) · `ci-watch-poll-seconds` (20) · `ci-watch-timeout-minutes` (15) · `ci-watch-sync-probe-minutes` (3; hybrid only) · `ci-watch-max-fix-cycles` (3) · `ci-required-checks` (`strict`/`branch-protection-aware`) · `ci-auto-retry-flakes` (true) · `ci-flake-patterns` (adopter-extensible).

## Cross-cutting invariants

- **Latest run only.** `gh pr checks` always reports the latest CI run for the PR. Stale check_run results from prior pushes never influence the verdict.
- **Never modify the PR description silently** mid-watch. Optional `## CI status` placeholder in `core/templates/pr-description.md` is updated only on exit-clean or final handback.
- **Never auto-merge, never auto-approve, never auto-dismiss reviews.** All human decisions.
- **Never edit the changeset to make a flake pass.** Flakes are surfaced, retried once, then escalated.
- **Never federate watches across PRs.** One PR per task per `core/protocols/delivery-modes.md § Out of scope`.

