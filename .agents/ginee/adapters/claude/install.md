# Claude Code adapter — install

## Prerequisites

- `.agents/ginee/` directory present at the project root.
- `.claude/agents/` directory:
  - Claude Code creates it.
  - Create manually if absent.

## Steps

1. **Copy the shared pointer subagents** — from `.agents/ginee/adapters/_shared/agents/*.md` into `.claude/agents/`.

   ```powershell
   New-Item -ItemType Directory -Force .claude\agents | Out-Null
   Copy-Item .agents\ginee\adapters\_shared\agents\*.md .claude\agents\
   ```

   ```bash
   mkdir -p .claude/agents
   cp .agents/ginee/adapters/_shared/agents/*.md .claude/agents/
   ```

2. **Bridge the framework skills** — copy (or symlink) framework skills into `.claude/skills/` so Claude Code's skill discovery picks them up.

   Skills follow the [AgentSkills standard](https://agentskills.io). Source: `.agents/ginee/core/skills/ginee-*/`. Each is a directory containing `SKILL.md`. Per [Claude Code skills docs](https://code.claude.com/docs/en/skills), Claude Code only searches `.claude/skills/` (and `~/.claude/skills/`) at the project level — it does **not** currently honor the cross-tool `.agents/skills/` path that other clients (e.g. Copilot) accept. Once it does, this bridge can collapse.

   ```powershell
   New-Item -ItemType Directory -Force .claude\skills | Out-Null
   Copy-Item -Recurse .agents\ginee\core\skills\ginee-* .claude\skills\
   ```

   ```bash
   mkdir -p .claude/skills
   cp -r .agents/ginee/core/skills/ginee-* .claude/skills/
   ```

   Symlinks work too on POSIX shells (`ln -s .agents/ginee/core/skills/ginee-* .claude/skills/`) — preferred for auto-update; copies need re-running on upgrade.

3. **Update `CLAUDE.md`.**
   - Append the block from `.agents/ginee/adapters/claude/CLAUDE-pointer.md` to the project's `CLAUDE.md`.
   - No existing `CLAUDE.md` — create one with that block as the content.

4. **Run discovery.**
   - Open the project in Claude Code.
   - In chat, ask Claude to run initial discovery — Claude auto-routes to `team-lead` via subagent description match. Equivalent phrasings:

     ```
     Run initial discovery.
     ```
     ```
     @team-lead run initial discovery     (works in Cursor; in Claude Code @ is not literal — see "How to invoke" below)
     ```

5. **Verify.** Ask Claude for the status of each cardinal. Each should:
   - Report its charter (read from `.agents/ginee/core/roles/<role>.md`).
   - Confirm the project's bindings.

## How to invoke

Claude Code has no literal `@<agent-name>` chat syntax. Three working invocation paths (pick whichever fits the workflow):

| Path | When |
|---|---|
| **AgentSkills (recommended for framework workflows)** — Claude auto-activates the matching skill from `.claude/skills/ginee-*/`. Just type natural language matching the skill's description (e.g., "file a bug report titled X"). | File / pick-up / triage / promote / discovery / reindex. |
| **Natural-language subagent dispatch** — describe what you want; Claude routes to the matching subagent in `.claude/agents/` via description match. | Specialist dispatches (`solution-architect`, `backend-engineer`, etc.). |
| **Explicit Task call** — Claude may use the `Task` tool internally to spawn a subagent in an isolated session. No user-visible invocation; it happens automatically when delegation is warranted. | Long-running parallel work. |

Cheat sheet for the 12 framework workflows (AgentSkills auto-activates from these phrasings):

| Phrasing | Activates |
|---|---|
| "Run initial discovery" | `ginee-discovery` |
| "Rediscover the project" | `ginee-rediscover` |
| "File a bug titled X" | `ginee-file-bug` |
| "File a feature request titled X" | `ginee-file-feature` |
| "File a framework bug titled X" | `ginee-file-framework-bug` |
| "File a framework feature titled X" | `ginee-file-framework-feature` |
| "Pick up #N" / "Work on the TODO about X" / "Start on Y" | `ginee-pick-up` (unified — issues, TODO lines, freeform) |
| "Triage" / "List ready work" / "Show the backlog" / "Triage framework" / "Triage todos" | `ginee-triage` (unified — issues + framework + TODOs) |
| "Promote discussion #N" / "Promote framework discussion #N" | `ginee-promote-discussion` |
| "Reindex" / "Reindex `<file>`" / "Reindex `<class>`" / "Reconcile the index" | `ginee-reindex` |
| "Update ginee" / "Upgrade the framework" / "Bump ginee to `v<X>`" / "Pull the latest ginee" | `ginee-update` |
| "Address review on PR #N" / "Respond to review on #N" / "Handle review feedback on #N" | `ginee-address-review` |

The framework's own `core/process.md` and role kernels use `@<role>` notation as vendor-neutral shorthand — Claude Code adopters read that as "the orchestrator routes here," not as a literal command.

## Updates

**Recommended — re-run the installer**: `.\install.ps1 -UpdateOnly -Adapter claude` (or `./install.sh --update-only --adapter claude`). It performs all the steps below automatically, including the pointer-block sync in step 5.

Manual equivalent:

1. Re-fetch `.agents/ginee/core/` + `.agents/ginee/adapters/` + `.agents/ginee/extras/` (your `local/` survives).
2. Re-copy `.agents/ginee/adapters/_shared/agents/*.md` to `.claude/agents/` (pointers may have been refined).
3. Re-copy `.agents/ginee/core/skills/ginee-*` to `.claude/skills/` (skill bodies / descriptions may have been refined). Skip if you used symlinks in step 2 above.
4. Read `.agents/ginee/core/MIGRATIONS/` for breaking-change notes.
5. **Re-sync the pointer block in `CLAUDE.md`** — pointer blocks evolve across releases. Find the existing block (between `## Engineering team framework` and the next `---`) and replace its body with the current `.agents/ginee/adapters/claude/CLAUDE-pointer.md` content. The installer's `-UpdateOnly` path does this automatically; manual one-liner equivalents in `core/MIGRATIONS/engineering-team-renamed-ginee.md § Action required #2`.
6. **For pre-D11 (pre-2026-05-18) upgrades** — run the rename migration script once:
   - `.\.agents\ginee\core\scripts\migrate-engineering-team-to-ginee.ps1` (or `.sh`).
   - Rewrites legacy `engineering-team` references under `local/*`.
   - Idempotent; safe to run on already-migrated installs.
   - Full notes: `.agents/ginee/core/MIGRATIONS/engineering-team-renamed-ginee.md`.

## Uninstall

1. Delete the 7 cardinal files from `.claude/agents/` (and any custom roles you copied).
2. Delete `.claude/skills/ginee-*` (or remove the symlinks).
3. Remove the pointer block from `CLAUDE.md`.
4. Optionally delete `.agents/ginee/`.
