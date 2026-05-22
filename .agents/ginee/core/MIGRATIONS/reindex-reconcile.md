# Migration — `reindex` reconciles index with current repo state (issue #49)

**Target release:** next minor after 2026-05-21.
**Affected adopters:** every adopter that uses `@ai-engineer reindex …` / `ginee-reindex`.

## What changed

`@team-lead reindex [scope]` (and the `ginee-reindex` skill) is now a **reconciliation** operation — it makes `local/index/` match the current repo state at the chosen scope. Previously it only refreshed one existing manifest entry; net-new files within an existing class's `source-glob` were silently missed, with adopters routed to `ginee-rediscover` even though discovery wasn't what they needed.

The contract is now three sweeps, ordered:

1. **SHA drift** — every in-scope manifest entry; re-extract on change.
2. **New files** — every in-scope class; files matching the class `source-glob` not yet in the manifest get added + extracted.
3. **Stale entries** — manifest entries whose source no longer exists are flagged with a `remove?` prompt. Never auto-deleted.

Scopes: `reindex` (no arg) = whole repo; `reindex <file>` = the file's class; `reindex <class>` = one class.

Modified files:

- `core/index-protocol.md` — `§ Re-extraction` renamed `§ Reconciliation`; body rewritten as the three-sweep algorithm + scope table. `§ Pre-dispatch staleness check` updated to offer scoped vs whole-repo reconciliation as separate options.
- `core/skills/ginee-reindex/SKILL.md` — full rewrite as a thin spec wrapper. Drops both previous forbiddens (new-source refusal + redirect-to-rediscover).
- `core/roles/team-lead.md` — kernel staleness offer + `Index dispatch` section renamed and broadened.
- `core/roles/team-lead.details.md` — `§ Pre-dispatch staleness check (index)` offer table updated to three options.
- `docs/CHEATSHEET.md`, `docs/ARCHITECTURE.md`, `adapters/{claude,copilot-cli,agents-md,generic}/install.md` — adopter-facing phrasing aligned (`Reindex <source>` → `Reindex [scope]`; lifecycle box `RE-EXTRACTION` → `RECONCILIATION`).

## Why

The skill name implies "make the index correct"; the previous contract was "refresh one entry." Adopters routinely add docs / configs / ADRs between `rediscover` runs, and the pre-dispatch staleness check only spotted SHA drift on existing entries — silent miss on net-new files in role-owned domains. The split between `reindex` and `rediscover` should be meaningful, not a footgun: `reindex` reconciles the index; `rediscover` re-runs full discovery (profile + bindings + index + role-catalog scan).

## Action required

After re-fetching framework files on upgrade:

1. **No mandatory adopter file changes.** Manifest schema is unchanged; `local/index/manifest.yaml` continues to parse with the same machinery.
2. **Behaviour shift, not breaking.** Adopters who previously bounced off "this skill only refreshes existing entries — use `ginee-rediscover`" now get the result they expected: `@ai-engineer reindex path/to/new-file.md` adds the entry and extracts it (if the file matches an existing class's `source-glob`).
3. **(Optional)** If your project has a TODO line like *"after adding a new ADR, run `rediscover`"*, you can downgrade it to `reindex` — `rediscover` remains correct but is the heavier operation; reserve it for genuine class-membership changes (new doc directory, new tooling type).

## Behavioural change to expect

- `reindex <file-not-in-manifest>` now succeeds (was: refused with a redirect-to-rediscover). If the file matches no existing class glob → that is a novel class; the skill surfaces this and routes to `rediscover`.
- `reindex` with no arg now performs a whole-repo reconciliation across every class — relatively cheap (SHA recompute + glob enumeration), useful as a periodic "catch up" before deep work.
- Stale-entry sweep is new — if a previously indexed file has been deleted, the user gets a `remove?` prompt instead of silent staleness.

## Safeguards

- **Never auto-delete.** Stale-entry sweep always prompts.
- **Sample-and-check unchanged.** Every Sweep-1 / Sweep-2 hit still runs existence + compression-floor verification per `core/index-protocol.md § Lossless rule for index`.
- **Dormant-index audit unchanged.** `ai-engineer` still emits the audit after extraction.
- **Novel-class detection remains a `rediscover` responsibility** — `reindex` reconciles within existing classes only. Sources matching no class glob need full discovery (profile + bindings + index + consumer-coupling input).

## Backward compatibility

- Manifest schema unchanged — no `local/index/manifest.yaml` rewrite required.
- Existing skill invocations: `reindex <file-already-in-manifest>` continues to behave the same (Sweep 1 fires; Sweep 2 + 3 are no-ops within a single-file scope).
- `reindex <file-not-in-manifest>` previously refused; now succeeds if the file matches an existing class glob. No silent failures introduced.
- `@team-lead rediscover` semantics unchanged — still owns full re-discovery.

## Rollback

- Pin framework to the pre-fix release in `core/VERSION`.
- No `local/` files need to be reverted — manifest schema is unchanged across the migration.

## Issue reference

Implemented per [issue #49](https://github.com/kostiantyn-matsebora/ginee/issues/49) — *Make ginee-reindex reconcile index with current repo state.*
