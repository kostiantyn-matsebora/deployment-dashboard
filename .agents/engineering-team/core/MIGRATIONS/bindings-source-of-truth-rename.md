# Migration — `bindings.md § Source of truth` → `§ Source-of-truth ownership`

**Target release:** next minor after 2026-05-18.
**Affected adopters:** every adopter with a `local/bindings.md` populated from a pre-fix `core/templates/bindings.md`.

## What changed

`core/templates/bindings.md` previously rendered a section header `## Source of truth (read before any work)` whose "read before any work" framing told every dispatched specialist to load the raw doc paths listed in the table. On projects with non-trivial documentation (architecture doc + ADRs + CRs + mockup + WBS + scenarios), this re-introduced the per-dispatch full-corpus read that `core/index-protocol.md` (D13) + the code-derived index (D15) exist to eliminate.

The fix:

- **Renamed** the section to `## Source-of-truth ownership`.
- **Reframed** the section as a **governance map** (who edits each raw source + where the verbatim text lives when an index entry points to "see source"). NOT a default read list.
- **Default reads** stay on `local/index/*` per `core/index-protocol.md`.
- **Cross-referenced** from `core/index-protocol.md § Why` so the load-on-demand contract is visible from both sides.

Affected files:

- `core/templates/bindings.md` — heading rename + new preamble line.
- `core/index-protocol.md § Why` — cross-reference paragraph added.
- `core/roles/backend-engineer.md`, `devops-engineer.md`, `frontend-engineer.md`, `qa-engineer.md`, `solution-architect.md` — tie-breaker reference updated.
- `core/templates/role-authoring-template.md` — conflict-resolution reference updated.

## Action required

After re-fetching framework files on upgrade:

1. **Rename the heading** in your `local/bindings.md`:

   ```
   ## Source of truth (read before any work)   →   ## Source-of-truth ownership
   ```

2. **Add the preamble line** (one line, immediately under the new heading, above the table):

   ```
   **Default reads:** `local/index/*` per `core/index-protocol.md`. The table below is a **governance map** — who edits each source + where the verbatim text lives when an index entry points to "see source." NOT a per-dispatch read list; pulling raw doc paths into every dispatch defeats the load-on-demand contract.
   ```

3. **No other changes required.** The table rows themselves stay as-is — same files, same `Edited by` column.

Alternatively, run `@project-manager rediscover` (or the natural-language equivalent activating `ginee-rediscover` per D16) to regenerate `local/bindings.md` from the patched template — but be aware this overwrites any hand-edited rows.

## Behavioural change to expect

- Specialist dispatches no longer cite "read before any work" as justification for pulling raw `docs/**` into context. The index protocol (`local/index/*`) is the only default read surface for source-of-truth artefacts.
- Tie-breaker references in role kernels now point at `Source-of-truth ownership` instead of `Source of truth`. Functionally identical — same table, same tie-breaker rows.
- Heavy-doc adopters (≥ 100K of docs) see a measurable drop in tokens consumed per dispatch on tasks that don't need verbatim doc text.

## Backward compatibility

- `local/bindings.md` files that retain the old heading still parse correctly. Role kernels' tie-breaker references will not auto-resolve to the renamed section in a strict-string sense, but specialists reading the file directly will still find the same table.
- Recommended: apply the action steps above so cross-references match.

## Rollback

- Revert the section heading in your `local/bindings.md`.
- Pin framework to the pre-fix release in `core/VERSION`.

## Issue reference

Implemented per [issue #7](https://github.com/kostiantyn-matsebora/engineering-team/issues/7) — `bindings.md "Source of truth (read before any work)" defeats local/index/ token-economy contract`.
