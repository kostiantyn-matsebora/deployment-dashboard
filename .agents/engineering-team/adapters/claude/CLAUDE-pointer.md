# CLAUDE-pointer

Append this block to the project's `CLAUDE.md` (or paste at the top if no existing file).

---

## Engineering team framework

Project uses the [`engineering-team`](.agents/engineering-team/) framework. **Read before any work:**

- `.agents/engineering-team/core/process.md` — vendor-neutral process spec (lifecycle, dispatch, iteration protocol, doc co-ownership, task model).
- `.agents/engineering-team/local/bindings.md` — project routing, role boundaries, source-of-truth, stack.
- `.agents/engineering-team/local/project-profile.md` — discovered project context (filled by `project-manager` on first run).

**Dispatch.** Via cardinal roles in `.claude/agents/` (installed from `.agents/engineering-team/adapters/_shared/agents/` per `.agents/engineering-team/adapters/claude/install.md`). Claude Code routes via subagent description match — natural language, no `@` literal.

**Orchestrator.** `project-manager`.

**Workflows.** AgentSkills at `.claude/skills/ginee-*/` (discovery / rediscover / file-bug / file-feature / pick-up / triage / promote-discussion / reindex). Type the workflow in natural language — Claude auto-activates the matching skill. See `.agents/engineering-team/adapters/claude/install.md § How to invoke` for the phrasing cheat sheet.

**Custom roles.** `.agents/engineering-team/local/roles/`.

**First install.** Type `Run initial discovery` — activates the `ginee-discovery` skill.

---
