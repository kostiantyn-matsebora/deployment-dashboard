---
name: ginee-discovery
description: Run the ginee framework's initial discovery on this project. Use when starting a new framework install, when local/project-profile.md is missing, or when the user asks to 'run initial discovery', 'discover the project', 'set up ginee'. Detects stack, paths, doc artefacts, SDLC tooling; writes local/project-profile.md + local/bindings.md + local/framework.config.yaml; dispatches ai-engineer to populate local/index/manifest.yaml.
---

# Initial discovery (ginee)

Run the ginee framework's initial-discovery workflow per `.agents/ginee/core/roles/team-lead.details.md § Discovery flow`.

## Activation

Any of `local/project-profile.md` · `local/bindings.md` · `local/framework.config.yaml` missing; OR user invokes per `adapters/_shared/install-common.md § Skill cheat sheet`.

## Procedure

1. Load `.agents/ginee/core/roles/team-lead.details.md § Discovery flow` for the 10-step procedure.
2. Run Steps 1–7 (detect stack / domain / architecture artefacts / SDLC tooling / roles / external agents / TODO conventions).
3. Step 8a: write `local/project-profile.md`, `local/bindings.md`, `local/framework.config.yaml` using templates in `.agents/ginee/core/templates/`.
4. Step 8b: enumerate doc classes (adopter-declared → built-in → novel) per `.agents/ginee/core/protocols/index-protocol.md`; dispatch `ai-engineer` to populate `local/index/*` + `manifest.yaml`.
5. Step 9: produce the discovery report using `.agents/ginee/core/templates/discovery-report.md`; surface to user.
6. Step 10: embed any user-approved external agents (translate to framework role shape, write `local/roles/<name>.md`, add bindings row).

## Forbidden

- Never enable a specialist or external agent without explicit user approval.
- Never overwrite existing `local/*` files — full rewrite requires `ginee-rediscover`.
- Never auto-extend any TODO file.
