# Engineering Process — Agent Dispatch Convention

**Status:** Draft · **Date:** 2026-06-01

Defines specialist-routing for every change in this repo. Stack-agnostic. This page is the
project-specific routing surface (concrete agents); the generalized, portable version of it
is the orchestration kit — see *Orchestration playbook* below.

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

## Orchestration playbook

The routing table above is the only project-specific surface. The orchestration **mechanics**
— launch rules, execution modes (in-session subagents vs spawned team), phases, and the fix
loop — live once in the portable kit `.claude/team-process/process.md`, with the typed
communication protocol (`BRIEF` / `RESULT` / `FINDING` / `FIX` / `ARTIFACT`) in its `protocol.md`
companion and the standing guardrails in `guardrails.md` (generic role names; this repo's
role→agent mapping and per-role stack/lanes/gates are in `CLAUDE.md` § *Project bindings*).
