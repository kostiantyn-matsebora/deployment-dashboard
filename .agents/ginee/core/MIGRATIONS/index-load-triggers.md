# Migration — Index file load-triggers (issue #11)

**Target release:** next minor after 2026-05-18.
**Affected adopters:** every adopter on Claude Code, Copilot CLI, Cursor, Codex, Gemini CLI, Goose, or any AgentSkills-compatible client.

## What changed

Role kernel `## Source of truth` tables now declare **per-file load triggers** — two-tier model: `always` for foundational baseline, trigger phrases for scope-loaded files. A trivial dispatch no longer pays the full role baseline; a deep-work dispatch picks up exactly the indexes its task touches.

- **New `§ Role consumption pattern`** in `core/protocols/index-protocol.md`:
  - Two-tier load model — `always` + scope-loaded with trigger phrase.
  - Trigger evaluation procedure (specialist evaluates on first reasoning step).
  - Reporting — specialist reports its load decision in first response.
  - Adopter overrides via new `local/bindings.md § Per-role load-trigger overrides` table.
- **All 5 cardinal role kernels updated** — `backend`, `frontend`, `devops`, `qa`, `solution-architect`. `## Source of truth` tables gain `Load when` column with `always` or trigger phrase per row.
- **New `## Per-role load-trigger overrides`** section in `core/templates/bindings.md` — adopter-side raises or lowers a file's tier vs cardinal default.
- **`core/templates/role-authoring-template.md`** — table-first shape for new role authoring with the `Load when` column shown.

## Why

Real adopter data: per-role baseline reads were 43–64 KB on every dispatch on deployment-dashboard — including trivial typo fixes and one-line edits that touched zero of the index files' concerns. The full role baseline loaded unconditionally because role kernels had no `Load when` mechanism. ~16K tokens per dispatch wasted on the worst case.

## Action required

After re-fetching framework files on upgrade:

1. **No mandatory adopter file changes.** Cardinal kernel changes are upstream-owned; they ship in `core/roles/*.md`. Adopters benefit on next dispatch — specialists read the kernel and apply the two-tier model automatically.

2. **(Optional) Add per-project overrides** in `local/bindings.md § Per-role load-trigger overrides` if your project's load pattern differs from the framework default. Example:

   ```markdown
   | Role | Index file | Override | Why |
   |---|---|---|---|
   | backend-engineer | local/index/topology.yaml | always | every backend task touches gateway routing on this project |
   | frontend-engineer | local/index/conventions.yaml | `style/lint touch` | trivial fixes shouldn't load full lint config (8 KB) |
   ```

   `team-lead` reads this table at dispatch time and extends/contracts the specialist's baseline accordingly.

3. **(Optional) Audit your `local/roles/*.md` custom roles** (if you have any). Update their `## Source of truth` sections to the new table shape with `Load when` column — see `core/templates/role-authoring-template.md` for the shape. Custom roles that don't update keep working (their flat-list baseline is treated as always-load — same as pre-fix behaviour).

## Behavioural change to expect

- Specialists report their loaded set in first response — adopter sees what was actually loaded per dispatch.
- Per-dispatch baseline drops substantially on trivial dispatches:

   | Role | Before (full baseline) | After (`always` tier only — typical trivial task) |
   |---|---|---|
   | `backend-engineer` | ~43 KB | ~16 KB (architecture-fr + constraints + architecture.idx) |
   | `frontend-engineer` | ~64 KB | ~29 KB (architecture-fr + constraints + ui-states + conventions) |
   | `devops-engineer` | ~56 KB | ~22 KB (constraints + architecture.idx + architecture-fr + commands) |
   | `qa-engineer` | ~51 KB | ~43 KB (most of QA's surfaces apply on every test task) |
   | `solution-architect` | ~46 KB | ~20 KB (architecture + architecture-fr + constraints + adr + cr) |

   Combined with #9's compression-floor fix (which makes stack/topology drop from 13 KB → ~3 KB each), the per-dispatch baseline for `devops-engineer` on a trivial task drops from ~56 KB to ~12 KB — a 4.5× reduction.

- Deep-work dispatches load the same content as before (scope-trigger matches), so high-effort tasks are unaffected.

## Safeguards

- **Pre-fix behaviour preserved** for kernels not yet updated: a flat-list `Source of truth` (no `Load when` column) is treated as "all rows = always-load" — same as before. Migration is per-role, not big-bang.
- **No silent skips.** Specialist reports loaded set in first response; adopter can intercept "I expected api-matrix.yaml to load" and provide a different prompt.
- **Override safety.** `bindings.md § Per-role load-trigger overrides` is an additive layer; cardinal kernels remain upstream-owned and replaceable on upgrade.

## Rollback

- Specialists ignoring the `Load when` column (older client / unaware specialist) treat the table as flat — every row loads (pre-fix behaviour). Graceful degradation; no breaking change.
- Pin framework to the pre-fix release in `core/VERSION`.
- Remove the `Per-role load-trigger overrides` section from `local/bindings.md` if you don't want it.

## Issue reference

Implemented per [issue #11](https://github.com/kostiantyn-matsebora/ginee/issues/11) — `Index files have no load-triggers — role baseline loads in full even for trivial dispatches`. Stacked on [issue #9](https://github.com/kostiantyn-matsebora/ginee/issues/9) (compression floor) + [issue #10](https://github.com/kostiantyn-matsebora/ginee/issues/10) (consumer coupling). Combined effect: per-dispatch baseline drops 3–4× on trivial tasks.
