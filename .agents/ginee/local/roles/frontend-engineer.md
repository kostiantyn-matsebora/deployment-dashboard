---
name: frontend-engineer-local
description: Project-local extension to the cardinal `frontend-engineer` charter (`.agents/ginee/core/roles/frontend-engineer.md`). Captures deployment-dashboard-specific craft notes — mockup self-verification before/after edits — that benefit this project's frontend dispatches but don't belong on the framework-upstream side.
aliases: [client-engineer, ui-engineer]
---

# Frontend Engineer — project-local extension

Load this **alongside** the cardinal charter (`.agents/ginee/core/roles/frontend-engineer.md`). The cardinal owns the generic craft; this file owns deployment-dashboard-specific knowledge that the cardinal deliberately stays stack-agnostic about.

## Mockup self-verification — `docs/ui/mockups/deployment-dashboard.html`

Every edit to `docs/ui/mockups/deployment-dashboard.html` MUST be bracketed by a before/after visual self-check. The formal mockup-visual harness in `testing/mockup-visual/` (owned by `qa-engineer`) gates against the golden baseline; this self-check is a different surface — it catches *unintended* visual changes within a single edit cycle, before the formal harness runs.

### Procedure

1. **Before opening the file for edit** — snapshot the current state:
   - Copy `docs/ui/mockups/deployment-dashboard.html` → `<temp>/deployment-dashboard.before.html`.
   - Use `[System.IO.Path]::GetTempPath()` (or `os.tmpdir()` equivalent) — never place the copy under the working tree.
   - Render the copy and save a baseline screenshot per representative viewport:
     - mobile (375 × 812) → `<temp>/screenshots/mobile-before.png`
     - desktop (1440 × 900) → `<temp>/screenshots/desktop-before.png`
2. **Make the requested edit** in the original file.
3. **After the edit** — render and diff:
   - Render the edited file at the same viewports → `<temp>/screenshots/<viewport>-after.png`.
   - Produce an **annotated diff image** per viewport → `<temp>/screenshots/<viewport>-diff.png`. The diff image MUST visually mark every changed region:
     - Pixel-mask overlay (e.g., `pixelmatch` red-channel mask), bounding boxes, or a composite — whichever the chosen tool produces. Outcome matters, not rendering style.
     - Anti-aliasing detection enabled where the tool supports it (suppresses spurious subpixel diffs).
4. **Report the visual delta** in the final phase report — diff images are attached **in both pass and fail cases**:
   - Per viewport: `before.png`, `after.png`, `diff.png` (all three, always — even when no unintended deltas exist).
   - Intended changes — list each marked region that matches the requested edit scope.
   - Unintended changes — list any marked region outside the requested scope.
   - Unintended deltas → fix before report-as-done OR explicitly flag in `## Open issues`.
   - Pass case (only intended deltas present) — diff images still attached so the reviewer sees *what* changed, not just *that* it passed.
5. **Clean up** — delete `<temp>/deployment-dashboard.before.html` + `<temp>/screenshots/` after the report is composed and posted.

### Tooling

Use whichever is available in the session — both are valid:

| Path | Invocation shape |
|---|---|
| Playwright CLI + diff library | `npx playwright screenshot --viewport-size=<W>,<H> file://<abs-path> <out.png>` (run from `testing/mockup-visual/` to reuse the project's Playwright install); diff via `pixelmatch` (or `odiff`, `looks-same`) — already common alongside Playwright. |
| Playwright MCP + diff library | MCP screenshot tool for capture; diff library invoked separately to produce the annotated overlay. |

Pick one mechanism per cycle; do not mix CLI + MCP within the same self-check. The diff library is required regardless of capture path — a raw `after.png` without an annotated `diff.png` does not satisfy step 4.

### Out of scope for this self-check

- Replacing the formal `testing/mockup-visual/` harness — owned by `qa-engineer`; remains the regression gate against the golden baseline.
- Editing the harness baseline — self-check is transient; baseline updates remain `qa-engineer`'s call.
- Diffing against any state other than the immediate pre-edit copy.
- Applying the procedure to other mockup files (e.g., `env-tag-column-alignment-variant-{a,b}.html`) — those have their own variant-pair comparison story and are not in scope for this rule yet.

## Source of truth — augmentations beyond the cardinal

The cardinal charter's "Source of truth" table covers index files that exist in `local/index/`. Add to that list:

| Read | What it gives you | Load when |
|---|---|---|
| This file (`local/roles/frontend-engineer.md`) | Project-local frontend gotchas + mockup self-verification rule. | **always** alongside the cardinal charter |

## Out of scope for this file

- **The cardinal frontend craft** (UI states, accessibility, FR/NFR citation, styling rules, generic mockup ownership) — that's in `core/roles/frontend-engineer.md`.
- **Project routing / role boundaries** — `local/bindings.md`.
- **Specific index recipes** — `local/index/*` per `core/index-protocol.md`.
- **Architecture / CR / ADR semantics** — `solution-architect`.
- **Test harness authoring** — `qa-engineer` owns `testing/mockup-visual/`.
