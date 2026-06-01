# Engineering Process — Agent Dispatch Convention

**Status:** Draft · **Date:** 2026-06-01

Defines specialist-routing for every change in this repo. Stack-agnostic; suitable for extraction to a shared engineering-team framework.

---

## Routing

The main loop orchestrates: plans, sequences, and synthesizes specialist returns. There is no separate orchestrator or team-lead agent.

Route each change to the specialist that owns it:

| Change type | Agent |
|---|---|
| Contract / API shape (endpoint, verb, payload, wire format) | `api-architect` |
| Server-side / backend code | `backend-developer` |
| Frontend / SPA / UI | `frontend-developer` |
| CI/CD workflows, containers (Docker/Compose), release lifecycle, infrastructure (IaC) | `deployment-engineer` |
| Tests + verification | `testing-specialist` |
| Markdown docs / `index.md` / sources-of-truth | `docs-keeper` |

## Rules

- **Surface before launch.** Present the dispatch plan (which agents + scope) before starting. For N parallel agents, get explicit user confirmation first.
- **Parallelize only independent slices.** Serialize coupled or shared-file edits — or isolate them in separate git worktrees — to avoid git index contention.
- **Inline execution is the exception.** Reserve main-loop execution for trivial edits, orchestration itself, and conversational turns. Substantive changes go to the owning specialist.
