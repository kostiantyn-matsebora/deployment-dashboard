---
title: Install
nav_order: 3
description: Full install reference — release path, demo mode, contributor flow, escape hatches.
---

# Install

Full install reference for the Deployment Dashboard. For a 60-second taste, the [Get Started](getting-started.html) page is faster. This page is the operational reference: prereqs, all flags, pinning, custom ports, uninstall, contributor flow, and the escape-hatch paths for locked-down environments.

A clean machine with Docker + the GitHub CLI (`gh`) installed can be running the
dashboard in two commands — no `git clone`, no source tree, no .NET SDK
required. The installer:

1. fetches release assets from GitHub via `gh release download`,
2. authenticates to GHCR via `gh auth token | docker login`,
3. pulls the four pinned private images from GHCR
   (`ghcr.io/kostiantyn-matsebora/deployment-dashboard-{api,fetcher,frontend,gateway}`),
4. brings up the stack with `docker compose`,
5. polls `/health` — the `api` container self-applies pending EF Core migrations on startup before reporting healthy (per [ADR-0009](adr/ADR-0009-startup-applied-ef-migrations.html)),
6. and prints the URL panel + the generated `API_TOKEN`.

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

## Windows (PowerShell 7+)

The two-step flow: `gh release download` fetches `install.ps1` into the
current directory; `pwsh` runs it. The old `iex (irm ...)` one-liner is
retired — the release asset URL it pulled requires auth headers `irm` does
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

## Linux / macOS

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
generated `API_TOKEN` once — it is also persisted to
`./dashboard-release/dashboard.env` for subsequent CI/CD POSTs.

## With the optional fetcher

The fetcher is a CR-0009 pull-mode worker that translates GitHub Actions runs
into `POST /api/deployments` events. Opt in with `-Fetcher` (PowerShell) /
`--fetcher` (bash) on the second step; the `GHA_TOKEN` precondition must hold before any `docker compose` invocation runs (per [issue #5](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/5)):

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

Note: the `GHA_TOKEN` and the `gh` CLI's stored token are two distinct secrets; one is not a substitute for the other, and both must be set when running the `-Fetcher` path.

| Token | Purpose | Used by | Required when |
|---|---|---|---|
| `GHA_TOKEN` | GitHub Actions API PAT | fetcher worker | running the `-Fetcher` path |
| `gh` CLI stored token | GitHub Releases + GHCR auth | installer | running the `-Fetcher` path |

For a zero-PAT walkthrough, use `-Demo` / `--demo` (next section) — it boots the fetcher against a public repo in GitHub's anonymous-mode rate bucket.

## Try it without setup — demo mode

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
(Grafana) env columns alongside the steady-state ones.

**Note.** A per-repo environment filter for the fetcher is tracked separately and is not part of this install path.

Under the hood, the fetcher's GitHub-API adapter omits the
`Authorization` header entirely when `GHA_TOKEN` is empty or equals the
compose-default placeholder literal `local-dev-gha-token-placeholder`;
that's the runtime transport contract that makes the zero-PAT path work
end-to-end. See [`docs/ci-cd-integration.md`](ci-cd-integration.html) § Anonymous-mode transport
for the wire detail.

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

The contributor stack is `dev_env/docker-compose.local.yml` — builds images
locally and bind-mounts `backend/`. Migrations apply on `api` startup the same
way as the release stack (see § Migrations). See `dev_env/README.md` for the
full contributor instructions (including `-Scaled`, `-Fetcher`, and the NFR-05
validation harness).

The release-install path and the contributor flow share **no token value** —
the dev-literal `local-dev-token-not-for-production` is hard-coded in
`dev_env/docker-compose.local.yml` and refused by `install.ps1` / `install.sh`
as `API_TOKEN`.
