# docs-sweep — procedure

Cross-doc consistency sweep — verify every sources-of-truth entry, walk every `index.md`
children list (supports nested paths from recursive descent), flag orphans + broken links
+ legacy-navigation READMEs, hand off drift to `docs-registry-sync`. Content-bearing
READMEs are regular files, not legacy. Mode C.

> Platform-neutral procedure. The Claude Code adapter exposes it as `/docs-keeper:docs-sweep [optional-scope-path]`.

## Pre-flight (binding)

Read-only by default. The **non-overwrite policy** from [`../role.md`](../role.md) still
applies to any follow-up action you queue.

## README.md classification (binding)

Apply the binding classification from [`../role.md`](../role.md) § "README classification"
before deciding what to flag. Default to content-bearing when ambiguous.

## Steps

1. For each path registered in the host's "sources of truth" registry, verify referenced
   file(s) exist and the description still matches.
2. Walk every `index.md` in the doc roots. Parse front-matter `children:` and resolve every
   entry (leading `/` is sibling-relative to the parent index's own directory; paths may be
   NESTED like `/sub/file`):
   - `/<a>/.../<name>.<ext>` → file `<parent-dir>/<a>/.../<name>.<ext>` must exist.
   - `/<a>/.../<name>` (no ext) → try `<parent-dir>/<a>/.../<name>.md` first, then
     `<parent-dir>/<a>/.../<name>/index.md`. Exactly one must exist; both → ambiguous;
     neither → broken.
3. Flag any **orphan**: a doc-shaped file (`.md`, `.yaml`, `.html`, `.json` under doc roots)
   NOT reachable from any index's `children:` chain AND NOT a registry unique-doc entry.
4. Flag any **un-listed content-bearing README.md**: classified content-bearing but NOT in
   its nearest enclosing `index.md`'s `children:` (`/README` for a sibling, `/<sub>/README`
   deeper). Owner adds it — or `docs-index <enclosing-dir>` picks it up.
5. Flag any **broken cross-link**: a registry entry or `children:` path resolving to a
   non-existent file or directory.
6. Flag any **ambiguous children resolution**: a `/<...>/<name>` matching BOTH `<name>.md`
   AND `<name>/index.md` — owner disambiguates by adding the `.md` extension.
7. Flag any **legacy navigation README.md** ONLY: only Files+TOC tables, no
   narrative/metadata, with a sibling `index.md`. Content-bearing READMEs are NEVER flagged.
8. Flag any **demoted ROOT**: a registry entry for an `index.md` now in some other index's
   `children:`.
9. **Read-only.** Do NOT auto-rewrite cross-craft content. Report → wait for owner.
10. **Hand off.**
    - Registry drift (steps 1, 8) → propose `docs-registry-sync`.
    - Index drift (missing `index.md`; broken/ambiguous `children:` from steps 2, 6;
      un-listed content READMEs from step 4) → propose `docs-index <directory>` per affected
      directory.
    - Never silently edit.

## Report (binding)

Structured-only. Use the **Documentation Report** ([`../templates/_output-template.md`](../templates/_output-template.md)),
Mode = C. Include a dedicated `Findings` block:

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
