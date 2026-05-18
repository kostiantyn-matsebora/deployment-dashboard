# Migration — D16: AgentSkills as per-adapter invocation surface

**Target release:** next minor after 2026-05-17.
**Affected adopters:** every adopter project that uses `@<role>`-style invocation as documented in adapter install instructions.

## What changed

Framework workflows now ship as Skills per the [AgentSkills standard](https://agentskills.io). The `@<role>` notation in framework docs stays as vendor-neutral shorthand — but it does NOT map to a literal command in most clients. Each adapter's install.md now documents the actual per-client invocation surface.

New artefacts:

- `core/skills/ginee-discovery/`
- `core/skills/ginee-rediscover/`
- `core/skills/ginee-file-bug/`
- `core/skills/ginee-file-feature/`
- `core/skills/ginee-file-framework-bug/`
- `core/skills/ginee-file-framework-feature/`
- `core/skills/ginee-pick-up/` (unified across issues + TODOs + freeform)
- `core/skills/ginee-triage/` (unified across all task sources)
- `core/skills/ginee-promote-discussion/`
- `core/skills/ginee-reindex/`

Each is a directory with a `SKILL.md` (YAML frontmatter + Markdown body) per the AgentSkills standard.

## Action required

After re-fetching framework files on upgrade:

### Claude Code adopters

```bash
mkdir -p .claude/skills
cp -r .agents/ginee/core/skills/ginee-* .claude/skills/
```

Or use symlinks (POSIX) for auto-update on framework upgrade.

See `.agents/ginee/adapters/claude/install.md § Step 2`.

### GitHub Copilot CLI / VS Code Copilot

```bash
mkdir -p .github/skills
cp -r .agents/ginee/core/skills/ginee-* .github/skills/
```

See `.agents/ginee/adapters/copilot-cli/install.md § Step 3`.

### AGENTS.md adopters (Cursor / Codex / Gemini CLI / Goose / etc.)

Per-client destination:

| Client | Destination |
|---|---|
| Cursor | `.cursor/skills/` |
| OpenAI Codex | `~/.codex/skills/` or per-project (see Codex docs) |
| Gemini CLI | per Gemini CLI skills docs |
| Goose | `~/.config/goose/skills/` |
| Other AgentSkills clients | per the client's docs |

```bash
mkdir -p <destination>
cp -r .agents/ginee/core/skills/ginee-* <destination>/
```

See `.agents/ginee/adapters/agents-md/install.md § Step 3`.

### Generic adapter

Skills only auto-activate in AgentSkills-compatible clients. For clients without AgentSkills support, framework workflows still work via natural-language routing to the orchestrator (no change). See `.agents/ginee/adapters/generic/install.md § Step 3`.

## Documentation changes

- `core/process.md` and role kernels keep `@<role>` notation as vendor-neutral shorthand.
- Each adapter's `install.md` gained a "How to invoke" section showing client-native invocations (Cursor literal, Claude Code natural-language, generic `act as <role>`).

## Backward compatibility

- No `local/` files change.
- Existing `@<role>` notation in adopter-authored docs still reads correctly (it's framework shorthand). The literal `@` was never universally functional anyway — Cursor accepted it, Claude Code never did.
- Adopters who skipped the skill-bridge step still have working framework workflows via natural-language routing; they just don't get the discoverability of skill auto-activation.

## Rollback

Delete `ginee-*` directories from the client's skill path. Framework workflows revert to natural-language-only invocation.

## Issue reference

Implemented per [issue #2](https://github.com/kostiantyn-matsebora/ginee/issues/2) — "Per-adapter invocation surfaces — make framework workflows actually runnable per tool."
