# Deployment Dashboard

A real-time **services x environments** deployment matrix sourced from any CI/CD
tool that can post an HTTP event (GitHub Actions, Azure DevOps, Jenkins, GitLab
CI, ...). One glance answers *"what version of service X is running in
environment Y right now -- and did the last deployment succeed?"*

The system is read-only / notification-only: it tracks deployments, it does not
trigger them. Tool-agnostic by design -- the backend never talks to a CI/CD tool
directly; integrators POST to `/api/deployments` from a pipeline step. An
optional `Dashboard.Fetcher` worker can translate pull -> push for tools without
notify steps (e.g. GitHub Actions API polling).

See `docs/architecture.md` for the full Solution Architecture Document.

---

## Quick start (release install)

A clean machine with Docker installed can be running the dashboard in one
command -- no `git clone`, no source tree, no .NET SDK required. The installer
fetches release assets from GitHub, pulls the four pinned images from GHCR
(`ghcr.io/kostiantyn-matsebora/dashboard-{api,fetcher,frontend,gateway}`), brings
up the stack with `docker compose`, applies idempotent schema migrations via a
one-shot `postgres:16-alpine` container, polls `/health`, and prints the URL
panel + the generated `API_TOKEN`.

### Windows (PowerShell 7+)

```powershell
iex (irm https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/latest/download/install.ps1)
```

To pin to a specific tag:

```powershell
$env:DASHBOARD_VERSION = 'v1.2.3'
& ([scriptblock]::Create((irm https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/install.ps1))) -Version v1.2.3
```

### Linux / macOS

```bash
curl -fsSL https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/latest/download/install.sh | bash
```

To pin to a specific tag:

```bash
curl -fsSL https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/install.sh | bash -s -- --version v1.2.3
```

The dashboard is then on `http://localhost:8080/`. The installer prints the
generated `API_TOKEN` once -- it is also persisted to
`./dashboard-release/dashboard.env` for subsequent CI/CD POSTs.

### With the optional fetcher

The fetcher is a CR-0009 pull-mode worker that translates GitHub Actions runs
into `POST /api/deployments` events. Opt in with `-Fetcher` (PowerShell) /
`--fetcher` (bash). The `GHA_TOKEN` precondition (per
[issue #5](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/5))
must hold before any `docker compose` invocation runs:

```powershell
$env:GHA_TOKEN = '<your-github-pat>'
pwsh -NoProfile -File install.ps1 -Fetcher
```

```bash
export GHA_TOKEN='<your-github-pat>'
./install.sh --fetcher
```

To boot the fetcher without a real GitHub PAT (e.g. local smoke), pass
`-AllowMissingGhaToken` / `--allow-missing-gha-token`. The fetcher boots with
the placeholder token; GitHub API calls will 401.

### Pin a version

```powershell
pwsh -NoProfile -File install.ps1 -Version v1.2.3
```

```bash
./install.sh --version v1.2.3
```

Re-running the installer with a newer tag against the same `-InstallDir` /
`--install-dir` upgrades in place. The `migration.sql` script is idempotent
(per EF Core's `--idempotent` contract -- see
`docs/ci-cd-pipelines.md` § 7); re-applying against an already-migrated DB is a
no-op.

### Custom port

```powershell
pwsh -NoProfile -File install.ps1 -Port 9090
```

```bash
./install.sh --port 9090
```

### Uninstall

```powershell
pwsh -NoProfile -File uninstall.ps1                                # preserve data + secrets
pwsh -NoProfile -File uninstall.ps1 -RemoveData                   # drop pg-data volume (irreversible)
pwsh -NoProfile -File uninstall.ps1 -RemoveData -RemoveSecrets    # also delete dashboard.env
```

```bash
./uninstall.sh                                                    # preserve data + secrets
./uninstall.sh --remove-data                                      # drop pg-data volume (irreversible)
./uninstall.sh --remove-data --remove-secrets                     # also delete dashboard.env
```

### Minimal install options (escape hatches)

For environments that disallow piped-script execution (`irm | iex` /
`curl | bash`), two minimal paths exist. Both **regress** on issue #5's
`GHA_TOKEN` precondition and on the `API_TOKEN` generation; the user takes on
the secret-handling discipline manually.

#### Option B -- raw compose + manual `docker compose`

```bash
curl -fsSL -O https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/docker-compose.release.yml
curl -fsSL -O https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/migration.sql

# REQUIRED: set both secrets before invoking, or the install boots with a
# placeholder token (silent 401s) and an unmigrated DB (broken API).
export API_TOKEN="$(openssl rand -hex 32)"
export POSTGRES_PASSWORD="$(openssl rand -hex 16)"
export GHA_TOKEN='<pat-or-omit-if-no-fetcher>'
export DASHBOARD_VERSION='v1.2.3'
export DASHBOARD_PORT='8080'
export ConnectionStrings__DefaultConnection="Host=db;Database=dashboard;Username=dashboard;Password=$POSTGRES_PASSWORD"

docker compose -f docker-compose.release.yml --profile migrate up -d --wait
```

If your shell rejects `__` in identifier names (BusyBox `sh`, certain minimal
images), prefix the env-var to the command instead of `export`-ing it:

```bash
env ConnectionStrings__DefaultConnection="Host=db;Database=dashboard;Username=dashboard;Password=$POSTGRES_PASSWORD" \
  docker compose -f docker-compose.release.yml --profile migrate up -d --wait
```

#### Option D -- `docker compose -f <https-url>`

```bash
# Docker Compose v2.20+ can read HTTPS URLs directly. Same secret-handling
# regression as Option B applies.
docker compose -f https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/docker-compose.release.yml \
  --profile migrate up -d --wait
```

#### Regression warnings for Options B and D

1. **`GHA_TOKEN` precondition is BYPASSED.** When the `fetcher` profile is
   active, the fetcher boots with the placeholder token from
   `docker-compose.release.yml`; `401 Unauthorized` from GitHub API surfaces
   only in fetcher logs. Set `$GHA_TOKEN` manually before running.
2. **`API_TOKEN` is NOT generated.** You MUST set `$API_TOKEN` to a strong
   random value before running, and you MUST NOT reuse the dev literal
   `local-dev-token-not-for-production` -- the API middleware accepts any
   value, but reusing the dev literal in a release install defeats the
   defence-in-depth split (per `docs/architecture.md` § 8).
3. **Migration actuation is BYPASSED unless you remember `--profile migrate`.**
   Without it, the `api` service starts against an unmigrated DB and fails.
   Re-add the profile or run `psql -f migration.sql` against the `db`
   container manually (per
   [ADR-0005](docs/adr/ADR-0005-release-install-migration-actuation.md)
   Consequences).

The primary install path (Options A / `install.ps1` / `install.sh`) handles
all three -- prefer it where local policy permits.

---

## Contributor flow (from a clone)

For maintainers / contributors who need the source tree + hot-reload:

```powershell
git clone https://github.com/kostiantyn-matsebora/deployment-dashboard.git
cd deployment-dashboard
pwsh -NoProfile -File dev_env/start.ps1
```

The contributor stack is `dev_env/docker-compose.local.yml` -- builds images
locally, bind-mounts `backend/`, runs migrations via a one-shot SDK container
calling `dotnet ef database update`. See `dev_env/README.md` for the full
contributor instructions (including `-Scaled`, `-Fetcher`, and the
NFR-05 validation harness).

The release-install path and the contributor flow share **no token value** --
the dev-literal `local-dev-token-not-for-production` is hard-coded in
`dev_env/docker-compose.local.yml` and refused by `install.ps1` / `install.sh`
as `API_TOKEN`.

---

## Architecture

The system is a modular monolith (per
[ADR-0002](docs/adr/ADR-0002-modular-monolith-consolidation.md)) with four
container images: `dashboard-api` (Write + Read endpoint groups co-hosted),
`dashboard-fetcher` (optional pull-mode worker), `dashboard-frontend` (Angular
20 SPA on nginx), and `dashboard-gateway` (nginx routing / SSE pass-through /
the only host-published service). The full topology, ADRs, change records, and
UI mockup live under `docs/`:

| Surface | Pointer |
|---|---|
| Solution Architecture Document | `docs/architecture.md` |
| Architecture Decision Records | `docs/adr/` |
| Change Records | `docs/cr/` |
| CI/CD pipelines (outbound) | `docs/ci-cd-pipelines.md` |
| CI/CD integration (inbound) | `docs/ci-cd-integration.md` |
| UI mockup (canonical visual ref) | `docs/ui/deployment-dashboard.html` |

For the release-install design specifically, see
[ADR-0005](docs/adr/ADR-0005-release-install-migration-actuation.md) (migration
actuation) and `docs/ci-cd-pipelines.md` § 10 (release pipeline + asset URL
pattern).
