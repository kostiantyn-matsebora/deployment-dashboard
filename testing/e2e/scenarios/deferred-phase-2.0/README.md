# Deferred to Phase 2.0

Scenarios in this folder describe behaviour that is **not part of MVP**
and has been parked for a future phase. They are preserved here (rather
than deleted) so the contract remains discoverable and the matching
Playwright specs under `../tests/deferred-phase-2.0/` can be reactivated
by lifting the `testIgnore` entry in `testing/e2e/playwright.config.ts`.

## Current contents — Matrix layout (re-added in Phase 2.0)

The Matrix layout was removed from the MVP layout axis. Swim-lane and
Workflow-rows are the only MVP layouts. The following scenarios all
assume `layout === 'matrix'` and therefore live here:

- `matrix-six-box-states.md` — pipeline matrix renders one stage box
  per service x environment in the six canonical box states.
- `matrix-version-hover-highlight.md` — hovering a version amber-rings
  every box across environments that hosts it.
- `matrix-focus-env-header-alignment.md` — Matrix x Focus env-header
  columns realign with deployment columns under row expansion
  (`--leaf-width-expanded`).

## Reactivation checklist (when Phase 2.0 opens)

1. Re-add `'matrix'` to the active layout list in any consuming
   scenario (`layout-x-view-combinations.md`, `layout-switcher-persists.md`,
   `spa-visual-invariants.md`, `focus-view-distinct-from-compact.md`).
2. Remove the `testIgnore` entry for `deferred-phase-2.0/**` in
   `testing/e2e/playwright.config.ts`.
3. Move the scenarios + specs out of `deferred-phase-2.0/` back to the
   parent folder (via `git mv` so history continues to follow them).
4. Restore matrix to `harness.config.json#layouts` and re-add the I11
   invariant from the `deferredPhase20` section to the active
   `invariants` list (mockup-visual harness).
