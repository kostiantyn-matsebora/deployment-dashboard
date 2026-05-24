<#
.SYNOPSIS
    Install + start a released Deployment Dashboard stack on the current host.
    Image-only -- no git clone, no source tree, no .NET SDK required.
.DESCRIPTION
    Release-install primary entrypoint. Per issue #72, the release stack no longer
    bundles Postgres by default -- the default install path assumes an external
    Postgres endpoint supplied via ConnectionStrings__DefaultConnection in the
    environment or dashboard.env.

    Flag matrix (issue #72):
      (no flag)            App-only -- api + gateway + dashboard. No db container,
                           no fetcher. Requires ConnectionStrings__DefaultConnection
                           to be set in the environment or dashboard.env. Use when
                           you supply your own Postgres (Azure Postgres Flexible,
                           existing cluster, etc.).
      -LocalDb             App + bundled Postgres (`--profile db`). Sets the
                           connection string automatically. Use for quick local
                           evals without an external DB.
      -RealGha             Real GitHub Actions upstream + fetcher (`--profile fetcher`).
                           Requires $env:GHA_TOKEN. Uses external Postgres
                           (ConnectionStrings__DefaultConnection must be set, or
                           combine with -LocalDb). Note: -RealGha alone activates
                           only the `fetcher` profile; for a self-contained single
                           host bring-up, pass -RealGha AND supply -LocalDb OR set
                           ConnectionStrings__DefaultConnection externally.
      -Demo                Demo stack -- app + bundled Postgres + demo-gha mock +
                           fetcher pointing at it. Activates `--profile db` +
                           `--profile fetcher` plus the docker-compose.demo.yml
                           overlay which adds the demo-gha + demo-driver services.
                           Zero-PAT, offline, populated dashboard within ~60s.

    ConnectionStrings__DefaultConnection precondition (ASR-D):
      When neither -LocalDb nor -Demo is set, the installer fails fast (exit 1)
      before any docker compose up if ConnectionStrings__DefaultConnection is
      not present in the environment or in an existing dashboard.env at -InstallDir.
      Resolution paths:
        1. Pass -LocalDb to start the bundled Postgres container.
        2. Pass -Demo for the full self-contained demo stack.
        3. Set ConnectionStrings__DefaultConnection in the environment before
           running install.ps1 (points at your own Postgres).

    What this script does, in order:
      1.  -RealGha GHA_TOKEN precondition (fires only when -RealGha is set).
      2.  ASR-D ConnectionStrings__DefaultConnection precondition (fires when
          neither -LocalDb nor -Demo is set and the connection string is absent).
      3.  gh CLI precondition -- present on PATH, authenticated, read:packages scope.
      4.  Ensures the install directory exists.
      5.  Downloads docker-compose.release.yml (+ docker-compose.demo.yml when
          -Demo) via gh release download.
      6.  docker login ghcr.io via gh auth token.
      7.  docker compose pull.
      8.  docker compose up -d --wait --force-recreate.
      9.  Polls the gateway-fronted /health.
      10. Prints the URL panel.

    Per ADR-0009: the API self-migrates on start; the installer does not actuate migrations.

    Prerequisite -- gh CLI:
      The repo and GHCR component images are private.
          gh auth login --hostname github.com
          gh auth refresh --hostname github.com --scopes read:packages

.PARAMETER Version
    Release tag (e.g. v1.2.3) or latest. Written into DASHBOARD_VERSION so the
    release compose resolves GHCR image refs to the same tag.
.PARAMETER LocalDb
    Start the bundled Postgres container (`--profile db`). The installer sets
    ConnectionStrings__DefaultConnection automatically to point at the bundled db.
.PARAMETER RealGha
    Real GitHub Actions upstream. Activates `--profile fetcher`. Requires
    $env:GHA_TOKEN. External Postgres required unless also passing -LocalDb or
    ConnectionStrings__DefaultConnection is set in the environment.
.PARAMETER Demo
    Full demo stack. Activates --profile db + --profile fetcher and layers
    docker-compose.demo.yml, which adds demo-gha + demo-driver services and
    injects demo-mode env overrides. Zero-PAT, self-contained, offline.
.PARAMETER Port
    Host port for the gateway. Default 8080.
.PARAMETER HealthTimeoutSeconds
    How long to wait for /health. Default 60. Fails + dumps logs on timeout.
.PARAMETER InstallDir
    Install directory. Created if absent. Defaults to .dashboard-release in the
    current user profile directory.

.EXAMPLE
    pwsh -NoProfile -File install.ps1 -LocalDb
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Demo
.EXAMPLE
    $env:GHA_TOKEN = '<PAT>'; $env:ConnectionStrings__DefaultConnection = 'Host=...'; pwsh -NoProfile -File install.ps1 -RealGha
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Version v1.2.3 -LocalDb
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Port 9090 -InstallDir C:\dashboards\prod -LocalDb
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [switch]$LocalDb,
    [switch]$RealGha,
    [switch]$Demo,
    [int]$Port = 8080,
    [int]$HealthTimeoutSeconds = 60,
    [string]$InstallDir = (Join-Path $HOME '.dashboard-release')
)
$ErrorActionPreference = 'Stop'

# ---- 0. Mutual-exclusion guard ----
$modeFlagCount = @([bool]$LocalDb, [bool]$RealGha, [bool]$Demo) | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count
# -Demo + -LocalDb are mutually exclusive (demo already bundles db).
# -Demo + -RealGha are mutually exclusive (demo uses mock upstream, not real GHA).
# -LocalDb + -RealGha can be combined (real GHA + bundled db); not blocked.
$hasDemo    = [bool]$Demo
$hasRealGha = [bool]$RealGha
$hasLocalDb = [bool]$LocalDb

if ($hasDemo -and $hasRealGha) {
    Write-Host "ERROR: -Demo and -RealGha are mutually exclusive. -Demo boots a self-contained mock upstream; -RealGha points the fetcher at the real GitHub API. Pick one." -ForegroundColor Red
    exit 1
}
if ($hasDemo -and $hasLocalDb) {
    Write-Host "ERROR: -Demo and -LocalDb are mutually exclusive. -Demo already activates the bundled Postgres via --profile db; adding -LocalDb is redundant and signals a misconfiguration." -ForegroundColor Red
    exit 1
}

# ---- 1. -RealGha GHA_TOKEN precondition ----
if ($hasRealGha) {
    if ([string]::IsNullOrWhiteSpace($env:GHA_TOKEN)) {
        Write-Host "ERROR: -RealGha requires `$env:GHA_TOKEN to be set to a valid GitHub PAT. The fetcher uses this token to authenticate against the GitHub Actions API (5000 req/h). Set `$env:GHA_TOKEN = '<PAT>' and re-run." -ForegroundColor Red
        exit 1
    }
}

# ---- 2. ASR-D: ConnectionStrings__DefaultConnection precondition ----
# Fires when neither -LocalDb nor -Demo is active (i.e. the stack will not
# start a bundled Postgres) AND the connection string is absent from the
# environment or an existing dashboard.env.
$needsExternalPostgres = (-not $hasLocalDb -and -not $hasDemo)
if ($needsExternalPostgres) {
    $connStrFromEnv = $env:ConnectionStrings__DefaultConnection
    # Also probe an existing dashboard.env at the resolved install dir.
    $envFileProbe = Join-Path $InstallDir 'dashboard.env'
    $connStrFromFile = $null
    if (Test-Path -LiteralPath $envFileProbe) {
        $line = Select-String -Path $envFileProbe -Pattern '^ConnectionStrings__DefaultConnection=' | Select-Object -First 1
        if ($line) {
            $connStrFromFile = $line.ToString().Split('=', 2)[1].Trim()
        }
    }
    if ([string]::IsNullOrWhiteSpace($connStrFromEnv) -and [string]::IsNullOrWhiteSpace($connStrFromFile)) {
        Write-Host "ERROR: ConnectionStrings__DefaultConnection is not set. The default install path (no -LocalDb, no -Demo) expects an external Postgres endpoint." -ForegroundColor Red
        Write-Host "" -ForegroundColor Red
        Write-Host "Resolution paths:" -ForegroundColor Red
        Write-Host "  1. Pass -LocalDb to start the bundled Postgres container (quick local eval)." -ForegroundColor Red
        Write-Host "  2. Pass -Demo for the full self-contained demo stack (offline, zero-PAT)." -ForegroundColor Red
        Write-Host "  3. Set the connection string before running install.ps1:" -ForegroundColor Red
        Write-Host "     `$env:ConnectionStrings__DefaultConnection = 'Host=<host>;Database=dashboard;Username=<user>;Password=<password>'" -ForegroundColor Red
        exit 1
    }
}

# ---- 3. gh CLI precondition ----
$ghAvailable = $false
try {
    $null = & gh --version 2>&1
    $ghAvailable = ($LASTEXITCODE -eq 0)
} catch [System.Management.Automation.CommandNotFoundException] {
    $ghAvailable = $false
}
if (-not $ghAvailable) {
    Write-Host "ERROR: 'gh' CLI not found on PATH. Install via 'winget install GitHub.cli' (Windows) / 'brew install gh' (macOS) / 'apt install gh' or 'dnf install gh' (Linux), then re-run." -ForegroundColor Red
    exit 1
}

$null = & gh auth status --hostname github.com 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: gh is not authenticated for github.com. Run 'gh auth login' and retry." -ForegroundColor Red
    exit 1
}

$ghScopeOutput = (& gh auth status --hostname github.com --show-token 2>&1 | Out-String)
if ($ghScopeOutput -notmatch '(read|write|admin):packages') {
    Write-Host "ERROR: gh token for github.com lacks GHCR read access. Need one of: 'read:packages', 'write:packages', or 'admin:packages'. Run 'gh auth refresh --hostname github.com --scopes read:packages' and retry." -ForegroundColor Red
    exit 1
}

# ---- 4. Install dir ----
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}
$InstallDir = (Resolve-Path $InstallDir).Path
Write-Host "==> Install directory: $InstallDir" -ForegroundColor Cyan
$envFile = Join-Path $InstallDir 'dashboard.env'

# ---- 5. Download release assets ----
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
        Write-Host "ERROR: failed to download $AssetName from release '$Version' (exit $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
}

$releaseCompose = Join-Path $InstallDir 'docker-compose.release.yml'
$demoCompose    = Join-Path $InstallDir 'docker-compose.demo.yml'
Invoke-AssetDownload -AssetName 'docker-compose.release.yml' -DestPath $releaseCompose
if ($hasDemo) {
    Invoke-AssetDownload -AssetName 'docker-compose.demo.yml' -DestPath $demoCompose
}

# ---- 6. GHCR docker login ----
$ghLogin = (& gh api user --jq .login 2>$null)
if ([string]::IsNullOrWhiteSpace($ghLogin)) { $ghLogin = 'oauth2' }
$ghToken = & gh auth token
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ghToken)) {
    Write-Host "ERROR: docker login ghcr.io failed -- could not obtain a token from gh auth token." -ForegroundColor Red
    exit 1
}
Write-Host "==> docker login ghcr.io --username $ghLogin --password-stdin" -ForegroundColor Cyan
$ghToken | & docker login ghcr.io --username $ghLogin --password-stdin
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker login ghcr.io failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}

# ---- 7. Write env vars to environment for compose substitution ----
if ($Version -ne 'latest') { $env:DASHBOARD_VERSION = $Version }
if ($Port -ne 8080)        { $env:DASHBOARD_PORT    = "$Port" }

# -LocalDb: set connection string env var so compose resolves it
if ($hasLocalDb -and [string]::IsNullOrWhiteSpace($env:ConnectionStrings__DefaultConnection)) {
    $pgPw = $env:POSTGRES_PASSWORD
    if ([string]::IsNullOrWhiteSpace($pgPw)) {
        Write-Host "INFO: POSTGRES_PASSWORD not set; defaulting to 'local-dev-password' for bundled db." -ForegroundColor Yellow
        $pgPw = 'local-dev-password'
        $env:POSTGRES_PASSWORD = $pgPw
    }
    $env:ConnectionStrings__DefaultConnection = "Host=db;Database=dashboard;Username=dashboard;Password=$pgPw"
}

# ---- 8. Build compose args ----
$composeArgs = @('-f', $releaseCompose)
if ($hasDemo) {
    $composeArgs += @('-f', $demoCompose)
}
if ($envFile -and (Test-Path -LiteralPath $envFile)) {
    $composeArgs += @('--env-file', $envFile)
}

if ($hasDemo) {
    $composeArgs += @('--profile', 'db', '--profile', 'fetcher')
} elseif ($hasLocalDb -and $hasRealGha) {
    $composeArgs += @('--profile', 'db', '--profile', 'fetcher')
} elseif ($hasLocalDb) {
    $composeArgs += @('--profile', 'db')
} elseif ($hasRealGha) {
    $composeArgs += @('--profile', 'fetcher')
}
# Default (no flag): no profiles -- app-only, external Postgres.

# ---- 9. Pull images ----
Write-Host "==> docker compose $($composeArgs -join ' ') pull" -ForegroundColor Cyan
& docker compose @composeArgs pull
if ($LASTEXITCODE -ne 0) {
    throw "docker compose pull failed with exit code $LASTEXITCODE"
}

# ---- 10. Bring up ----
Write-Host "==> docker compose $($composeArgs -join ' ') up -d --wait --force-recreate" -ForegroundColor Cyan
& docker compose @composeArgs up -d --wait --force-recreate
if ($LASTEXITCODE -ne 0) {
    & docker compose @composeArgs logs --tail=50
    throw "docker compose up --force-recreate failed with exit code $LASTEXITCODE"
}

# ---- 11. Health-poll ----
$healthUrl = "http://localhost:$Port/health"
Write-Host "==> Waiting up to $HealthTimeoutSeconds s for $healthUrl" -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        if ((Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) {
            $ok = $true; break
        }
    } catch { }
    Start-Sleep -Seconds 2
}
if (-not $ok) {
    & docker compose @composeArgs logs --tail=50
    throw "/health did not return 200 at $healthUrl within $HealthTimeoutSeconds s."
}

# ---- 12. URL panel ----
Write-Host ""
Write-Host "  Dashboard: http://localhost:$Port/"
if ($hasDemo) {
    Write-Host "  Mode: Demo (self-contained mock upstream, offline, zero-PAT)"
} elseif ($hasRealGha) {
    Write-Host "  Mode: RealGha (fetcher points at https://api.github.com)"
} elseif ($hasLocalDb) {
    Write-Host "  Mode: LocalDb (bundled Postgres, external fetcher path)"
} else {
    Write-Host "  Mode: App-only (external Postgres, no fetcher)"
}
Write-Host ""
