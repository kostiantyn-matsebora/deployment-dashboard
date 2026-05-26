---
name: ginee-rediscover
description: Run full re-discovery of the project via the ginee framework. Use when the user asks to 'rediscover', 'refresh project discovery', 're-run discovery', or when major project structure has changed since the last discovery. Re-detects everything and overwrites local/* artefacts; preserves local/roles/ (project-authored).
---

# Full re-discovery (ginee)

Re-run the full discovery flow per `.agents/ginee/core/roles/team-lead.details.md § Discovery flow`. Overwrites discovery output; preserves adopter-authored content.

## Activation

Per `adapters/_shared/install-common.md § Skill cheat sheet`; OR major project structure changed (new top-level dirs · new tier · new doc class).

## Procedure

1. Confirm with the user before overwriting: list `local/project-profile.md`, `local/bindings.md`, `local/framework.config.yaml`, `local/index/manifest.yaml` as the files about to be replaced.
2. Run the full 10-step Discovery flow per `.agents/ginee/core/roles/team-lead.details.md § Discovery flow`.
3. Step 8a writes refreshed `local/project-profile.md` / `local/bindings.md` / `local/framework.config.yaml`.
4. Step 8b re-enumerates doc classes and dispatches `ai-engineer` to re-extract every index file under `local/index/`; `manifest.yaml` SHA-256 values are recomputed.
5. Diff against prior versions; surface notable changes in the discovery report (new tiers, new doc classes, retired components).

## Preserved across rediscover

- `local/roles/*` — adopter-authored custom roles.
- `local/` files outside the four discovery outputs (anything the adopter added).

## Forbidden

- Never overwrite without user confirmation.
- Never re-enable an external agent the adopter previously declined.
- Never auto-bump roles from `extras/` into `local/roles/` without confirmation.
