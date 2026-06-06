# Team Process Kit

A portable, **project-agnostic** definition of how a small fleet of role-specialist agents
collaborate on a non-trivial change under one orchestrator. Drop into any repo spanning
**frontend + backend + infrastructure** (or a subset). Defines *who does what and how they
coordinate* — not the technology (stack-, domain-, tool-agnostic).

## Layout

| File | Role |
|---|---|
| [`process.md`](process.md) | Orchestration playbook: routing, phases, execution modes, the **communication protocol** (5 typed messages), inherited guardrails, when-to-use threshold. |
| [`roles/`](roles/) | One file per role: mission · owns · operating routine · self-verify gate · orchestration contract. |

Roles: [`orchestrator`](roles/orchestrator.md) · [`contract`](roles/contract.md) ·
[`backend`](roles/backend.md) · [`frontend`](roles/frontend.md) ·
[`infrastructure`](roles/infrastructure.md) · [`testing`](roles/testing.md) ·
[`docs`](roles/docs.md).

## Reuse in a new project

1. **Copy** `team-process/` in verbatim — it carries no project specifics.
2. **Anchor** your agent definitions to the role files (see *Anchoring*).
3. **Set project bindings once** in your root prompt (`CLAUDE.md` / `AGENTS.md`): owning-spec
   locations (docs-first target), line-ending + formatter convention, the CI gates self-verify runs.

The kit is the **generic layer**; your agents + root prompt are the **project layer**. Update
the kit when a lesson is universal; update the project layer when it's local.

## Anchoring (generic role → project agent)

Each project agent declares the role it fulfils and inherits that role's contract. Reference
implementation (`.claude/agents/*.md`):

| Project agent | Role |
|---|---|
| `api-architect` | [`contract`](roles/contract.md) |
| `backend-developer` | [`backend`](roles/backend.md) |
| `frontend-developer` | [`frontend`](roles/frontend.md) |
| `deployment-engineer` | [`infrastructure`](roles/infrastructure.md) |
| `testing-specialist` | [`testing`](roles/testing.md) |
| `docs-keeper` | [`docs`](roles/docs.md) |
| main loop (no agent file) | [`orchestrator`](roles/orchestrator.md) |

An anchor is a short block in the agent body:
`Role anchor: team-process/roles/<role>.md — inherit its mission, guardrails, communication
protocol, and self-verify gate. Project bindings: <stack / paths / gates>.`
