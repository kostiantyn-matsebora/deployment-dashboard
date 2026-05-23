<#
.SYNOPSIS
    Install + start a released Deployment Dashboard stack on the current host.
.DESCRIPTION
    Thin docker compose wrapper for the release-install flow. Same shape as
    dev_env/start.ps1 -- the only differences are: uses the release compose
    (no build), layers docker-compose.demo.yml for the default demo mode, and
    authenticates to GHCR before pulling images.

    Default (no flags): demo stack -- demo-gha + fetcher, zero-PAT, offline.

.PARAMETER Version
    Release tag to install (e.g. v1.2.3) or latest (default). Written into
    DASHBOARD_VERSION so the release compose resolves GHCR image refs to the
    same tag.
.PARAMETER RealGha
    Real GitHub Actions upstream. Requires $env:GHA_TOKEN.
.PARAMETER Empty
    Bare-minimum stack -- db + api + gateway + dashboard only. No fetcher,
    no demo-gha. For direct-POST integrators.
.PARAMETER Port
    Host port for the gateway. Default 8080. Written into DASHBOARD_PORT.
.EXAMPLE
    pwsh -NoProfile -File install.ps1
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Version v1.2.3
.EXAMPLE
    $env:GHA_TOKEN = '<PAT>'; pwsh -NoProfile -File install.ps1 -RealGha
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Empty
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Port 9090
#>
#Requires -Version 7.0
param(
    [string]$Version = 'latest',
    [switch]$RealGha,
    [switch]$Empty,
    [int]$Port = 8080
)
$ErrorActionPreference = 'Stop'

$releaseCompose = Join-Path $PSScriptRoot 'docker-compose.release.yml'
$demoCompose    = Join-Path $PSScriptRoot 'docker-compose.demo.yml'

if ($RealGha -and $Empty) {
    Write-Host "ERROR: -RealGha and -Empty are mutually exclusive." -ForegroundColor Red; exit 1
}

if ($RealGha -and [string]::IsNullOrWhiteSpace($env:GHA_TOKEN)) {
    Write-Host "ERROR: -RealGha requires `$env:GHA_TOKEN to be set." -ForegroundColor Red; exit 1
}

# GHCR login -- images are private.
$ghToken = (& gh auth token 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ghToken)) {
    Write-Host "ERROR: gh not authenticated. Run:" -ForegroundColor Red
    Write-Host "  gh auth login --hostname github.com" -ForegroundColor Red
    Write-Host "  gh auth refresh --hostname github.com --scopes read:packages" -ForegroundColor Red
    exit 1
}
$ghToken | & docker login ghcr.io --username oauth2 --password-stdin
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Seed compose substitution vars when non-default.
if ($Version -ne 'latest') { $env:DASHBOARD_VERSION = $Version }
if ($Port -ne 8080)        { $env:DASHBOARD_PORT    = "$Port" }

if ($Empty) {
    & docker compose -f $releaseCompose up -d --wait --force-recreate
    exit $LASTEXITCODE
}

if ($RealGha) {
    & docker compose -f $releaseCompose --profile fetcher up -d --wait --force-recreate
    exit $LASTEXITCODE
}

& docker compose -f $releaseCompose -f $demoCompose --profile demo --profile fetcher up -d --wait --force-recreate
exit $LASTEXITCODE
