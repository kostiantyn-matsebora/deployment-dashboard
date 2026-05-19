[![Built with ginee](https://img.shields.io/badge/built%20with-ginee-7c3aed?style=flat-square)](https://kostiantyn-matsebora.github.io/ginee/) [![AI-implemented end-to-end](https://img.shields.io/badge/AI--implemented-end%20to%20end-10b981?style=flat-square)](https://github.com/kostiantyn-matsebora/ginee)

> [!NOTE]
> **Built end-to-end by AI** — every commit, ADR, CR, test, and CI workflow in this repo was authored by AI specialists routed through [`ginee`](https://github.com/kostiantyn-matsebora/ginee), a multi-agent engineering process for small autonomous teams.

> [!WARNING]
> **Work in progress — not production-ready.** Pre-1.0 active development; APIs, wire contracts, infrastructure topology, and configuration surfaces may change without notice. Suitable for evaluation, demos, and internal testbed use only.

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

A clean machine with Docker + the GitHub CLI (`gh`) installed can be running the
dashboard in two commands -- no `git clone`, no source tree, no .NET SDK
required. The installer fetches release assets from GitHub via `gh release
download`, authenticates to GHCR via `gh auth token | docker login`, pulls the
four pinned private images from GHCR
(`ghcr.io/kostiantyn-matsebora/deployment-dashboard-{api,fetcher,frontend,gateway}`),
brings up the stack with `docker compose`, applies idempotent schema migrations
via a one-shot `postgres:16-alpine` container, polls `/health`, and prints the
URL panel + the generated `API_TOKEN`.

### Prerequisites

The release repo and the GHCR image registry are both private. All asset
fetches and image pulls flow through the GitHub CLI's authenticated session.

| Prereq | Why |
|---|---|
| Docker (Engine + Compose v2) | Runs the four release images + the one-shot migrations container. |
| **`gh` CLI on `PATH`** | Replaces anonymous `irm` / `curl` -- the release asset URL pattern 404s without auth headers. |
| **`gh auth status --hostname github.com` returns 0** | Installer's first action is to verify the auth session; missing / expired auth fails fast with a friendly error. |
| **`gh` token carries `read:packages`, `write:packages`, or `admin:packages`** | Required by the `gh auth token` → `docker login ghcr.io` pipeline. GitHub's OAuth scopes are hierarchical -- `write:packages` includes `read:packages` (and `admin:packages` includes both), so any of the three is accepted. The default `gh auth login` scope set does NOT include any of them -- refresh with `--scopes read:packages` to grant the minimum. |

Install + authenticate `gh`:

```powershell
# Windows
winget install GitHub.cli
```

```bash
# macOS
brew install gh

# Debian / Ubuntu
sudo apt install gh

# Fedora / RHEL
sudo dnf install gh
```

Then, on any OS:

```bash
gh auth login
gh auth refresh --hostname github.com --scopes read:packages
```

Verify:

```bash
gh auth status --hostname github.com
```

### Windows (PowerShell 7+)

The two-step flow: `gh release download` fetches `install.ps1` into the
current directory; `pwsh` runs it. The old `iex (irm ...)` one-liner is
retired -- the release asset URL it pulled requires auth headers `irm` does
not supply.

Latest release:

```powershell
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
pwsh -NoProfile -File install.ps1
```

Pin to a specific tag:

```powershell
gh release download v1.2.3 --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
pwsh -NoProfile -File install.ps1 -Version v1.2.3
```

### Linux / macOS

```bash
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
bash install.sh
```

Pin to a specific tag:

```bash
gh release download v1.2.3 --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
bash install.sh --version v1.2.3
```

The dashboard is then on `http://localhost:8080/`. The installer prints the
generated `API_TOKEN` once -- it is also persisted to
`./dashboard-release/dashboard.env` for subsequent CI/CD POSTs.

### With the optional fetcher

The fetcher is a CR-0009 pull-mode worker that translates GitHub Actions runs
into `POST /api/deployments` events. Opt in with `-Fetcher` (PowerShell) /
`--fetcher` (bash) on the second step. The `GHA_TOKEN` precondition (per
[issue #5](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/5))
must hold before any `docker compose` invocation runs:

```powershell
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
$env:GHA_TOKEN = '<your-github-pat>'
pwsh -NoProfile -File install.ps1 -Fetcher
```

```bash
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
export GHA_TOKEN='<your-github-pat>'
bash install.sh --fetcher
```

Note: the `GHA_TOKEN` (fetcher → GitHub Actions API PAT) is a separate
secret from the `gh` CLI's stored token (installer → GitHub Releases + GHCR
auth). Both must be set when running the `-Fetcher` path; one is not a
substitute for the other. For a zero-PAT walkthrough, use `-Demo` /
`--demo` (next section) — it boots the fetcher against a public repo in
GitHub's anonymous-mode rate bucket.

### Try it without setup -- demo mode

`-Demo` (PowerShell) / `--demo` (bash) implies `-Fetcher` and bakes in a
public-repo default (`GHA_REPOSITORIES=[{"owner":"PostHog","repo":"posthog"},{"owner":"grafana","repo":"grafana"}]`)
plus a 60-second poll interval, so a fresh install renders deployment
activity end-to-end with no caller-side configuration. Two repos are
seeded (rather than one) to give a richer multi-service matrix on first
render. `$env:GHA_TOKEN`
governs the fetcher's rate budget but is **not required**:

| `$env:GHA_TOKEN` | `Authorization` header | GitHub API rate limit |
|---|---|---|
| set            | `Bearer <token>` | 5000 req/h (authed)   |
| unset          | omitted          | 60 req/h (anonymous)  |

```powershell
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
pwsh -NoProfile -File install.ps1 -Demo
```

```bash
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
./install.sh --demo
```

PostHog/posthog and grafana/grafana are high-deployment-activity public
repos chosen for visible matrix output on first render. Both surface
PR-ephemeral environments in their action runs, so the matrix will show
some historical `posthog-NNNN-*` (PostHog) and `storybook-pr-preview-NNNNN`
(Grafana) env columns alongside the steady-state ones. A per-repo
environment filter for the fetcher is tracked separately (separate
forthcoming issue: per-repo environment filter for the fetcher) and is
not part of this install path.

Under the hood, the fetcher's GitHub-API adapter omits the
`Authorization` header entirely when `GHA_TOKEN` is empty or equals the
compose-default placeholder literal `local-dev-gha-token-placeholder`;
that's the runtime transport contract that makes the zero-PAT path work
end-to-end. See `docs/ci-cd-integration.md` § Anonymous-mode transport
for the wire detail.

### Pin a version

```powershell
gh release download v1.2.3 --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
pwsh -NoProfile -File install.ps1 -Version v1.2.3
```

```bash
gh release download v1.2.3 --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
bash install.sh --version v1.2.3
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

For environments that disallow running the installer script (sandboxed CI,
locked-down hosts), one minimal path exists. It **regresses** on issue #5's
`GHA_TOKEN` precondition, on the `API_TOKEN` generation, AND requires the user
to perform the GHCR docker login manually; the user takes on the
secret-handling + auth discipline.

The `gh` CLI prereq (installed + authenticated + any of `read:packages` / `write:packages` / `admin:packages` per
the Prerequisites table above) still applies. Without `gh`, the escape hatch
cannot fetch the release assets and cannot authenticate `docker login` to
pull the private GHCR images.

#### Option B -- raw compose + manual `docker compose`

```bash
# Fetch the release assets via gh (anonymous curl 404s against the private repo).
gh release download v1.2.3 \
  --repo kostiantyn-matsebora/deployment-dashboard \
  --pattern 'docker-compose.release.yml' \
  --pattern 'migration.sql' \
  --clobber

# Authenticate docker to GHCR before compose attempts to pull images
# (the images are private; anonymous pulls 404).
gh auth token | docker login ghcr.io --username "$(gh api user --jq .login)" --password-stdin

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

#### Option D -- `docker compose -f <https-url>` *(no longer supported)*

The previous `docker compose -f https://.../docker-compose.release.yml ...`
shortcut **no longer works** against this repo. The release repo is private,
so the `releases/download/<tag>/<asset-name>` HTTPS URL returns `404` to any
fetcher (including `docker compose`) that cannot inject GitHub auth headers
into the request. Compose v2.20+'s HTTPS-URL support has no hook for
arbitrary `Authorization: Bearer <token>` headers, so this path cannot be
revived without making the repo public.

Use Option B instead: `gh release download` the compose file locally, then
`docker compose -f <local-path>`.

#### Regression warnings for Option B

1. **`gh` CLI is now a hard dependency for the escape hatch too.** Without
   `gh` (installed / authenticated / any of `read:packages` / `write:packages` / `admin:packages`), this option
   cannot fetch the release assets and cannot `docker login` to GHCR.
   Anonymous `curl -fsSL -O <release-asset-url>` and anonymous `docker
   compose pull` both 404 against the private repo + private GHCR.
2. **`GHA_TOKEN` precondition is BYPASSED.** When the `fetcher` profile is
   active, the fetcher boots with the placeholder token from
   `docker-compose.release.yml`; `401 Unauthorized` from GitHub API surfaces
   only in fetcher logs. Set `$GHA_TOKEN` manually before running. This is
   the GitHub Actions API PAT used by the fetcher worker, distinct from the
   `gh` CLI's session token.
3. **`API_TOKEN` is NOT generated.** You MUST set `$API_TOKEN` to a strong
   random value before running, and you MUST NOT reuse the dev literal
   `local-dev-token-not-for-production` -- the API middleware accepts any
   value, but reusing the dev literal in a release install defeats the
   defence-in-depth split (per `docs/architecture.md` § 8).
4. **Migration actuation is BYPASSED unless you remember `--profile migrate`.**
   Without it, the `api` service starts against an unmigrated DB and fails.
   Re-add the profile or run `psql -f migration.sql` against the `db`
   container manually (per
   [ADR-0005](docs/adr/ADR-0005-release-install-migration-actuation.md)
   Consequences).

The primary install path (`install.ps1` / `install.sh`) handles all four --
prefer it where local policy permits.

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

The system is a **microservices architecture** with **container co-location** of
the Write + Read API services (framing per
[ADR-0006](docs/adr/ADR-0006-microservices-architecture-with-container-co-location.md);
co-location mechanics per
[ADR-0002](docs/adr/ADR-0002-modular-monolith-consolidation.md)). Four container
images: `deployment-dashboard-api` (Write + Read services co-located — packaging choice,
not the architecture itself), `deployment-dashboard-fetcher` (optional pull-mode worker
microservice), `deployment-dashboard-frontend` (Angular 20 SPA on nginx), and
`deployment-dashboard-gateway` (nginx routing / SSE pass-through / the only host-published
service). The full topology, ADRs, change records, and UI mockup live under
`docs/`:

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
