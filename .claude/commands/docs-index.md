---
description: Build or refresh a directory's index.md (github/docs-style — recursive-descent children list with sub-index boundaries, hierarchical, minimum-footprint at the root prompt). One invocation produces a full index for the target subtree; sub-indexes added later automatically shrink the parent's footprint. Walks UP the directory tree on completion. Body retains a ## Contents H2 TOC for the descent scope. Mode A of docs-keeper.
argument-hint: <directory-path>
model: sonnet
---

# /docs-index

Build or refresh the `index.md` index for `$ARGUMENTS`, performing a recursive descent (stopped at sub-index boundaries) to populate `children:`, then walk UP the directory tree to refresh every ancestor index in the same dispatch.

## Pre-flight (binding)

Inherited from `.claude/agents/docs-keeper.md`:

1. **Non-overwrite policy** § — every `Write` / `Edit` goes through the gate table (applies per-file across the walk-up, not just to the target).
2. **Hard rules — project authoring conventions** § — load host rules first; honor them over any default.
3. **YAML front-matter quoting** § — single-quote `intro` always; quote `title` / `shortTitle` when they contain anchor chars.
4. **README.md classification** § — content-bearing vs legacy-navigation; default to content-bearing when ambiguous.

If either gate halts you on the TARGET, return a proposed diff and wait. For ancestors discovered during walk-up, emit per-ancestor proposed diffs and continue walking — do NOT halt the dispatch.

## Workflow shape (user-facing)

`/docs-index <dir>` creates / refreshes `<dir>/index.md` — and ONLY that file (plus ancestor walk-up). It enumerates the entire descendant subtree under `<dir>` in one go, stopping its descent only when it hits a sub-directory that already has its OWN `index.md` (a boundary).

This means:

- **Initial use** — owner calls `/docs-index docs/` once. The result is a single `index.md` containing every doc reachable under `docs/`. Suitable for small/medium trees.
- **Growth-by-splitting** — when the top index gets too big, owner calls `/docs-index docs/<sub>/` to introduce a sub-index. Re-running `/docs-index docs/` (or the automatic walk-up from the next sub-tree dispatch) will now stop at `/<sub>` instead of enumerating its contents → parent index shrinks accordingly.

Boundaries compose: a deeply-nested `index.md` is a boundary for every ancestor above it.

## Format conventions

- **Index filename.** `index.md` (lowercase). Renders at the directory URL on GitHub Pages / GitHub's Markdown viewer.
- **Hierarchy in front-matter.** Inspired by github/docs convention. Each `index.md` declares the entries it surfaces via a `children:` array. Parent → child only; no `parent:` backref.
- **Children path convention (github/docs-style, supports nesting).** Leading `/` is sibling-relative to the index file's own directory (NOT the repo root). Entries may be nested (`/sub/name`) when the descent crossed a sub-dir that lacked its own `index.md`.

   | Child kind discovered during descent | Children entry format | Resolves to |
   |---|---|---|
   | Direct Markdown file | `/<name>` | `<parent-dir>/<name>.md` |
   | Direct non-Markdown file | `/<name>.<ext>` | `<parent-dir>/<name>.<ext>` |
   | Sub-directory with its own `index.md` (BOUNDARY — stop descent) | `/<name>` | `<parent-dir>/<name>/index.md` |
   | Markdown file inside a sub-dir WITHOUT `index.md` (descended into) | `/<sub>/<name>` (nested) | `<parent-dir>/<sub>/<name>.md` |
   | Non-Markdown file inside a sub-dir WITHOUT `index.md` | `/<sub>/<name>.<ext>` (nested) | `<parent-dir>/<sub>/<name>.<ext>` |
   | Deeper nesting (sub-dir-of-sub-dir, etc., all without indexes) | `/<a>/<b>/.../<name>[.<ext>]` | `<parent-dir>/<a>/<b>/.../<name>[.<ext>]` |

   Resolution rule for any `/.../<name>` (no extension): try `<...>/<name>.md` first; if not found, try `<...>/<name>/index.md`. Ambiguity (both exist) → flag as open question.

- **Front-matter keys.** Minimum useful set:
  - `title` — required.
  - `intro` — required; ≤ 25 words; single-quoted.
  - `shortTitle` — optional.
  - `children` — required if descent yields entries.
  - Owner-set keys: preserved verbatim.
- **YAML safety.** **Single-quote all prose string values** in front-matter — at minimum `intro`, and any `title` / `shortTitle` containing a colon, `#`, `&`, `*`, `!`, `|`, `>`, `%`, `@`, `?`, `,`, `[`, `]`, `{`, `}`, leading `-`, or template syntax. Matches the github/docs convention.
- **Body.** Optional narrative (≤ 3 sentences, dropped if redundant with `intro`) + `## Contents` H2 TOC for every Markdown file the descent surfaced (direct + nested up to the sub-index boundary). No `## Files` / `## Child indexes` tables — the `children:` list IS the file index.

## Discovery algorithm

```
function discover(start_dir):
    """
    Recursive descent under start_dir.
    Returns a sorted list of children entries (paths relative to start_dir, leading /).
    """
    entries = []
    visit(start_dir, root=start_dir, prefix="", entries)
    sort(entries)  # natural / lexicographic
    return entries

function visit(current, root, prefix, entries):
    for child in direct_entries(current):
        skip if hidden (starts with '.' or '_')          # Jekyll convention
        if child is a file:
            if name == "index.md":
                skip — this is the target file itself or a sub-dir's index
            if name == "README.md":
                classify per § "README.md classification"
                if legacy-navigation:
                    skip (deprecation candidate; surface separately)
                if content-bearing:
                    add "/<prefix><base>" (no ext) to entries
            else if Markdown:
                add "/<prefix><base>" (no ext) to entries
            else:
                add "/<prefix><base>.<ext>" to entries
        elif child is a directory:
            if (child/index.md exists):
                # BOUNDARY — sub-index handles its own subtree
                add "/<prefix><dir-name>" to entries
                do NOT recurse
            else:
                # Descend; nested entries get prefixed
                visit(child, root, prefix + dir-name + "/", entries)
```

The descent yields a flat sorted list. Sub-indexes act as opaque boundaries — their contents are NOT enumerated by the parent. Idempotent: running on an unchanged tree produces the same list byte-for-byte.

## Steps

1. **Check existence.** `Glob` `$ARGUMENTS`. If `index.md` exists, `Read` it and classify:

   | Classification | Signals | Action |
   |---|---|---|
   | Stub / auto-generated | Front-matter + `## Contents` TOC only; no hand-authored narrative | Proceed with `Edit`. |
   | Hand-authored | Narrative paragraphs, owner-set front-matter beyond the minimum set, status / deprecation notes, custom body sections | Produce proposed `index.md` + diff → return for confirmation; do NOT write. |

2. **Discover content.** Run the descent algorithm above starting at `$ARGUMENTS`.
   - For every Markdown file surfaced (direct + nested, before any boundary): `Grep '^## '` to capture second-layer headings.
   - Do NOT descend into `###` unless host rules require.

3. **Verify references.** Cross-check the discovered file list against sibling docs (root prompt, parent index, top-level architecture doc) so you don't index files about to move.

4. **Compose** the `index.md` using this skeleton, adapting to host conventions:

   ```markdown
   ---
   title: <Human Title>
   shortTitle: <Short Nav Label>          # OPTIONAL — drop if same as title
   intro: '<One-line role of the directory, ≤ 25 words.>'
   children:
     - /<entry-1>
     - /<entry-2>
     - /<sub-without-index>/<nested-entry>
     - /<sub-with-index>
   ---

   <Optional narrative — ≤ 3 sentences; OMIT if `intro` already conveys it.>

   ## Contents

   ### `<file-1>.md`           # for a directly-surfaced markdown

   - [<H2 title>](./<file-1>.md#<gfm-slug>)
   - …

   ### `<sub>/<file-2>.md`     # for a nested-surfaced markdown (sub had no index)

   - [<H2 title>](./<sub>/<file-2>.md#<gfm-slug>)
   - …
   ```

   **Note on body link form.** Body `## Contents` links use the conventional Markdown `./<relative-path>.md#<slug>` form (file-rooted with extension, including any nesting). Body links match the descent scope — sub-indexed subtrees do NOT appear in the body.

5. **Drop empty sections / keys.**
   - Descent yielded no entries at all → omit `children:` key.
   - Descent surfaced no Markdown files → omit `## Contents`.
   - No narrative needed → omit body entirely (front-matter-only is valid, matches github/docs example).

6. **Single-markdown collapse.** If the descent surfaced exactly one Markdown file (direct OR nested), collapse `## Contents` + `### <path>.md` into one `## Contents — \`<path>.md\`` section.

7. **Anchor slugs.** Default to GFM / kramdown (full table in `.claude/agents/_anchor-slugs.md`). For non-default renderers (Docusaurus, MkDocs, Hugo, GitBook, AsciiDoc), surface as an open question — do NOT silently re-slug.

8. **Respect host metadata.** Merge with existing front-matter — never clobber owner-set keys. Preserve `Version` / `Status` / `Owner` / `Last reviewed` / `redirect_from` / `versions` / similar verbatim. Structural keys (`title`, `intro`, `shortTitle`, `children`) may be added or refreshed.

9. **Sibling README.md classification.** For every `README.md` encountered during the descent (target dir or any descended sub-dir without `index.md`), apply the binding classification from `.claude/agents/docs-keeper.md` § "README.md classification":

   - **Content-bearing** → include in `children:` at the appropriate nesting (`/README` for the target dir, `/<sub>/README` for a nested location). NOT a deprecation candidate.
   - **Legacy-navigation** → exclude from `children:`. Surface as a deprecation candidate in the report. Do NOT delete.

10. **Walk-up hierarchy refresh (binding).** After completing steps 1-9 on `$ARGUMENTS`, walk UP the directory tree to refresh every ancestor `index.md` until you reach the top of the indexed tree. The caller does NOT need to invoke `/docs-index` on parents separately.

    **Algorithm (linear ascent — does NOT recursively re-trigger walk-up):**

    ```
    current = parent_dir($ARGUMENTS)
    while current/index.md exists:
        apply steps 1-9 to `current`
        # Each ancestor's descent honors the same sub-index boundary rule —
        # because the target's index.md now exists, the ancestor's descent
        # stops at `<target-dir-name>` instead of enumerating its contents.
        current = parent_dir(current)
    # Stop when current/index.md does not exist (top of indexed tree).
    ```

    **Trigger matrix.** Each ancestor visit is gated by what `current/index.md`'s `children:` array WOULD contain after recomputation:

    | Walk-up effect on this ancestor | Action |
    |---|---|
    | `children:` gains a `/<descendant>` boundary entry (because `$ARGUMENTS` newly has `index.md`) | `Edit` — additive change. |
    | `children:` shape collapses (nested entries fold into a single boundary entry now that the sub-index exists) | `Edit` — surgical (replace many entries with one). |
    | `children:` would lose an entry (a descendant index was deleted / renamed) | `Edit` — surgical removal. |
    | Recomputed content is byte-identical to current | NO write — idempotent no-op. |
    | Ancestor is hand-authored AND recomputed content differs | Propose-only — emit diff, **continue walking** (do NOT halt the dispatch). |

    **Termination guarantees:**
    - Stops at the indexed-tree root (first ancestor without `index.md`).
    - Idempotent — re-running on an already-consistent tree produces zero writes.
    - Linear, not recursive — each ancestor is visited at most once per dispatch.

    **Walk-up boundary surface.** If walk-up reaches a directory whose parent has no `index.md`, that's the indexed-tree root. If the OWNER expected a higher-level index (per the host's "Sources of truth" registry), surface as an open question — do not auto-create ancestor indexes the owner didn't ask for.

11. **Chain to `/docs-registry-sync` (single, after walk-up completes).** Invoke ONCE at the end of the walk-up — not per ancestor. The registry sync sees the final, fully-propagated state after every ancestor's `children:` has settled.

## Report

Use the **Documentation Report** template from `.claude/agents/_output-template.md`. Set Mode = A. Include a `Walk-up trace` block listing every ancestor visited and the per-ancestor action (Edit / Write / propose-only / idempotent-no-op). Include a `Descent summary` block stating (a) the deepest path the descent reached, (b) the count of files surfaced, (c) the count of boundaries encountered. Surface any **legacy-navigation** `README.md` siblings as deprecation candidates in the Open questions block; surface any **content-bearing** `README.md` newly added to a `children:` array as an additive walk-up event.
