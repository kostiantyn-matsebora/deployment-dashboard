# Claude Code adapter

For projects using [Claude Code](https://code.claude.com/).

The 7 cardinal roles install as native Claude Code subagents at `.claude/agents/<role>.md`.

## Capability tier — **1** (native subagents + parallel dispatch)

- Verified against Claude Code subagent docs as of 2026-05.
- Re-check per release.

## What this adapter ships

| Path | What it is |
|---|---|
| `CLAUDE-pointer.md` | Block to append to the project's `CLAUDE.md` |
| `install.md` | Step-by-step install procedure |

**Subagent pointer files:**
- Live in `.agents/engineering-team/adapters/_shared/agents/*.md`.
- Shared with the Copilot CLI adapter.
- No duplication.

## How it works

Subagent files at `.claude/agents/<role>.md` carry only:

- Front-matter (`name`, `description`) — what Claude Code uses for routing.
- A 4-line body instructing the subagent to read:
  - `.agents/engineering-team/core/roles/<role>.md` (canonical charter)
  - `core/process.md`
  - `local/bindings.md`
  - `local/project-profile.md`

Key properties:
- Canonical charter lives once in `core/roles/`.
- Subagent files are pure pointers.
- Updates to `core/` propagate immediately.

## Pointer line (for your `CLAUDE.md`)

```
Engineering team framework: see .agents/engineering-team/core/process.md + .agents/engineering-team/adapters/claude/CLAUDE-pointer.md
```

Or paste the full block from `CLAUDE-pointer.md` for context-rich onboarding.

## Smoke test

1. Install per `install.md`.
2. Open in Claude Code.
3. Prompt `@project-manager status` — confirm it loads.
4. Prompt `@project-manager run initial discovery` — confirm it produces `local/project-profile.md`, `local/bindings.md`, `local/framework.config.yaml`.

## Custom roles

1. Place custom subagent definitions in `.agents/engineering-team/local/roles/<role>.md` (use `core/templates/role-authoring-template.md`).
2. Create a matching `.claude/agents/<role>.md` pointer (copy the shape from `_shared/agents/`).
3. `project-manager` discovers them on next prompt.
