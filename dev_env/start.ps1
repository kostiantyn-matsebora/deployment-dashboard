<#
.SYNOPSIS
    Bring up the Deployment Dashboard local-dev stack.
.DESCRIPTION
    Thin docker compose wrapper for contributor flow. Always builds images locally
    from source. Flag surface mirrors install.ps1 1-for-1 per issue #72 ASR-C.

    Default (no flags): demo mode -- demo-gha + demo-driver + fetcher + bundled
    Postgres. Equivalent to install.ps1 -Demo for the contributor flow.

.PARAMETER Scaled
    Use docker-compose.scaled.yml (3 Read API + 2 Write API replicas). NFR-05
    validation only. Standalone -- does NOT layer on release + local overlays.
.PARAMETER LocalDb
    Start the bundled Postgres container (--profile db). App-only; no fetcher.
    Use when you want to test against a local DB without the demo upstream.
.PARAMETER RealGha
    Real GitHub Actions upstream. Activates --profile fetcher. Requires
    $env:GHA_TOKEN. Uses bundled Postgres (--profile db) automatically so
    the contributor stack is self-contained.
.PARAMETER Demo
    Demo mode (default when no flag is set). Activates bundled Postgres +
    fetcher + demo-gha mock upstream + demo-driver sidecar. Zero-PAT, offline.
.PARAMETER Integration
    Integration test mode (CR-0012). Adds dev_env/docker-compose.integration.yml
    to the compose chain, which brings up mock-gha (JVM WireMock) with the base
    GHA mapping fixture mounted and host port 18080 published for dotnet test.
    Activates --profile db + --profile fetcher. Mutually exclusive with -Scaled.
.PARAMETER AllowMissingGhaToken
    Escape hatch for -RealGha: skip the GHA_TOKEN precondition and boot with the
    placeholder token. Fetcher boots but GitHub API calls will 401.
.PARAMETER HealthTimeoutSeconds
    How long to wait for /health (default: 60). Use 120+ on first cold build.
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -LocalDb
.EXAMPLE
    $env:GHA_TOKEN = '<PAT>'; pwsh -NoProfile -File dev_env/start.ps1 -RealGha
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Integration
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Scaled
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Scaled,
    [switch]$LocalDb,
    [switch]$RealGha,
    [switch]$Demo,
    [switch]$Integration,
    [switch]$AllowMissingGhaToken,
    [int]$HealthTimeoutSeconds = 60
)
$ErrorActionPreference = 'Stop'

$releaseCompose     = Join-Path $PSScriptRoot '..' 'install' 'docker-compose.release.yml'
$demoCompose        = Join-Path $PSScriptRoot '..' 'install' 'docker-compose.demo.yml'
$localCompose       = Join-Path $PSScriptRoot 'docker-compose.local.yml'
$demoLocalCompose   = Join-Path $PSScriptRoot 'docker-compose.demo-local.yml'
$integrationCompose = Join-Path $PSScriptRoot 'docker-compose.integration.yml'
$scaledCompose      = Join-Path $PSScriptRoot 'docker-compose.scaled.yml'

# ---- Mutual-exclusion guard ----
if ($Scaled -and $Integration) {
    Write-Host "ERROR: -Scaled and -Integration are mutually exclusive." -ForegroundColor Red; exit 1
}
if ($Scaled -and ($LocalDb -or $RealGha -or $Demo -or $Integration)) {
    Write-Host "ERROR: -Scaled is standalone and cannot be combined with other mode flags." -ForegroundColor Red; exit 1
}
if ($Demo -and $RealGha) {
    Write-Host "ERROR: -Demo and -RealGha are mutually exclusive." -ForegroundColor Red; exit 1
}
if ($Demo -and $LocalDb) {
    Write-Host "ERROR: -Demo and -LocalDb are mutually exclusive. -Demo already activates the bundled Postgres." -ForegroundColor Red; exit 1
}
if ($Integration -and ($Demo -or $RealGha)) {
    Write-Host "ERROR: -Integration cannot be combined with -Demo or -RealGha." -ForegroundColor Red; exit 1
}

# ---- Scaled path (standalone) ----
if ($Scaled) {
    & docker compose -f $scaledCompose up -d --build --wait
    exit $LASTEXITCODE
}

# ---- RealGha GHA_TOKEN precondition ----
if ($RealGha -and -not $AllowMissingGhaToken) {
    if ([string]::IsNullOrWhiteSpace($env:GHA_TOKEN)) {
        Write-Host "ERROR: -RealGha requires `$env:GHA_TOKEN to be set. Set `$env:GHA_TOKEN = '<PAT>' or pass -AllowMissingGhaToken to skip this check (fetcher will boot with placeholder token and GitHub API calls will 401)." -ForegroundColor Red
        exit 1
    }
}
if ($RealGha -and $AllowMissingGhaToken -and [string]::IsNullOrWhiteSpace($env:GHA_TOKEN)) {
    Write-Host "NOTICE: GHA_TOKEN not set -- fetcher booting with placeholder token; GitHub API calls will 401." -ForegroundColor Yellow
}

# ---- Resolve mode defaults ----
# Default (no explicit mode flag) = Demo.
$hasLocalDb     = [bool]$LocalDb
$hasRealGha     = [bool]$RealGha
$hasIntegration = [bool]$Integration
# Demo is the default when no other mode flag is set.
$hasDemo        = [bool]$Demo -or (-not $hasLocalDb -and -not $hasRealGha -and -not $hasIntegration)

# ---- Integration mode ----
if ($hasIntegration) {
    $env:GHA_API_BASE_URL              = 'http://mock-gha:80'
    $env:FETCHER_POLL_INTERVAL_SECONDS = '1'
    if (-not $env:GHA_REPOSITORIES) { $env:GHA_REPOSITORIES = '[{"owner":"integration-test-org","repo":"integration-test-repo"}]' }
    if (-not $env:GHA_TOKEN)        { $env:GHA_TOKEN        = 'integration-test-placeholder-mock-gha-ignores-this' }
    if (-not $env:ConnectionStrings__DefaultConnection) {
        $env:ConnectionStrings__DefaultConnection = 'Host=db;Database=dashboard;Username=dashboard;Password=local-dev-password'
    }
    & docker compose `
        -f $releaseCompose `
        -f $localCompose `
        -f $integrationCompose `
        --profile db --profile fetcher `
        up -d --build --wait
    exit $LASTEXITCODE
}

# ---- Demo mode (default) ----
if ($hasDemo) {
    if (-not $env:ConnectionStrings__DefaultConnection) {
        $env:ConnectionStrings__DefaultConnection = 'Host=db;Database=dashboard;Username=dashboard;Password=local-dev-password'
    }
    & docker compose `
        -f $releaseCompose `
        -f $demoCompose `
        -f $localCompose `
        -f $demoLocalCompose `
        --profile db --profile fetcher `
        up -d --build --wait
    exit $LASTEXITCODE
}

# ---- LocalDb mode ----
if ($hasLocalDb -and -not $hasRealGha) {
    if (-not $env:ConnectionStrings__DefaultConnection) {
        $env:ConnectionStrings__DefaultConnection = 'Host=db;Database=dashboard;Username=dashboard;Password=local-dev-password'
    }
    & docker compose `
        -f $releaseCompose `
        -f $localCompose `
        --profile db `
        up -d --build --wait
    exit $LASTEXITCODE
}

# ---- RealGha mode (+ optional LocalDb) ----
if ($hasRealGha) {
    if ($hasLocalDb) {
        if (-not $env:ConnectionStrings__DefaultConnection) {
            $env:ConnectionStrings__DefaultConnection = 'Host=db;Database=dashboard;Username=dashboard;Password=local-dev-password'
        }
        & docker compose `
            -f $releaseCompose `
            -f $localCompose `
            --profile db --profile fetcher `
            up -d --build --wait
    } else {
        & docker compose `
            -f $releaseCompose `
            -f $localCompose `
            --profile fetcher `
            up -d --build --wait
    }
    exit $LASTEXITCODE
}
