## Code & docs intelligence (MCP)

Purpose-routed MCP servers return targeted symbols/sections (callers, dependents, tests, doc
headings), not whole files — **prefer them over `Read` / `Grep`** for code and `.md`. Servers:
**tokensave** (code research/impact) · **serena** (symbol-level editing) · **code-review-graph**
(change review) · **markdown** (`.md` section retrieval).

**External library docs → context7** (not the local-repo servers above). For up-to-date docs/APIs of a
**third-party** framework or library (Angular, EF Core, PrimeNG, nginx, …): `resolve-library-id` →
`get-library-docs`. Use it instead of recalling APIs from memory; **never** for this repo's own code (use
tokensave/serena).

**Load before use (mandatory).** All expose *deferred* tools — uncallable until fetched via
`ToolSearch` (e.g. `select:mcp__tokensave__tokensave_context,mcp__markdown__get_section`). Skip
this and agents silently fall back to `Grep` / `Read`.

**Routing table, per-server notes, and `Read`/`Grep` fallbacks:** [`.claude/mcp-routing.md`](.claude/mcp-routing.md).
