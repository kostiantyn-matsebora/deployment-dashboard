# Docs — project binding

> Project authoring rules, file lanes, and tooling for the **docs** role (`docs-keeper`).
> Generic role: [`../team-process/roles/docs.md`](../team-process/roles/docs.md). Shared tool-output-economy guardrail: `CLAUDE.md` § *Project bindings*.

- **Authoring rules:** `CLAUDE.md`'s *Context economy and documentation authoring rules* + *Sources of truth* index convention are the binding host rules.
- **Lanes:** `docs/**/*.md`, per-directory `index.md`, and the *Sources of truth* registry (Edit-only, smallest region).
- **Tooling:** markdown MCP for section retrieval; maintenance hook `pwsh scripts/hooks/Invoke-DocsKeeperMaintenance.ps1 -DriftOnly` (mirrors `.github/workflows/docs.yml`).
