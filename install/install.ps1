<#
.SYNOPSIS
    Install + start a released Deployment Dashboard stack on the current host.
    Image-only -- no git clone, no source tree, no .NET SDK required.
.DESCRIPTION
    Release-install primary entrypoint (Option A per GitHub issue #7).
    Per CR-0013 the no-flag default is the *demo stack* -- a self-contained
    stack with the baked `demo-gha` mock GitHub Actions upstream + fetcher
    pointing at it. Zero-PAT, zero external network, populated dashboard
    within ~60s. The companion contributor flow is `dev_env/start.ps1`,
    which depends on a cloned repo and bind-mounts the source tree for
    hot-reload / migration generation.

    CR-0014: bring-up logic extracted to install/_bringup-core.ps1 (dot-sourced
    below). dev_env/start.ps1 delegates to this script via subprocess per S3.

    Flag matrix (CR-0013):
      (no flag)            Demo stack -- demo-gha + fetcher pointing at
                           http://demo-gha:80; no GHA_TOKEN required.
      -RealGha             Real GitHub Actions upstream -- requires
                           $env:GHA_TOKEN. Renamed from `-Fetcher`; semantics
                           identical to the historical `-Fetcher` flag.
      -Empty               Bare-minimum stack -- db + api + gateway +
                           dashboard only; no fetcher, no demo-gha.
                           Direct-POST integrators only.
      -Demo                Back-compat alias for the no-flag default.
                           Silently routes + logs one INFO line. Drop the
                           flag from your install command after this
                           release cycle.
      -BuildLocally        Passed by dev_env/start.ps1 when delegating here.
                           No-op at helper boundary per S5; image-source
                           divergence is carried by docker compose -f overlay
                           per ADR-0010.

    What this script does, in order:
      1.  `GHA_TOKEN` precondition (issue #5 verbatim) -- fires only when
          `-RealGha` is set. The no-flag / `-Demo` / `-Empty` paths never
          touch real GitHub and do not require a PAT.
      2.  `gh` CLI precondition -- gh present on PATH, authenticated for github.com,
          and the active token carries the `read:packages` scope. All three failure
          modes exit 1 BEFORE any side effect (no install dir, no asset writes, no
          docker calls).
      3.  Ensures the install directory exists.
      4a. Volume-detection safety net (non-demo path only; demo path skips per S8).
          -ResetDemoDefaults drift guard on demo path.
      4b. Generates / preserves `API_TOKEN` + `POSTGRES_PASSWORD` via helper.
          Demo path: fixed literals per CR-0014 § 3c.
          Non-demo path: random per install; refuse dev-literals.
      4c. Persists secrets + demo defaults to `<InstallDir>/dashboard.env`.
      5+6. Downloads `docker-compose.release.yml` via `gh release download`.
      7.  `docker login ghcr.io` using `gh auth token`.
      8.  `docker compose pull`.
      9.  `docker compose up -d --wait --force-recreate`.
      10. Polls the gateway-fronted `/health`.
      11. Prints the URL panel.

    Per ADR-0009: the API self-migrates on start; the installer does not actuate migrations.

    Prerequisite -- gh CLI:
      The repo and GHCR component images are private. Install the GitHub CLI from
      https://cli.github.com/, then:
          gh auth login --hostname github.com
          gh auth refresh --hostname github.com --scopes read:packages
      The installer fails fast (exit 1) if gh is missing, not logged in to
      github.com, or the active token lacks `read:packages`.

    Upgrade flow (v0.3.0 -> v0.4.0 worked example):
      Pass `-InstallDir` pointing at the prior install dir to preserve the
      generated secrets + DB volume. The installer detects the pre-existing
      `dashboard.env`, reuses `API_TOKEN` + `POSTGRES_PASSWORD`, and only
      rewrites `DASHBOARD_VERSION` / `DASHBOARD_PORT`. Demo-mode defaults
      (GHA_REPOSITORIES, FETCHER_POLL_INTERVAL_SECONDS, GHA_API_BASE_URL,
      GHA_TOKEN) are preserved unless `-ResetDemoDefaults` is passed.

      If a stray `deployment-dashboard_pg-data` Docker volume is detected but
      no `dashboard.env` exists at `-InstallDir`, the installer red-errors
      and exits 1 BEFORE writing any state -- otherwise a fresh
      `POSTGRES_PASSWORD` would be generated against a DB seeded by the
      historical install, locking the api container out.

.PARAMETER Version
    Release tag to install (e.g. `v1.2.3`) or `latest`. The installer fetches the
    tag-pinned release assets via `gh release download` (the repo is private) and
    writes `DASHBOARD_VERSION=<tag>` into the env-file so the compose file resolves
    GHCR image refs to the same tag.
.PARAMETER RealGha
    Real GitHub Actions upstream. Activates the `fetcher` Compose profile (only --
    not `demo`) and requires `$env:GHA_TOKEN` to be non-empty; the script
    red-errors and exits 1 before any side effect when the token is missing.
    Renamed from `-Fetcher` per CR-0013; semantics are identical.
.PARAMETER Empty
    Bare-minimum stack -- db + api + gateway + dashboard only. No fetcher, no
    demo-gha, no mock-gha. For direct-POST integrators that thread deployment
    events into `POST /api/deployments` themselves.
.PARAMETER Demo
    Back-compat alias for the no-flag default. Silently routes to the demo stack
    bring-up + logs one informational line. Drop the flag from your install
    command after this release cycle (one-cycle deprecation per CR-0013).
.PARAMETER BuildLocally
    Passed by dev_env/start.ps1 when delegating here via subprocess (S3).
    No-op at helper boundary per CR-0014 S5 -- build-vs-pull divergence is
    carried entirely by docker compose -f overlay per ADR-0010.
.PARAMETER ResetDemoDefaults
    Force-overwrite the demo-mode keys (`GHA_REPOSITORIES`,
    `FETCHER_POLL_INTERVAL_SECONDS`, `GHA_API_BASE_URL`, `GHA_TOKEN`) even
    when a prior `dashboard.env` already contains them. Without this switch,
    an upgrade re-run on the demo path preserves whatever the operator
    customised. `GHA_TOKEN` additionally rotates when `$env:GHA_TOKEN` is set
    AND differs from the persisted value (caller is explicitly threading a
    new token through).

    Also force-overwrites demo credentials (`POSTGRES_PASSWORD`, `API_TOKEN`)
    with fixed demo literals per CR-0014 § 3c, and emits a yellow warning that
    the operator MUST run `uninstall -RemoveData` before the next bringup to
    drop the incompatible pg volume.
.PARAMETER Port
    Host port to publish the gateway on. Default 8080. Becomes `DASHBOARD_PORT` in
    the env-file; compose substitutes it into the `gateway` service's `ports:`.
.PARAMETER HealthTimeoutSeconds
    How long to wait for the gateway-fronted /health endpoint. Default 60. On
    failure, logs are dumped and the script exits 1.
.PARAMETER InstallDir
    Install directory. Created if absent. Defaults to `.dashboard-release` under
    the current user's profile directory (cross-platform: `$HOME` on POSIX,
    `%USERPROFILE%` on Windows). See the "Upgrade flow" sub-section above for
    upgrade-re-run semantics.

.EXAMPLE
    # No-flag default per CR-0013: brings up the demo stack with the baked
    # demo-gha mock GitHub upstream + fetcher pointing at it.
    pwsh -NoProfile -File install.ps1
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Version v1.2.3
.EXAMPLE
    # Real GitHub upstream -- requires $env:GHA_TOKEN. Renamed from -Fetcher.
    $env:GHA_TOKEN = '<PAT>'
    pwsh -NoProfile -File install.ps1 -RealGha
.EXAMPLE
    # Bare-minimum stack for direct-POST integrators.
    pwsh -NoProfile -File install.ps1 -Empty
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Port 9090 -InstallDir 'C:\dashboards\demo'
.EXAMPLE
    # v0.3.0 -> v0.4.0 upgrade: preserve the prior install dir + secrets + DB volume.
    pwsh -NoProfile -File install.ps1 -Version v0.4.0 -InstallDir 'C:\dashboards\prod'
.EXAMPLE
    # Demo re-run, force-refresh the demo defaults to the new installer's baked-in values.
    pwsh -NoProfile -File install.ps1 -ResetDemoDefaults
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [switch]$RealGha,
    [switch]$Empty,
    [switch]$Demo,
    [switch]$BuildLocally,
    [switch]$ResetDemoDefaults,
    [int]$Port = 8080,
    [int]$HealthTimeoutSeconds = 60,
    [string]$InstallDir = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dashboard-release')
)
$ErrorActionPreference = 'Stop'

# CR-0014: dot-source the shared helper (colocated under install/ per S1).
. (Join-Path $PSScriptRoot '_bringup-core.ps1')

# ---- 0. Resolve the install mode from the flag matrix (CR-0013) ----
# Mutually exclusive triple: $modeDemo (default), $modeRealGha, $modeEmpty.
# Exactly one is true after this block. The historical `-Demo` flag becomes
# a silent alias for the default with a one-line INFO log.
$conflict = @(@(
    [bool]$RealGha,
    [bool]$Empty,
    [bool]$Demo
) | Where-Object { $_ })
if ($conflict.Count -gt 1) {
    Write-Host "ERROR: -RealGha, -Empty, and -Demo are mutually exclusive. Pick at most one." -ForegroundColor Red
    exit 1
}

$modeRealGha = [bool]$RealGha
$modeEmpty   = [bool]$Empty
# Default = demo. -Demo (back-compat) also lands here.
$modeDemo    = -not ($modeRealGha -or $modeEmpty)

if ($Demo) {
    Write-Host "INFO: demo is now the default; -Demo flag is redundant -- drop it from your install command after this release cycle." -ForegroundColor Yellow
}

# ---- 1. GHA_TOKEN precondition (issue #5 verbatim, scoped to -RealGha) ----
if ($modeRealGha) {
    $tokenSet = -not [string]::IsNullOrWhiteSpace($env:GHA_TOKEN)
    if (-not $tokenSet) {
        Write-Host "ERROR: -RealGha requires `$env:GHA_TOKEN to be set. Set `$env:GHA_TOKEN = '<PAT>' or re-run with the no-flag default for a zero-PAT demo install against the baked demo-gha upstream." -ForegroundColor Red
        exit 1
    }
}

# ---- 2. gh CLI precondition ----
$ghAvailable = $false
try {
    & gh --version *> $null
    $ghAvailable = ($LASTEXITCODE -eq 0)
} catch {
    $ghAvailable = $false
}
if (-not $ghAvailable) {
    Write-Host "ERROR: gh CLI not found on PATH. The repo and GHCR images are private, so the installer needs gh to fetch release assets and authenticate to ghcr.io." -ForegroundColor Red
    Write-Host "       Install it from https://cli.github.com/ and then run:" -ForegroundColor Red
    Write-Host "         gh auth login --hostname github.com" -ForegroundColor Red
    Write-Host "         gh auth refresh --hostname github.com --scopes read:packages" -ForegroundColor Red
    exit 1
}

& gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: gh is not authenticated for github.com. Run:" -ForegroundColor Red
    Write-Host "         gh auth login --hostname github.com" -ForegroundColor Red
    Write-Host "         gh auth refresh --hostname github.com --scopes read:packages" -ForegroundColor Red
    exit 1
}

$ghScopeOutput = (& gh auth status --hostname github.com --show-token 2>&1 | Out-String)
if ($ghScopeOutput -notmatch '(read|write|admin):packages') {
    Write-Host "ERROR: gh token for github.com lacks GHCR read access. Need one of: 'read:packages', 'write:packages', or 'admin:packages'. Run:" -ForegroundColor Red
    Write-Host "         gh auth refresh --hostname github.com --scopes read:packages" -ForegroundColor Red
    exit 1
}

# ---- 3. Install dir ----
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}
$InstallDir = (Resolve-Path $InstallDir).Path
Write-Host "==> Install directory: $InstallDir" -ForegroundColor Cyan

# ---- 4a. Volume-detection safety net + -ResetDemoDefaults drift guard ----
$envFile = Join-Path $InstallDir 'dashboard.env'

if ($modeDemo) {
    # Demo path: skip Test-PgVolumeConflict per S8 (fixed credentials make collision impossible).
    # -ResetDemoDefaults drift guard per CR-0014 § 3c + OI-4:
    # Three-condition trigger: (a) demo re-run + (b) persisted PG password != demo literal +
    # (c) pg volume exists.
    & docker volume inspect deployment-dashboard_pg-data *> $null
    $volumeExists = ($LASTEXITCODE -eq 0)
    if ($volumeExists) {
        $persistedPg = ''
        if (Test-Path -LiteralPath $envFile) {
            $persistedPg = _dd-read-env-value -Path $envFile -Key 'POSTGRES_PASSWORD'
        }
        $pgDrifted = (-not [string]::IsNullOrWhiteSpace($persistedPg) -and $persistedPg -ne 'local-dev-password')
        if ($pgDrifted -and -not $ResetDemoDefaults) {
            Write-Host "ERROR: Demo re-run detected with a pg volume initialised under different credentials (POSTGRES_PASSWORD in $envFile is not 'local-dev-password')." -ForegroundColor Red
            Write-Host "" -ForegroundColor Red
            Write-Host "Remediation paths:" -ForegroundColor Red
            Write-Host "  1. Re-run with -ResetDemoDefaults (force-overwrites dashboard.env with demo literals, then run uninstall -RemoveData before next bringup)." -ForegroundColor Red
            Write-Host "  2. Run uninstall.ps1 -RemoveData then re-run install.ps1 (clean slate)." -ForegroundColor Red
            Write-Host "  3. Manually edit $envFile and set POSTGRES_PASSWORD=local-dev-password (only if you know the cluster was seeded with that password)." -ForegroundColor Red
            exit 1
        }
        if ($pgDrifted -and $ResetDemoDefaults) {
            Write-Host "WARNING: -ResetDemoDefaults set. Overwriting dashboard.env with demo credentials." -ForegroundColor Yellow
            Write-Host "WARNING: You MUST run 'uninstall.ps1 -RemoveData' before the next bringup to drop the incompatible pg volume." -ForegroundColor Yellow
        }
    }
} else {
    # Non-demo path: run the volume conflict guard per S8.
    Test-PgVolumeConflict -VolumeName 'deployment-dashboard_pg-data' -EnvFilePath $envFile -InstallDir $InstallDir
}

# ---- 4b. Secret handling via helper ----
$secrets = Resolve-DashboardSecrets -EnvFilePath $envFile -ModeDemo $modeDemo -ResetDemoDefaults ([bool]$ResetDemoDefaults)
$apiToken   = $secrets.ApiToken
$pgPassword = $secrets.PgPassword

# ---- 4c. Persist env-file ----
$demoLines = @()
if ($modeDemo) {
    $demoLines = Resolve-DemoEnvDefaults -EnvFilePath $envFile -ResetDemoDefaults ([bool]$ResetDemoDefaults)
}
Write-DashboardEnvFile -EnvFilePath $envFile -Version $Version -Port $Port -ApiToken $apiToken -PgPassword $pgPassword -DemoLines $demoLines
Write-Host "==> Wrote $envFile" -ForegroundColor Cyan

# ---- 5 + 6. Download release assets via gh ----
$repo = 'kostiantyn-matsebora/deployment-dashboard'

function Invoke-AssetDownload {
    param([string]$AssetName, [string]$DestPath)
    Write-Host "==> gh release download ($Version) $AssetName -> $DestPath" -ForegroundColor Cyan
    if ($Version -eq 'latest') {
        & gh release download --repo $repo --pattern $AssetName --output $DestPath --clobber
    } else {
        & gh release download $Version --repo $repo --pattern $AssetName --output $DestPath --clobber
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: failed to download $AssetName from release '$Version' via gh release download (exit $LASTEXITCODE)." -ForegroundColor Red
        Write-Host "       Confirm that release '$Version' exists and advertises a '$AssetName' asset, and that the active gh account can read this repo." -ForegroundColor Red
        exit 1
    }
}

$composeFile = Join-Path $InstallDir 'docker-compose.release.yml'
Invoke-AssetDownload -AssetName 'docker-compose.release.yml' -DestPath $composeFile

# ---- 7. GHCR docker login ----
$ghLogin = (& gh api user --jq .login 2>$null)
if ([string]::IsNullOrWhiteSpace($ghLogin)) { $ghLogin = 'oauth2' }
$ghToken = & gh auth token
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ghToken)) {
    Write-Host "ERROR: docker login ghcr.io failed -- could not obtain a token from gh auth token (exit $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}
Write-Host "==> docker login ghcr.io --username $ghLogin --password-stdin" -ForegroundColor Cyan
$ghToken | & docker login ghcr.io --username $ghLogin --password-stdin
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker login ghcr.io failed (exit $LASTEXITCODE). Verify the gh account has 'read:packages' and access to the deployment-dashboard packages." -ForegroundColor Red
    exit 1
}

# ---- 8. Build compose args via helper + pull images ----
$composeArgs = Resolve-ComposeArgs `
    -ModeDemo $modeDemo -ModeRealGha $modeRealGha -ModeEmpty $modeEmpty `
    -BuildLocally ([bool]$BuildLocally) `
    -ComposeFile $composeFile -EnvFile $envFile

Write-Host "==> docker compose $($composeArgs -join ' ') pull" -ForegroundColor Cyan
& docker compose @composeArgs pull
if ($LASTEXITCODE -ne 0) { throw "docker compose pull failed with exit code $LASTEXITCODE" }

# ---- 9. Bring up ----
Write-Host "==> All services will be recreated (--force-recreate ensures GHCR digest changes are picked up)." -ForegroundColor Cyan
Write-Host "==> docker compose $($composeArgs -join ' ') up -d --wait --force-recreate" -ForegroundColor Cyan
& docker compose @composeArgs up -d --wait --force-recreate
if ($LASTEXITCODE -ne 0) {
    & docker compose @composeArgs logs --tail=50
    throw "docker compose up --force-recreate failed with exit code $LASTEXITCODE"
}

# ---- 10. Health-poll via helper ----
$healthUrl = "http://localhost:$Port/health"
Wait-DashboardHealth -HealthUrl $healthUrl -TimeoutSeconds $HealthTimeoutSeconds -ComposeArgs $composeArgs

# ---- 11. URL panel via helper ----
Write-DashboardUrlPanel -Port $Port -ApiToken $apiToken -EnvFile $envFile `
    -ModeDemo $modeDemo -ModeRealGha $modeRealGha -ModeEmpty $modeEmpty
