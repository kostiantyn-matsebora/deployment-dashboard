# docs-index — procedure

Build or refresh the `index.md` index for a target directory, performing a recursive
descent (stopped at sub-index boundaries) to populate `children:`, then walk UP the
directory tree to refresh every ancestor index in the same dispatch. Mode A.

> Platform-neutral procedure. The Claude Code adapter exposes it as `/docs-keeper:docs-index <directory-path>`.

## Pre-flight (binding)

Inherited from [`../role.md`](../role.md):

1. **Non-overwrite policy** § — every `Write` / `Edit` goes through the gate table
   (applies per-file across the walk-up, not just to the target).
2. **Host authoring rules** § — load host rules first; honor them over any default.
3. **YAML front-matter quoting** § — single-quote `intro` always; quote `title` /
   `shortTitle` when they contain anchor chars.
4. **README classification** § — content-bearing vs legacy-navigation; default to
   content-bearing when ambiguous.

If either gate halts you on the TARGET, return a proposed diff and wait. For ancestors
discovered during walk-up, emit per-ancestor proposed diffs and continue walking — do
NOT halt the dispatch.

## Workflow shape (user-facing)

`docs-index <dir>` creates / refreshes `<dir>/index.md` — and ONLY that file (plus
ancestor walk-up). It enumerates the entire descendant subtree under `<dir>` in one go,
stopping its descent only when it hits a sub-directory that already has its OWN
`index.md` (a boundary).

- **Initial use** — owner runs `docs-index docs/` once. The result is a single `index.md`
  containing every doc reachable under `docs/`. Suitable for small/medium trees.
- **Growth-by-splitting** — when the top index gets too big, run `docs-index docs/<sub>/`
  to introduce a sub-index. Re-running `docs-index docs/` (or the automatic walk-up) now
  stops at `/<sub>` instead of enumerating its contents → parent index shrinks.

Boundaries compose: a deeply-nested `index.md` is a boundary for every ancestor above it.

## Format conventions

- **Index filename.** `index.md` (lowercase). Renders at the directory URL on GitHub
  Pages / GitHub's Markdown viewer.
- **Hierarchy in front-matter.** Each `index.md` declares the entries it surfaces via a
  `children:` array. Parent → child only; no `parent:` backref.
- **Children path convention (sibling-relative, supports nesting).** Leading `/` is
  sibling-relative to the index file's own directory (NOT the repo root). Entries may be
  nested (`/sub/name`) when the descent crossed a sub-dir that lacked its own `index.md`.

   | Child kind discovered during descent | Children entry | Resolves to |
   |---|---|---|
   | Direct Markdown file | `/<name>` | `<parent-dir>/<name>.md` |
   | Direct non-Markdown file | `/<name>.<ext>` | `<parent-dir>/<name>.<ext>` |
   | Sub-directory with its own `index.md` (BOUNDARY — stop descent) | `/<name>` | `<parent-dir>/<name>/index.md` |
   | Markdown file inside a sub-dir WITHOUT `index.md` (descended into) | `/<sub>/<name>` | `<parent-dir>/<sub>/<name>.md` |
   | Non-Markdown inside a sub-dir WITHOUT `index.md` | `/<sub>/<name>.<ext>` | `<parent-dir>/<sub>/<name>.<ext>` |
   | Deeper nesting (all without indexes) | `/<a>/<b>/.../<name>[.<ext>]` | `<parent-dir>/<a>/<b>/.../<name>[.<ext>]` |

   Resolution rule for any `/.../<name>` (no extension): try `<...>/<name>.md` first; if
   not found, try `<...>/<name>/index.md`. Ambiguity (both exist) → flag as open question.

- **Front-matter keys.** `title` (required), `intro` (required; ≤ 25 words;
  single-quoted), `shortTitle` (optional), `children` (required if descent yields
  entries). Owner-set keys preserved verbatim.
- **Body.** Optional narrative (≤ 3 sentences, dropped if redundant with `intro`) +
  `## Contents` H2 TOC for every Markdown file the descent surfaced (direct + nested up
  to the sub-index boundary). No `## Files` / `## Child indexes` tables.

## Discovery algorithm

```
function visit(current, prefix, entries):
    for child in direct_entries(current):
        skip if hidden (starts with '.' or '_')          # Jekyll convention
        if child is a file:
            if name == "index.md": skip
            if name == "README.md":
                classify per role.md § "README classification"
                legacy-navigation: skip (surface separately)
                content-bearing: add "/<prefix><base>" (no ext)
            else if Markdown: add "/<prefix><base>" (no ext)
            else: add "/<prefix><name>.<ext>"
        elif child is a directory:
            if (child/index.md exists):
                add "/<prefix><dir-name>"; do NOT recurse   # BOUNDARY
            else:
                visit(child, prefix + dir-name + "/", entries)
    sort(entries)   # natural / lexicographic
```

Sub-indexes act as opaque boundaries — their contents are NOT enumerated by the parent.
Idempotent: running on an unchanged tree produces the same list byte-for-byte.

## Steps

1. **Check existence.** Glob the target. If `index.md` exists, read + classify: a
   stub/auto-generated index (front-matter + `## Contents` only) → proceed with `Edit`;
   a hand-authored index (narrative, owner front-matter, custom sections) → produce a
   proposed `index.md` + diff and return for confirmation; do NOT write.
2. **Discover content.** Run the descent. For every Markdown file surfaced, capture
   `^## ` second-layer headings. Do NOT descend into `###` unless host rules require.
3. **Verify references.** Cross-check the discovered file list against sibling docs so
   you don't index files about to move.
4. **Compose** the `index.md` (front-matter + optional narrative + `## Contents` TOC),
   adapting to host conventions. Body `## Contents` links use `./<relative-path>.md#<slug>`.
5. **Drop empty sections / keys.** No entries → omit `children:`; no Markdown surfaced →
   omit `## Contents`; no narrative → front-matter-only is valid.
6. **Single-markdown collapse.** Exactly one Markdown file surfaced → collapse to one
   `## Contents — \`<path>.md\`` section.
7. **Anchor slugs.** Default to GFM / kramdown ([`../templates/_anchor-slugs.md`](../templates/_anchor-slugs.md)).
   For non-default renderers, surface as an open question — do NOT silently re-slug.
8. **Respect host metadata.** Merge with existing front-matter — never clobber owner-set
   keys (`Version`/`Status`/`Owner`/`Last reviewed`/`redirect_from`/`versions`/…).
9. **Sibling README classification.** For every `README.md` encountered, apply role.md §
   "README classification": content-bearing → include in `children:`; legacy-navigation →
   exclude + surface as a deprecation candidate. Never delete.
10. **Walk-up hierarchy refresh (binding).** After steps 1-9 on the target, walk UP:

    ```
    current = parent_dir(target)
    while current/index.md exists:
        apply steps 1-9 to `current`     # descent now stops at the target boundary
        current = parent_dir(current)
    ```

    | Walk-up effect on this ancestor | Action |
    |---|---|
    | gains a `/<descendant>` boundary entry | `Edit` — additive |
    | nested entries fold into a single boundary entry | `Edit` — surgical |
    | loses an entry (descendant index deleted/renamed) | `Edit` — surgical removal |
    | recomputed content byte-identical | NO write — idempotent no-op |
    | hand-authored AND recomputed differs | propose-only — emit diff, **continue walking** |

    Stops at the indexed-tree root (first ancestor without `index.md`). Linear, not
    recursive; each ancestor visited at most once.
11. **Chain to `docs-registry-sync` (single, after walk-up completes).** Invoke ONCE at
    the end — not per ancestor.

## Report (binding)

Structured-only. Use the **Documentation Report** ([`../templates/_output-template.md`](../templates/_output-template.md)),
Mode = A. Include a `Walk-up trace` block (per-ancestor action) and a `Descent summary`
block (deepest path, files surfaced, boundaries encountered). Surface legacy-navigation
`README.md` siblings as deprecation candidates; surface content-bearing `README.md`
additions as additive walk-up events.
