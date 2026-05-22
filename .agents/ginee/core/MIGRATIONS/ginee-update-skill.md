# Migration — `ginee-update` skill (framework self-update via the orchestrator)

**Target release:** next minor after 2026-05-21.
**Affected adopters:** every adopter on every adapter (Claude Code, Copilot CLI, AGENTS.md clients, generic) — opt-in trigger; no breaking change.

## What changed

The orchestrator (`team-lead`) gains a uniform self-update surface — no more "remember to re-run the installer with `--update-only` manually." Triggers `@team-lead update [<tag|branch|sha>]` / "update ginee" / "upgrade the framework" now load `core/skills/ginee-update/SKILL.md`, which:

1. Locates the installed framework (default `.agents/ginee/`).
2. Reads current `core/VERSION`.
3. Resolves the target ref (latest release / explicit tag / branch / SHA).
4. Surfaces an explicit plan + waits for user approval.
5. Drives the existing `install.{ps1,sh} --update-only` flow.
6. Reports VERSION delta + CHANGELOG range + any new `core/MIGRATIONS/` files (with their `Action required` excerpts).

The underlying installer behaviour is unchanged — `--update-only` already preserves `local/` and refreshes only the three upstream-owned trees (`core/` / `adapters/` / `extras/`). This migration only adds the orchestrator-driven invocation surface.

Affected files:

- `core/skills/ginee-update/SKILL.md` — NEW skill (~50 lines).
- `core/roles/team-lead.md` — new `§ Framework self-update` bullet + new row in `## Dispatch routing` table.
- `core/process.md` — `update` added to the framework-workflows list under `§ Invocation notation`.
- `adapters/{claude,copilot-cli,agents-md,generic}/install.md` — activation cheat-sheet rows for the new skill.
- `docs/CHEATSHEET.md` + `docs/ARCHITECTURE.md` — skill listing + cheat-sheet entry.
- `.github/workflows/ci.yml` — `ginee-update` added to the three per-adapter skill-presence loops.

## Why

Pre-fix, the only way to update was to recall the installer one-liner (`iwr ... | iex` with `GINEE_UPDATE_ONLY=1`, or `./install.{ps1,sh} --update-only`) and run it manually. Adopters routinely:

- Ran with the wrong `--ref` (defaulted to `main` instead of `latest`).
- Missed `core/MIGRATIONS/*.md` entries shipped since their last update.
- Re-ran the adapter install step out of sync with the framework refresh.

A skill-mediated flow makes the path discoverable (any AgentSkills-compatible client picks it up by description match), enforces the explicit-approval gate, and produces a structured post-update report so adopter action items aren't missed.

## Adopter action

None required to keep working on the existing version. To start using the new flow:

1. Refresh the framework once via the existing path: `./install.{ps1,sh} --update-only` (or the bootstrap one-liner with `GINEE_UPDATE_ONLY=1`). This pulls `core/skills/ginee-update/`.
2. Re-run the per-adapter install step so the skill gets bridged into the host client's expected path (`.claude/skills/`, `.agents/skills/`, ...). The installer's `--update-only` flag handles this automatically when the adapter is detected.
3. Future updates: just say "update ginee" — the orchestrator drives it from there.

## Behavioural change to expect

- Saying "update ginee" in any session activates the new skill instead of routing to a manual installer command.
- Plan-then-approve flow is enforced — no silent updates regardless of how the user phrases the request.
- Post-update report names the migrations the adopter should read; previously these were easy to miss.

## Safeguards

- **Never auto-update.** Step 5 of the procedure is a hard approval gate.
- **Never edit `local/*`** — the skill mirrors the installer's `local/` preservation guarantee.
- **Never auto-reindex on drift** — `local/index/manifest.yaml` SHA-256 drift after update is surfaced; adopter chooses `ginee-reindex` per the standard staleness flow.
- **Never downgrade silently** — target tag < current tag is refused unless the user explicitly names `--allow-downgrade`.
- **Never mask installer failure** — non-zero exit code surfaces with the last 20 lines of stderr; no retry loop.

## Backward compatibility

- The manual installer one-liner continues to work unchanged. The new skill is additive.
- Adopters on older framework versions can keep running `./install.{ps1,sh} --update-only` directly — the skill is a convenience surface, not a replacement.
- No changes to `install.ps1` / `install.sh` themselves; the skill is a thin orchestration layer on top.

## Rollback

- Delete `core/skills/ginee-update/` (the skill is self-contained).
- Revert the four touched non-skill files (`team-lead.md`, `process.md`, the CI workflow, and adopter docs).
- The manual installer continues to function untouched.

## Issue reference

Implemented per direct user instruction during the 0.7.0 release cycle ("add new feature — make ginee to be capable to update itself"). No upstream issue — this migration is the record.
