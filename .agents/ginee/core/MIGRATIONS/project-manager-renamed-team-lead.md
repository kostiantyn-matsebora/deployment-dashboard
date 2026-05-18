# Migration — `project-manager` → `team-lead`

**Target release:** next minor after 2026-05-18.
**Affected adopters:** all installs prior to 2026-05-18.

## What changed

The orchestrator cardinal role was renamed `project-manager` → `team-lead`. Rationale: better matches the ginee tagline *"an AI software engineering team that behaves like a real one"* — engineering teams have team leads, not project managers (PM is product-side; team lead is engineering-side).

- **Canonical name:** `team-lead`.
- **Aliases:** `orchestrator`, `project-manager` (legacy name retained for back-compat — existing `@project-manager` dispatches still route).
- **Files renamed:**
  - `core/roles/project-manager.md` → `core/roles/team-lead.md`
  - `core/roles/project-manager.details.md` → `core/roles/team-lead.details.md`
  - `adapters/_shared/agents/project-manager.md` → `adapters/_shared/agents/team-lead.md`
- All sibling kernels, specs, adapters, templates, skills, docs, README, PLAN, CLAUDE.md updated to reference `team-lead` as canonical.

## Action required

After `./install.sh --update-only --adapter <…>` (or `.\install.ps1 -UpdateOnly -Adapter <…>`):

The installer auto-deletes stale pointer files from your adapter directory:
- `claude` adapter — removes legacy `.claude/agents/project-manager.md`
- `copilot-cli` adapter — removes legacy `.github/agents/project-manager.agent.md`

No manual cleanup needed for these. New `team-lead.md` / `team-lead.agent.md` lands in the same directory.

### `agents-md` / `generic` adopters

No filesystem footprint to clean up — the single `AGENTS.md` / `INSTRUCTIONS.md` file is overwritten in place on update.

### `local/bindings.md`

Optional — purely cosmetic. If you authored `local/bindings.md § Project role boundaries` rows that named `project-manager` explicitly, leave them as-is (the alias still routes), or rename to `team-lead` for consistency with the framework docs.

### `local/framework.config.yaml`

If you set `delivery.default-mode` or other config entries that referenced `project-manager` in comments, rename for consistency. No functional change.

## Behavioural change to expect

- `@project-manager` still routes — alias preserved indefinitely. No urgency to rewrite existing TODO files, README snippets, or scripted prompts.
- `@team-lead` is the new canonical form in framework docs + skill descriptions.
- Discovery prompts in the installer's "Next steps" message now say `act as team-lead and run initial discovery` (tier-3 fallback). `act as project-manager and run initial discovery` still works.

## Backward compatibility

- **Long-term alias support.** `project-manager` is a permanent alias, not a transition stub. No deprecation timeline.
- **Adapter pointer files** — the legacy `.claude/agents/project-manager.md` / `.github/agents/project-manager.agent.md` are removed by the installer on update. If you didn't run the updater (e.g. running framework from `git clone`), delete them manually to avoid duplicate-pointer warnings from the client.
- **CI / scripts** — if your project's CI greps for `project-manager` in framework files, update to `team-lead` (or grep for both). The framework's own `.github/workflows/ci.yml` cardinal-roles validation now expects `team-lead`.

## Rollback

This is a rename + alias addition. Rollback procedure:

1. Pin framework to a pre-2026-05-18 release: `./install.sh --ref v0.1.0 --update-only --adapter <…>`.
2. Restore deleted `.claude/agents/project-manager.md` (or `.github/agents/project-manager.agent.md`) from your git history if you committed it before the update.

No data loss in either direction — the role's charter, skills, dispatch behaviour, and lifecycle gates are unchanged.

## Issue reference

No issue — user-requested rename on 2026-05-18.
