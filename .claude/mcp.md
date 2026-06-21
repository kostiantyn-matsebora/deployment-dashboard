## Code & docs intelligence (MCP)

**Goal: retrieve targeted symbols/sections — callers, dependents, tests, doc headings — instead of
reading whole files.** Code-intelligence MCP servers do this far more cheaply than scanning full files:
**serena** (symbol-level retrieval + editing) · **code-review-graph** (change review) · **markdown**
(`.md` section retrieval). Reach for these first for code and `.md`; whole-file reads / text search are
the fallback for declarative files (json/yaml/csproj) or exact line ranges.

**External library docs → context7.** For up-to-date docs/APIs of a **third-party** framework or library
(Angular, EF Core, PrimeNG, nginx, …): `resolve-library-id` → `get-library-docs`, rather than recalling
APIs from memory. Never for this repo's own code (use serena / code-review-graph).

**Load before use (mandatory).** These expose *deferred* tools — uncallable until loaded via `ToolSearch`
(e.g. `select:mcp__serena__find_symbol,mcp__markdown__get_section`). Load the relevant server first;
skip this and the model silently falls back to coarse full-file search.

**Routing table + per-server notes:** [`.claude/mcp-routing.md`](.claude/mcp-routing.md).
