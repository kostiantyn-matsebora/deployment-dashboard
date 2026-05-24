---
name: ginee-reindex
description: Reconcile local/index/ with the current repo state at the named scope per the ginee index protocol. Three sweeps — SHA drift on existing entries, new files within existing class globs, stale entries (prompt). Use when the user asks to 'reindex', 'reindex <file>', 'reindex <class>', 'reconcile the index', 'refresh the index', or when SHA-256 drift is detected pre-dispatch.
---

# Reconcile the index (ginee)

Run the reconciliation workflow per `.agents/ginee/core/protocols/index-protocol.md § Reconciliation`. Dispatches `ai-engineer` to make `local/index/` match the current repo state at the chosen scope.

## Activation

- User asks "reindex" / "reindex `<scope>`" / "reconcile the index" / "refresh the index".
- `team-lead` detected SHA-256 drift pre-dispatch and the user picked reconciliation over full rediscovery.

## Scope

| Form | Effect |
|---|---|
| `reindex` (no arg) | All classes, whole repo. |
| `reindex <file>` | The file's matching class only. Sweep 1 if entry exists, Sweep 2 if not. Multi-class match → ask which class. |
| `reindex <class>` | One class's `source-glob` only — full three-sweep within that class. |

## Procedure

1. Load `.agents/ginee/core/protocols/index-protocol.md § Reconciliation` and `.agents/ginee/core/roles/ai-engineer.details.md § Project extraction recipes`.
2. Resolve the scope:
   - **No arg** → all manifest entries + every class's `source-glob`.
   - **`<file>`** → look up the file's matching class via manifest `source-glob`. Multi-class match → ask which class. No class match at all → reconciliation cannot help (novel class); suggest `ginee-rediscover` for class enumeration.
   - **`<class>`** → that class's `source-glob`.
3. Dispatch `ai-engineer` with the resolved scope. `ai-engineer` runs the three sweeps per the spec:
   - **Sweep 1 (SHA drift).** Recompute SHA-256 on every in-scope manifest entry; re-extract on change.
   - **Sweep 2 (new files).** For every in-scope class, list files matching its `source-glob`; any not in the manifest → add entry (recipe inherited from class) and extract.
   - **Sweep 3 (stale entries).** Manifest entry whose source file no longer exists → surface to user; prompt `remove?`. Never auto-delete.
4. `ai-engineer` updates `manifest.yaml` (new SHA-256, new `indexed-on`, refreshed `index-files`) and runs sample-and-check on each entry touched by Sweep 1 or 2.
5. `ai-engineer` runs the dormant-index audit and reports findings (`§ Dormant-index audit`).
6. Surface the per-sweep summary + the resulting diff and manifest delta to the user.

## Forbidden

- Never auto-delete a Sweep-3 stale entry — always prompt.
- Never skip the sample-and-check lossless verification on any class touched.
- Never extend into novel-class detection (sources matching no manifest class glob). Route to `ginee-rediscover` — that path also touches `project-profile.md` + `bindings.md` + may need user consumer-coupling input.
