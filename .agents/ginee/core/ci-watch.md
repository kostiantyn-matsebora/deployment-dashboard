# CI watch — post-PR iterate-fix-recheck loop

**Load-on-demand.** Fetched when:

- `team-lead` runs the Mode 1 finalize procedure in automatic mode AND `automatic-mode.ci-watch` is `enabled` (the framework default).
- `team-lead` is the orchestrator at a delivery-handoff Accept that pushes a branch + opens a PR.
- A specialist's Phase 6 fix is dispatched from a CI-attributable failure (specialist reads this file's § Failure classification).

Default short tasks (Mode 2 / Mode 3 / `ci-watch: disabled`) do not load this file.

## Why

Per `core/automatic-mode.md`, auto-mode's invariant is to minimize user intervention. Without this spec, Mode 1 finalize stops at `gh pr create` — CI red after push lands as a fresh human prompt instead of an orchestrator dispatch. CI-watch extends the **single delivery handoff** through to "CI green," running an iterate-fix-recheck loop for attributable failures.

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

Triggered when the first watch cycle returns ≥ 1 attributable (or auto-retried-flake-still-failing-but-attributable) failure.

1. **Phase 6 dispatch.** `team-lead` reads the failing run log (`gh run view <id> --log-failed`), routes to the owning specialist per `local/bindings.md § Project role boundaries` based on touched paths + failure category.
2. **Fix commits** land on the same branch — standard Mode 1 commit cadence per `core/delivery-modes.md § Mode 1`.
3. **Push** the new commits — triggers a fresh CI run on the PR.
4. **Re-enter watch state** at step 1 of § Watch state. `gh pr checks` reports the latest run by design; stale check_run results are ignored.
5. **Loop terminates** on one of:
   - All green → § Exit clean.
   - `ci-watch-max-fix-cycles` reached (default 3) → § Forced-handback triggers.
   - Same check fails twice in consecutive cycles after a fix attempt → § Forced-handback triggers.
   - Forced-interactive trigger fires (see below).

## Forced-handback triggers

Same structural rule as `core/automatic-mode.md § Forced-interactive triggers`, scoped to CI-watch:

| Trigger | Action |
|---|---|
| Failure unattributable to the changeset | Surface failure log verbatim; ask user to direct. |
| Same check fails twice in consecutive cycles after a fix attempt | Surface before/after diff of the failing assertion + new failure log; ask user to direct. No third Phase 6 for that surface. |
| Flake-classified failure recurs after the one allowed auto-retry | Treat as attributable / unattributable per heuristic; if unattributable, hand back. |
| `ci-watch-timeout-minutes` exceeded mid-cycle | Post "CI still running after N minutes, handing back" comment; record stoppable-intermediate-state. |
| `ci-watch-max-fix-cycles` reached (default 3) | Post cumulative fix-cycle log; ask user to direct. |
| User interrupts at any poll boundary | Record state; exit per `core/protocols/iteration-protocol.md § Stoppable intermediate states`. No orphaned watch threads. |
| Token-budget / wall-clock thresholds exceed `core/automatic-mode.md § Forced-interactive triggers` ceilings | Inherit existing escalation. |

On any trigger: `team-lead` halts the watch, surfaces a structured report (last green check / failing check / commits attempted / cycle count), resumes auto mode only on explicit user direction.

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

## Configuration keys

All under `local/framework.config.yaml § automatic-mode`:

```yaml
automatic-mode:
  ci-watch: enabled                       # enabled | disabled
  ci-watch-policy: poll                   # poll | async | hybrid
  ci-watch-poll-seconds: 20               # poll interval (poll / hybrid sync phase only)
  ci-watch-timeout-minutes: 15            # max wall-clock per cycle
  ci-watch-sync-probe-minutes: 3          # hybrid: synchronous probe duration
  ci-watch-max-fix-cycles: 3              # cap on iterate-fix-recheck cycles
  ci-required-checks: strict              # strict | branch-protection-aware
  ci-auto-retry-flakes: true              # rerun-failed once per cycle on flake-pattern match
  ci-flake-patterns:                      # adopter-extensible; merged with defaults
    - "<additional regex>"
```

All keys optional — framework defaults shown.

## Cross-cutting invariants

- **Latest run only.** `gh pr checks` always reports the latest CI run for the PR. Stale check_run results from prior pushes never influence the verdict.
- **Never modify the PR description silently** mid-watch. Optional `## CI status` placeholder in `core/templates/pr-description.md` is updated only on exit-clean or final handback.
- **Never auto-merge, never auto-approve, never auto-dismiss reviews.** All human decisions.
- **Never edit the changeset to make a flake pass.** Flakes are surfaced, retried once, then escalated.
- **Never federate watches across PRs.** One PR per task per `core/delivery-modes.md § Out of scope`.

## Out of scope

- Auto-merging the PR after all-green.
- Approving / dismissing reviews.
- Direct support for non-GitHub hosts (GitLab / Bitbucket / Gitea ship as their own framework features).
- Mocking CI for unit-testing the watcher itself.
- Automatic branch deletion after merge — adopter / git-host owns.
- Cross-PR coordination ("wait for this PR before opening the next").
- Modifying the changeset to mask a flake.

## References

- `core/automatic-mode.md § Delivery handoff` — Accept action calls into this spec for Mode 1.
- `core/delivery-modes.md § Mode 1` — finalize procedure references this spec as a post-`gh pr create` step.
- `core/github-integration.md § PR linkage` — describes the comment surfaces this spec writes to.
- `core/protocols/iteration-protocol.md § Stoppable intermediate states` — interrupt contract.
- `core/process.md § Phase 6 — Bug fixing` — where attributable failures route.
- `core/process.md § Executing actions with care` — never-auto-merge invariant.
