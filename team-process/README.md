# Team Process Kit

A portable, **project-agnostic** definition of how a small fleet of role-specialist
agents collaborate on a non-trivial change under one orchestrator. Drop it into any
repo that spans **frontend + backend + infrastructure** (or a subset).

Stack-, domain-, and tool-agnostic. The kit defines *who does what and how they
coordinate* — not the technology.

## Layout

| File | Role |
|---|---|
| [`process.md`](process.md) | The orchestration playbook: phases, parallelization, communication model, the guardrails every role inherits, and the when-to-use threshold. |
| [`roles/`](roles/) | One file per role. Each states mission · owns (file lane) · consumes · produces · hand-off · self-verify gate · must-not. |

Roles: [`orchestrator`](roles/orchestrator.md) · [`contract`](roles/contract.md) ·
[`backend`](roles/backend.md) · [`frontend`](roles/frontend.md) ·
[`infrastructure`](roles/infrastructure.md) · [`testing`](roles/testing.md) ·
[`docs`](roles/docs.md).

## How to reuse in a new project

1. **Copy** `team-process/` into the repo verbatim. It carries no project specifics.
2. **Anchor** your agent/specialist definitions to the role files — each agent
   inherits its role's mission + guardrails and adds only the project bindings
   (stack, file paths, build/test/lint/format gates). See *Anchoring* below.
3. **Set the project bindings once** in your root prompt file (`CLAUDE.md` /
   `AGENTS.md` / equivalent): the owning-spec locations (docs-first target), the
   line-ending + formatter convention, and the CI gates the self-verify step runs.

The kit is the **generic layer**; your agents + root prompt are the **project layer**.
Update the kit when a lesson is universal; update the project layer when it's local.

## Anchoring (generic role → project agent)

Each project agent declares the role it fulfils and inherits that role's contract.
Reference implementation in this repo (`.claude/agents/*.md`):

| Project agent | Anchors to role |
|---|---|
| `api-architect` | [`contract`](roles/contract.md) |
| `backend-developer` | [`backend`](roles/backend.md) |
| `frontend-developer` | [`frontend`](roles/frontend.md) |
| `deployment-engineer` | [`infrastructure`](roles/infrastructure.md) |
| `testing-specialist` | [`testing`](roles/testing.md) |
| `docs-keeper` | [`docs`](roles/docs.md) |
| main loop (no agent file) | [`orchestrator`](roles/orchestrator.md) |

An anchor is a short block in the agent body:
`Role anchor: team-process/roles/<role>.md — inherit its mission, guardrails, and
self-verify gate. Project bindings: <stack / paths / gates>.`
