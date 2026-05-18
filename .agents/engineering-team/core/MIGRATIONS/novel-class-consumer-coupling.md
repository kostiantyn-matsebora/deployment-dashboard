# Migration — Novel-class consumer coupling (issue #10)

**Target release:** next minor after 2026-05-18.
**Affected adopters:** every adopter whose discovery extracted novel-class index files.

## What changed

The index protocol now requires every extracted class to declare at least one consumer role. Extraction without a consumer is the bug — it produces files no role reads.

- **New `§ Consumer coupling`** section in `core/index-protocol.md`:
  - Built-in classes auto-populate `consumed-by` from cardinal kernel scans + `local/bindings.md § Project-specific index citations`.
  - Novel classes MUST declare consumer via one of three paths: `framework.config.yaml`, `bindings.md` table, or interactive prompt during discovery.
  - **Default skip on no consumer** — novel class without declared consumer is NOT extracted; logged in discovery report instead.
- **New `§ Dormant-index audit`** section runs after every extraction. Reports any class with empty `consumed-by` or unresolved citations.
- **Manifest entries gain `consumed-by: [<role>...]` field** (required for novel classes; auto-populated for built-ins). See `§ Manifest shape`.
- **`§ Novel-class recipe`** in `core/roles/ai-engineer.details.md` now starts with "Resolve consumer FIRST" — extraction is gated on that resolution.
- **New `## Project-specific index citations` section** in `core/templates/bindings.md` — adopter-side citation table wires novel classes to cardinal roles without editing upstream kernels.

## Why

Real adopter data: deployment-dashboard extracted 4 novel-class index files (`wbs-index.yaml` 23 KB, `ci-cd-integration-index.yaml` 10 KB, `glossary.idx` 6 KB, `ui-options-index.idx` 4 KB — total 43 KB) that no cardinal role kernel cites. They sat on disk indefinitely, paid disk + staleness-check + extraction cost, but never loaded on any default dispatch. The fix forces an explicit consumer declaration before extraction.

## Action required

After re-fetching framework files on upgrade:

1. **Add the citations section to your existing `local/bindings.md`.** Copy the new `## Project-specific index citations` block from `core/templates/bindings.md` and place it before `## Out of scope`. Initially leave the table empty; fill it as you wire novel classes.

2. **Audit existing `manifest.yaml § indexed[]` entries** for the missing `consumed-by` field:

   ```
   @ai-engineer audit consumed-by
   ```

   `ai-engineer` will:
   - For each entry, scan cardinal kernels + `local/bindings.md § Project-specific index citations` for citations of the entry's `index-files`.
   - Auto-populate `consumed-by` where citations resolve.
   - Surface any entry that still ends with empty `consumed-by` as dormant.

3. **For each dormant class, decide per adopter judgment:**

   **Deployment-dashboard specific recommendations** (the four dormant files that motivated this issue):

   | Class | Index file | Size | Suggested action |
   |---|---|---|---|
   | wbs | `wbs-index.yaml` | 23 KB | Wire to `project-manager` (WBS is operational state, not architecture) — add row to `bindings.md § Project-specific index citations`. OR skip extraction; WBS is read directly by PM only when planning phase work. |
   | ci-cd-integration | `ci-cd-integration-index.yaml` | 10 KB | Wire to `devops-engineer` (operational companion to architecture's CI/CD section). Add row to `bindings.md`. |
   | ui-options | `ui-options-index.idx` | 4 KB | Wire to `frontend-engineer` (UI proposal governance during Phase 2). Add row to `bindings.md`. |
   | glossary | `glossary.idx` | 6 KB | Already cited by `extras/data-engineer.md` (when enabled). For cardinal-only projects, either wire to `solution-architect` (governance) or accept skip. |

4. **Update `local/framework.config.yaml § index.classes`** to pre-declare `consumed-by` for any class you want to keep extracted long-term. Example:

   ```yaml
   index:
     classes:
       - name: wbs
         category: doc
         source-glob: docs/WBS.md
         template: novel
         consumed-by: [project-manager]
       - name: ci-cd-integration
         category: doc
         source-glob: docs/ci-cd-integration.md
         template: novel
         consumed-by: [devops-engineer]
   ```

5. **Skip any class you don't need**: remove its entry from `local/framework.config.yaml § index.classes` (or never add it). The detection heuristic that surfaced it will log a "skipped — no consumer" line in the next discovery report so you don't lose visibility.

## Behavioural change to expect

- Discovery no longer silently extracts novel classes. The first time PM detects a novel class without declared consumer, it asks you (or skips with a logged warning if non-interactive).
- `manifest.yaml § indexed[]` entries now carry `consumed-by` — you can inspect at any time which roles consume each class.
- `@ai-engineer audit consumed-by` is the on-demand surface for the audit.
- For deployment-dashboard's 43 KB of dormant files: either wire them via `bindings.md` (preserves the existing files; PM extends role baselines) or remove from extraction (reclaims 43 KB on disk + corresponding per-dispatch costs IF they had been cited).

## Safeguards

- **No silent removal of existing dormant files.** Dormancy is reported, not auto-pruned. Adopter explicitly decides per class.
- **Built-in classes always have at least one cardinal consumer** (verified by the framework's own CI when role kernels change). Adopter never needs to declare consumers for them.
- **`consumed-by` is purely declarative.** It does NOT modify role kernel files — they stay upstream-owned and replaceable on upgrade. The PM-side baseline-extension happens at dispatch time by reading `bindings.md`.

## Rollback

- Delete the `## Project-specific index citations` section from `local/bindings.md` if you don't want it.
- Remove `consumed-by` from manifest entries — older `ai-engineer` versions ignore the field (graceful degradation).
- Pin framework to the pre-fix release in `core/VERSION`.

## Issue reference

Implemented per [issue #10](https://github.com/kostiantyn-matsebora/engineering-team/issues/10) — `Novel-class index files extracted but no role kernel cites them — dormant 43 KB on deployment-dashboard`. Stacked on [issue #9](https://github.com/kostiantyn-matsebora/engineering-team/issues/9) (compression floor).
