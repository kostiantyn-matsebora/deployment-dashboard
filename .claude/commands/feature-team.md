---
description: Launch a plan-and-confirm Claude agent team for a multi-layer issue. The lead does docs-first intake, drafts a lane map + member roster, SURFACES the plan, and only TeamCreate + spawns members after approval. Implements .claude/team-process/.
argument-hint: <issue-number | task description>
---

# /feature-team

Run a non-trivial, multi-layer change as a **Claude agent team** (multiple sessions,
each spawned in the context of a project agent, coordinating via `SendMessage` + a
shared task list). The playbook is [`.claude/team-process/`](../team-process/process.md);
this command is its runtime launcher.

**You are the lead/orchestrator.** Teams are runtime-only — nothing here is checked in
beyond this command. Members **never** commit; the lead is the sole integration gate.

## Prerequisite

Experimental teams feature enabled: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in user or
project settings. If unset, stop and tell the user to enable it.

## Member roster (role → project agent / subagent_type)

| Role | `subagent_type` |
|---|---|
| [contract](../team-process/roles/contract.md) | `api-architect` |
| [backend](../team-process/roles/backend.md) | `backend-developer` |
| [frontend](../team-process/roles/frontend.md) | `frontend-developer` |
| [infrastructure](../team-process/roles/infrastructure.md) | `deployment-engineer` |
| [testing](../team-process/roles/testing.md) | `testing-specialist` |
| [docs](../team-process/roles/docs.md) | `docs-keeper` |

Spawn only the roles the change actually needs (routing table in `process.md`).

## Phase 1 — Plan (NO team yet)

1. **Resolve target.** `$ARGUMENTS` = an issue number (read it via `gh`/the issue
   tracker) or a task description.
2. **Docs-first intake.** Navigate `docs/index.md` → the owning spec(s); restate the
   acceptance criteria from them. For API features, the contract artifact is the source
   of truth.
3. **Draft the plan:**
   - **Scope** — what changes, which layers.
   - **Roster** — which roles/members are needed.
   - **Ownership-lane map** — the exact files each member may touch (must be disjoint;
     if not, mark for serialization or worktree isolation).
   - **Sequence** — contract-first if cross-layer; then parallel implement on disjoint
     lanes; then integrate + verify; then ship.
4. **Surface and STOP.** Present scope + roster + lane map + sequence. Do **not**
   `TeamCreate` or spawn anything until the user approves. (Repo rule: *surface before
   launch; for N parallel members get explicit confirmation*.)

## Phase 2 — Spawn (after approval)

5. **`TeamCreate`** with a name derived from the target (e.g. `feat-<issue>`), description
   = the issue summary.
6. **Spawn each member** via the `Agent` tool:
   - `team_name` = the team · `name` = a stable, referenceable label (e.g. `backend`,
     `frontend`) · `subagent_type` = the mapped agent above.
   - `isolation: "worktree"` for every member that writes code in parallel (prevents
     same-file clobbers).
   - `run_in_background: true` so the lead can coordinate while members work.
   - **Prompt = scoped brief:** owning spec + the member's named lane + "inherit your
     role file `.claude/team-process/roles/<role>.md` and its guardrails" + an explicit
     self-verify gate (build + **unit tests for your own change** + lint, report actual
     results) + "do NOT commit/push; hand changes back to the lead."
   - The **testing member** additionally owns the wider net (API / integration / e2e +
     regression) and **reports failures to the lead — it does not fix production code.**
7. **Assign work.** Create the task list (one task per lane); have members self-claim or
   assign directly. Contract member first if cross-layer — its artifact unblocks the rest.

## Phase 3 — Coordinate (hub-and-spoke)

8. Members report to the lead when done (changes, lane touched, gate results, blockers).
   Peer `SendMessage` is reserved for **contract negotiation** (contract ↔ consumers),
   and the outcome is recorded in the spec artifact, not left as chat.
9. **Verify state after every wave** — re-check repo/worktree state; catch out-of-lane
   edits, stray commits, mixed EOL before they compound.

## Phase 4 — Integrate & ship (lead only)

10. Merge member lanes/worktrees (implementers have already unit-tested their own changes).
    Have the **testing member** run the wider net — API / integration / e2e + **regression**.
11. **Analyze failures & assign fixes.** The testing member reports negative results to you
    (the lead), not fixes them. Diagnose each failure, route it to the **owning member** to
    fix, re-run — loop until the full suite is green. Reconcile drift; re-verify against the
    phase-2 spec.
12. Commit in logical groups → branch → open/update PR → watch CI to green. Never push to
    the default branch directly.
13. **`TeamDelete`** once integrated.

## Guardrails (inherited from .claude/team-process/process.md — binding)

Docs-first · single integrator (members never commit) · stay in your lane · repo hygiene
(match EOL/format; CI platform's result wins) · self-verify before returning · report —
don't act — on scope changes · check provided theories first.

## When NOT to use

1–2 surfaces with no shared contract → a single agent + inline integration. Trivial edit
→ inline. The team pays off at **≥3 layers with a shared contract**.
