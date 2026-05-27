---
audience: team-lead-only
load: on-demand
triggers: [auto, automatic-mode, ci-watch]
cap-bytes: 12000
reads-before-applying: []
---

# Automatic mode

**Load-on-demand.**

- `team-lead` fetches this file when activation is detected (`auto:` prefix or PM-proposed-then-user-accepted).
- Default tasks run interactive — do not load this file.

**Effect.**

- For low-risk or self-contained tasks, the lifecycle runs end-to-end without per-phase user gates.
- Presents a single **delivery handoff** at the end.
- Phase 8 user-approval invariant preserved as that one final gate; not waived.

## Activation

**Explicit, per-task only** — never session-wide, never inherited across tasks. Recorded in the orchestrator's plan.

| Trigger | Notes |
|---|---|
| User prefixes the task with `auto:` | |
| User addresses team-lead with `auto` | |
| Team-lead proposes auto for low-risk task AND user confirms ("yes, auto") | Low-risk = docs-only · isolated bug fix in single owned path · mechanical refactor. |

**Never silent** — proposal without explicit yes runs interactively.

## Gates elided

- **Phase 3 design review.** Auto-approved when Phase 2 has no user-visible behaviour change OR user already approved broader direction. Material UX surfaces escalate (§ Forced-interactive triggers).
- **Iteration-protocol per-batch confirmations.** Iterations still run as 3–5 min stoppable batches; orchestrator does not pause between. User may interrupt at any boundary.
- **Per-step "stop and confirm" inside engineers.** Engineers proceed once intermediate state is recorded.

## Gates respected

- **Phase 7 SA review.** Runs normally; automated; no user interaction.
- **Destructive / external actions** (per `core/process.md § Executing actions with care`). Even in auto mode, never without explicit consent: push to shared branches · drop/downgrade deps · modify shared infra · send messages · contact external services. Default delivery handoff does NOT push.
- **Full regression remains opt-in** (`core/process.md § Phase 5`). Auto mode does NOT request it; delivery report records not-run; user may request before accept.
- **Phase 8 user-approval invariant** — preserved as the single delivery handoff.

## Forced-interactive triggers — auto mode falls back to interactive when

| Trigger | Action |
|---|---|
| Phase 2 surfaces a design choice with material user-visible impact (new screen, changed wire shape adopters depend on, new external dependency, NFR-affecting trade-off) | Pause; surface Phase 2 artefacts per Phase 3; resume on approval. |
| Phase 6 fails to resolve the same defect after 2 iteration batches | Pause; surface defect, attempted fixes, proposed next step. |
| A cross-domain integration cycle is required (per `core/protocols/cross-domain-bugs.md`) | Pause; surface integration scope and dispatch plan. |
| A test oracle is found to be wrong (per `core/process.md § Test oracles can be wrong`) | Pause; surface observed vs asserted divergence and oracle-tightening proposal. |
| Token-budget consumed exceeds 1.5× the Phase 4/5 estimate OR wall-clock exceeds 2× the estimate | Pause; surface burn rate; request continue-or-stop. |
| Any planned action enters the "destructive / external" set above | Pause; surface action + reason + alternatives. |
| Change-governance gate hits the prompt branch — `change-governance.prompt-before-create: always`, OR `prompt-before-create: non-trivial` AND the non-trivial heuristic fires (≥ 2 architectural-delta triggers OR register-diff non-empty) | Pause; surface proposed CR / ADR draft + skip-OR-author choice. Resume on explicit answer. Full gate: `core/roles/team-lead.md § CR-gate` · `core/roles/solution-architect.md § ADR-gate`. |

On any trigger: `team-lead` halts dispatch, presents a short interactive-fallback report, resumes auto mode only on explicit user direction.

## Delivery handoff (replaces Phase 8 in auto mode)

State at handoff per resolved mode (`core/protocols/delivery-modes.md`):

| Mode | State |
|---|---|
| 1 (branch + PR) | Commits on `<branch>`; branch NOT yet pushed. |
| 2 (wt) — **auto-mode framework default** | Changes in working tree; nothing committed. |
| 3 (commit-no-push) | Commits on current branch; nothing pushed. |

**Auto-mode default = Mode 2 (`wt`)** — aligns with "nothing committed yet" invariant. Adopter overrides via `delivery.default-mode` or per-task prefix.

**Delivery report shape.** `core/templates/user-response.md § Auto-mode delivery-handoff addendum` — `## Result` · `## What changed` · `## Verification` · `## Next` · `## Delivery state` · `## Accept / Feedback / Reject` · optional `## Notes` ≤ 150 words · marker. Synthesis from cardinal phase-reports per the same template's mapping table.

**Required content:**

- TODO / issue / freeform task addressed.
- Phase 2/4/5 artefact deltas — files touched · contracts changed.
- Change-scoped test results — pass/fail per suite + manual-smoke note.
- SA review sign-off.
- *"Full regression: not run (auto mode). Request before accept if desired."*
- Forced-interactive escalations during run.
- Resolved mode + per-mode state (commit list / wt diff / branch).
- Suggested commit message(s) per `local/bindings.md` (Mode 2 only).
- Schema-bound-return compliance count from the task — `## Notes` line per `core/templates/phase-report.md § Orchestrator behaviour on non-compliant returns`.

| Action | Effect by mode |
|---|---|
| **Accept** | Mode 1 → push branch + `gh pr create` per `core/templates/pr-description.md` (+ `Closes #<N>` for issue-sourced) → **enter CI-watch per `core/protocols/ci-watch.md`** when `ci-watch: enabled`. Mode 2 → commit per suggested message; push only on explicit instruction. Mode 3 → push current branch. Transition TODO `☐` → `☒` / close issue per task source. |
| **Feedback** | User remarks → loop to earlier phase (typically Phase 6) · resume auto toward fresh handoff. |
| **Reject** | Roll back per mode — Mode 1: delete branch + revert · Mode 2: `git checkout -- .` · Mode 3: `git reset --hard HEAD~<N>`. User may re-prompt with adjustments. |

**Invariant.** Auto NEVER pushes / transitions task state without explicit Accept. Mode 2 also never commits without Accept.

**Mode 1 + CI-watch.** After Accept, orchestrator does NOT exit at "PR opened" by default — enters synchronous polling (`ci-watch-policy: poll`, default) + iterate-fix-recheck on attributable failures until all required green OR forced-handback. Adopter switches `async` / `hybrid` / `disabled` via `local/framework.config.yaml § automatic-mode`. Single-delivery-handoff invariant extends to **"CI green"** for `poll`, or "PR opened + watch scheduled" for `async` / `hybrid`.

## Orchestrator duties (team-lead)

`team-lead` is the only role that detects · sustains · exits auto mode. Other specialists operate normally + receive dispatches that skip intermediate user-confirmation pauses.

| Duty | Behaviour |
|---|---|
| Detect activation | See § Activation. Proposal without explicit yes → run interactively. |
| Record the mode | In the task plan so specialists operate without intermediate confirmations. |
| Elide gates | Per § Gates elided. Iterations run as 3–5 min stoppable batches for observability; never pause between. |
| Watch forced-interactive triggers | Halt dispatch · surface short report · ask user to direct · resume only on explicit instruction. |
| Track budget | Estimate Phase 4/5 token + wall-clock at dispatch; record actuals; trip the threshold trigger when crossed. |
| Never push / modify shared state silently | Default delivery handoff produces commits only on explicit Accept; push requires separate explicit instruction. |
| Run delivery handoff at lifecycle end | See § Delivery handoff. Do nothing destructive until the user picks. |

**On Accept** — commit per project convention · push only on explicit instruction · `☐` → `☒` (TODO) / close issue · run post-acceptance doc-optimization hook · **Mode 1 + `ci-watch: enabled`** → enter CI-watch per `core/protocols/ci-watch.md` immediately after `gh pr create`; do NOT exit the turn (default `poll`) until all required green or forced-handback fires; attributable failures loop through Phase 6.

**On Feedback** — loop back to the appropriate earlier phase (typically Phase 6; Phase 4/2 if structural); resume auto toward a fresh handoff.

**On Reject** — roll working tree back to pre-task state; TODO stays `☐`; do not commit the rollback.
