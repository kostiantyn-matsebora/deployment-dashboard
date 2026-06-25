---
description: Launch a plan-and-confirm Claude agent team for a multi-layer issue. The lead does docs-first intake, drafts a lane map + member roster, SURFACES the plan, and only opens the session (--set-marker) + spawns background-Agent members after approval. Implements .claude/team-process/.
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

Agent-teams surface enabled: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in user or project settings —
this gates `SendMessage` / `TaskCreate` / background `Agent`. If unset, stop and tell the user to
enable it. **`TeamCreate` / `TeamDelete` are no longer used** (removed from Claude Code in 2.1.178);
members run as **background Agents** and the session lifecycle is driven by an explicit
`invoke_team_mode_guard.py` call (below), not a tool hook.

## Member roster (role → `subagent_type`)

| Role | `subagent_type` |
|---|---|
| [contract](../team-process/roles/contract.md) | `api-architect` |
| [backend](../team-process/roles/backend.md) | `backend-developer` |
| [frontend](../team-process/roles/frontend.md) | `frontend-developer` |
| [infrastructure](../team-process/roles/infrastructure.md) | `deployment-engineer` |
| [testing](../team-process/roles/testing.md) | `testing-specialist` |
| [docs](../team-process/roles/docs.md) | `docs-keeper` *(plugin-provided / opt-in — staffable only when the docs-keeper plugin is installed)* |

Spawn only the roles the change actually needs (routing table in `process.md`).

## How the process maps onto the team substrate

| Process activity | On the team substrate |
|---|---|
| [`/intake`](intake.md) · [`/contract`](contract.md) · [`/plan-dispatch`](plan-dispatch.md) | Lead runs them **solo, before any team exists** → surface the plan + STOP for approval. |
| [`/implement`](implement.md) | Each lane runs as a **spawned member** (worktree-isolated, background). |
| [`/integrate`](integrate.md) · [`/review-loop`](review-loop.md) | Lead integrates; spawns one reviewer per competency + a `security` reviewer (generic Agent running the `security-review` skill); reviewer ≠ implementer. |
| [`/fix-loop`](fix-loop.md) · [`/ship`](ship.md) | Lead drives; the testing member reports red, the lead routes `FIX`es. |

## 0 — Resume check (before anything)

**Don't fork an existing run.** Before planning, check for an active run already working this
issue/feature and **propose to resume it** instead of creating a parallel team:

- Issue mode: `python3 scripts/hooks/invoke_team_mode_guard.py --find-session --issue <ref>`
  — a non-empty result is the run to propose resuming (re-create the same team id → merges/resumes).
- Informal ask: match the request against the active runs' `summary` in the SessionStart reminder.

Only proceed to a fresh plan when no existing run matches (or the user declines to resume). See
[`process.md`](../team-process/process.md) → *Session state & resume*.

## 1 — Plan (NO team yet)

Run [`/intake`](intake.md) → [`/contract`](contract.md) (if cross-layer) → [`/plan-dispatch`](plan-dispatch.md)
**solo**. Then **surface and STOP** — present scope + roster + lane map; do **not** open the session
(`--set-marker`) or spawn anything until the user approves (repo rule: *surface before launch; for N
parallel members get explicit confirmation*).

## 2 — Spawn (after approval)

- **Open the session record** — run (no `TeamCreate` tool exists):
  ```
  python3 scripts/hooks/invoke_team_mode_guard.py --set-marker --team feat-<issue> --workflow feature-team --issue <ref> --summary "<essence>"
  ```
  This writes the durable record `.team-process/sessions/<id>/session.json` with `workflow:
  feature-team` (`<id>` = sanitized `-Team`) and creates its `inbox/` + `outbox/`. The record's
  EXISTENCE flips team mode on: the team-mode guard then blocks any foreground in-session `Agent`/Task
  subagent — every member spawn below MUST be a **background Agent** (`run_in_background: true`), or it
  is rejected as an in-session downgrade. The record persists across reboots; concurrent runs coexist
  as distinct directories; see [`process.md`](../team-process/process.md) → *Session state & resume*.
  *(If a stale same-id session already exists, call `--end-session --id <id>` first — re-running `--set-marker` without clearing merges (resume path), not fresh.)*
- **Write each member's `BRIEF` to its inbox** *before* spawning — normalize with
  `format_protocol_form.py`, then write to `.team-process/sessions/<id>/inbox/<role>.BRIEF.json`. The
  spec / lane / task / gate / seed all live in this file; the spawn prompt only points at it (keeps the
  task durable, auditable, and out of the lead's context). See
  [`protocol.md`](../team-process/protocol.md) → *Message delivery*.
- **Spawn each member** via the `Agent` tool to execute [`/implement`](implement.md) in its lane:
  - `run_in_background: true` — **the member substrate**: spawns a background Agent the lead coordinates with via `SendMessage` while it works. Also what the team-mode guard recognizes as a legitimate member (vs a blocked foreground subagent).
  - `name` = the **role** (e.g. `backend`) or role-prefixed with a short task hint (e.g. `backend: extract HTTP adapter`) — the role must be the leading token so it is visible in the agent statusline AND is the `SendMessage` address; never set `name` to only the task · `subagent_type` = the mapped agent above.
  - `isolation: "worktree"` for every member that writes code in parallel (prevents same-file clobbers).
  - `team_name` is **optional** (back-compat only) — set it to the `<id>` if your runtime still supports named teams; not required, and the guard accepts the spawn on `run_in_background` alone.
  - **Prompt = brief-by-reference (NOT the brief restated):** "Read your `BRIEF` at
    `<absolute-path-to-inbox-BRIEF.json>` — it carries your spec / lane / task / gate." + "inherit your
    role file `.claude/team-process/roles/<role>.md` and its guardrails" + the `/implement` self-verify
    gate (build + own-change unit tests + lint, actual counts) + "do NOT commit/push; hand back to the lead."
    + "The session id is `<literal-id-value>`; your outbox is `<absolute-path-to-outbox-dir>` — use these verbatim, do NOT derive them from the team name. If running in a worktree, run `mkdir -p '<outbox-path>'` before writing your hand-back."
    + "NEVER return prose, markdown, or a .txt file as your final message — write the typed form to your outbox file first, then send the { type, ref } pointer."
    + **the hand-back few-shot:** three items — (1) the expected form name, (2) its **canonical example
    copied verbatim from [`protocol.md`](../team-process/protocol.md)** (e.g. the `RESULT` example for
    `/implement`), (3) the one-step recipe: write filled JSON to a temp file →
    `python3 scripts/hooks/format_protocol_form.py --input-file <file> --outbox-dir <outbox>` → send the
    printed pointer verbatim. Primes a first-try conforming hand-back; no blocked-write +
    schema-exploration round-trip. See [`protocol.md`](../team-process/protocol.md) → *Prime the hand-back*.
- **Assign work.** Create the task list (one task per lane); contract member first if cross-layer —
  its `ARTIFACT` unblocks the rest.
- **Populate the statusline fields.** Set the session `summary` (issue title / feature essence) and
  each `roster[]` member's `task` (short description) — these render in the team statusline
  (`team: <id> - <summary> (<phase>) | <role>: <task>, ...`).

## 3 — Coordinate (hub-and-spoke)

- Members report to the lead on completion (changes, lane touched, gate results, blockers) as a
  **file + pointer**: the typed form is written to `.team-process/sessions/<id>/outbox/<role>.<TYPE>.json`
  and a `{ type, ref }` pointer is sent via `SendMessage`. **Drain each wave** — read the outbox file by
  `ref`, fold it into the ledger, then delete it (see [`protocol.md`](../team-process/protocol.md) →
  *Message delivery*). Peer `SendMessage` is reserved for **contract negotiation** (contract ↔
  consumers); the outcome is recorded in the `ARTIFACT`, not left as chat.
- **Verify state after every wave** — re-check repo/worktree state; catch out-of-lane edits, stray
  commits, mixed EOL before they compound.
- **Update the session record each wave** — set each `roster[]` member's `status` + a short
  `progress` note, fold the wave into the ledger, and append any decisions surfaced (incl. from a
  member's `RESULT.notes`) to `decisions[]`. This is what a restart re-attaches to. See
  [`process.md`](../team-process/process.md) → *Decision record* / *Session state & resume*.

## 4 — Integrate & review

- Run [`/integrate`](integrate.md) — merge member lanes/worktrees into the branch.
- Run [`/review-loop`](review-loop.md) — dispatch one reviewer per touched competency as a **fresh
  instance ≠ that lane's implementer**, **plus a `security` reviewer** (a generic Agent running the
  `security-review` skill over the integrated diff → `REVIEW` with `role: "security"`); route
  `changes-requested` remarks to the owning implementer; loop until all `pass`. Reviewers report, never fix.

## 5 — Verify & ship

- Run [`/fix-loop`](fix-loop.md) — the **testing member** runs the wider net + regression and
  **reports red to the lead** (never fixes production code); the lead routes each failure to its
  owning member; loop until green.
- Run [`/ship`](ship.md) — commit in logical groups → branch → open/update PR → watch CI green.
  Never push the default branch. **Publish the decision record** to the issue (confirm-first) via
  `scripts/team-process/update_issue_decision_record.py` — see [`/ship`](ship.md).
- **Close the session** once integrated — run `python3 scripts/hooks/invoke_team_mode_guard.py --end-session --id <id>` (there is
  no `TeamDelete` tool), but only **after** the decision record is published; teardown removes the
  session record (the decisions' live store), so the issue comment is their durable home.
  *(On a fresh session a leftover record is NOT auto-cleared — `SessionStart` reminds you to resume or
  abandon it; abandon a stale one by id with the same `--end-session --id <id>`.)*

## Guardrails (inherited from .claude/team-process/guardrails.md — binding)

Docs-first · single integrator (members never commit) · stay in your lane · repo hygiene (match
EOL/format; CI platform's result wins) · self-verify before returning · report — don't act — on
scope changes · check provided theories first.

## When NOT to use

1–2 surfaces with no shared contract → a single agent + inline integration. Trivial edit → inline.
The team pays off at **≥3 layers with a shared contract**.
