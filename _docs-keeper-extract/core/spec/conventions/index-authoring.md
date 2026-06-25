# Authoring + index conventions (fallback)

Bundled **fallback** authoring rules — used ONLY when the host project exposes no
doc-authoring section (see role.md § *Host authoring rules*). When the host has its
own rules, those win; cite them by path + section.

## Authoring rules (fallback)

- **One source of truth** — others cite by path + section.
- **Structure beats prose:**
  - Steps → numbered list.
  - Mappings / choices → table.
  - `"X means Y"` → `**X.** Y` on its own line.
  - Multi-rule bullet → parent + sub-bullets, one rule per line.
- **Section atomicity** — each section reads standalone; cite prerequisites.
- **One term per concept.**
- **Front-load instructions** — most important first.
- **Imperative voice** — "Do X." / "Never Y."
- **Forbidden actions as one list** per role.
- **ASCII first.**
- **Cut filler** — every sentence earns its tokens.
- **Extract over compact** — move reusable parts to a referenced file (in-place
  reformatting plateaus ~−10%; extraction reaches −60%+).
- **Preserve normative content** — `MUST`/`SHOULD`/numbered constraints / anchoring
  examples survive compression.

## Index conventions (summary)

The canonical index rules live in role.md (§ *Index convention*, § *Children path
resolution*, § *README classification*, § *YAML front-matter quoting*). In brief:

- `index.md` (lowercase) per directory; `children:` YAML array is the index.
- Leading `/` in a child path is **sibling-relative** to the index's own directory.
- Markdown children drop the extension; non-Markdown keep it; sub-dirs with their own
  `index.md` are boundaries (no descent).
- The host "sources of truth" registry lists only ROOT indexes + uncovered unique docs.
