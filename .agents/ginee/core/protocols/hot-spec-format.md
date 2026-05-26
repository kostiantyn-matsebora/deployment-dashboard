---
audience: all-cardinals
load: on-demand
triggers: [hot-spec, frontmatter, authoring]
cap-bytes: 4096
reads-before-applying: [core/protocols/doc-size-caps.md, core/protocols/index-protocol.md]
---

# Hot-spec frontmatter — load metadata standard

## Purpose

- Make load-decision **explicit** at the file head — audience · load-tier · triggers · cap · prereqs.
- Eliminate per-dispatch inference cost — the LLM reads frontmatter once instead of re-deriving "who loads this when" from prose.
- Single attestation surface for the validator (`scripts/context-economy-check.ps1`) to gate size + completeness.

## Schema

| Key | Type | Required when | Semantics | Example |
|---|---|---|---|---|
| `audience` | enum / role-id | always | Who loads this file. `all-cardinals` · `team-lead-only` · `skill-runner` · `<role-id>` (e.g. `ai-engineer`). | `all-cardinals` |
| `load` | enum | always | `always` (loaded every dispatch in audience) · `on-demand` (loaded when triggers match). | `on-demand` |
| `triggers` | list of strings | `load == on-demand` | Keyword phrases that activate the load. Single-word or short multi-word; matched case-insensitive against task / phase context. `[]` forbidden when `load: on-demand`. | `[hot-spec, frontmatter]` |
| `cap-bytes` | integer | always | Per-file size ceiling, in bytes. Honours `core/protocols/doc-size-caps.md` trailer-bypass machinery. Independent of per-class caps (ADR/CR/UI). | `4096` |
| `reads-before-applying` | list of paths | always (use `[]` if none) | Companion specs that must be in context before this file's rules can be applied. Empty list explicit — never omitted. | `[core/protocols/doc-size-caps.md]` |

## Authoring rules

- **Place frontmatter as the first lines** of the file — YAML block delimited by `---` · `---`. First Markdown heading follows immediately.
- **`audience`** — pick the **narrowest** correct value. Default to a specific role-id; widen to `all-cardinals` only when every cardinal genuinely needs the file. `skill-runner` is reserved for `core/process/dispatch.md`-class content per the skill-runner surface boundary; do **not** point new specs at `skill-runner`.
- **`load: always`** — reserved for foundational specs (process.md · role kernels · always-loaded protocol bits). Authors default to `on-demand` and justify upgrades.
- **`triggers`** — short keyword phrases, not full sentences. Plural form (e.g. `[hot-spec, frontmatter]`) — empty list trips the validator when `load: on-demand`.
- **`cap-bytes`** — set conservatively (≤ 6144 typical); breach routes to `ai-engineer` per `core/protocols/doc-size-caps.md § Breach routing`. Same `Optimized-By: ai-engineer` trailer bypass.
- **`reads-before-applying`** — list every spec whose rules are pre-requisite to applying this one. Empty list (`[]`) when truly standalone — never omit the key.

## Validator

`scripts/context-economy-check.ps1` enforces, on the diff:

1. Frontmatter block present + parses as YAML at the file head.
2. All 5 required keys present; `triggers` populated when `load: on-demand`; `reads-before-applying` present (empty list legal).
3. `audience` value is one of the allowed enum + role-ids.
4. File size at HEAD ≤ `cap-bytes` OR commit carries `Optimized-By: ai-engineer` trailer (same bypass shape as per-class caps).
5. Scope — applies to `core/process.md` · `core/process/*.md` · `core/protocols/*.md` · `core/roles/*.md` only. **Does NOT cover** `local/roles/*.md` (adopter-owned), `core/templates/*.md`, `core/skills/*/SKILL.md` (AgentSkills frontmatter governs that surface).

Breach surfaces as a one-line advisory + gate failure; same enforcement layers as the doc-size-caps gate (Claude Code hook · git hooks · CI workflow · PR-time CI).

## See also

- `core/protocols/index-protocol.md § Read order` — index-first read discipline; hot-spec frontmatter complements (not replaces) per-role baselines.
- `core/protocols/doc-size-caps.md` — per-class caps (ADR/CR/UI); `cap-bytes:` here is the per-file equivalent for hot specs.

<!-- self-lint: pass -->
