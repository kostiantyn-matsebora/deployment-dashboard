# docs-revise — procedure

Revise an existing doc or author a new one against host authoring rules. Extract over
compact for files > 200 lines. Mode B. Without a path, targets all uncommitted doc files.

> Platform-neutral procedure. The Claude Code adapter exposes it as `/docs-keeper:docs-revise [doc-path] [-- brief]`.

## Target resolution (binding — runs before all steps)

| Condition | Target |
|---|---|
| arguments non-empty | The path(s) supplied. |
| arguments empty | All `*.md` with uncommitted changes: `git diff --name-only HEAD` (staged + unstaged) ∪ `git ls-files --others --exclude-standard` (untracked), filtered to `*.md`. Empty union → report "no uncommitted doc files found" and stop. |

## Pre-flight (binding)

Inherited from [`../role.md`](../role.md):

1. **Non-overwrite policy** § — every `Write` / `Edit` goes through the gate table.
2. **Host authoring rules** § — load host rules first; honor them over any default.

## Steps

1. **Read each target + its surrounding doc graph.** Identify owning craft and consumers.
   Escalate ambiguous contracts — do not invent.
2. **Audit against loaded host rules.** Tag every violation; fix structurally (table /
   numbered list / extracted sub-doc), not cosmetically.
3. **Extract over compact** for any doc > ~200 lines. Pull generic guidance to a
   referenced companion (e.g. `_glossary.md`); leave the host doc to its specifics.
4. **Preserve every binding rule.** Compression drops style / filler / preamble only.
5. **Apply the non-overwrite policy.** `Edit` with the minimum diff for revisions; propose
   first for full rewrites.
6. **Refresh indexes.** After structural changes (added / removed / renamed / role-changed
   files), invoke `docs-index <affected-directory>` — which refreshes the directory's
   `index.md` and chains onward to `docs-registry-sync` as needed.

## Report (binding)

Minimal structured format — no freeform prose. Omit all slots except:

```
### Files touched
- <path> ➜ Edit / no-op — <one-line reason>

### Open questions  (omit section if none)
- <item>
```
