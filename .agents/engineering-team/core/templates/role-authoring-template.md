---
name: <your-role-name>
description: <One paragraph — what this role owns, when to dispatch it, and what it MUST NOT do.>
aliases: [<generic-alias-1>, <generic-alias-2>]
---

# Role Authoring Template

<!--
  Usage:
  1. Copy to local/roles/<your-role-name>.md.
  2. Fill sections that apply.
  3. Drop sections you don't need.
  4. NEVER leave empty headings.
  Discovery:
  - project-manager scans local/roles/*.md on next prompt.
  - project-manager adds the role to routing.
  Hierarchy:
  - Custom roles register UNDER project-manager.
  - NEVER alongside.
  Shape:
  - Mirrors core/roles/*.md (the 7 cardinals).
  - Consistent shapes = faster LLM routing.
-->

---

## Source of truth

<!-- Read before every task (per core/process.md § Reading order). -->

- `<doc 1 — path in local/framework.config.yaml or absolute>` — `<one-line why>`
- `<doc 2>` — `<one-line why>`
- `<mockup, when relevant>` — `<one-line why>`

**Conflict resolution.** Per `core/process.md` § Coordination protocol AND `local/bindings.md` → "Source of truth" tie-breaker.

## Estimation-first dispatch

<!-- Trigger: dispatch scope > 15-min threshold (per core/iteration-protocol.md). -->

**First response (before any edits):**

1. **Task decomposition** — sub-tasks in active voice.
2. **Per-task time estimate** — minutes per sub-task.

**Then:**

- Wait for orchestrator/user approval.
- Proceed per Iteration protocol.
  - 3–5 min iterations.
  - Each iteration ends in a stoppable intermediate state.

## What you own (and only you edit)

<!-- Look up exact paths in local/bindings.md. -->

| Path / surface | What it is |
|---|---|
| `<path-glob 1>` | `<one-line>` |
| `<path-glob 2>` | `<one-line>` |

## What you do NOT own (and must NOT edit)

<!--
  Project-wide forbidden table:
  - local/bindings.md → "Project role boundaries".
-->

| Thing | Owning role | Why |
|---|---|---|
| `<thing 1>` | `<owning role>` | `<why>` |
| `<thing 2>` | `<owning role>` | `<why>` |

**Out-of-domain need surfaces mid-task →** stop and hand off per `core/process.md` § Cross-agent handoff — diagnose ≠ fix.

## Workspace layout

<!--
  Scope:
  - Per-tier dependency rules.
  Source:
  - Mirror OR extend local/bindings.md → "Repository structure".
-->

- `<rule 1>` — `<one line>`
- `<rule 2>` — `<one line>`

## Declarative configuration only

<!-- Per core/process.md § Configuration vs. data. -->

| Kind | Goes in | Never as |
|---|---|---|
| Configuration | `<file>` | string literals inside `<surface>` |
| Data / fixtures | `<file>` | inline literals inside `<surface>` |

## Stack — role specifics

<!--
  Canonical stack:
  - local/bindings.md → "Stack".
  Role-specific rules listed below.
-->

| Concern | Choice |
|---|---|
| `<concern 1>` | `<rule>` |
| `<concern 2>` | `<rule>` |

**Do NOT introduce** `<X / Y / Z>` — see `local/bindings.md` → "Do not introduce".

## Required behaviours

<!--
  Source:
  - Drive from the FR table in the architecture doc.
  Content:
  - List FRs/NFRs this role primarily owns OR implements.
-->

## When proposing changes

- `<role-specific lead — e.g. "Lead with cost delta">`
- `<role-specific lead 2>`
- **Wire-shape change →** flag cross-domain consumers in your final report.

## Forbidden actions (strict-domain)

- **Never** `<action 1>`.
- **Never** `<action 2>`.
- **Never** `<action 3>`.

## Reporting

<!--
  Structured final report:
  - core/templates/phase-report.md.
  Role-specific highlights listed below.
-->

- `<role-specific reporting expectation>`
- `<role-specific verification log entry>`
