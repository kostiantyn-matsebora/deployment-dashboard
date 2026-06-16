# Contract — project binding

> Project stack, file lanes, and gate commands for the **contract** role (`api-architect`).
> Generic role: [`../team-process/roles/contract.md`](../team-process/roles/contract.md). Shared tool-output-economy guardrail: `CLAUDE.md` § *Project bindings*.

- **Source of truth:** `docs/api/openapi.yaml` (OpenAPI 3.1); guidelines `docs/api/api-guidelines.md`. Behavior-only changes — no backend tech in the contract.
- **Lanes:** `docs/api/openapi.yaml`, `docs/api/api-guidelines.md`.
- **Validate:** YAML well-formed + spec self-consistent (no spectral configured in CI); surface validation errors only. Hand off as an `ARTIFACT`.
