# Migration — D41: Pre-implementation blueprint-diff gate for visual source-of-truth

**Target release:** next minor after 2026-05-24.
**Affected adopters:** every adopter whose `local/framework.config.yaml § mockup:` (or new `visual-source-of-truth:`) is set; auto-applies on next Phase 4 dispatch touching that path.
**Closes:** [#111](https://github.com/kostiantyn-matsebora/ginee/issues/111).

## What changed

Pre-D41 the framework named the mockup (or equivalent visual artefact) as canonical client contract per `local/bindings.md § Source-of-truth ownership`, then trusted Phase 5/6 oracles to catch drift. **No protocol step asserted what already changed before Phase 4 added more.**

D41 adds a **Phase 4 entry precondition** — a structural diff between the working-copy visual source-of-truth and a configurable blueprint reference (default `origin/main`), scoped to the issue's expected-change region. Unexpected deltas force-interactive-gate the dispatch; expected/pre-existing deltas pass through.

Full spec: `core/protocols/blueprint-diff-protocol.md` (load-on-demand at Phase 4 dispatch entry).

## Why

Adopter incident `kostiantyn-matsebora/deployment-dashboard#54` (workflow-rows W1 migration):

| Step | What happened |
|---|---|
| 1 | Migration rewrote the canonical HTML mockup's tile innerHTML emission. |
| 2 | SPA reused an existing tile component (`<dd-layout-leaf>`); mockup was rewritten from scratch. |
| 3 | Mockup lost chrome elements — status badge · version-block · ago timestamp · run number · actor · ref/sha · prev-failed warning · lastSuccessful row. |
| 4 | Geometry oracles (no-crossings · no-overlap · no-clip · edge-count) ran **green** across four bug-fix iterations. Chrome was gone; geometry didn't care. |
| 5 | User caught the regression via manual screenshot comparison only. |

Root cause:

- Mockup named as visual source-of-truth; mockup-visual harness assumed to catch drift.
- Harness oracles default to geometry — chrome-parity oracles need explicit authoring and rarely exist by default in an adopter.
- **No protocol step forced a structural diff vs the pre-change blueprint before Phase 4 fired.**
- When the SPA reuses a component the mockup approximates by hand, SPA fidelity masks the regression.

D41 closes the gap at the point the regression starts — *before* Phase 4 edits.

## Form

**Option B** from the issue (Phase 4 first-step in role dispatch) — chosen. Rejected alternatives:

| Option | Why rejected |
|---|---|
| A (Phase 3 gate addition) | Design-review gate is per-PR for SA-owned files; the regression slipped at Phase 4 *start*, not at design review. Wrong attachment point. |
| C (new Phase 3.5 protocol step) | Adds a lifecycle phase; bloats the 8-phase model for a check that fits cleanly as a Phase 4 dispatch precondition. |

Option B matches the established protocol pattern — D22 / D26 / D29 / D30 / D40 all use load-on-demand specs with N mandatory checks + LLM self-review + one-line orchestrator advisory.

## Files updated

| Path | Change |
|---|---|
| `core/protocols/blueprint-diff-protocol.md` | **NEW** — full spec. |
| `core/MIGRATIONS/D41-blueprint-diff-gate.md` | **NEW** — this file. |
| `core/templates/framework.config.yaml` | Add `visual-source-of-truth:` block. |
| `core/process/phase-4-implementation.md` | Add D41 entry-precondition rule + load-trigger reference. |
| `core/roles/frontend-engineer.md` | Add D41 obligation to `§ Mockup ownership`. |
| `core/templates/phase-report.md` | Add D41 row example to `## Verification log § Section templates`. |
| `core/process.md` § Load-on-demand specs | Add D41 row to the index. |
| `CLAUDE.md` | Add D41 to locked-decisions table. |
| `PLAN.md` | Add D41 row. |
| `docs/CHANGELOG.md` | Verbose entry per D40 voice. |
| `.github/release-notes/v0.17.0.md` | **NEW** — user-value sidecar per D40 voice; ≤ 20 words / bullet. |
| `docs/CONCEPTS.md` + `docs/CHEATSHEET.md` | User-docs co-update per D25 binding rule (adopter-facing surface). |

## Configuration shape

New `local/framework.config.yaml § visual-source-of-truth` block — all keys optional; framework defaults derive from `mockup:` when absent:

```yaml
visual-source-of-truth:
  type: html-mockup           # html-mockup | figma | image | video | other
  path: docs/mockup.html      # working-copy path or external URL
  blueprint-ref: origin/main  # git ref / tag / commit / external URL / file path
  scope-discriminator: block-glob  # block-glob | section-anchor | full-file | external
  enabled: true               # set false to disable repo-wide
```

Adopters with `mockup:` set automatically get the protocol on next dispatch — derived defaults assume HTML + `origin/main` + block-glob scoping. Override patterns:

| Use case | Override |
|---|---|
| Release-tag blueprint (non-trunk mainline) | `blueprint-ref: v1.2.0` |
| Frozen snapshot file | `blueprint-ref: docs/mockup.v1.html` |
| External Figma project | `type: figma` + `path: <figma-url>` + `blueprint-ref: <figma-version-url>` |
| Image baseline | `type: image` + `path: testing/baseline/dashboard.png` + `blueprint-ref: testing/baseline/dashboard.prev.png` |
| Adopter-specific tool | `type: other` + path to working copy + `blueprint-ref` per adopter convention; `local/index/commands.yaml § commands.visual-diff` carries the invocation. |

## Decisions affected

Touchpoints — D12 (forced-interactive on unexpected delta) · D14 (issue scope drives classification) · D17 (mode-independent) · D22 (doc-shape on surrounding text) · D25 (mockup-owning role gains diff-and-surface obligation) · D29 (Verification-log row; no new section) · D30 (per-type adopt + protocol-layer build) · D36 (warm-resumed specialist re-runs each dispatch) · D39 (sub-issue closing comment carries outcome).

Full interaction table — `core/protocols/blueprint-diff-protocol.md § Interaction with other decisions`.

## Adopt-vs-build (D30)

| Layer | Choice | Rationale |
|---|---|---|
| Per-type diff tools | **adopt** | `git diff` (built-in; GPL-2; universal) for `html-mockup`; Figma file-comparison URL / REST `GET /v1/files/<key>/versions` for `figma`; `pixelmatch` (MIT) / `odiff` (MIT) / `Resemble.js` (MIT) for `image`. All mature; adopters typically already have one configured. |
| Protocol layer | **build** | `(none viable — surveyed Conftest/Rego, Spectral, htmlhint; none ship a markdown-spec-driven pre-edit blueprint-diff gate for multi-agent workflows)`. Build follows the framework's load-on-demand spec pattern proven on D22 / D26 / D29 / D30 / D40. |

## Mandatory checks + forbidden patterns

Full lists in `core/protocols/blueprint-diff-protocol.md § 4 mandatory checks before edits begin` + `§ Forbidden patterns`. Same self-review machinery as D22 / D26 / D29 / D30 / D40 — no external linter; orchestrator one-line advisory on violation; never auto-rewrites.

## Backward compatibility

- **Breaks existing `local/*` files: no** — new `visual-source-of-truth:` block defaults derived from existing `mockup:` key; adopters get the behaviour on next Phase 4 dispatch without manual config edits.
- Adopters with no `mockup:` configured — protocol auto-skips with cite `"visual-SoT untouched — protocol n/a"`.
- No script changes. No installer change. No test changes. Adopter action on upgrade: **none** (override patterns optional).

## Reproducer test

The adopter incident from `deployment-dashboard#54` no longer slips through under the new gate:

1. Phase 4 dispatch picked up the workflow-rows W1 migration.
2. Protocol fires at dispatch entry — `git diff origin/main -- docs/mockup.html` scoped to the workflow-row block.
3. Diff classifies the chrome-element removals (status badge · version-block · timestamps · prev-failed) as **Unexpected** — not in the issue's stated scope.
4. Forced-interactive gate fires; user surfaces the regression; either re-scopes the issue to keep chrome OR rejects the dispatch.
5. Phase 4 edits do not begin under the regression-prone shape.

## Out of scope

- Authoring per-adopter diff tools — adopter writes them per `local/`.
- Replacing the mockup-visual harness — D41 is additive, not a substitute.
- Mandating a specific diff format.
- Authoring chrome-parity oracles — `qa-engineer`'s Phase 5 surface; D41 catches drift earlier.
- Diffing non-visual artefacts — wire contracts · API specs · architecture docs have their own review surfaces.
- License gating on adopter diff tools — adopter `local/` policy.

## Forward-only

Purely additive. The next Phase 4 dispatch touching `visual-source-of-truth.path` on any upgraded adopter is the first that runs the protocol.
