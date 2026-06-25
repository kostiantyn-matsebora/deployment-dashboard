# Project bindings

Per-role **project layer** — stack, file lanes, gate commands. One file per role; a role reads
ONLY its own file. The generic role definitions live in [`../team-process/roles/`](../team-process/roles/);
these files are the project-specific bindings those roles inherit at runtime.

| Role | Agent | File |
|---|---|---|
| contract | `api-architect` | [`contract.md`](contract.md) |
| backend | `backend-developer` | [`backend.md`](backend.md) |
| frontend | `frontend-developer` | [`frontend.md`](frontend.md) |
| infrastructure | `deployment-engineer` | [`infrastructure.md`](infrastructure.md) |
| testing | `testing-specialist` | [`testing.md`](testing.md) |
| docs *(plugin-provided / opt-in)* | `docs-keeper` | [`docs.md`](docs.md) |

Routing index + the shared tool-output-economy guardrail: root prompt `CLAUDE.md` § *Project bindings*.
