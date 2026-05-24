# CLAUDE-pointer

Append this block to the project's `CLAUDE.md` (or paste at the top if no existing file).

---

## Engineering team framework

Project uses the [`ginee`](.agents/ginee/) framework. **Read before any work:**

- `.agents/ginee/core/process.md` — vendor-neutral process spec (lifecycle, dispatch, iteration protocol, doc co-ownership, task model).
- `.agents/ginee/local/bindings.md` — project routing, role boundaries, source-of-truth, stack.
- `.agents/ginee/local/project-profile.md` — discovered project context (filled by `team-lead` on first run).

**Dispatch.** Via cardinal roles in `.claude/agents/` (installed from `.agents/ginee/adapters/_shared/agents/` per `.agents/ginee/adapters/claude/install.md`). Claude Code routes via subagent description match — natural language, no `@` literal.

**Orchestrator.** `team-lead`.

**Workflows.** AgentSkills at `.claude/skills/ginee-*/` (discovery / rediscover / file-bug / file-feature / pick-up / triage / promote-discussion / reindex / update). Type the workflow in natural language — Claude auto-activates the matching skill. See `.agents/ginee/adapters/claude/install.md § How to invoke` for the phrasing cheat sheet.

**Custom roles + cardinal extensions.** `.agents/ginee/local/roles/`. Two uses:

- **Custom new roles** — author a role definition; register under `team-lead` per discovery flow.
- **Cardinal extensions** (D37-local-role-extensions) — author `.agents/ginee/local/roles/<cardinal>.md` (matching name of a cardinal: `team-lead` · `solution-architect` · `backend-engineer` · `frontend-engineer` · `devops-engineer` · `qa-engineer` · `ai-engineer`). The shared pointer auto-loads it as the final read in the cardinal's read chain — augments the charter with project-specific craft notes; never replaces. Absence is a no-op.

**First install.** Type `Run initial discovery` — activates the `ginee-discovery` skill.

---

## CR convention (local)

GitHub issues are the canonical design-of-record for any work picked up via `/ginee-pick-up #<N>` — the issue body + comment thread + linked PR description carry scope, motivation, decisions, and acceptance criteria. A separate CR markdown file is **redundant** for issue-sourced work and is no longer authored for this project.

**Authoring rule.** A new Change Request (`docs/cr/CR-<N>-*.md`) is authored **only** when the task source is:

- A **free-form** instruction without a GitHub issue (e.g., `pick up "refactor the X service"`), **OR**
- A **TODO line** (e.g., `pick up TODO:42`).

When a free-form task escalates and gains a GitHub issue mid-flight, the in-flight CR is closed in place and the issue body takes over as design-of-record.

**Historical CRs.** `CR-0001..CR-0015` were retired in the branch that introduced this rule. Their substantive decisions live on in: `docs/architecture.md` (FRs / NFRs / invariants), `docs/adr/` (architectural decisions), and the corresponding GitHub issues where back-mappable. See git history for the original CR text.

**Issue registry.** Open + recently-closed issues are summarized in `.agents/ginee/local/index/github-issues-index.idx` (refreshed by `ginee-reindex` and post-acceptance). Consume this index in place of `docs/cr/` lookups.

---
