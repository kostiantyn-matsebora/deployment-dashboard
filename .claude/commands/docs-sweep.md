---
description: Cross-doc consistency sweep — verify every sources-of-truth entry, walk every index.md children list (supports nested paths from recursive descent), flag orphans + broken links + legacy-navigation READMEs, hand off drift to /docs-registry-sync. Content-bearing READMEs are regular files, not legacy. Mode C of document-writer.
argument-hint: [optional-scope-path]
---

# /docs-sweep

Cross-doc consistency sweep over `$ARGUMENTS` (defaults to repo root).

## Pre-flight (binding)

Read-only by default. The **non-overwrite policy** from `.claude/agents/document-writer.md` still applies to any follow-up action you queue.

## README.md classification (binding)

For every `README.md` encountered, classify BEFORE deciding what to flag:

| Classification | Signals | Status |
|---|---|---|
| **Content-bearing README** | Substantive narrative paragraphs, owner-set metadata (Version / Status / Owner / Last reviewed), technology / spec / purpose sections, anything beyond a flat Files / Contents table | Regular content file. Should appear in its parent `index.md`'s `children:` as `/README` (or `/<sub>/README` when nested under a no-index sub-dir). Not legacy. Not a deletion candidate. |
| **Legacy navigation README** | Only `## Files` table + `## Contents` TOC; no narrative; no owner-set metadata; no custom sections | Deprecation candidate (only if sibling `index.md` exists). Owner-deletion territory. |

**Default to content-bearing** when ambiguous.

## Steps

1. For each path registered in the host's "sources of truth" registry, verify referenced file(s) exist and the description still matches.
2. Walk every `index.md` in the doc roots. For each, parse front-matter `children:` and resolve every entry (leading `/` is sibling-relative to the parent index's own directory; paths may be NESTED like `/sub/file`):
   - `/<a>/<b>/.../<name>.<ext>` → file `<parent-dir>/<a>/<b>/.../<name>.<ext>` must exist.
   - `/<a>/<b>/.../<name>` (no ext) → try `<parent-dir>/<a>/<b>/.../<name>.md` first, then `<parent-dir>/<a>/<b>/.../<name>/index.md`. Exactly one must exist; flag both-exist as ambiguous, neither-exists as broken.
3. Flag any **orphan**: a doc-shaped file (`.md`, `.yaml`, `.html`, `.json` under doc roots) NOT reachable from any index's `children:` chain (where each index's `children:` covers everything under it up to sub-index boundaries) AND NOT in the registry as a unique-doc entry.
4. Flag any **un-listed content-bearing README.md**: a `README.md` classified as content-bearing (per the classification table above) that is NOT in its nearest enclosing `index.md`'s `children:` (as `/README` for a sibling, or `/<sub>/README` for a deeper README inside a no-index sub-dir). Owner adds the entry — or `/docs-index <enclosing-dir>` will pick it up on next refresh.
5. Flag any **broken cross-link**: a registry entry or `children:` path that resolves to a non-existent file or directory.
6. Flag any **ambiguous children resolution**: a `/<...>/<name>` entry that matches BOTH `<name>.md` AND `<name>/index.md` — owner must disambiguate by adding `.md` extension to the entry.
7. Flag any **legacy navigation README.md** ONLY (per the classification table): a `README.md` with only Files+TOC tables and no narrative/metadata, with a sibling `index.md`. Content-bearing READMEs are NEVER flagged here.
8. Flag any **demoted ROOT**: a registry entry for an `index.md` that is now in some other index's `children:` (no longer a ROOT — registry footprint is too large).
9. **Read-only.** Do NOT auto-rewrite cross-craft content. Report → wait for owner.
10. **Hand off.**
    - Registry drift (ADDs / UPDATEs / REMOVEs from steps 1, 8) → propose `/docs-registry-sync`.
    - Index drift (missing `index.md` in directories that should have one; broken/ambiguous `children:` entries from steps 2, 6; un-listed content READMEs from step 4) → propose `/docs-index <directory>` per affected directory.
    - Never silently edit.

## Report

Use the **Documentation Report** template from `.claude/agents/document-writer.md` § "Output Template". Set Mode = C. Include a dedicated `Findings` block:

```markdown
### Findings
- Broken cross-links: <list>
- Ambiguous children resolutions: <list>
- Orphans (doc-shaped, unreachable from any index `children:`): <list>
- Un-listed content-bearing README.md (not in nearest enclosing `index.md` `children:`): <list>
- Legacy navigation README.md (Files+TOC only; sibling of index.md): <list>
- Orphan README.md (no sibling index.md): <list>
- Demoted ROOTs (registry entries no longer root): <list>
- Stale registry entries (path moved / role drifted): <list>
```
