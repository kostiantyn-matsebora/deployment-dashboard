# Execution modes

Substrate reference for [`process.md`](process.md), [`protocol.md`](protocol.md), and [`guardrails.md`](guardrails.md) — roles + guardrails identical across modes; only the substrate differs. **Default flow unchanged — teams are opt-in escalation only.**

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

Each runtime maps the two modes to its own primitives.

| | Claude Code | GitHub Copilot |
|---|---|---|
| **In-session subagent** | `Agent`/Task tool | `@<role>` direct |
| **Spawned team** | `/feature-team` → `-SetMarker` opens the run + background-Agent members (`run_in_background`, `subagent_type`=role) via `SendMessage` | `/fleet` (Copilot CLI) — parallel tracks to role agents; lead integrates |
| **Project bindings** | `CLAUDE.md` § *Project bindings* | `.github/copilot-instructions.md` |
