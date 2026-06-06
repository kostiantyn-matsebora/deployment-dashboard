# Team Process Kit

A portable definition of how a small fleet of role-specialist agents collaborate on a
non-trivial change under one orchestrator. Drop into any repo spanning **frontend + backend +
infrastructure** (or a subset). Defines *who does what and how they coordinate* — not the
technology.

The **core** (`process.md` · `roles/`) is stack-, domain-, and **runtime-agnostic**; the only
client-specific wiring is one labeled *Claude Code binding* in `process.md` (and the
reference agents below), which another agent runtime can swap.

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

1. **Copy** `.claude/team-process/` in verbatim — it carries no project specifics.
2. **Anchor** your agent definitions to the role files (see *Anchoring*).
3. **Set project bindings once** in your root prompt (`CLAUDE.md` / `AGENTS.md`): owning-spec
   locations (docs-first target), line-ending + formatter convention, the CI gates self-verify runs.

The kit is the **generic layer**; your agents + root prompt are the **project layer**. Update
the kit when a lesson is universal; update the project layer when it's local.

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
`Role anchor: team-process/roles/<role>.md — inherit its full definition (mission, principles,
guardrails, communication protocol, tool-output economy, self-verify gate). Project bindings
come from the host root prompt.`

**Per-vendor glue** (extension, location, frontmatter) is the only thing that differs — the body copies as-is:

| Runtime | Agent file | Spawn primitive |
|---|---|---|
| Claude Code | `.claude/agents/<role>.md` | `Agent`/Task · `/feature-team` → `TeamCreate` |
| GitHub Copilot | `.github/agents/<role>.agent.md` | `@<role>` · `/fleet` |

Keep `agents/` and `team-process/` under the **same parent** so the relative anchor (`../team-process/roles/…`) resolves regardless of whether that parent is `.claude/` or `.github/`. See `process.md` → *Execution modes* for the full binding per runtime.

**Project specifics never live in the agent.** Stack, exact build/test/lint/format commands,
file lanes, and CI gates go once into the root prompt's *Project bindings* section; the agent
reads them at runtime. This is what keeps agents portable across repos.
