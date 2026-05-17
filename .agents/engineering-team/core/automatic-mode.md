# Automatic mode

**Load-on-demand.**

- `project-manager` fetches this file when activation is detected (`auto:` prefix or PM-proposed-then-user-accepted).
- Default tasks run interactive — do not load this file.

**Effect.**

- For low-risk or self-contained tasks, the lifecycle runs end-to-end without per-phase user gates.
- Presents a single **delivery handoff** at the end.
- Phase 8 user-approval invariant preserved as that one final gate; not waived.

## Activation

- **Explicit, per-task only.**
  - Never session-wide.
  - Never inherited across tasks.
- **Triggers:**
  - User prefixes the task with `auto:`.
  - User addresses `project-manager` with `auto`.
  - `project-manager` proposes auto mode for a low-risk task AND user replies "yes, auto" or equivalent.
    - **Low-risk** = docs-only edit, isolated bug fix in a single owned path, mechanical refactor.
- **Never silent.** Orchestrator never enters auto mode without one of the triggers above.
- Recorded in orchestrator's plan for that task.

## Gates elided in auto mode

- **Phase 3 — Design review.**
  - Auto-approved when Phase 2 produces no user-visible behaviour change.
  - OR when the user already approved the broader direction.
  - Material UX surfaces still escalate (see § Forced-interactive triggers).
- **Iteration-protocol intermediate-batch user confirmations.**
  - Iterations still run as 3–5 min stoppable batches.
  - Orchestrator does NOT pause between batches.
  - User may interrupt at any time; next batch boundary is the safe stop.
- **Per-step "stop and confirm" pauses inside engineers.**
  - Engineers proceed once the iteration's intermediate state is recorded.

## Gates still respected in auto mode

- **Phase 7 — SA review.**
  - Runs as normal.
  - Automated; no user interaction required.
- **Destructive / external actions** (per "Executing actions with care" guidance in project-instruction files). Even in auto mode, do NOT do any of these without explicit consent:
  - Push to shared branches.
  - Drop or downgrade dependencies.
  - Modify shared infrastructure.
  - Send messages.
  - Contact external services.
  - Default delivery handoff does NOT push.
- **Full regression remains opt-in** (per `core/process.md § Phase 5`).
  - Auto mode does NOT request it.
  - Delivery report records that full regression was not run.
  - User may request it before accept.
- **Phase 8 user-approval invariant** — preserved as the single delivery handoff at the end.

## Forced-interactive triggers — auto mode falls back to interactive when

| Trigger | Action |
|---|---|
| Phase 2 surfaces a design choice with material user-visible impact (new screen, changed wire shape adopters depend on, new external dependency, NFR-affecting trade-off) | Pause; surface Phase 2 artefacts per Phase 3; resume on approval. |
| Phase 6 fails to resolve the same defect after 2 iteration batches | Pause; surface defect, attempted fixes, proposed next step. |
| A cross-domain integration cycle is required (per `core/cross-domain-bugs.md`) | Pause; surface integration scope and dispatch plan. |
| A test oracle is found to be wrong (per `core/process.md § Test oracles can be wrong`) | Pause; surface observed vs asserted divergence and oracle-tightening proposal. |
| Token-budget consumed exceeds 1.5× the Phase 4/5 estimate OR wall-clock exceeds 2× the estimate | Pause; surface burn rate; request continue-or-stop. |
| Any planned action enters the "destructive / external" set above | Pause; surface action + reason + alternatives. |

On any trigger: `project-manager` halts dispatch, presents a short interactive-fallback report, resumes auto mode only on explicit user direction.

## Delivery handoff (replaces Phase 8 in auto mode)

- **Working-tree / branch state at handoff** — depends on the resolved delivery mode (per `core/delivery-modes.md`):

  | Resolved mode | State at handoff |
  |---|---|
  | Mode 1 (branch + PR) | Commits already on `<branch>`; branch NOT yet pushed. |
  | Mode 2 (wt) — **auto-mode framework default** | All changes in working tree; nothing committed. |
  | Mode 3 (commit-no-push) | Commits already on current branch; nothing pushed. |

- **Auto-mode default = Mode 2 (`wt`).** Aligns with the "nothing committed yet" invariant. Adopter can override via `local/framework.config.yaml § delivery.default-mode` or per-task prefix.
- `project-manager` produces a **delivery report**:
  - TODO line(s) / issue / freeform task addressed.
  - Phase 2 / 4 / 5 artefact deltas (files touched, contracts changed).
  - Change-scoped test results (pass/fail per suite, manual-smoke note).
  - SA review sign-off.
  - "Full regression: not run (auto mode). Request before accept if desired."
  - Any forced-interactive escalations during the run.
  - Resolved delivery mode + per-mode state (commit list / working-tree diff / branch name).
  - Suggested commit message(s) per project's commit convention from `local/bindings.md` (Mode 2 only — already committed for Modes 1 and 3).
- `project-manager` presents three actions:

  | Action | Effect (branches by resolved mode) |
  |---|---|
  | **Accept** | Mode 1 → push branch + open PR per `core/templates/pr-description.md` (+ `Closes #<N>` for issue-sourced). Mode 2 → commit per suggested message; push only if user says push. Mode 3 → push current branch. Transition TODO `☐` → `☒` / close issue per task source. |
  | **Feedback** | User supplies remarks; loop back to the relevant earlier phase (typically Phase 6); resume auto mode toward a fresh delivery handoff. |
  | **Reject** | Roll back per mode — Mode 1: delete branch + revert; Mode 2: `git checkout -- .`; Mode 3: `git reset --hard HEAD~<N>`. User may re-prompt with adjustments. |

- **Invariant.** Auto mode NEVER pushes or transitions task state without the user's explicit Accept at this gate. Mode 2 also never commits without Accept.

## Orchestrator duties (project-manager)

- **Who runs auto mode.**
  - `project-manager` is the only role that detects, sustains, and exits auto mode.
  - Other specialists operate normally; they receive dispatches that skip intermediate user-confirmation pauses.
- **Detect activation.**
  - User prefixed the task with `auto:`, OR
  - User addressed `project-manager` with `auto`, OR
  - PM proposed auto mode AND user said yes.
    - Low-risk = docs-only, isolated bug fix in a single owned path, mechanical refactor.
  - **Never silent.** Proposal without explicit yes → run the task interactively.
- **Record the mode** in the task plan so dispatched specialists operate without intermediate user confirmations.
- **Elide the gates** listed in § Gates elided in auto mode.
  - Iterations still run as 3–5 min stoppable batches for observability.
  - Do NOT wait for user review between batches.
- **Watch the forced-interactive triggers** (see § Forced-interactive triggers). On any trigger:
  1. Halt dispatch.
  2. Surface a short report.
  3. Ask the user to direct.
  4. Resume auto mode only on explicit instruction.
- **Track budget.**
  1. Estimate Phase 4/5 token + wall-clock at dispatch.
  2. Record actuals.
  3. Trip the threshold trigger when crossed.
- **Never push, never modify shared state silently.**
  - Default delivery handoff produces commits only on explicit Accept.
  - Pushing requires a separate explicit user instruction.
  - Auto mode is not a license to bypass "Executing actions with care".
- **Run the delivery handoff** (see § Delivery handoff) when the lifecycle completes. Do nothing destructive until the user picks.
- **On Accept:**
  1. Commit per project convention.
  2. Push only on explicit user instruction.
  3. Transition the TODO `☐` → `☒`.
  4. Run the post-acceptance doc-optimization hook as usual.
- **On Feedback:**
  - Loop back to the appropriate earlier phase (typically Phase 6; occasionally Phase 4 or 2 if the remark is structural).
  - Resume auto mode toward a fresh delivery handoff.
- **On Reject:**
  - Roll the working tree back to pre-task state.
  - The TODO stays `☐`.
  - Do not commit the rollback.
