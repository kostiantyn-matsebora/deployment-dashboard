# Execution modes

Substrate reference for [`process.md`](process.md) — a companion alongside
[`protocol.md`](protocol.md) and [`guardrails.md`](guardrails.md). Roles + guardrails are identical
across modes; only the substrate differs. **Default flow is unchanged; teams never replace it —
opt-in escalation only.**

## The two modes

| Mode | How it runs | When |
|---|---|---|
| **In-session subagents** *(default)* | The orchestrator dispatches the owning role as an in-session subagent that reports back. | Most work: one/few surfaces, handled by one integrator + sequential/parallel subagents. |
| **Spawned team** *(opt-in)* | Role members run as separate, coordinated sessions under a plan-confirm launch; the lead integrates. | ≥3 layers sharing a contract, where per-role context + peer contract-negotiation pay off. |

## Mode is sticky — no silent downgrade

- The substrate chosen at launch holds for the whole run.
- `/feature-team` (or any spawned-team launch) commits the run to **separate member sessions**
  coordinated via `SendMessage` + the shared task list — *every later dispatch goes to a spawned
  member*, never to an in-session `Agent`/Task subagent.
- Sliding back to in-session subagents mid-run — a common drift right after a conversational turn
  — collapses the per-role contexts and peer contract-negotiation the team mode exists for.
- Need to change substrate? Surface it as a decision; never downgrade silently.

## Runtime bindings

The modes are runtime-neutral; each runtime maps them to its own primitives. Two bindings ship:

**Claude Code:**

- In-session subagent = the `Agent`/Task tool.
- Spawned team = `/feature-team <issue>` → plan-confirm → `TeamCreate` + spawn members (`subagent_type` = role), coordinating via `SendMessage` + a shared task list.
- Project bindings: `CLAUDE.md` § *Project bindings*.

**GitHub Copilot:**

- Role member = a custom agent `.github/agents/<role>.agent.md` (body = the role anchor), invoked `@<role>`.
- In-session subagent = invoke `@<role>` directly.
- Spawned team = `/fleet` (Copilot CLI) — decomposes the objective into parallel tracks dispatched to the role agents; the lead integrates.
- Project bindings: `.github/copilot-instructions.md`.
