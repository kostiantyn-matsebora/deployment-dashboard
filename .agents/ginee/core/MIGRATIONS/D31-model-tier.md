# Migration — D31: per-role + per-task model tier

**Target release:** next minor after 2026-05-23.
**Affected adopters:** every adopter on every adapter — opt-in; no breaking change.

## What changed

D31 introduces a **model-tier abstraction** so reasoning-heavy roles can route to capable models and execution-heavy roles to cheaper ones. Three pieces:

| Piece | Where | Owner |
|---|---|---|
| `default-tier:` per role | `core/roles/<role>.md` frontmatter | framework |
| `model-tier:` config block | `framework.config.yaml § model-tier` (`per-role` + `adapters.<client>`) | adopter |
| `model:<tier>` per-task prefix | dispatch syntax (combinable with `auto:` / `branch:` / `wt:` / `commit:`) | adopter |

Tier names are vendor-neutral in `core/`; concrete model IDs live only in the adapter layer. Pre-D31 every dispatch ran on whatever single model the client had selected — typically the most capable one at the most capable price.

## Tier table

| Tier | Use | Adapter map (Claude Code) |
|---|---|---|
| `reasoning` | High-context · synthesis · architectural | `claude-opus-4-7` |
| `standard` (default-default) | Implementation · tests · doc-shape · lint fixes | `claude-sonnet-4-6` |
| `fast` | Mechanical · label ops · sticky updates | `claude-haiku-4-5` |

Other adapters map tiers per their model catalogue; no-op + one-line install warning where the surface lacks per-role model selection (Cursor / Copilot CLI / Codex / generic today).

## Default tier per role

| Role | Default tier | Why |
|---|---|---|
| `team-lead` | `reasoning` | Orchestration · synthesis · routing reconciliation. |
| `solution-architect` | `reasoning` | ATAM · SAD freeze · CR/ADR governance · cross-cutting review. |
| `ai-engineer` | `standard` | Doc-shape passes are mechanical post-D22/D26/D29 self-lint. |
| `backend-engineer` · `frontend-engineer` · `devops-engineer` | `standard` | Implementation + tests; D29 bounds return reasoning. |
| `qa-engineer` | `standard` | Test authoring + harness; D28 narrows skill-runner ops. |

## Resolution order

Per dispatch — stop at first match:

1. Per-task prefix `model:<tier>` in the dispatch line.
2. Phase-3 user answer.
3. `framework.config.yaml § model-tier.per-role.<role>`.
4. `core/roles/<role>.md` frontmatter `default-tier:`.

## Open-question picks

| Question | Resolution |
|---|---|
| Tier count | 3 — `reasoning` / `standard` / `fast`. Two would throw away the mechanical-ops downshift that D28 + D29 make safe. |
| Tier names | `reasoning` / `standard` / `fast` — describe load profile, vendor-neutral. |
| Default for `ai-engineer` | `standard` — doc-shape passes are rule-following post-D22/D26/D29 self-lint. |
| Per-skill override | Out of scope v1; skills inherit role tier. |
| Cost-based auto-selection | Out of scope; explicit-only. |
| Adopter-extensible custom tiers | Out of scope v1; defer until demand surfaces. |
| D-number | D31 (D30 = adopt-existing-solution, merged 2026-05-23). |

## Adapter behaviour

| Adapter | At install | Per-task prefix |
|---|---|---|
| `claude` | Pointer files in `.claude/agents/<role>.md` carry `model: <id>` in frontmatter — pre-resolved from the role's `default-tier:` + the template's adapter map. Adopter override via `local/framework.config.yaml § model-tier` is applied if the file exists at install time. | Orchestrator routes via `Task` tool's `model` field for the one dispatch. |
| `copilot-cli` · `agents-md` · `generic` | No surface for programmatic per-role model selection today → install emits one-line warning. | Documented as user-side hint; client selects model via its own UI. |

## Enforcement

None — this is config, not a doc-shape rule. No external linter, no self-lint check.

## Action required — none (adopter-side)

**Purely additive.** No `local/` schema change is forced; absent `model-tier:` → framework defaults apply silently. Existing dispatches unaffected until adopter sets a tier or uses the prefix.

**Forward-only** — no retroactive sweep of in-flight tasks.

## Files changed (framework upstream)

| Path | Change |
|---|---|
| `core/roles/{team-lead,solution-architect,ai-engineer,backend-engineer,frontend-engineer,devops-engineer,qa-engineer}.md` | `default-tier:` added to YAML frontmatter (× 7) |
| `adapters/_shared/agents/*.md` | `model:` field added to pointer frontmatter (× 7), pre-resolved from default tier |
| `core/templates/framework.config.yaml` | New `model-tier:` section — `per-role:` overrides + `adapters.<client>.<tier>:` ID maps |
| `core/process.md § Dispatch & parallelism rules` | New subsection: `model:<tier>` per-task prefix + 4-step resolution order |
| `install.ps1` · `install.sh` | Claude branch reads `local/framework.config.yaml § model-tier` (when present) and rewrites `model:` frontmatter per-role |
| `tests/install.Tests.ps1` | Pester coverage for the tier-frontmatter writer |
| `adapters/claude/install.md` | Tier section + per-task `model:` prefix |
| `adapters/{copilot-cli,agents-md,generic}/install.md` | One-line no-op warning + per-task prefix hint |
| `docs/CONCEPTS.md` · `docs/CHEATSHEET.md` · `docs/CHANGELOG.md` | D31 entries |
| `CLAUDE.md` · `PLAN.md` | D31 row |
| `core/MIGRATIONS/D31-model-tier.md` | This file (**NEW**) |

## Backward compatibility

- **Adopter `local/*`** — no required schema change.
- **Existing dispatches** — unaffected until adopter sets a tier or uses the prefix.
- **Pre-D31 `.claude/agents/<role>.md`** — re-install (or `@team-lead update`) adds the `model:` line; pointer-block sync is already idempotent.
- **`framework.config.yaml`** — new `model-tier:` block is optional; framework defaults apply when absent.
- **Adapter renderings** — only `claude` wires programmatically; others document the per-task prefix as a hint.

## Rollback

Not recommended — D31 is purely additive. To revert:

1. Remove `default-tier:` lines from `core/roles/*.md`.
2. Remove `model:` lines from `adapters/_shared/agents/*.md`.
3. Remove `model-tier:` section from `core/templates/framework.config.yaml`.
4. Remove `model:<tier>` subsection from `core/process.md § Dispatch & parallelism rules`.
5. Drop the tier-frontmatter writer from `install.ps1` / `install.sh`.

Framework still functions; every dispatch falls back to the client's single-model behaviour (pre-D31 state).

## Issue reference

Closes [#76](https://github.com/kostiantyn-matsebora/ginee/issues/76) — *"[Framework Feature] Per-role + per-task model tier — adapter-mapped cost knob."* Issue body provisionally numbered this decision D30; D30 was taken by adopt-existing-solution (merged 2026-05-23, PR #75). Final number **D31**.
