---
title: Install
nav_order: 3
description: Full install reference — demo-default release path, real-GHA opt-in, empty stack, contributor flow, escape hatches.
---

# Install

Full install reference for the Deployment Dashboard. For a 60-second taste, the [Get Started](getting-started.html) page is faster. This page is the operational reference: prereqs, all flags, pinning, custom ports, uninstall, contributor flow, and the escape-hatch paths for locked-down environments.

A clean machine with Docker + the GitHub CLI (`gh`) installed can be running the
dashboard in two commands — no `git clone`, no source tree, no .NET SDK
required. **As of [CR-0013](cr/CR-0013-demo-mode-default-installer.html), the
no-flag install boots a self-contained demo stack**: the dashboard renders a
populated, evolving matrix within 60 seconds with no GitHub PAT, no external
network calls. The installer:

1. fetches release assets from GitHub via `gh release download`,
2. authenticates to GHCR via `gh auth token | docker login`,
3. pulls the pinned private component images from GHCR
   (`ghcr.io/kostiantyn-matsebora/deployment-dashboard-{api,fetcher,frontend,gateway}` —
   plus `deployment-dashboard-demo-gha` under the default `demo` profile, per
   [CR-0013](cr/CR-0013-demo-mode-default-installer.html)),
4. brings up the stack with `docker compose` (default profile: `demo`),
5. polls `/health` — the `api` container self-applies pending EF Core migrations on startup before reporting healthy (per [ADR-0009](adr/ADR-0009-startup-applied-ef-migrations.html)),
6. and prints the URL panel + the generated `API_TOKEN`.

## Flag matrix at a glance

| Invocation | Stack | When to use |
|---|---|---|
| `install.ps1` / `install.sh` (no flag) | Demo — `demo-gha` + fetcher pointing at it; 6-service × 5+-env matrix evolves over time | Default. Evaluators / first-look installs. Zero configuration. |
| `install.ps1 -RealGha` / `install.sh --real-gha` | Real GitHub Actions upstream; requires `$env:GHA_TOKEN` | You want to point the fetcher at your own repos. |
| `install.ps1 -Empty` / `install.sh --empty` | No fetcher; no demo-gha; bare api/gateway/frontend/db | Direct `POST /api/deployments` integrators / power users. |
| `install.ps1 -Demo` (back-compat) | Routes to default + logs an info line | Migration aid; will be removed after one release cycle. See § Migration from earlier versions. |
| `install.ps1 -ResetDemoDefaults` / `install.sh --reset-demo-defaults` | Demo with credential reset | Re-runs where the prior install used different credentials (pre-CR-0014 random secrets or a `-RealGha` install). See § Demo credentials and re-run safety. |

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

## Quick start — demo default (Windows, PowerShell 7+)

The two-step flow: `gh release download` fetches `install.ps1` into the
current directory; `pwsh` runs it. No flag — boots the demo-default stack per
[CR-0013](cr/CR-0013-demo-mode-default-installer.html). The dashboard renders
a populated, evolving 6-service × 5+-env matrix within ~60 seconds, with no
PAT and no external network calls.

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

## Quick start — demo default (Linux / macOS)

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

### What you see

Within ~60 seconds of `/health` returning 200:

| Surface | Behaviour |
|---|---|
| Matrix | ≥ 20 populated slots (6 services × 5+ environments); ≥ 5 of the canonical 6 box states from `local/index/ui-states.yaml` appear |
| DAG | All four `parent_deployments` shapes covered — empty / single per-env / intra-run `needs:` / multi-`needs:` mixed |
| SSE | New deployment events arrive every 5–10 s; the dashboard evolves visibly for ~10 minutes before the scenario walk loops |
| Network | Zero outbound calls — the fetcher polls the in-network `demo-gha` container; no GitHub.com traffic |

The demo bundle is content-only — there is no admin UI to inject new events.
Re-run `install.ps1` to reset the scenario state to tick 1.

## Demo credentials and re-run safety

As of [CR-0014](cr/CR-0014-shared-bringup-logic-and-demo-credentials.html), the demo path writes **fixed** credentials to `dashboard.env` instead of random-per-install values. This makes demo re-runs idempotent against an existing `pg-data` volume — you no longer need to uninstall between re-runs.

| Variable | Demo path value | Non-demo paths (`-RealGha` / `--real-gha`, `-Empty` / `--empty`) |
|---|---|---|
| `POSTGRES_PASSWORD` | `local-dev-password` | Random hex per install |
| `API_TOKEN` | `demo-api-token` | Random hex per install |

> **Do not use demo credentials in production.** These are publicly documented fixed literals. They are safe for the demo path only because the stack is internal-only with no public ingress (NFR-04). Any `-RealGha` or `-Empty` install generates random secrets and refuses the demo literals.

### Re-run safety

Re-running `install.ps1` (no flags — demo default) against an existing `pg-data` volume succeeds without data loss. The Postgres cluster was initialised with `local-dev-password`; the re-run writes the same password; the API container connects successfully.

### `-ResetDemoDefaults` — credential drift escape hatch

If a prior install used different credentials (for example, a pre-CR-0014 install with random secrets, or a `-RealGha` install that left a non-demo `POSTGRES_PASSWORD` in `dashboard.env`), re-running as the demo default detects the drift and hard-fails with a remediation menu:

1. **Re-run with `-ResetDemoDefaults`** (PowerShell) / `--reset-demo-defaults` (bash). Force-overwrites `dashboard.env` with demo literals. You MUST then run `uninstall.ps1 -RemoveData` / `uninstall.sh --remove-data` before the next bring-up to drop the incompatible pg volume.
2. **Run `uninstall.ps1 -RemoveData` then re-install** — clean slate.
3. **Manually edit `dashboard.env`** and set `POSTGRES_PASSWORD=local-dev-password` — only valid if you know the cluster was seeded with that exact password.

```powershell
# PowerShell: reset demo credentials + drop the old pg volume before re-running
pwsh -NoProfile -File install.ps1 -ResetDemoDefaults
pwsh -NoProfile -File uninstall.ps1 -RemoveData
pwsh -NoProfile -File install.ps1
```

```bash
# bash: same sequence
bash install.sh --reset-demo-defaults
bash uninstall.sh --remove-data
bash install.sh
```

## Real GitHub repos — `-RealGha`

For pointing the fetcher at your own GitHub Actions repos (CR-0009 pull-mode worker), opt in with `-RealGha` (PowerShell) / `--real-gha` (bash). The `GHA_TOKEN` precondition must hold before any `docker compose` invocation runs (per [issue #5](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/5) — preserved verbatim under the renamed flag):

```powershell
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
$env:GHA_TOKEN = '<your-github-pat>'
pwsh -NoProfile -File install.ps1 -RealGha
```

```bash
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
export GHA_TOKEN='<your-github-pat>'
bash install.sh --real-gha
```

Note: the `GHA_TOKEN` and the `gh` CLI's stored token are two distinct secrets; one is not a substitute for the other, and both must be set when running the `-RealGha` path.

| Token | Purpose | Used by | Required when |
|---|---|---|---|
| `GHA_TOKEN` | GitHub Actions API PAT | fetcher worker | running the `-RealGha` path |
| `gh` CLI stored token | GitHub Releases + GHCR auth | installer | every install |

`-RealGha` consumes the same fetcher service and the same env-var contract that today's `-Fetcher` does — the rename is install-time UX only, not a backend change. `GHA_REPOSITORIES` defaults to your own value via the existing `dashboard.env` round-trip; pre-CR-0013 behaviour is otherwise unchanged.

Under the hood, the fetcher's GitHub-API adapter omits the
`Authorization` header entirely when `GHA_TOKEN` is empty or equals the
compose-default placeholder literal `local-dev-gha-token-placeholder`. See
[`docs/ci-cd-integration.md`](ci-cd-integration.html) § Anonymous-mode transport
for the wire detail. The demo-default path does not exercise this anonymous-mode
transport — `demo-gha` ignores the `Authorization` header entirely.

## Empty stack — `-Empty` (direct-POST integrators)

Power-user escape: bring up the stack with no fetcher and no demo-gha. Useful when an external pipeline POSTs deployment events directly to `/api/deployments` and the in-stack fetcher would be redundant or conflicting.

```powershell
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.ps1 --output install.ps1 --clobber
pwsh -NoProfile -File install.ps1 -Empty
```

```bash
gh release download --repo kostiantyn-matsebora/deployment-dashboard --pattern install.sh --output install.sh --clobber
bash install.sh --empty
```

The resulting stack is `api` + `gateway` + `dashboard` (frontend) + `db` — four services, identical to the pre-CR-0013 no-flag default. The dashboard renders empty on first load; populate it via direct `POST /api/deployments` (see [`docs/ci-cd-integration.md`](ci-cd-integration.html)).

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

## Migration from earlier versions

[CR-0013](cr/CR-0013-demo-mode-default-installer.html) inverted the
release-install no-flag default from "empty stack" to "demo stack" and renamed
two flags. The pre-CR-0013 flag set is preserved on a one-release-cycle
back-compat alias schedule:

| Pre-CR-0013 flag | CR-0013 replacement | Status |
|---|---|---|
| (no flag) | (no flag) | **Behaviour inverted.** Pre-CR-0013 brought up an empty stack; CR-0013 brings up the demo stack. To replicate the old empty-stack default, pass `-Empty` / `--empty`. |
| `-Fetcher` / `--fetcher` | `-RealGha` / `--real-gha` | Flag renamed. The fetcher service, the env-var contract, and the `$env:GHA_TOKEN` precondition are unchanged. The old flag name routes to the new behaviour for one release cycle. |
| `-Demo` / `--demo` | (no flag) | Behaviour folded into the default. Passing `-Demo` silently routes to the new demo default + logs one informational "demo is now the default; `-Demo` flag is redundant" line. The PostHog/Grafana public-repo upstream the pre-CR-0013 `-Demo` flag pointed at is no longer used — the new default polls the in-stack `demo-gha` container instead. |

The back-compat aliases (`-Fetcher`, `-Demo`) will be removed in the
release-after-next. Adopters pinning to a recent tag have one full release
cycle to switch to `-RealGha` / no-flag.

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
