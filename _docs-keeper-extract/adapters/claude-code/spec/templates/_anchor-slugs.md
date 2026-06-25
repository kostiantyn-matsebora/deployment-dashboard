# Anchor slugs — quick reference (GFM / kramdown default)

Used by `/docs-index` when composing `## Contents` TOC links. GitHub's Markdown renderer
(and kramdown via `auto_ids`) emits IDs that match GFM in the common cases. Each row
demonstrates a different edge case.

| Heading | Slug | Edge case demonstrated |
|---|---|---|
| `## Naming` | `#naming` | Trivial — lowercase only. |
| `## Error envelope (RFC 9457)` | `#error-envelope-rfc-9457` | Parentheses stripped; space → `-`. |
| `## Foo & Bar` | `#foo--bar` | `&` collapses to empty → adjacent dashes → `--`. |
| `## Source → Target` | `#source--target` | `→` collapses to empty → `--`. |
| `## 6 Phases` | `#6-phases` | Leading digit preserved. |
| `## package.json Summary` | `#packagejson-summary` | Dot in filename stripped, no separator inserted. |
| `## 11. Examples — copy-paste` | `#11-examples--copy-paste` | Numeric prefix + em-dash + period combo. |

For non-GFM/non-kramdown renderers (Docusaurus, MkDocs, Hugo, GitBook, AsciiDoc), flag
the pipeline and let the owner specify the slug algorithm.
