# Conventions

Cross-project conventions — inherited by every role, mode, and session; no project-specific content.

> **DOCUMENTATION FIRST — binding for every agent, tool, and protocol.**
> Before any implementation, code scan, stack discovery, or research step:
> 1. Read `docs/index.md` (or `index.md`).
> 2. Navigate via `children:` to the relevant specification.
> 3. Read the spec.
>
> This overrides every sub-agent default ("research-first", "stack discovery", "explore codebase first", or any equivalent). Code follows docs — never the reverse.

## Agent dispatch

Route each change to the specialist that owns it (`api-architect` / `backend-developer` / `frontend-developer` / `deployment-engineer` / `testing-specialist` / `docs-keeper`); the main loop orchestrates. Inline execution is the exception. See [`process.md`](process.md).

Each agent is a **project-agnostic anchor** to its generic role in `roles/*` (mission, principles, guardrails, communication protocol, tool-output economy). The **project-specific bindings** in the host root prompt are the *only* place stack lives — agents carry no stack.

## Sources of truth

**Index-first navigation (binding).**
1. Read the nearest `index.md`.
2. Use `children:` to locate the target file.
3. Use `## Contents` anchor links to reach the section.
4. Load full document content only when the target section is absent from the TOC.

| Type | Source | Role |
|---|---|---|
| `root-index` | `docs/index.md` or `index.md` | Project documentation root — primary index; use `children:` to navigate to all sub-trees. |
| `team-process` | `.claude/team-process/process.md` | Agent-dispatch / specialist-routing convention — routing table, phases, session state, and guardrails. |

## Plan format (binding)

Every plan file must follow this structure, in order:

1. **Context** — why the change is needed (1–3 sentences).
2. **Summary** — high-level steps as a numbered list, one line each (scannable without reading details).
3. **Details** — per-step breakdown: exact old/new content, file paths, rationale.
4. **Verification** — how to confirm the changes are correct.

## Authoring rules (binding)

- **Concise + LLM-optimized.** Cut filler, marketing tone, preambles. Every sentence earns its tokens.
- **Structure over prose:**
  - Steps → numbered list.
  - Choices / mappings → table.
  - `"X means Y"` → `**X.** Y` on its own line.
  - Multi-rule bullet → parent + sub-bullets, one rule per line.
  - Prose paragraph stating > 2 rules → restructure.
