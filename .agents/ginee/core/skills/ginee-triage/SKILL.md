---
name: ginee-triage
description: List ready work across all task sources (GitHub issues + TODO files) and propose a pickup order. Use when the user asks to 'triage', 'list ready work', 'what should I work on', 'show the backlog'. Optional positional arg narrows scope ('issues' / 'framework' / 'todos'). Returns a merged table; never picks on its own.
---

# Triage — list ready work

Single backlog view across all task sources per `.agents/ginee/core/process.md § Task model`. Reads-only — never picks.

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

### Step 2 — parse scoring labels + markers

Per `.agents/ginee/core/triage-scoring.md`:

- **Issues:** parse `value:high|medium|low` + `complexity:high|medium|low` from the `labels` array.
- **TODOs:** parse `[v:H c:L]` inline marker (H/M/L, case-insensitive) between glyph and description; partial markers (`[v:H]` only / `[c:L]` only) handled; missing marker = unscored.
- Map labels to numeric: `high = 3, medium = 2, low = 1`.
- Compute `score` per `triage.scoring-formula` from `local/framework.config.yaml` (default `value-over-complexity` → `value / complexity`; `value-only` → `value`; `value-minus-complexity` → `value - complexity`).
- Edge cases: only `value` → impute `complexity = L = 1`; only `complexity` / neither → score 0 (unscored).

### Step 3 — surface as one merged table

Columns: Source / Ref / Title / `v` / `c` / Score / Age.

Sources:
- `issue:primary` — `#<N>` ref.
- `issue:framework` — `#<N>` ref.
- `todo` — `<path>:<line>` ref.

Render scores to 2 decimals. Unscored cells = `—`.

### Step 4 — sort + group

- Primary sort: `Score DESC, Age DESC` (older first within tie).
- Group unscored items at the bottom under a one-line header: *"Unscored — leverage unknown; ask reporter or auto-estimate on pickup."*
- Worked example + sort contract: `triage-scoring.md § Examples`.

### Step 5 — close with explicit pickup instruction

End the response with: *"Pick one with `pick up <ref>` (issue, TODO line, or freeform)."* Never auto-invoke `ginee-pick-up`.

### Step 6 — hand any follow-up to `team-lead`

`ginee-triage` itself is read-only mechanical work (gather labels · parse markers · compute scores · sort · surface). The skill-runner runs steps 1–5 directly. **Any follow-up that isn't pure enumeration** — user asks "why is X ranked above Y?" · user asks to recompute · user asks to file a sibling issue · user picks a ref and asks to pick it up — dispatches `@team-lead` per `.agents/ginee/core/process.md § Skill-runner — surface boundary`. Skill-runner never:

- Reasons about ranking trade-offs in the main thread after surfacing the table.
- Auto-invokes `ginee-pick-up` on a ref the user mentioned.
- Recomputes / re-scores in the main thread on a re-question.

## Forbidden

- Never auto-pick.
- Never modify state (no label swaps, no TODO glyph flips).
- Never fall back to broader scope when a narrower scope was requested and its data is missing — fail with a clear message instead.
- Never include closed issues or `☒` TODOs in the listing.
- **Skill-runner forbiddens.** Any post-table follow-up beyond enumeration dispatches `@team-lead`. No ranking-rationale prose in the main thread; no main-thread default-selection ("I'll pick up the top one if you don't redirect"). Full boundary: `.agents/ginee/core/process.md § Skill-runner — surface boundary`.
