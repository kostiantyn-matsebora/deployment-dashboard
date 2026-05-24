# Migration — D35: `core/process.md` load topology split

**Target release:** next minor after 2026-05-24.
**Affected adopters:** every adopter on every adapter — opt-in via re-installer; no breaking change to project state.
**Closes:** [#89](https://github.com/kostiantyn-matsebora/ginee/issues/89).

## What changed

Pre-D35, `core/process.md` (477 lines, ~33 KB) was always-loaded on every cardinal dispatch — every role paid the cost of phases it never participated in. D35 splits the file by **audience + phase**, leaving common content always-loaded and extracting phase / orchestration content to `core/process/` (load-on-demand per role).

| File | Pre-D35 | Post-D35 |
|---|---|---|
| `core/process.md` | 477 lines — full spec | 199 lines — common only (Purpose · Reading order · Engineering principles · Doc style D22 / D26 · Reporting D29 · Coordination protocol · Load-on-demand index) |
| `core/process/phase-1-analysis.md` | (embedded) | extracted |
| `core/process/phase-2-design.md` | (embedded) | extracted |
| `core/process/phase-3-design-review.md` | (embedded) | extracted |
| `core/process/phase-4-implementation.md` | (embedded) | extracted |
| `core/process/phase-5-testing.md` | (embedded) | extracted |
| `core/process/phase-6-bug-fixing.md` | (embedded) | extracted |
| `core/process/phase-7-sa-review.md` | (embedded) | extracted |
| `core/process/phase-8-user-approval.md` | (embedded) | extracted |
| `core/process/dispatch.md` | (embedded) | extracted — skill-runner boundary · dispatch & parallelism · automatic mode · task model · cross-domain bugs mapping |

## Why

Pre-D35 a Phase 4 `backend-engineer` dispatch loaded:
- Phase 1 — `solution-architect` design dip (not backend's surface)
- Phase 3 — design review gate (team-lead's surface)
- Phase 7 — SA governance review (SA's surface)
- Phase 8 — user acceptance (team-lead's surface)

…each on every dispatch, every adopter, every project. The phase pipeline was the largest remaining always-loaded chunk that didn't apply to every role. D35 makes role context cost proportional to role participation.

D21-context-economy-gates classifies `core/process.md` + `core/roles/*.md` as the **strictest** always-loaded tier (25-line / 1 KB net-added gate). D35 is the natural follow-through — the file was already acknowledged as expensive.

## Form — Option A (phase-file split)

Selected from three options surfaced in #89 (A / B / C):

| Option | Verdict | Reason |
|---|---|---|
| **A — phase-file split** | **Selected** | File-level loading is universal across adapters; no HTML strip mechanism; phase boundaries are natural read units; trivial to verify which files a role pays for. |
| B — audience extraction with section markers | Rejected | Requires per-adapter section-strip mechanism; more complex than pure file boundaries. |
| C — `<details>`-wrapped chunks with `load-trigger` markers | Rejected | HTML-in-Markdown coupling; opaque to adapters lacking the strip implementation. |

Adopt-existing-solution candidate (per D30-adopt-existing-solution): the framework's **own load-on-demand extraction pattern**, already proven via `core/automatic-mode.md` · `core/protocols/options-protocol.md` · `core/protocols/doc-authoring-protocol.md` · `core/delivery-modes.md` · `core/protocols/index-protocol.md`. D35 applies the same machinery at finer granularity (per-phase) inside `core/process/`. No external library / framework adopted — pattern adoption only.

## Role participation contract

Each cardinal kernel declares `phase-participation: [N, M, …]` in frontmatter. Adapters render the kernel and load only the matching `core/process/phase-<N>-*.md` files for that role.

| Role | `phase-participation:` | Loads |
|---|---|---|
| `team-lead` | `[1, 2, 3, 4, 5, 6, 7, 8]` | all 8 phase files + `core/process/dispatch.md` |
| `solution-architect` | `[1, 2, 4, 5, 6, 7]` | phase-1 (design dip), phase-2 (design), phase-4 / 5 / 6 (review + governance dips), phase-7 (final coherence) |
| `backend-engineer` | `[2, 4, 5, 6]` | phase-2 (contract slice), phase-4 (implementation), phase-5 / 6 (test + fix) |
| `frontend-engineer` | `[2, 4, 5, 6]` | phase-2 (mockup + contract slice), phase-4 (implementation), phase-5 / 6 (test + fix) |
| `devops-engineer` | `[2, 4, 5, 6]` | phase-2 (infra / deploy contract), phase-4 (implementation), phase-5 / 6 (test + fix) |
| `qa-engineer` | `[5, 6]` | phase-5 (testing), phase-6 (parallel exercises during bug fixing) |
| `ai-engineer` | `[]` | none — between-phase optimizer; loads no phase files by default |

**`core/process/dispatch.md`** loads when:

- `team-lead` is dispatched (always).
- Skill-runner main thread enters any `ginee-*` skill body (per D28-skill-runner-boundary).

Other cardinals do NOT load `dispatch.md`.

## Token measurement

Backend-engineer Phase 4 dispatch — always-loaded process content:

| | Pre-D35 | Post-D35 | Reduction |
|---|---|---|---|
| `core/process.md` lines | 477 | 199 | -58% |
| Backend's per-dispatch phase files | n/a (all bundled) | `phase-2` (32) + `phase-4` (16) + `phase-5` (31) + `phase-6` (16) = 95 | — |
| Total process lines loaded | 477 | 294 (199 + 95) | **-38%** |
| Approximate token cost | ~33 KB | ~20 KB | **-39%** |

`qa-engineer` reduction is larger (loads only phase-5 + phase-6 = 47 lines + common 199 = 246 lines → **-48%**). `ai-engineer` reduction is largest (199 lines vs 477 → **-58%**). The 30% acceptance floor from #89 is met for every non-orchestrator cardinal.

`team-lead` is unchanged on aggregate — it legitimately needs the full pipeline + orchestration content. Common file is smaller; phase files load to replace what was bundled.

## Lossless rule — survival evidence

Per `core/roles/ai-engineer.md § Lossless rule`, every rule from pre-D35 `core/process.md` survives in either the slim common file or one of the extracted files. Section-by-section table:

| Pre-D35 section | Post-D35 location |
|---|---|
| Purpose | `core/process.md § Purpose` |
| Reading order | `core/process.md § Reading order` (expanded with process/ files) |
| Skill-runner — surface boundary (D28-skill-runner-boundary) | `core/process/dispatch.md § Skill-runner — surface boundary` |
| Dispatch & parallelism rules | `core/process/dispatch.md § Dispatch & parallelism rules` |
| Per-task model tier (D31-model-tier) | `core/process/dispatch.md § Dispatch & parallelism rules` (sub-section) |
| Overlap patterns | `core/process/dispatch.md § Dispatch & parallelism rules` (sub-section) |
| Implementation gate | `core/process/phase-3-design-review.md § Implementation gate` |
| Phase 1 — Analysis | `core/process/phase-1-analysis.md` |
| Phase 2 — Design & architecture | `core/process/phase-2-design.md` |
| Phase 3 — Design review | `core/process/phase-3-design-review.md` |
| Phase 4 — Implementation | `core/process/phase-4-implementation.md` |
| Phase 5 — Testing | `core/process/phase-5-testing.md` |
| Phase 6 — Bug fixing | `core/process/phase-6-bug-fixing.md` |
| Phase 7 — SA review | `core/process/phase-7-sa-review.md` |
| Phase 8 — User approval | `core/process/phase-8-user-approval.md` |
| Cross-phase rule | `core/process/phase-2-design.md § Cross-phase rule` (lives with design since the rule fires there) |
| Relation to the cross-domain bugs cycle | `core/process/dispatch.md § Relation to the cross-domain bugs cycle` (orchestrator concern) |
| Automatic mode (kernel) | `core/process/dispatch.md § Automatic mode` |
| Engineering principles | `core/process.md § Engineering principles` (compressed but lossless) |
| Documentation style (D22 / D26) | `core/process.md § Documentation style` |
| Reporting (D29 / D33) | `core/process.md § Reporting` |
| Coordination protocol (PR rules) | `core/process.md § Coordination protocol` |
| Load-on-demand specs index | `core/process.md § Load-on-demand specs` |
| Task model | `core/process/dispatch.md § Task model` |
| Post-task check-in pointer | `core/process.md § Post-task check-in` (D35) — later relocated to `core/process/dispatch.md § Post-task check-in` as a team-lead-only kernel summary alongside GitHub integration + Triage scoring |

No rule, table row, gate, or invariant from pre-D35 process.md was dropped.

## Anchor migration

External `local/*` files or adopter-authored docs that cite `core/process.md § Phase <N>` (or any specific phase anchor) should re-point to `core/process/phase-<N>-<name>.md` (anchor surface may also have shifted to a flat-document headings shape inside each new file).

| Pre-D35 anchor | Post-D35 anchor |
|---|---|
| `core/process.md § Phase 1 — Analysis` | `core/process/phase-1-analysis.md` |
| `core/process.md § Phase 2 — Design & architecture` | `core/process/phase-2-design.md` |
| `core/process.md § Phase 3 — Design review` | `core/process/phase-3-design-review.md` |
| `core/process.md § Phase 4 — Implementation` | `core/process/phase-4-implementation.md` |
| `core/process.md § Phase 5 — Testing` | `core/process/phase-5-testing.md` |
| `core/process.md § Phase 6 — Bug fixing` | `core/process/phase-6-bug-fixing.md` |
| `core/process.md § Phase 7 — SA review` | `core/process/phase-7-sa-review.md` |
| `core/process.md § Phase 8 — User approval` | `core/process/phase-8-user-approval.md` |
| `core/process.md § Skill-runner — surface boundary (D28)` | `core/process/dispatch.md § Skill-runner — surface boundary (D28-skill-runner-boundary)` |
| `core/process.md § Dispatch & parallelism rules` | `core/process/dispatch.md § Dispatch & parallelism rules` |
| `core/process.md § Task model` | `core/process/dispatch.md § Task model` |
| `core/process.md § Automatic mode` | `core/process/dispatch.md § Automatic mode` |

The slim `core/process.md` continues to host: Purpose · Reading order · Lifecycle topology · Engineering principles · Documentation style · Reporting · Coordination protocol · Load-on-demand index · Post-task check-in pointer.

## Decisions affected

- **D21-context-economy-gates** — watched-paths table extended. `core/process/*.md` joins the "other watched" tier (50-line / 2 KB net-added gate). The slimmed `core/process.md` remains in the strictest always-loaded tier.
- **D28-skill-runner-boundary** — the skill-runner-boundary text moved to `core/process/dispatch.md`. Skill-runner main thread loads it on entry to any `ginee-*` skill body (in addition to team-lead always loading it). D28's behavioural contract is unchanged.
- **D29-strict-subagent-return-schema** — reporting section stays in the slim common `core/process.md`. Cross-references in templates / migrations continue to resolve at the same anchor (`core/process.md § Reporting`).

## Adapter implications

Each adapter's role-kernel render is responsible for honouring `phase-participation:`. The contract:

1. Read kernel frontmatter `phase-participation: [N, M, …]`.
2. For each N in the list, surface `core/process/phase-<N>-<name>.md` as a load reference in the rendered kernel.
3. For `team-lead` only (and skill-runner main thread on skill entry): also surface `core/process/dispatch.md`.
4. Other cardinals do NOT receive `dispatch.md` references.

Each `adapters/*/install.md` documents the contract in a new "Phase-file loading (D35)" section. The current adapter install steps (subagent file copy, skill bridge, pointer block append) are unchanged.

## Out of scope

- **Cross-file `<details>`-strip implementation** — Options B and C were considered and rejected (see "Form" above).
- **Splitting role kernels further** — already paired with `.details.md` sidecar; additional splits are a separate optimization.
- **Code-generated process views** — human-readable spec stays.
- **Adapter loader hardening** — each adapter owns its load mechanism per the contract above. This migration ships the spec; per-adapter mechanism changes (if any) are tracked separately.

## Forward-only

Purely additive. No `local/` schema change. Adopters with stale anchors update on their own cadence via the migration table above. `rediscover` (D6) does not need to fire — the role-kernel changes are upstream-owned and replaced on `ginee-update`.
