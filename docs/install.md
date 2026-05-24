---
title: Install
nav_order: 3
description: Full install reference — flag matrix, Postgres options, real-GHA opt-in, demo stack, contributor flow, escape hatches.
---

# Install

Full install reference for the Deployment Dashboard. For a 60-second taste, the [Get Started](getting-started.html) page is faster. This page is the operational reference: prereqs, all flags, Postgres assumptions, pinning, custom ports, uninstall, contributor flow, and the escape-hatch paths for locked-down environments.

A clean machine with Docker + the GitHub CLI (`gh`) installed can be running the
dashboard in two commands — no `git clone`, no source tree, no .NET SDK
required. The installer:

1. fetches release assets from GitHub via `gh release download`,
2. authenticates to GHCR via `gh auth token | docker login`,
3. pulls the pinned private component images from GHCR
   (`ghcr.io/kostiantyn-matsebora/deployment-dashboard-{api,fetcher,frontend,gateway}`
   — plus `deployment-dashboard-demo-gha` and `deployment-dashboard-demo-driver`
   when `-Demo` is passed),
4. brings up the stack with `docker compose`,
5. polls `/health` — the `api` container self-applies pending EF Core migrations on startup before reporting healthy (per [ADR-0009](adr/ADR-0009-startup-applied-ef-migrations.html)),
6. and prints the URL panel.

## Production assumption — external Postgres

The release stack assumes an external Postgres endpoint by default. The bundled
`db` container (image `postgres:16-alpine`) is a convenience activated only via
`-LocalDb` or `-Demo`. It is NOT a production contract:

- For production deployments, supply `ConnectionStrings__DefaultConnection`
  pointing at your Azure Postgres Flexible instance (or equivalent).
- For quick local evals, pass `-LocalDb` to start the bundled container.
- For the zero-configuration demo, pass `-Demo`.

## Flag matrix at a glance

| Invocation | Postgres | Fetcher | Demo upstream | When to use |
|---|---|---|---|---|
| `install.ps1` / `install.sh` (no flag) | External — `ConnectionStrings__DefaultConnection` required | None | None | Production / CI integration. You supply Postgres and push events via `POST /api/deployments`. |
| `install.ps1 -LocalDb` / `install.sh --local-db` | Bundled `db` container (`--profile db`) | None | None | Quick local eval without external Postgres. No fetcher — push events manually. |
| `install.ps1 -RealGha` / `install.sh --real-gha` | External — `ConnectionStrings__DefaultConnection` required | Real GitHub Actions (`--profile fetcher`) | None | Point the fetcher at your own GitHub repos. Requires `$env:GHA_TOKEN`. |
| `install.ps1 -Demo` / `install.sh --demo` | Bundled `db` container (`--profile db`) | Fetcher (`--profile fetcher`) | `demo-gha` + `demo-driver` (baked WireMock bundle) | Evaluators / first-look installs. Zero configuration, zero-PAT, offline. |

## ConnectionStrings__DefaultConnection precondition (ASR-D)

When neither `-LocalDb` nor `-Demo` is passed, the installer fails fast (exit 1)
before any `docker compose up` if `ConnectionStrings__DefaultConnection` is unset.

Three resolution paths:

1. Pass `-LocalDb` to start the bundled Postgres container (quick local eval).
2. Pass `-Demo` for the full self-contained demo stack (offline, zero-PAT).
3. Set the connection string before running:

```powershell
# PowerShell
$env:ConnectionStrings__DefaultConnection = 'Host=<host>;Database=dashboard;Username=<user>;Password=<password>'
pwsh -NoProfile -File install.ps1
```

```bash
# bash
export ConnectionStrings__DefaultConnection='Host=<host>;Database=dashboard;Username=<user>;Password=<password>'
./install.sh
```

## Prerequisites

The release repo and the GHCR image registry are both private. All asset
fetches and image pulls flow through the GitHub CLI's authenticated session.

| Prereq | Why |
|---|---|
| Docker (Engine + Compose v2) | Runs the four release images (gateway / api / dashboard / fetcher) plus `postgres:16-alpine`. |
| **`gh` CLI on `PATH`** | Replaces anonymous `irm` / `curl` — the release asset URL pattern 404s without auth headers. |
| **`gh auth status --hostname github.com` returns 0** | Installer's first action is to verify the auth session; missing / expired auth fails fast with a friendly error. |
| **`gh` token carries `read:packages`, `write:packages`, or `admin:packages`** | Required by the `gh auth token` → `docker login ghcr.io` pipeline. `read:packages` minimum (or `write:packages` / `admin:packages` — scopes are hierarchical). Default `gh auth login` does not include these — see note below. |

**Token scope note.** GitHub's OAuth scopes are hierarchical — `write:packages` includes `read:packages` (and `admin:packages` includes both), so any of the three is accepted. The default `gh auth login` scope set does NOT include any of them — refresh with `--scopes read:packages` to grant the minimum.

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

## Quick start — demo stack (Windows, PowerShell 7+)

Two-step flow: `gh release download` fetches `install.ps1`; `pwsh -Demo` runs it.
The dashboard renders a populated, evolving 6-service × 5+-env matrix within
~60 seconds with no PAT and no external network calls.

Latest release:

```powershell
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
pwsh -NoProfile -File install.ps1 -Demo
```

Pin to a specific tag:

```powershell
gh release download v1.2.3 --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
pwsh -NoProfile -File install.ps1 -Demo -Version v1.2.3
```

## Quick start — demo stack (Linux / macOS)

```bash
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
bash install.sh --demo
```

Pin to a specific tag:

```bash
gh release download v1.2.3 --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
bash install.sh --demo --version v1.2.3
```

The dashboard is then on `http://localhost:8080/`.

### What you see (demo mode)

Within ~60 seconds of `/health` returning 200:

| Surface | Behaviour |
|---|---|
| Matrix | ≥ 20 populated slots (6 services × 5+ environments); ≥ 5 of the canonical 6 box states appear |
| DAG | All four `parent_deployments` shapes covered — empty / single per-env / intra-run `needs:` / multi-`needs:` mixed |
| SSE | New deployment events arrive every 5–10 s; the dashboard evolves visibly for ~10 minutes before the scenario walk loops |
| Network | Zero outbound calls — the fetcher polls the in-network `demo-gha` container; no GitHub.com traffic |

The demo bundle is content-only — there is no admin UI to inject new events.
Re-run `install.ps1 -Demo` to reset the scenario state to tick 1.

## Quick start — local evaluation with bundled Postgres

Use `-LocalDb` when you want to push your own deployment events to an empty
dashboard without supplying an external Postgres.

```powershell
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
pwsh -NoProfile -File install.ps1 -LocalDb
```

```bash
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
bash install.sh --local-db
```

The dashboard starts empty. Push events via `POST /api/deployments` (see
[`docs/ci-cd-integration.md`](ci-cd-integration.html)).

## Real GitHub repos — `-RealGha`

Point the fetcher at your own GitHub Actions repos (CR-0009 pull-mode worker).
`GHA_TOKEN` is required. Supply your own Postgres via
`ConnectionStrings__DefaultConnection` or omit if it is already in the environment.

```powershell
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
$env:GHA_TOKEN = '<your-github-pat>'
$env:ConnectionStrings__DefaultConnection = 'Host=<host>;Database=dashboard;Username=<user>;Password=<password>'
pwsh -NoProfile -File install.ps1 -RealGha
```

```bash
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
export GHA_TOKEN='<your-github-pat>'
export ConnectionStrings__DefaultConnection='Host=<host>;Database=dashboard;Username=<user>;Password=<password>'
bash install.sh --real-gha
```

Note: `GHA_TOKEN` and the `gh` CLI stored token are distinct secrets.

| Token | Purpose | Used by | Required when |
|---|---|---|---|
| `GHA_TOKEN` | GitHub Actions API PAT | fetcher worker | `-RealGha` / `--real-gha` |
| `gh` CLI stored token | GitHub Releases + GHCR auth | installer | every install |

Under the hood, the fetcher omits the `Authorization` header entirely when
`GHA_TOKEN` is empty or equals the placeholder literal
`local-dev-gha-token-placeholder`. See
[`docs/ci-cd-integration.md`](ci-cd-integration.html) § Anonymous-mode transport.

## Production / CI integration (no flag)

Bring up the app stack against your own Postgres and push events via
`POST /api/deployments`. No fetcher, no demo services.

```powershell
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
$env:ConnectionStrings__DefaultConnection = 'Host=<host>;Database=dashboard;Username=<user>;Password=<password>'
$env:API_TOKEN = '<your-api-token>'
pwsh -NoProfile -File install.ps1
```

```bash
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
export ConnectionStrings__DefaultConnection='Host=<host>;Database=dashboard;Username=<user>;Password=<password>'
export API_TOKEN='<your-api-token>'
bash install.sh
```

## Pin a version

```powershell
gh release download v1.2.3 --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
pwsh -NoProfile -File install.ps1 -Version v1.2.3
```

```bash
gh release download v1.2.3 --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
bash install.sh --version v1.2.3
```

Re-running the installer with a newer tag against the same `-InstallDir` /
`--install-dir` upgrades in place. Migrations apply automatically on the
new `api` image's first startup — see § Migrations below.

## Migrations

The `api` container applies pending EF Core migrations on startup,
between `app.Build()` and `app.RunAsync()` — see
[ADR-0009](adr/ADR-0009-startup-applied-ef-migrations.html) for the
decision and alternatives. No installer step actuates migrations; the
release no longer ships a `migration.sql` asset and the release compose
file no longer carries a one-shot runner service. EF's idempotent
migration contract makes re-apply across upgrades a no-op for
already-applied migrations.

## Custom port

```powershell
pwsh -NoProfile -File install.ps1 -Port 9090
```

```bash
./install.sh --port 9090
```

## Uninstall

The default install directory is `$HOME/.dashboard-release` (the same default as `install.ps1` / `install.sh`). Pass `--install-dir` / `-InstallDir` if you used a custom path.

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

## Minimal install options (escape hatches)

For environments that disallow running the installer script (sandboxed CI,
locked-down hosts), one minimal path exists. It **regresses** on issue #5's
`GHA_TOKEN` precondition and on the `API_TOKEN` generation, AND requires the
user to perform the GHCR docker login manually; the user takes on the
secret-handling + auth discipline.

The `gh` CLI prereq (installed + authenticated + any of `read:packages` / `write:packages` / `admin:packages` per
the Prerequisites table above) still applies. Without `gh`, the escape hatch
cannot fetch the release assets and cannot authenticate `docker login` to
pull the private GHCR images.

### Option B — raw compose + manual `docker compose`

```bash
# Fetch the release compose file via gh (anonymous curl 404s against the private repo).
gh release download v1.2.3 \
  --repo kostiantyn-matsebora/deployment-dashboard \
  --pattern 'docker-compose.release.yml' \
  --clobber

# Authenticate docker to GHCR before compose attempts to pull images
# (the images are private; anonymous pulls 404).
gh auth token | docker login ghcr.io --username "$(gh api user --jq .login)" --password-stdin

# REQUIRED: set secrets before invoking, or the install boots with a
# placeholder token (silent 401s on the API).
export API_TOKEN="$(openssl rand -hex 32)"
export POSTGRES_PASSWORD="$(openssl rand -hex 16)"
export GHA_TOKEN='<pat-or-omit-if-no-fetcher>'
export DASHBOARD_VERSION='v1.2.3'
export DASHBOARD_PORT='8080'
export ConnectionStrings__DefaultConnection="Host=db;Database=dashboard;Username=dashboard;Password=$POSTGRES_PASSWORD"

docker compose -f docker-compose.release.yml up -d --wait
```

`--wait` blocks until the api healthcheck passes, by which point startup-applied
migrations are already complete (see § Migrations).

If your shell rejects `__` in identifier names (BusyBox `sh`, certain minimal
images), prefix the env-var to the command instead of `export`-ing it:

```bash
env ConnectionStrings__DefaultConnection="Host=db;Database=dashboard;Username=dashboard;Password=$POSTGRES_PASSWORD" \
  docker compose -f docker-compose.release.yml up -d --wait
```

### Option D — `docker compose -f <https-url>` *(no longer supported)*

The previous `docker compose -f https://.../docker-compose.release.yml ...`
shortcut **no longer works** against this repo. The release repo is private,
so the `releases/download/<tag>/<asset-name>` HTTPS URL returns `404` to any
fetcher (including `docker compose`) that cannot inject GitHub auth headers
into the request. Compose v2.20+'s HTTPS-URL support has no hook for
arbitrary `Authorization: Bearer <token>` headers, so this path cannot be
revived without making the repo public.

Use Option B instead: `gh release download` the compose file locally, then
`docker compose -f <local-path>`.

### Regression warnings for Option B

1. **`gh` CLI hard dependency.** `gh` CLI is now a hard dependency for the escape hatch too.
   - Without `gh` (installed / authenticated / any of `read:packages` / `write:packages` / `admin:packages`), this option cannot fetch the release assets and cannot `docker login` to GHCR.
   - Anonymous `curl -fsSL -O <release-asset-url>` and anonymous `docker compose pull` both 404 against the private repo + private GHCR.
2. **`GHA_TOKEN` precondition bypassed.** `GHA_TOKEN` precondition is BYPASSED.
   - When the `fetcher` profile is active, the fetcher boots with the placeholder token from `docker-compose.release.yml`; `401 Unauthorized` from GitHub API surfaces only in fetcher logs.
   - Set `$GHA_TOKEN` manually before running.
   - This is the GitHub Actions API PAT used by the fetcher worker, distinct from the `gh` CLI's session token.
3. **`API_TOKEN` not generated.** `API_TOKEN` is NOT generated.
   - You MUST set `$API_TOKEN` to a strong random value before running.
   - You MUST NOT reuse the dev literal `local-dev-token-not-for-production` — the API middleware accepts any value, but reusing the dev literal in a release install defeats the defence-in-depth split (per [`docs/architecture.md`](architecture.html) § 8).

Migration actuation is **not** in this list: Option B requires no manual
actuation step (see § Migrations).

The primary install path (`install.ps1` / `install.sh`) handles all three —
prefer it where local policy permits.

---

## Contributor flow (from a clone)

For maintainers / contributors who need the source tree + hot-reload:

```powershell
git clone https://github.com/kostiantyn-matsebora/deployment-dashboard.git
cd deployment-dashboard
pwsh -NoProfile -File dev_env/start.ps1
```

The default (no flag) is demo mode — same semantics as `install.ps1 -Demo`. See
`dev_env/README.md` for the full contributor instructions including `-LocalDb`,
`-RealGha`, `-Integration`, `-Scaled`, and the NFR-05 validation harness.
