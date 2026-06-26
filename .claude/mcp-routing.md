# MCP routing — code & docs intelligence

Routing detail for the purpose-routed MCP servers. The always-loaded rule (prefer MCP over
`Read`/`Grep`; **load deferred tools before use**) lives in `CLAUDE.md` § *Code & docs intelligence (MCP)*;
this file holds the per-purpose routing table, per-server notes, and fallbacks.

## Code intelligence (purpose-routed)

**Route by purpose — pick the server built for the job; never one server for everything.** They
return targeted symbols plus structural context (callers, dependents, tests), not whole files —
cutting tokens across agent turns.

| Purpose | Primary server | Tools |
|---|---|---|
| **Research / explore / understand** code | **serena** | `get_symbols_overview` (file structure), `find_symbol` (locate + read a symbol), `find_referencing_symbols` (call sites) |
| **Impact / blast radius** before touching a shared symbol | **code-review-graph** (+ serena) | graph `get_impact_radius` / `get_affected_flows`; cross-check refs with serena `find_referencing_symbols` / `find_implementations` |
| **Symbol-level editing** | **serena** | `replace_symbol_body` / `insert_after_symbol` / `insert_before_symbol` / `rename_symbol` — LSP-accurate (C# / TS / PowerShell) |
| **Code review** (change-scoped) | **code-review-graph** (+ serena) | graph: `detect_changes` (risk-scored) / `get_review_context` / `get_impact_radius` / `get_affected_flows`; serena to read exact symbol bodies |
| **Architecture / structure overview** | **code-review-graph** | graph `get_architecture_overview` / `list_communities` |
| **Docs (`.md`)** | **markdown** | see *Docs intelligence* below |
| **External library / framework docs** (third-party, not this repo) | **context7** | `resolve-library-id` (name → Context7 ID) → `get-library-docs` |

**Per-server notes.**
- **serena** (`mcp__serena__*`). LSP retrieval + editing. `get_symbols_overview` → `find_symbol` (`depth=1` for members, `include_body` only when source needed). Owns surgical edits.
- **code-review-graph** (`mcp__code-review-graph__*`). Persistent change-review graph; auto-updates via hooks but **rebuild after a branch switch** (it warns when stale).
- **context7** (`mcp__context7__*`). External (internet) docs for third-party libraries/frameworks — NOT a local-repo server. `resolve-library-id` first (free-text name → Context7-ID), then `get-library-docs` (optionally scoped by `topic`). Use over memory-recalled APIs; never for this repo's own code. Free tier is rate-limited.

- **Fall back to `Read` / `Grep`** for declarative/non-code files (YAML, JSON, Dockerfiles, configs), exact line-range reads, or content the LSPs don't index well. For **Markdown** use the markdown MCP, not `Read`.

## Docs intelligence (markdown-first)

The markdown MCP server (`mcp__markdown__*`, `ofershap/mcp-server-markdown`) exposes structural, embedding-free section retrieval over `.md` files via the heading tree. **Prefer it over `Read` wherever a doc section applies** — it returns one section, not the whole file. The docs analogue of *Code intelligence* above; paths resolve against the project root, so pass relative paths (`docs/index.md`).

- **Map, then extract.** `list_headings` (a file's heading tree / TOC) before reading, then `get_section` to pull only the target heading's content — pairs with the index-first navigation in *Sources of truth*.
- **Locate across docs.** `list_files` (enumerate `.md`) + `search_docs` (case-insensitive keyword scan, **not** semantic) to find the file, then `get_section` to extract.
- **Address by heading TEXT, not anchor slug.** `get_section(file, "Sources of truth")`, never `"sources-of-truth"` — `index.md` cross-links use `#slugs`, so convert slug → heading text before calling.
- **Fall back to `Read`** for whole-file reads, content not delimited by headings, exact line-range reads, or frontmatter-only needs (or use `get_frontmatter`).
