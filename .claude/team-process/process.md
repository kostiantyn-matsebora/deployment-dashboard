# Orchestration Process

One **orchestrator** routes a multi-layer change across role-specialists. Project-agnostic.
Pairs with [`roles/`](roles/). Every role inherits two companions:

- [`protocol.md`](protocol.md) — typed communication forms.
- [`guardrails.md`](guardrails.md) — standing guardrails + tool-output economy.

## Routing

The main loop **orchestrates** — plans, sequences, synthesizes returns; no separate lead agent (orchestration is a mode). Route each change to its owning role:

| Change | Role |
|---|---|
| Contract / API shape (endpoint, verb, payload, wire format) | [`contract`](roles/contract.md) |
| Server-side / backend code | [`backend`](roles/backend.md) |
| Frontend / SPA / UI | [`frontend`](roles/frontend.md) |
| CI/CD, containers, release, IaC | [`infrastructure`](roles/infrastructure.md) |
| Tests + verification | [`testing`](roles/testing.md) |
| Markdown docs / indexes / sources-of-truth | [`docs`](roles/docs.md) |
| Plan, dispatch, integrate, ship | [`orchestrator`](roles/orchestrator.md) |

## Rules

- **Surface before launch.** Present the dispatch plan (roles + scope) before starting;
  for N parallel members, get explicit confirmation.
- **Parallelize only disjoint lanes.** Serialize coupled/shared-file edits, or isolate
  them in separate worktrees — avoid index contention.
- **The orchestrator does not edit lane files** — delegation is the default, not a judgment
  call. See *Delegate by default* below.

## Delegate by default — the orchestrator does not edit lane files

**Test: lane membership, not size** — inline edits apply a bar the lead does not hold and pull raw diffs into the lead's longest-lived context.

- **Lead edits only:** run ledger / plan / lane map (orchestration state); typed-form messages (`BRIEF` / `FIX`); conversational replies.
- **Anything in a role's lane → delegate.** Backend / frontend / infra / contract / tests / docs — *even a one-line change.* Small changes still carry the role's full bar; the lead cannot apply it.
- **Trigger.** About to call `Edit` / `Write` on a lane file? That is the dispatch signal — emit a `BRIEF`.
- **Chat-turn re-entry.** A turn that resolves into a lane change re-enters the dispatch loop — don't continue "in flow." Resolution → `BRIEF`.
- **Autonomy ≠ inline.** Autonomy waives the *wait*, not the *delegation* — dispatch faster, not do-it-yourself.
- **Context economy.** Lane edits out of the lead's context = stable prefix, prompt-cacheable, low long-session cost (→ *Single-integrator model*).

## Execution modes

Roles + guardrails identical across modes — only substrate differs. Full matrix + runtime bindings: [`execution-modes.md`](execution-modes.md).

- **Default flow unchanged** — teams never replace it; opt-in escalation only.
- **In-session subagents** *(default)* — owning role as in-session subagent; reports back. Most work.
- **Spawned team** *(opt-in)* — role members as separate coordinated sessions; lead integrates. ≥3 layers sharing a contract.
- **Mode is sticky — no silent downgrade:**
  - Substrate chosen at launch holds for the whole run.
  - Need to change? Surface as a decision — never slide back to in-session subagents silently.

## Session state & resume

`.team-process/sessions/<id>/` — gitignored; `<id>` = sanitized session/team name (set at `-SetMarker`); survives boundaries/reboots; concurrent runs coexist as distinct dirs.

- **Contents.** `session.json` (durable record = run ledger), `inbox/` (orch→member `BRIEF`/`FIX`), `outbox/` (member hand-backs).
- **Id.** Sanitized `-SetMarker -Team` name. Re-running `-SetMarker` with the same id **merges** (resume path, not fresh). Fresh start: `-EndSession -Id <id>` before `-SetMarker`; omit `-Id` to abandon all.
- **Lifecycle is explicit, not hook-driven.** `TeamCreate`/`TeamDelete` were removed from Claude Code (2.1.178); the lead opens the run with `Invoke-TeamModeGuard.ps1 -SetMarker` and closes it with `-EndSession`. Members run as **background Agents** (`run_in_background: true`), addressed via `SendMessage`.
- **Team mode active** whenever any session record exists — blocks foreground in-session `Agent`/`Task` spawns (a member is recognized by `run_in_background`, or `team_name` for back-compat). Spans reboots. Legacy single-file `session.json` read for back-compat.
- **Workflow classifier.** `workflow`: `feature-team` (follows phase enum) | `freeform` (free-form phase string).
- **Run ledger = `session.json`.** Orchestrator enriches it (roster · phase · per-wave changed/decided/deferred). Shape: [`schemas/session.schema.json`](schemas/session.schema.json).
- **Lanes = generated projection.** `roster[].lane` → `lane` field (read by lane guard). Never hand-maintain. Sync: `Invoke-TeamModeGuard.ps1 -SyncLane -Id <id> -Role <role>`.
- **SessionStart reminds, never wipes.** Injects resume summary of every active run (id · workflow · branch · phase · summary · agents · decisions) — lead re-attaches without re-reading transcript.
- **Match work to existing run — propose resume, never fork.** Before `/feature-team` or "work on X":
  - **Issue (#number):** `Invoke-TeamModeGuard.ps1 -FindSession -Issue <ref>` — non-empty result = propose resume.
  - **Informal:** match against `summary` in SessionStart reminder; plausible match → propose resume.
- **Resume.** Reboot kills live members; re-run `-SetMarker` (merges the record) + re-spawn the in-flight wave's background Agents from the ledger — ledger is durable truth, live members rebuilt from it.
- **Abandon.** `Invoke-TeamModeGuard.ps1 -EndSession -Id <id>` (omit `-Id` for all).

## Decision record — capture, surface, publish

Decisions captured as they happen · surfaced on every resume · published to the issue at ship — shape: [`schemas/session.schema.json`](schemas/session.schema.json) (`acceptance` · `decisions[]` · `roster[].progress`).

- **Capture at the moment.** On user confirmation, answered question, resolved `FINDING`, or `RESULT.notes` design choice — append `decisions[]`: `{id, decision, why, supersedes, status, refs}`.
  - **`supersedes` mandatory** when overriding issue text / earlier plan / spec line — prevents silent re-loss.
  - **`refs` point at the artifact** (mockup SHA, contract anchor) — artifact is truth above any prose summary.
  - Acceptance criteria at intake → `acceptance` (locked contract + gate).
- **Record AUTHORITATIVE over conversation summary.** After compaction: re-read decisions first; decision wins over summary. `SessionStart` surfaces decisions + member status inline (content, not counts).
- **Per-member resume.** `roster[]` carries `status` + `progress`. Resume re-dispatches member with its `BRIEF` + `progress` + relevant decisions — continues, not restarts.
- **Publish at ship (issue mode).** `Update-IssueDecisionRecord.ps1` upserts a managed comment (idempotent, never clobbers body). Confirm-first: `-DryRun` → show user → post on approval.

## Autonomy

Autonomy = licence over **effort**, not over the **merge gate**.

- **Grants.** Dispatch, integrate, iterate, drive CI green across every wave — no per-wave or plan-confirm approval pause.
- **Still surfaces.** Plan + each wave's intent emitted to transcript; never hidden. User can interject at any point.
- **Withholds the merge gate.** End-state = **PR open + CI green + awaiting user acceptance**. Never merged to default branch; never disbanded at PR-open.
- **Only autonomous push to default branch** = user-ordered revert.
- **Done** = user-accepted AND merged AND default branch green — autonomy never advances this. See [`guardrails.md`](guardrails.md).

## Single-integrator model

One orchestrator (sole integration/commit gate): members produce in-lane; orchestrator reviews, reconciles, commits, ships.

- **Hub-and-spoke.** Members report to orchestrator; it holds the plan + merge.
- **Peer-to-peer only for contract negotiation.** `contract` role settles an interface directly with consumers → `ARTIFACT`, never left as chat.
- **Fan-out is deterministic.** Drive parallel phases from an explicit plan, not chatter.
- **Compressed messages only.** Reads `RESULT`/`REVIEW`/`FINDING`/`ARTIFACT` — never test logs, full diffs, or source. Decision needing an artifact read → delegate it.
- **Working set = `plan + current wave`.** Run ledger (lane map + one line per wave: changed / decided / deferred). Fold each `RESULT` in; drop the verbatim message. Team mode: shared task list is the ledger.

## Investigation is delegated — including scoping

The orchestrator routes to the owning role — it does not investigate; applies to the first read of a code area, not only the fix loop.

- **No role bar.** Lead reading code to scope it applies a generic / line-count proxy — misses exactly the role-specific smells.
- **Scoping = delegated assessment.** Refactor / audit / feasibility / "is X clean" → dispatch the owning role; lead does NOT open the code.
- **Role walks its full bar per symbol** (line-spans, responsibility counts — measured) → `REVIEW` (`scope` · `checked` · `verdict` · `remarks`). Same form for pre-implementation scoping and post-implementation peer review.
- **Lead keeps aggregate, drops raw.** Fold `REVIEW.remarks` into the run ledger; never pull file reads / diffs into lead context.
- **Fix-loop = same rule.** `FINDING` → pick owning role → `FIX`; route, don't investigate.

## Communication protocol

6 typed forms (`BRIEF` · `RESULT` · `REVIEW` · `FINDING` · `FIX` · `ARTIFACT`) — fields, rendering, rules: [`protocol.md`](protocol.md).

- Every cross-role message MUST be one of these forms; non-conforming → **UNREAD**.
- Orchestrator: emits `BRIEF`/`FIX` · reads the rest.
- **Every message is a file, not inline:**
  - Dispatch (`BRIEF`/`FIX`) → member `inbox`; hand-back → `outbox` (`.team-process/sessions/<id>/{inbox,outbox}/<role>.<TYPE>.json`).
  - Pointer: `{ type, ref }` — `SendMessage` body; or named in the spawn prompt for the first `BRIEF`.
  - Reader: resolves `ref` → folds into working set → deletes box file.
  - See [`protocol.md`](protocol.md) → *Message delivery*.

## Phases

- Each phase is an **executable command** — procedure can change without touching this spine.
- Run in order; skip only when a phase doesn't apply (e.g. no contract change → skip Phase 1).
- Binding invariants: the command file + *Anti-patterns* below.

| # | Phase | Command | Purpose |
|---|---|---|---|
| 0 | Intake & docs-first | [`/intake`](../commands/intake.md) | Read owning spec; restate acceptance criteria; delegate scoping (never read code to scope). |
| 1 | Contract | [`/contract`](../commands/contract.md) | Cross-layer → define/update the shared contract first (→ `ARTIFACT`). |
| 2 | Plan & dispatch | [`/plan-dispatch`](../commands/plan-dispatch.md) | Map work to roles; declare lanes in a `BRIEF`; surface; confirm before N parallel. |
| 3 | Implement | [`/implement`](../commands/implement.md) | Parallel on disjoint lanes; each self-verifies → `RESULT`. Members never commit. |
| 4 | Integrate | [`/integrate`](../commands/integrate.md) | Sole integrator merges lanes into the branch; verify repo state. |
| 5 | Cross-review | [`/review-loop`](../commands/review-loop.md) | Pool reviewers per competency; verify + dedup → consolidated `REVIEW`. |
| 6 | Verify | [`/fix-loop`](../commands/fix-loop.md) | `testing`'s wider net; red → `FIX`, loop until green; never ship red. |
| 7 | Ship | [`/ship`](../commands/ship.md) | Commit groups → branch → PR → CI green. **Never push the default branch.** |

## Standing guardrails & tool-output economy

Inherited by every role and mode — [`guardrails.md`](guardrails.md):

- docs-first
- single-integrator
- stay-in-lane
- repo hygiene
- self-verify
- report-don't-act
- check-theories-first
- tool-output economy
- typed-forms-verbatim
- walk-the-full-bar
- no-harm refactor

## Verify state after every wave

Re-check repo state between waves — members may have committed, pushed, made out-of-lane edits, or mixed EOL; catch before it compounds.

## Anti-patterns (each cost a real failure)

- Implementation leads, spec treated as descriptive → lost behavior.
- Multiple writers on one worktree → clobbers, rogue commits, lost state.
- Returning unverified work ("builds locally") → red CI, wasted round-trips.
- Re-deriving a diagnosis the user already gave → burned effort.
- Lead edits a lane file itself ("it's just one line / I'm already in flow") → applies a bar it
  doesn't hold AND swells the lead's expensive context, ballooning long-session token cost.
- Lead scopes an area by its own read → generic / line-count proxy, misses the role's
  non-negotiables; pollutes the lead's context with raw investigation (delegate the assessment).
- "Autonomous" read as auto-merge or run-silent → shipped to the default branch unaccepted,
  or no plan surfaced to interject against.
- Silent truncation/re-scoping when blocked → the request quietly unmet.
- Tests-green mistaken for principle-compliance → smells ship unreviewed (run [`/review-loop`](../commands/review-loop.md)).
- Self-review by the implementer → blind spots; the reviewer must be a different instance.
