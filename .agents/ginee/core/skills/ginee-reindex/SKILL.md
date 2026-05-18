---
name: ginee-reindex
description: Re-extract a single source file (architecture doc, ADR set, scenario set, mockup, novel-class corpus) into local/index/* per the ginee D13 index protocol. Use when the user asks to 'reindex <file>', 'refresh the index for <file>', 're-extract <source>', or when SHA-256 drift is detected pre-dispatch on a specific doc.
---

# Re-extract source — D13 index

Run the targeted re-extraction workflow per `.agents/ginee/core/index-protocol.md § Re-extraction`. Dispatches `ai-engineer` against a single source; rebuilds the affected index files; updates `manifest.yaml` SHA-256.

## Activation

- User asks "reindex <file>" / "refresh the index for <file>" / "re-extract <source>".
- `team-lead` detected SHA-256 drift pre-dispatch and the user picked targeted re-extraction.

## Procedure

1. Load `.agents/ginee/core/index-protocol.md` and `.agents/ginee/core/roles/ai-engineer.details.md § Project-doc extraction recipes`.
2. Identify the source from the user's argument:
   - Match against `local/index/manifest.yaml § indexed[]` entries.
   - If ambiguous (multiple classes touch this file) → ask which class to re-extract.
   - If the file isn't in the manifest → suggest `ginee-rediscover` instead (this skill only refreshes existing entries).
3. Look up the recipe id (`builtin:architecture` / `builtin:adr` / `builtin:cr` / `builtin:scenario` / `builtin:mockup` / `inline:<class>`) from the manifest entry.
4. Dispatch `ai-engineer` with: source path(s), recipe id, expected index files (from the manifest entry's `index-files:` list).
5. `ai-engineer`:
   - Reads the source.
   - Re-extracts per the recipe → overwrites affected `local/index/*` files.
   - Recomputes SHA-256.
   - Updates manifest entry (`sha256`, `indexed-on`).
   - Runs sample-and-check (5 random items per affected index file).
6. Surface the diff and manifest update to the user.

## Forbidden

- Never re-extract sources not already in the manifest — use `ginee-rediscover` to enumerate new sources.
- Never skip the sample-and-check lossless verification.
- Never silently accept extraction that loses items present in the source (lossless rule).
