## Solution directory structure

The tree below is authoritative — *Present today* vs *Reserved* are split into the two tables.

**Present today:**

| Path | Role |
|---|---|
| `docs/` | All design + contract documentation (see *Sources of truth*). |
| `backend/[service]` | Backend services (`Dashboard.Api` + endpoint-group libs, `Dashboard.Fetcher` + host, shared, tests). |
| `frontend/[application]` | Angular SPA (`dashboard`) + `mock` server + `extension` (MV3 WebExtension). |
| `demo/` | `driver` (demo-orchestration service) + `github-emulator` (GitHub REST emulator for fetcher demo/CI) + `data` (scenario seeds). |
| `gateway/` | nginx App Gateway config. |
| `testing/[type]` | Testing solutions (`api`, `e2e`). |
| `compose/` | Local-dev Docker Compose stack. |
| `scripts/` | PowerShell tooling + hooks. |

**Reserved (planned, not present).** Slots referenced by `.dockerignore` and SAD §7 awaiting implementation:

| Path | Future role |
|---|---|
| `infrastructure/` | Terraform modules — Azure-only per NFR-01 / NFR-06. |
| `dev_env/` | Local-dev compose / fixtures. |
