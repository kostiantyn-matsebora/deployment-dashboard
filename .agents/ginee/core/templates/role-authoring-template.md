---
name: <your-role-name>
description: <One paragraph — what this role owns · when to dispatch · what it MUST NOT do.>
aliases: [<generic-alias-1>, <generic-alias-2>]
---

# Role Authoring Template

<!--
  Usage: copy to local/roles/<your-role-name>.md · fill sections that apply · drop unused · never leave empty headings.
  Discovery: team-lead scans local/roles/*.md on next prompt + adds to routing.
  Hierarchy: custom roles register UNDER team-lead, never alongside.
  Shape: mirrors core/roles/*.md (7 cardinals) — consistent shapes = faster LLM routing.
-->

---

## Source of truth

Index-first per `core/protocols/role-kernel-shared.md § A`. Two-tier table:

| Read | What it gives you | Load when |
|---|---|---|
| `local/index/<file>` | `<one-line — what signal the role gets>` | **always** |
| `local/index/<file>` | `<one-line>` | `<trigger phrase, e.g. wire/endpoint touch>` |

Governance-only / ad-hoc roles (no index files) — flat list:

- `<doc 1 — path>` — `<one-line why>`
- `<doc 2>` — `<one-line why>`

**Conflict resolution** per `core/process.md § Coordination protocol` + `local/bindings.md § Source-of-truth ownership` tie-breaker.

## Estimation-first dispatch

Per `core/protocols/role-kernel-shared.md § B`. Decomposition surfaces: `<role-specific sub-task list>`.

## What you own (and only you edit)

Look up exact paths in `local/bindings.md`.

| Path / surface | What it is |
|---|---|
| `<path-glob 1>` | `<one-line>` |
| `<path-glob 2>` | `<one-line>` |

## What you do NOT own

Project-wide forbidden table: `local/bindings.md § Project role boundaries`. Role-specific:

| Thing | Owning role | Why |
|---|---|---|
| `<thing 1>` | `<owning role>` | `<why>` |
| `<thing 2>` | `<owning role>` | `<why>` |

Out-of-domain need surfaces mid-task → stop + hand off per `core/protocols/cross-agent-handoff.md` — diagnose ≠ fix.

## Workspace layout

Mirror / extend `local/bindings.md § Repository structure`:

- `<rule 1>` — `<one line>`
- `<rule 2>` — `<one line>`

## Declarative configuration

Per `core/process.md § Configuration vs. data`:

| Kind | Goes in | Never as |
|---|---|---|
| Configuration | `<file>` | string literals inside `<surface>` |
| Data / fixtures | `<file>` | inline literals inside `<surface>` |

## Stack — role specifics

Canonical: `local/bindings.md § Stack`. Role-specific:

| Concern | Choice |
|---|---|
| `<concern 1>` | `<rule>` |
| `<concern 2>` | `<rule>` |

**Do NOT introduce** `<X / Y / Z>` — see `local/bindings.md § Do not introduce`.

## Required behaviours

Drive from FR table — list FRs / NFRs this role owns or implements.

## When proposing changes

- `<role-specific lead — e.g. "Lead with cost delta">`
- `<role-specific lead 2>`
- Wire-shape change → flag cross-domain consumers in final report.

## Forbidden actions

Per `core/protocols/role-kernel-shared.md § F`. Role-specific:

- **Never** `<action 1>`.
- **Never** `<action 2>`.
- **Never** `<action 3>`.

## Reporting

Per `core/protocols/role-kernel-shared.md § D`. Role-specific:

- `<role-specific expectation>`
- `<role-specific verification log entry>`
