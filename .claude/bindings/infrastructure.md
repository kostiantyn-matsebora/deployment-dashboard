# Infrastructure — project binding

> Project stack, file lanes, and gate commands for the **infrastructure** role (`deployment-engineer`).
> Generic role: [`../team-process/roles/infrastructure.md`](../team-process/roles/infrastructure.md). Shared tool-output-economy guardrail: `CLAUDE.md` § *Project bindings*.

- **Stack:** Docker multi-stage (non-root, minimal), Compose (`compose/*.yaml`), nginx gateway (`gateway/`), GitHub Actions (`.github/workflows/*`). Azure-only (NFR-01/06); `infrastructure/` (Terraform) reserved. Trivy scans images (build → scan → push; SARIF → Security tab).
- **Lanes:** `.github/workflows/**`, `compose/**`, `gateway/**`, `**/Dockerfile`, `scripts/**`. App logic → owning app role.
- **Gates:**
  - Image — `docker build …` → surface error lines only
  - Stack — `docker compose -f compose/docker-compose.yaml up -d --build --wait`; diagnose via `docker compose logs --no-color <svc>` (slice, not all)
  - CI — check the run **status/conclusion** + pull only the failing job's log; don't stream
- **Scripts:** PowerShell 7+ with sibling Pester suites (§Scripts); `-AsLibrary` switch. No secrets/env-specific values in committed files.
