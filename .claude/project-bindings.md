## Project bindings

Per-role stack, file lanes, and gate commands live **one file per role** under `.claude/bindings/`.
**Each role reads ONLY its own file** into context — not the whole set.

| Role | Agent | Binding |
|---|---|---|
| contract | `api-architect` | [`.claude/bindings/contract.md`](.claude/bindings/contract.md) |
| backend | `backend-developer` | [`.claude/bindings/backend.md`](.claude/bindings/backend.md) |
| frontend | `frontend-developer` | [`.claude/bindings/frontend.md`](.claude/bindings/frontend.md) |
| infrastructure | `deployment-engineer` | [`.claude/bindings/infrastructure.md`](.claude/bindings/infrastructure.md) |
| testing | `testing-specialist` | [`.claude/bindings/testing.md`](.claude/bindings/testing.md) |
| docs *(plugin-provided / opt-in)* | `docs-keeper` | [`.claude/bindings/docs.md`](.claude/bindings/docs.md) |

**Tool-output-economy guardrail** (`.claude/team-process/guardrails.md`) — shared across all roles; apply to every command:

- Capture output; branch on the exit code.
- Surface only the aggregate (success) or the failing slice (failure) — never the full log.
