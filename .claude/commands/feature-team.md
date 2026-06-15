---
description: Launch a plan-and-confirm Claude agent team for a multi-layer issue. The lead does docs-first intake, drafts a lane map + member roster, SURFACES the plan, and only TeamCreate + spawns members after approval. Implements .claude/team-process/.
argument-hint: <issue-number | task description>
---

# /feature-team

Run a non-trivial, multi-layer change as a **Claude agent team** (multiple sessions, each spawned in
the context of a project agent, coordinating via `SendMessage` + a shared task list). The playbook is
[`.claude/team-process/`](../team-process/process.md); **this command adds the spawned-team substrate
on top of that process.** The per-phase *work* is defined by the phase activity commands — what's
below is only the **team overlay** (spawn, coordinate, disband).

**You are the lead/orchestrator.** Teams are runtime-only — nothing here is checked in beyond this
command. Members **never** commit; the lead is the sole integration gate.

## Prerequisite

Experimental teams feature enabled: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in user or project
settings. If unset, stop and tell the user to enable it.

## Member roster (role → `subagent_type`)

| Role | `subagent_type` |
|---|---|
| [contract](../team-process/roles/contract.md) | `api-architect` |
| [backend](../team-process/roles/backend.md) | `backend-developer` |
| [frontend](../team-process/roles/frontend.md) | `frontend-developer` |
| [infrastructure](../team-process/roles/infrastructure.md) | `deployment-engineer` |
| [testing](../team-process/roles/testing.md) | `testing-specialist` |
| [docs](../team-process/roles/docs.md) | `docs-keeper` |

Spawn only the roles the change actually needs (routing table in `process.md`).

## How the process maps onto the team substrate

| Process activity | On the team substrate |
|---|---|
| [`/intake`](intake.md) · [`/contract`](contract.md) · [`/plan-dispatch`](plan-dispatch.md) | Lead runs them **solo, before any team exists** → surface the plan + STOP for approval. |
| [`/implement`](implement.md) | Each lane runs as a **spawned member** (worktree-isolated, background). |
| [`/integrate`](integrate.md) · [`/review-loop`](review-loop.md) | Lead integrates; spawns one reviewer per competency (reviewer ≠ implementer). |
| [`/fix-loop`](fix-loop.md) · [`/ship`](ship.md) | Lead drives; the testing member reports red, the lead routes `FIX`es. |

## 1 — Plan (NO team yet)

Run [`/intake`](intake.md) → [`/contract`](contract.md) (if cross-layer) → [`/plan-dispatch`](plan-dispatch.md)
**solo**. Then **surface and STOP** — present scope + roster + lane map; do **not** `TeamCreate` or
spawn anything until the user approves (repo rule: *surface before launch; for N parallel members get
explicit confirmation*).

## 2 — Spawn (after approval)

- **`TeamCreate`** with a name derived from the target (e.g. `feat-<issue>`), description = the issue
  summary. *(A `PostToolUse(TeamCreate)` hook writes the durable session record
  `.team-process/run/sessions/<id>/session.json` with `workflow: feature-team` (`<id>` = sanitized team
  name); the team-mode guard then blocks any foreign in-session `Agent`/Task subagent — every member spawn
  below MUST set `team_name`, or it is rejected as an in-session downgrade. The record persists across
  reboots; concurrent runs coexist as distinct directories; see [`process.md`](../team-process/process.md)
  → *Session state & resume*.)*
- **Spawn each member** via the `Agent` tool to execute [`/implement`](implement.md) in its lane:
  - `team_name` = the team · `name` = a stable, referenceable label (e.g. `backend`) ·
    `subagent_type` = the mapped agent above.
  - `isolation: "worktree"` for every member that writes code in parallel (prevents same-file clobbers).
  - `run_in_background: true` so the lead can coordinate while members work.
  - **Prompt = scoped brief:** owning spec + the member's named lane + "inherit your role file
    `.claude/team-process/roles/<role>.md` and its guardrails" + the `/implement` self-verify gate
    (build + own-change unit tests + lint, actual counts) + "do NOT commit/push; hand back to the lead."
- **Assign work.** Create the task list (one task per lane); contract member first if cross-layer —
  its `ARTIFACT` unblocks the rest.

## 3 — Coordinate (hub-and-spoke)

- Members report to the lead on completion (changes, lane touched, gate results, blockers) as a
  **file + pointer**: the typed form is written to `.team-process/run/sessions/<id>/outbox/<role>.<TYPE>.json`
  and a `{ type, ref }` pointer is sent via `SendMessage`. **Drain each wave** — read the outbox file by
  `ref`, fold it into the ledger, then delete it (see [`protocol.md`](../team-process/protocol.md) →
  *Hand-back delivery*). Peer `SendMessage` is reserved for **contract negotiation** (contract ↔
  consumers); the outcome is recorded in the `ARTIFACT`, not left as chat.
- **Verify state after every wave** — re-check repo/worktree state; catch out-of-lane edits, stray
  commits, mixed EOL before they compound.

## 4 — Integrate & review

- Run [`/integrate`](integrate.md) — merge member lanes/worktrees into the branch.
- Run [`/review-loop`](review-loop.md) — dispatch one reviewer per touched competency as a **fresh
  instance ≠ that lane's implementer**; route `changes-requested` remarks to the owning implementer;
  loop until all `pass`. Reviewers report, never fix.

## 5 — Verify & ship

- Run [`/fix-loop`](fix-loop.md) — the **testing member** runs the wider net + regression and
  **reports red to the lead** (never fixes production code); the lead routes each failure to its
  owning member; loop until green.
- Run [`/ship`](ship.md) — commit in logical groups → branch → open/update PR → watch CI green.
  Never push the default branch.
- **`TeamDelete`** once integrated. *(A `PostToolUse(TeamDelete)` hook removes that team's session
  record. On a fresh session a leftover record is NOT auto-cleared — `SessionStart` reminds you to
  resume or abandon it; abandon a stale one by id with
  `Invoke-TeamModeGuard.ps1 -EndSession -Id <id>`.)*

## Guardrails (inherited from .claude/team-process/guardrails.md — binding)

Docs-first · single integrator (members never commit) · stay in your lane · repo hygiene (match
EOL/format; CI platform's result wins) · self-verify before returning · report — don't act — on
scope changes · check provided theories first.

## When NOT to use

1–2 surfaces with no shared contract → a single agent + inline integration. Trivial edit → inline.
The team pays off at **≥3 layers with a shared contract**.
