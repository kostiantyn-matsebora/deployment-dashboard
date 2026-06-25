# Acme Stack

Fictional full-stack sample app — a parcel-tracking dashboard — used as a **pair-repo
fixture** for exercising docs-keeper against a realistic multi-layer tree (frontend,
backend, infrastructure, testing, documentation).

## Layout

| Path | Role |
|---|---|
| `frontend/` | Web SPA. |
| `backend/` | API service. |
| `infrastructure/` | IaC (Terraform). |
| `testing/` | End-to-end tests. |
| `docs/` | Documentation hub (index-first). |

## Documentation authoring rules

- Concise + structure-over-prose: steps as numbered lists, mappings as tables.
- Every directory under `docs/` has an `index.md` whose `children:` match the files on disk.

## Sources of truth

- [docs/](docs/index.md) — Acme Stack documentation hub: architecture, API reference, and operations guides.
