---
name: ginee-triage
description: List ready work across all task sources (GitHub issues + TODO files) and propose a pickup order. Use when the user asks to 'triage', 'list ready work', 'what should I work on', 'show the backlog'. Optional positional arg narrows scope ('issues' / 'framework' / 'todos'). Returns a merged table; never picks on its own.
---

# Triage — list ready work

Single backlog view across all task sources per `.agents/engineering-team/core/process.md § Task model`. Reads-only — never picks.

## Activation

User asks "triage" / "list ready work" / "what should I work on" / "show the backlog".

Optional positional arg narrows scope:

| Arg | Scope |
|---|---|
| (none) | All sources — primary repo issues + framework upstream issues (if configured) + TODOs. |
| `issues` | Primary repo issues only. |
| `framework` | Framework upstream issues only. |
| `todos` | TODO files only (root + nested). |

## Procedure

### Step 1 — gather per scope

- **Issues (primary):** `gh issue list --repo <primary-repo> --label <ready-label> --state open --json number,title,labels,createdAt` (or GitHub MCP).
- **Issues (framework upstream):** same against `github.framework-repo`. Fail fast with clear message if unset and user requested `framework` scope; silently skip when running default "all sources" scope.
- **TODOs:** grep `☐` across the repo-root TODO file (per `framework.config.yaml § todo`) + nested TODO files (per `framework.config.yaml § nested-todos-glob`). Capture file path + line + content.

### Step 2 — surface as one merged table

Columns: Source / Ref / Title / Age (or first-seen for TODOs) / Notes.

Sources:
- `issue:primary` — `#<N>` ref.
- `issue:framework` — `#<N>` ref.
- `todo` — `<path>:<line>` ref.

### Step 3 — propose pickup order

Rank by:
1. Age (older first; modulo urgent items with explicit priority labels or wording).
2. Apparent scope (bug-fixes typically shorter than feature work).
3. Cross-references with active work (avoid context-switch thrash; group related items).

### Step 4 — close with explicit pickup instruction

End the response with: *"Pick one with `pick up <ref>` (issue, TODO line, or freeform)."* Never auto-invoke `ginee-pick-up`.

## Forbidden

- Never auto-pick.
- Never modify state (no label swaps, no TODO glyph flips).
- Never fall back to broader scope when a narrower scope was requested and its data is missing — fail with a clear message instead.
- Never include closed issues or `☒` TODOs in the listing.
