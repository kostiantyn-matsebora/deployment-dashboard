# Team Process Kit

Portable orchestration framework: one lead, N role-specialists, any stack. Defines *who does what and how they coordinate* — not the technology.

**Core** (`process.md` · `protocol.md` · `guardrails.md` · `roles/`) is stack-, domain-, and runtime-agnostic. Only client-specific wiring: one *Claude Code binding* in `process.md` (and the reference agents below), swappable by runtime.

## Session lifecycle

Lifecycle is explicit, not hook-driven (`TeamCreate`/`TeamDelete` removed in Claude Code 2.1.178). The lead opens a run with `python3 scripts/hooks/invoke_team_mode_guard.py --set-marker` (writes the session record + inbox/outbox, enables team mode) and closes it with `--end-session`. Members run as **background Agents** (`run_in_background: true`), addressed via `SendMessage`.

## Layout

| File | Role |
|---|---|
| [`process.md`](process.md) | Orchestration playbook: routing, execution modes, single-integrator model, phases, fix/review loops, when-to-use threshold. |
| [`protocol.md`](protocol.md) | The **communication protocol** — 8 typed **JSON** messages (`BRIEF` · `RESULT` · `REVIEW` · `FINDING` · `FIX` · `ARTIFACT` · `RESEARCH` · `ANALYSIS`); fields · constraints · examples; inherited by every role. |
| [`schemas/`](schemas/) | One **JSON Schema** per form — the machine-readable enforcement source for `protocol.md` (validated by the `SendMessage` guard + normalizer). |
| [`guardrails.md`](guardrails.md) | Standing guardrails + tool-output economy; inherited by every role and mode. |
| [`conventions.md`](conventions.md) | Cross-project conventions — plan format + authoring rules; inherited by every role and mode via @import in the host root prompt. |
| [`roles/`](roles/) | One file per role: mission · owns · operating routine · self-verify gate · orchestration contract. |

Roles: [`orchestrator`](roles/orchestrator.md) · [`contract`](roles/contract.md) ·
[`backend`](roles/backend.md) · [`frontend`](roles/frontend.md) ·
[`infrastructure`](roles/infrastructure.md) · [`testing`](roles/testing.md) ·
[`docs`](roles/docs.md).

## Reuse in a new project

1. **Copy** `.claude/team-process/` verbatim — carries no project specifics.
2. **Anchor** agent definitions to the role files (see *Anchoring*).
3. **Set project bindings once** in the root prompt (`CLAUDE.md` / `AGENTS.md`): owning-spec locations, line-ending + formatter, CI gates.

**Kit = generic layer; agents + root prompt = project layer.** Update kit for universal lessons; project layer for local ones.

## Anchoring (generic role → project agent)

Each project agent declares the role it fulfils and inherits that role's contract. **Claude Code
reference implementation** (`.claude/agents/*.md`); another runtime maps its own agent files to the same roles:

| Project agent | Role |
|---|---|
| `api-architect` | [`contract`](roles/contract.md) |
| `backend-developer` | [`backend`](roles/backend.md) |
| `frontend-developer` | [`frontend`](roles/frontend.md) |
| `deployment-engineer` | [`infrastructure`](roles/infrastructure.md) |
| `testing-specialist` | [`testing`](roles/testing.md) |
| `docs-keeper` | [`docs`](roles/docs.md) |
| main loop (no agent file) | [`orchestrator`](roles/orchestrator.md) |

The agent's **body** is vendor- and project-agnostic — just the anchor:
`Role anchor: team-process/roles/<role>.md — inherit its full definition (mission, principles, guardrails, communication protocol, tool-output economy, self-verify gate). Project bindings come from the host root prompt.`

Per-vendor glue (extension, location, frontmatter) is the only thing that differs — body copies as-is:

| Runtime | Agent file | Spawn primitive |
|---|---|---|
| Claude Code | `.claude/agents/<role>.md` | `Agent`/Task · `/feature-team` → background Agents (`run_in_background`) |
| GitHub Copilot | `.github/agents/<role>.agent.md` | `@<role>` · `/fleet` |

Keep `agents/` and `team-process/` under the **same parent** so `../team-process/roles/…` resolves for both. See *Execution modes* in `process.md` for the full runtime binding.

**Project specifics never live in the agent.** Stack, build/test/lint/format commands, file lanes, CI gates → root prompt's *Project bindings* section only.
