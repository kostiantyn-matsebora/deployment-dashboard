# Deployment Dashboard

## Source of truth
[docs/SAD.md](docs/SAD.md) — Solution Architecture Document describing the project's architecture (goals, non-goals, FR/NFR, constraints, target architecture, components, domain model). Consult it before making architectural decisions or changes that touch component boundaries, contracts, or stated requirements.

## Context economy and documentation authoring rules

Following rules MUST be followed always for any kind of project documentation and LLM assets:

- **Concise + LLM-optimized.** Cut filler, marketing tone, "in this section we will explore" preambles. Every sentence earns its tokens.
- **Structure over prose — binding here, not aspirational.** Convert prose into the smallest readable structure that preserves every rule:
  - Steps → numbered list. Choices / mappings → table. "X means Y" → `**X.** Y` on its own line.
  - Multi-rule bullet ("do A; also B; warn C") → parent + sub-bullets, one rule per line.
  - Prose paragraph stating > 2 rules → restructure.
