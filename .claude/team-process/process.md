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
| Markdown docs / indexes / sources-of-truth | [`docs`](roles/docs.md) — *plugin-provided (docs-keeper); opt-in. Unstaffed when the plugin is absent.* |
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

`.team-process/sessions/<id>/` — gitignored; `<id>` = sanitized session/team name (set at `--set-marker`); survives boundaries/reboots; concurrent runs coexist as distinct dirs.

- **Contents.** `session.json` (durable record = run ledger), `inbox/` (orch→member `BRIEF`/`FIX`), `outbox/` (member hand-backs).
- **Id.** Sanitized `--set-marker --team` name. Re-running `--set-marker` with the same id **merges** (resume path, not fresh). Fresh start: `--end-session --id <id>` before `--set-marker`; omit `--id` to abandon all.
- **Lifecycle is explicit, not hook-driven.** The lead opens the run with `python3 scripts/hooks/invoke_team_mode_guard.py --set-marker` and closes it with `--end-session`. Members run as **background agents** the lead drives asynchronously and coordinates with by message — the runtime's spawn + message primitives; see [`execution-modes.md`](execution-modes.md).
- **Team mode active** whenever any session record exists — blocks foreground in-session `Agent`/`Task` spawns (a member is recognized by `run_in_background`, or `team_name` for back-compat). Spans reboots. Legacy single-file `session.json` read for back-compat.
- **Workflow classifier.** `workflow`: `feature-team` (follows phase enum) | `freeform` (free-form phase string).
- **Run ledger = `session.json`.** Orchestrator enriches it (roster · phase · per-wave changed/decided/deferred). Shape: [`schemas/session.schema.json`](schemas/session.schema.json).
- **Lanes = generated projection.** `roster[].lane` → `lane` field (read by lane guard). Never hand-maintain. Sync: `python3 scripts/hooks/invoke_team_mode_guard.py --sync-lane --id <id> --role <role>`.
- **SessionStart reminds, never wipes.** Injects resume summary of every active run (id · workflow · branch · phase · summary · agents · decisions) — lead re-attaches without re-reading transcript.
- **Match work to existing run — propose resume, never fork.** Before `/feature-team` or "work on X":
  - **Issue (#number):** `python3 scripts/hooks/invoke_team_mode_guard.py --find-session --issue <ref>` — non-empty result = propose resume.
  - **Informal:** match against `summary` in SessionStart reminder; plausible match → propose resume.
- **Resume.** Reboot kills live members; re-run `--set-marker` (merges the record) + re-spawn the in-flight wave's background Agents from the ledger — ledger is durable truth, live members rebuilt from it.
- **Abandon.** `python3 scripts/hooks/invoke_team_mode_guard.py --end-session --id <id>` (omit `--id` for all).

## Decision record — capture, surface, publish

Decisions captured as they happen · surfaced on every resume · published to the issue at ship — shape: [`schemas/session.schema.json`](schemas/session.schema.json) (`acceptance` · `decisions[]` · `roster[].progress`).

- **Capture at the moment.** On user confirmation, answered question, resolved `FINDING`, or `RESULT.notes` design choice — append `decisions[]`: `{id, decision, why, supersedes, status, refs}`.
  - **`supersedes` mandatory** when overriding issue text / earlier plan / spec line — prevents silent re-loss.
  - **`refs` point at the artifact** (mockup SHA, contract anchor) — artifact is truth above any prose summary.
  - Acceptance criteria at intake → `acceptance` (locked contract + gate).
- **Record AUTHORITATIVE over conversation summary.** After compaction: re-read decisions first; decision wins over summary. `SessionStart` surfaces decisions + member status inline (content, not counts).
- **Per-member resume.** `roster[]` carries `status` + `progress`. Resume re-dispatches member with its `BRIEF` + `progress` + relevant decisions — continues, not restarts.
- **Publish at ship (issue mode).** `update_issue_decision_record.py` upserts a managed comment (idempotent, never clobbers body). Confirm-first: `--dry-run` → show user → post on approval.

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
- **Compressed messages only.** Reads `RESULT`/`REVIEW`/`FINDING`/`ARTIFACT`/`RESEARCH`/`ANALYSIS` — never test logs, full diffs, or source. Decision needing an artifact read → delegate it (→ `ANALYSIS`).
- **Working set = `plan + current wave`.** Run ledger (lane map + one line per wave: changed / decided / deferred). Fold each `RESULT` in; drop the verbatim message. Team mode: shared task list is the ledger.

## Investigation and analysis are delegated — at every stage

**Pure coordinator.** The orchestrator decides, routes, assigns, and handles errors — it does **not** explore, scope, or *analyze* in its own context. **Stage-independent** — applies to intake, propose-solution, lane-map rationale, `FINDING` option-weighing, fix-loop layer-selection, and human-in-the-loop / post-PR iteration. **Three delegated shapes, picked by need:**

- **Broad discovery → `Explore` agent → `RESEARCH`.** "How does this work today / where's the relevant code / what are the options" → dispatch a read-only **`Explore`** agent.
  - Its exploration loops run in its **disposable** context; it returns a [`RESEARCH`](protocol.md) form (`topic` · `findings` · `options` · `refs` · `open`).
  - Lead **never runs the exploration loops itself** — that is exactly the agent-loop context pollution this rule exists to prevent.
  - `Explore` is read-only (no `Write`): returns the form as its final message; orchestrator persists it via the normalizer, folds `findings`/`options` into the ledger as plan input. **Discovery carries no verdict.**
- **Judgment / synthesis → analyst (owning role or `Plan`/general agent) → `ANALYSIS`.** "Which approach, is X feasible, weigh these options, what's the root layer" → delegate the **evaluation**, don't perform it in-context.
  - Owning role for in-domain judgment; a general analyst / `Plan` agent for cross-cutting / architectural decisions. Returns an [`ANALYSIS`](protocol.md) form (`question` · `evaluated` · `recommendation` · `rationale` · `confidence?` · `risks?`).
  - The orchestrator **ratifies** the `recommendation` and folds it into `decisions[]` — it **never derives** it. Proposing the solution, choosing among `RESEARCH.options`, and picking the owning layer for an ambiguous `FINDING` are all `ANALYSIS`, not lead cognition.
- **Bar-level scoping → owning role → `REVIEW`.** When a role's non-negotiable bar must be judged (refactor / audit / feasibility / "is X clean"), dispatch the **owning role**; it walks its full bar per symbol (line-spans, responsibility counts — measured) → `REVIEW` (`scope` · `checked` · `verdict` · `remarks`). Same form for pre-implementation scoping and post-implementation peer review.
- **The three are distinct, never interchangeable.** Discovery (`RESEARCH`) answers *where / how / what-are-the-options*; analysis (`ANALYSIS`) answers *which option / is it feasible / what's the root layer*; the role `REVIEW` answers *does it meet the bar*. Discovery feeds analysis; analysis informs the plan; review gates the change.
- **Tool-enforced.** Code-cognition (`Read` / `Grep` / `Glob` over source) is **blocked for the orchestrator while a run is active** by `invoke_orchestrator_read_guard.py`.
  - Lead may read only orchestration state (`.team-process/**`, `.claude/**`) and the owning spec (`docs/**`). Subagents pass through.
  - The one judgment the lead legitimately keeps: **choosing among options an analyst already evaluated**. Re-deriving from already-returned forms is forbidden by rule.
- **No role bar in the lead.** A lead reading code to scope it applies a generic / line-count proxy — misses exactly the role-specific smells.
- **Lead keeps aggregate, drops raw.** Fold `RESEARCH.findings` / `ANALYSIS.recommendation` / `REVIEW.remarks` into the run ledger; never pull file reads / diffs into lead context.
- **Fix-loop = same rule.** `FINDING` → pick owning role → `FIX`; route, don't investigate. Owning layer ambiguous across roles → delegate an `ANALYSIS` to pick it, don't deepen the dig in-context.
- **Integration is untouched.** This guard bans code-*cognition*, never the orchestrator's mechanics: it keeps every `git` mutation, box-file write, and script run (single-integrator model preserved — see *Single-integrator model*).

## Communication protocol

8 typed forms (`BRIEF` · `RESULT` · `REVIEW` · `FINDING` · `FIX` · `ARTIFACT` · `RESEARCH` · `ANALYSIS`) — fields, rendering, rules: [`protocol.md`](protocol.md).

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
| 0 | Intake & docs-first | [`/intake`](../commands/intake.md) | Read owning spec; restate acceptance criteria; delegate exploration to `Explore` (→ `RESEARCH`), judgment to an analyst (→ `ANALYSIS`), scoping to the owning role (→ `REVIEW`) — never read code to explore/scope or synthesize the approach in-context. |
| 1 | Contract | [`/contract`](../commands/contract.md) | Cross-layer → define/update the shared contract first (→ `ARTIFACT`). |
| 2 | Plan & dispatch | [`/plan-dispatch`](../commands/plan-dispatch.md) | Ratify the delegated `ANALYSIS` recommendation; map work to roles; declare lanes in a `BRIEF`; surface; confirm before N parallel. |
| 3 | Implement | [`/implement`](../commands/implement.md) | Parallel on disjoint lanes; each self-verifies → `RESULT`. Members never commit. |
| 4 | Integrate | [`/integrate`](../commands/integrate.md) | Sole integrator merges lanes into the branch; verify repo state. |
| 5 | Cross-review | [`/review-loop`](../commands/review-loop.md) | Pool reviewers per competency + a `security` reviewer (generic agent running the `security-review` skill); verify + dedup → consolidated `REVIEW`. |
| 6 | Verify | [`/fix-loop`](../commands/fix-loop.md) | `testing`'s wider net; red → `FIX`, loop until green; never ship red. |
| 7 | Ship | [`/ship`](../commands/ship.md) | Commit groups → branch → PR → CI green. **Never push the default branch.** |

## Post-PR iteration — the loop doesn't end at PR-open

PR-open + CI green is a **checkpoint awaiting acceptance, not termination** (see *Autonomy* → *Done*). Each user change request on the open PR is a **new wave through the same phases**, not an inline patch.

- **Re-enter the loop.** Post-PR request re-runs Implement → Integrate → **Cross-review** → **Verify** → Ship for the changed unit.
  - **Review-loop and fix-loop are NOT skipped** on follow-ups — the most-violated gap: later edits bypass the gates the initial work passed.
- **Proportional, never zero.** A one-line tweak gets a focused review + fix pass over the changed unit — never the full fan-out, but never zero.
- **Trigger depends on mode:**
  - **Autonomous** → re-enter the implement→review→fix→ship loop automatically; surface the intent.
  - **Interactive** → surface the re-entry plan + let the user choose the depth before dispatching.
- **Lane rule still holds.** Lead does not patch the PR itself — emit a `BRIEF`, exactly like the first wave. Re-review by a **different instance** than the implementer.
- **Security re-runs too.** The `security-review` dimension is part of the review loop; a post-PR wave re-audits the new diff (see *Cross-review*).

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
- Lead runs the exploration/options research in its own context (agent loops, code spelunking) →
  swells the lead's expensive context (dispatch an `Explore` agent → `RESEARCH` instead).
- Lead evaluates options / judges feasibility / synthesizes the approach in-context → delegate an `ANALYSIS`; the lead **ratifies**, it does not **derive**.
- Lead reads/greps source to scope or decide → tool-blocked by the read-guard; dispatch `Explore` (→ `RESEARCH`) or the owning role (→ `ANALYSIS`/`REVIEW`) instead.
- Post-PR change patched inline or shipped without re-review → follow-up edits bypass the cross-review +
  verify gates the initial work passed (re-enter the loop; see *Post-PR iteration*).
- "Autonomous" read as auto-merge or run-silent → shipped to the default branch unaccepted,
  or no plan surfaced to interject against.
- Silent truncation/re-scoping when blocked → the request quietly unmet.
- Tests-green mistaken for principle-compliance → smells ship unreviewed (run [`/review-loop`](../commands/review-loop.md)).
- Self-review by the implementer → blind spots; the reviewer must be a different instance.
