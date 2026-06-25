# Docs — project binding (plugin-provided / opt-in)

> Project authoring rules, file lanes, and tooling for the **docs** role — staffed by the
> external **docs-keeper** plugin (opt-in). Role slot: [`../team-process/roles/docs.md`](../team-process/roles/docs.md).
> When the plugin is absent the docs role is unstaffed and this binding is inert.

- **Authoring rules:** `CLAUDE.md`'s *Context economy and documentation authoring rules* +
  *Sources of truth* index convention are the binding host rules. The plugin's docs role
  host-discovers these from `CLAUDE.md`; they win over the plugin's bundled fallback.
- **Lanes:** `docs/**/*.md`, per-directory `index.md`, and the *Sources of truth* registry
  (Edit-only, smallest region).
- **Tooling:** markdown MCP for section retrieval; the commit-time drift gate +
  `/docs-keeper:*` commands are provided by the installed plugin. CI drift is checked by
  the plugin's neutral core CLI (`core/engine/cli.py --drift-only`) from a pinned checkout
  — see `.github/workflows/docs.yml`.
