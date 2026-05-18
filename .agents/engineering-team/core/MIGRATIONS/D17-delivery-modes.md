# Migration — D17: Delivery modes

**Target release:** next minor after 2026-05-17.
**Affected adopters:** every adopter project.

## What changed

PM now resolves one of three explicit delivery modes per task — **Mode 1** (feature branch + PR), **Mode 2** (working-tree only), **Mode 3** (commit-no-push) — before Phase 4 starts. The pre-D17 de-facto behaviour ("commit per batch on current branch") = Mode 3 in the new model.

New artefacts:

- `core/delivery-modes.md` — full spec.
- New `delivery:` block in `core/templates/framework.config.yaml`.

Modified:

- `core/process.md § Phase 8` — mode-aware acceptance steps + new Coordination-protocol stub.
- `core/roles/project-manager.md` — Phase-3 gate now includes mode-resolution; new `Delivery mode` section + forbiddens.
- `core/roles/project-manager.details.md` — Phase-3 resolution procedure + per-mode dispatch checklist.
- `core/automatic-mode.md` (D12 spec) — handoff state + Accept action branch by resolved mode; auto-mode default = `wt`.

## Action required

### Adopters

After re-fetching framework files on upgrade:

1. **(Optional) Set adopter-wide default** by uncommenting + setting the new `delivery.default-mode` block in `local/framework.config.yaml`. If left unset, framework defaults apply (`branch` for issue/TODO-sourced; `wt` for freeform).
   ```yaml
   delivery:
     default-mode: branch   # branch | wt | commit
   ```
2. **(Optional) Use per-task prefix.** Drop `branch:` / `wt:` / `commit:` at the start of any task description to override per task. Combinable with `auto:` (D12).
3. **(No action) If you do nothing**, PM will ask at Phase 3 the first time a task lacks a resolved mode.

### Behavioural change to expect

- Phase 3 design-review now reports the resolved delivery mode + offers a one-line override.
- Phase 4 commit cadence depends on mode (no commits in Mode 2; branch commits in Mode 1; current-branch commits in Mode 3).
- Phase 8 finalize runs per-mode steps: push + PR (1), surface diff (2), surface commit list (3).
- Auto mode (D12) — default delivery is now Mode 2 (was implicit before; the "nothing committed yet" invariant now has a formal name).

## Backward compatibility

- No `local/` files break.
- Adopters who relied on the pre-D17 "commit per batch on current branch" behaviour can either:
  - Set `delivery.default-mode: commit` in `local/framework.config.yaml`, OR
  - Prefix tasks with `commit:`.
- `@<role>` notation and existing dispatch flows unchanged.

## Rollback

- Remove the `delivery:` block from `local/framework.config.yaml`.
- Pin framework to pre-D17 release in `core/VERSION` (or re-fetch the older `core/`).

## Issue reference

Implemented per [issue #3](https://github.com/kostiantyn-matsebora/engineering-team/issues/3) — "Delivery modes — branch+PR / working-tree-only / commit-no-push."
