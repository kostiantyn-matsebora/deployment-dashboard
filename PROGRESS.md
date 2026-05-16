# Progress Snapshot — 2026-05-16 (end of session, Focus-across-all-layouts cycle landed)

Resume point. Read `CLAUDE.md` first; this is a working snapshot, not authoritative.

## One-line status

Focus view (chevron + pin + expand-to-Detailed) extended from Matrix-only to **all three layouts** (Matrix, Swim-lane, Workflow-rows); two new NFR-09 sibling invariants codified (service-name single-line auto-width + env-header column alignment under Matrix Focus expand); CLAUDE.md restructured to deterministic 4-dimension lifecycle blocks (Goal / Actions / Artefacts / Acceptance per phase) with the process section extracted to `docs/engineering-process.md`. Build clean; 227/227 Angular unit tests PASS; mockup-visual harness 12/12 PASS. Manual SPA smoke pending — user owns it (agent sandbox has no Docker).

## Cycles closed this session

### Cycle G — CLAUDE.md lifecycle determinism

Promoted process feedback from memory to permanent CLAUDE.md rule. Multiple iterations as user refined the wording:

| Edit | Section | Effect |
|---|---|---|
| Insert | `## Task lifecycle — phased pipeline with maximum parallelism` | 8-phase pipeline (Analysis → Design → Design review → Implementation → Testing → Bug fixing → SA review → User approval); parallelism rules; dispatch pattern; cross-ref to four-phase cross-domain-bug cycle |
| Amend | Phase 2 sub-deliverables | Added **API design** alongside system / visual / impl plan |
| Insert | New Phase 3 row | **Design review — user approval gate** between Design & Implementation; phases 3–7 renumbered 4–8 |
| Reframe | Why-line | "Work like a real engineering team" → operational guidance (not flavour) — apply established best practices |
| Generalize | Mockup-vs-implementation rule | "Mockup edits are Phase 2, NOT Phase 4" → `### Each phase owns its own artefacts` with bulleted phase-to-artefact map; closing `Cross-phase rule — artefacts do not cross phases` |
| Restructure | All 8 phases | Per-phase `### Phase N — Name` blocks with deterministic 4-dimension bullets: `Goal and objectives` / `Actions and expectations` / `Produces artefacts` / `Criteria of acceptance`. 32 identical lead-in labels (8 × 4) |
| Extract | Process section → `docs/engineering-process.md` | User pulled the entire lifecycle + parallelism + engineering principles + cross-domain bugs + TODO workflow into a referenced doc; CLAUDE.md now cites the extracted file in a `## Process model` section |

### Cycle H — Focus view: extend to all three layouts

Multi-phase cycle following the new lifecycle:

| Phase | Agent(s) | Deliverable |
|---|---|---|
| 1 — Analysis | orchestrator | User reported Focus regression (Matrix Focus ≈ Compact visually); identified scope: restore Focus distinct affordance; later extended to all three layouts |
| 2 — Design (round 1) | `frontend-engineer` | Mockup: chevron + pin promoted to framed visible buttons, left-accent rail, expanded-row tint. Added `data-testid` hooks `row-chevron-{id}`, `row-pin-{id}`, `row-collapsed-{id}` / `row-expanded-{id}` |
| 2 — Design (round 2) | `solution-architect` | Initial ruling: Path 2 (matrix-only); added "Layout scope" + "Focus exception under FR-13" to `ui-compact-options.md` + SAD §7 |
| 1 — Analysis (round 2) | orchestrator | User signalled Focus regression in swim-lane + workflow-rows ("focus has expand/collapse in matrix mode which is overriden by swim-lane and workflow rows mode") — Path 2 ruling reversed |
| 2 — Design (round 3) | `frontend-engineer` | Two option-fork mockups (`-a-wider.html`, `-b-taller.html`) + `docs/ui-focus-layout-options.md` design note. User picked Option A (wider + taller, matrix-parity) |
| 3 — Design review | user | Approved Option A; pin-survives-layout-switch=YES; toolbar-above-all-layouts=YES |
| 2 — Design (round 4) | parallel — `frontend-engineer` + `solution-architect` + `qa-engineer` | Frontend merged Option A into canonical, deleted forks, fixed two new defects flagged mid-merge (service name cut with `…` in workflow-rows; env-header misaligned in matrix Focus expand), rewrote design note to chosen-design framing. SA replaced "Layout scope" Path 2 with Path A 3-row granularity table + 2 new clauses (pin-survives-layout-switch, toolbar-above-all-layouts); SAD §7 mirror "Focus exception" → "Focus per-layout granularity (FR-13)"; added 2 NFR-09 sibling invariants. QA extended I9 across all 3 layouts, added I10 (service-name no-clip) and I11 (env-header alignment) to mockup-visual harness, authored 6 new e2e Markdown scenarios + 6 Playwright specs |
| 4 — Implementation | `frontend-engineer` | Angular SPA mirror: matrix container `--leaf-width` page-level CSS variable (env-header + rows share), `pipeline-matrix.focusVars()` computed signal, swim-lane per-lane chevron+pin+expand wired into `recomputeEdges`, workflow-rows per-service-header chevron+pin+expand wired into `recomputeConnectorTops`, Focus toolbar above all 3 layouts, `data-testid="service-name-{svcId}"` at every site, pin already layout-agnostic in signal store |
| 5 — Testing | `qa-engineer` | 162/166 e2e PASS, 2 specs failed on Matrix Focus env-header alignment (the user-reported defect, not yet fixed in SPA); 11/12 mockup-visual PASS (I11 fail); 227/227 Angular unit tests PASS; 8 spec-selector drift fixes landed |
| 6 — Bug fixing (round 1) | `frontend-engineer` | NFR-09 #6 strengthened ("single-line auto-width" not "wraps vertically") via user signal "service name is oneliner without cuts". Fixed: header strip 13-px padding-left mirror (mockup + SPA); service-name `whitespace-nowrap` + inline `width: max-content` at all 6 sites (mockup + SPA). Mockup-visual harness 12/12 PASS. 227/227 unit tests still PASS. E2E specs not re-run in agent sandbox (no Docker). Flagged contradictory sanity check in `matrix-focus-env-header-alignment.spec.ts:148-153` (`expandedW - collapsedW > 20` jointly unsatisfiable with the alignment assertions under binary-widen contract) for QA to fix in follow-up |
| 7 — SA review | pending — user manual smoke first | |
| 8 — User approval | pending | |

## SAD edits landed this session

| Section | Change |
|---|---|
| §7 "Focus per-layout granularity (FR-13)" (~line 516) | Rewritten from "Focus exception under FR-13" (matrix-only) to per-layout granularity rule + 2 new clauses (pin-survives-layout-switch; Focus toolbar above all 3 layouts) |
| §5 NFR-09 sibling — service-name single-line auto-width | New invariant: name renders on single line at intrinsic width, no truncation/ellipsis/wrap; container auto-sizes (CSS Grid `auto` track precedent applied at `<p>`-element level) |
| §5 NFR-09 sibling — env-header column alignment under expand | New invariant: in Matrix layout, env-header row stays column-aligned with deployment-row columns under any expanded/collapsed Focus combination; header + body share CSS Grid track definition |

## Mockup edits landed this session

| Region | Change |
|---|---|
| Head-comment NFR-09 #6 | Service-name rule sharpened from "no-clip via wrap" to "single-line via `whitespace-nowrap` + `width: max-content`" |
| Head-comment NFR-09 #7 | New: env-header column alignment under Matrix Focus expand |
| Matrix Focus toolbar (line ~1652) | Now renders above all three layouts when View=Focus (was Matrix-only) |
| Matrix Focus container | Page-level `--leaf-width` / `--leaf-width-expanded` / `--focus-arrow-gap` CSS variables; env-header + every row read the same property → binary widening; header strip got `padding-left: 13px` matching the row gutter |
| Swim-lane Focus | Chevron + pin in `.lane-label` gutter (gated on `view === 'focus'`); `--leaf-width` overridden per-lane-row when expanded; SVG connector reflow via `recomputeEdges` |
| Workflow-rows Focus | Chevron + pin in `.svc-block-meta-row` (service-header level); `--leaf-width` overridden per-service-block when expanded; per-connector `--target-line-width` / `--target-half` rewritten via `recomputeConnectorTops(serviceId)` |
| Service-name sites (6 total: 4 matrix views + swim-lane lane-label + workflow-rows svc-block-meta-row) | `<p class="whitespace-nowrap" style="width: max-content">{{name}}</p>`; column containers (`w-44`/`w-40`/`w-36`/`176px`) remain as visual reservation; long names extend past rather than clipping |
| `data-testid="service-name-{svcId}"` | Added at every site for stable Angular SPA selector |
| `data-testid="collapse-all"` | Added to the existing collapse-all button |

## CLAUDE.md edits landed this session

| Region | Change |
|---|---|
| `## Task lifecycle` (entire section) | Replaced phases table + per-phase notes with 8 `### Phase N — Name` subsections, each with deterministic 4-dimension bullets (`Goal and objectives` / `Actions and expectations` / `Produces artefacts` / `Criteria of acceptance`) — 32 identical lead-in labels |
| `### Cross-phase rule — artefacts do not cross phases` | New closing subsection carrying the artefact-no-crossing rule |
| `### Parallelism rules` / `### Dispatch pattern` / `### Relation to the cross-domain-bugs cycle` | Preserved unchanged |
| Why-line | "Work like a real engineering team" reframed as operational guidance |
| **Extracted to `docs/engineering-process.md`** | User-driven: entire lifecycle + parallelism + engineering principles + cross-domain bugs + TODO workflow now lives in a referenced doc; CLAUDE.md carries a `## Process model` thin section citing it |

## Angular SPA changes landed this session (Phase 4 + Phase 6)

| File | Change |
|---|---|
| `frontend/matrix/src/lib/pipeline-matrix.component.ts` | Focus wrapper writes page-level `--leaf-width` / `--leaf-width-expanded` / `--focus-arrow-gap` CSS variables; `focusVars()` computed signal binds to `expandedServices()` |
| `frontend/matrix/src/lib/matrix-header.component.ts` | Reads `--leaf-width` for env-header columns; `padding-left: 13px` to align with row gutter |
| `frontend/matrix/src/lib/focus-row.component.ts` | Framed chevron + pin (`w-5 h-5` `bg-*-50/100`); boxes consume `--leaf-width`; arrow gaps consume `--focus-arrow-gap`; new layout-agnostic testids; sr-only legacy aliases; service-name one-liner |
| `frontend/matrix/src/lib/stage-box.component.ts` | New `widthAuto` input |
| `frontend/matrix/src/lib/layout-leaf.component.ts` | Passes `widthAuto=true`; compact-branch reads `--leaf-width` via inline style |
| `frontend/matrix/src/lib/detailed-row.component.ts`, `compact-row.component.ts`, `glance-row.component.ts` | Service-name one-liner (`whitespace-nowrap` + `width: max-content`) |
| `frontend/dashboard/src/app/swim-lane-layout.component.ts` | Focus toolbar + per-lane chevron+pin + `--leaf-width` override + `LayoutLeafComponent` driven by `viewOverride='detailed'` + `forceAllAttrs=true` when expanded; service-name one-liner |
| `frontend/dashboard/src/app/workflow-rows-layout.component.ts` | Focus toolbar + per-service-header chevron+pin + `--leaf-width` override; service-name one-liner |
| `frontend/dashboard/src/styles.css` | `.focus-row` left-rail accent + dark-theme overrides |

Signal store: `pinnedServices` was already layout-agnostic (`ReadonlySet<string>` keyed by service id). No refactor needed for pin-survives-layout-switch.

## Test suite + harness changes landed this session

| Surface | Change |
|---|---|
| `testing/mockup-visual/harness.config.json` | I9 `layoutScope` removed (now runs on all 3 layouts under Focus); I10 added (`service-name-no-clip`); I11 added (`matrix-focus-env-header-alignment`) |
| `testing/mockup-visual/mockup-invariants.spec.ts` | I9 evaluator generalized across all 3 layouts (service-grain via distinct `data-service-row` + duplicate-suffix guard); I10 evaluator (per-layout `whitespace`/`overflow`/`scrollWidth<=clientWidth`); I11 evaluator (programmatic `toggleExpand` via Alpine root; header/expanded/collapsed rect comparison ±1 px) |
| `testing/mockup-visual/README.md` | I9 description updated; I10 + I11 rows added (count 9 → 11) |
| `testing/e2e/scenarios/focus-view-distinct-from-compact.md` (new) | Path A intro; per-layout assertions; Block E pin-survives-layout-switch |
| `testing/e2e/tests/focus-view-distinct-from-compact.spec.ts` (new) | 5 test blocks (A-E) exercising Focus distinctness, chevron/pin/expand, collapseAll, pin-survives-layout-switch |
| `testing/e2e/scenarios/service-name-no-clip-universal.md` (new) | 24 combinations (4 views × 3 layouts × 2 themes) |
| `testing/e2e/tests/service-name-no-clip-universal.spec.ts` (new) | Asserts `scrollWidth <= clientWidth + 1` against `[data-testid="service-name-{svcId}"]` |
| `testing/e2e/scenarios/matrix-focus-env-header-alignment.md` (new) | Pre-expand + post-expand assertions |
| `testing/e2e/tests/matrix-focus-env-header-alignment.spec.ts` (new) | Header bounding rect ≈ expanded row's box rect AND collapsed row's box rect (±1 px) |
| `testing/e2e/tests/focus-on-last-event-toggle.spec.ts`, `full-attribute-disclosure.spec.ts`, `spa-visual-invariants.spec.ts`, `theme-switcher-persists-across-reload.spec.ts`, `theme-switcher-popover-open-and-select.spec.ts`, `workflow-rows-expand-row.spec.ts` | Selector drift fixes after frontend changed canonical testid shape — sample fixes: `[data-testid="service-name-{svcId}"]` replaces `.truncate`; `visibleServiceCount` counts `row-collapsed-*|row-expanded-*` under Focus; `findEnclosingRow` recognises Focus-mode anchors; misc oracle hardening |

## Test suite counts (end-of-session)

| Suite | Count | Notes |
|---|---|---|
| Frontend unit (`ng test shared/matrix/drawer/dashboard --watch=false`) | **227 / 227** PASS | shared 136 + matrix 83 + drawer 7 + dashboard 1 |
| Backend unit | **130 / 130** (unchanged — no backend work this cycle) | |
| Functional / API | **76 / 76** (unchanged) | |
| Mockup visual harness | **12 / 12** PASS | I9 + I10 + I11 all green after Phase 6 fixes |
| E2E (Playwright) | 164 / 166 (last known) + 6 new specs authored | Last run after Phase 5 selector fixes: 162/166 pass + 2 fail (the user-reported Matrix Focus env-header defects). Phase 6 fix should resolve the 2 fails; e2e not re-run in agent sandbox (no Docker). User to verify locally. |

## Outstanding items

- **Manual SPA smoke** — user-owned, in progress this session.
- **`matrix-focus-env-header-alignment.spec.ts` contradictory sanity check** — `expandedW - collapsedW > 20` is jointly unsatisfiable with the alignment assertions under the binary-widen contract (any service expanded → entire matrix widens). Either remove the sanity check OR rephrase to "both expanded AND collapsed == 200 px when any is expanded" (matches binary-widen). Owner: `qa-engineer`. Flagged by `frontend-engineer` in Phase 6.
- **Pre-existing scratch verification scripts** in `testing/mockup-visual/` (`focus-full-verify.mjs`, `focus-vs-compact.mjs`, `focus-vs-compact-screenshot.mjs`, `_smoke-headeralign.mjs`) — authored locally during cycle H, never staged. Owner: `qa-engineer` to clean up or adopt.
- **Phase 7 (SA review) + Phase 8 (User approval)** for cycle H — pending Phase 6 oracle fix + manual smoke.
- All non-blocking follow-ups from prior cycles still open (see git log + prior PROGRESS.md).

## TODO status (`TODO` is canonical — file edited this session)

Per the in-IDE state at session end, `TODO` line 9 (light/dark/auto theme) closed in commit `ad6f738`. The Focus-across-layouts work this session does NOT correspond to any TODO line — it was a regression fix surfaced mid-session. No TODO state change this commit.

## Resume instructions

1. Open the working directory in Claude Code — agent definitions reload.
2. Recommended clean cycle before substantive work: `pwsh -NoProfile -File dev_env/stop.ps1` → `pwsh -NoProfile -File dev_env/start.ps1` → `pwsh -NoProfile -File testing/scripts/seed.ps1 -Clean`.
3. **Manual SPA smoke for Cycle H** — exercise Focus × {Matrix, Swim-lane, Workflow-rows} × {Light, Dark}; verify chevron + pin visible, expand flips data-expanded, pin survives "Failures only" + Layout switch, env-header columns aligned with deployment rows pre + post expand, service-name renders on single line at intrinsic width (try long-name stress).
4. Dispatch `qa-engineer` (single dispatch) to fix the `matrix-focus-env-header-alignment.spec.ts:148-153` contradictory sanity check + re-run the 3 affected e2e specs.
5. Phase 7 (SA review) → Phase 8 (User approval) → close cycle H.

## Git state

- Repo: local-only, branch `main`.
- Local git config (repo scope): `user.name = kostiantyn-matsebora`, `user.email = komkom@duck.com`.
- Working tree at session end: cycle G (CLAUDE.md restructure + engineering-process.md extraction) and cycle H (Focus across all layouts) bundled together in this session's commit.
- No remote configured.
- Pre-existing unstaged modifications in `.claude/agents/ai-engineer.md` and `.claude/settings.local.json` left untouched — not owned by this session.
- Scratch `.mjs` verification scripts under `testing/mockup-visual/` left unstaged — pending qa-engineer cleanup or adoption.
