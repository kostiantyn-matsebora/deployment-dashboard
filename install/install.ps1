<#
.SYNOPSIS
    Install + start a released Deployment Dashboard stack on the current host.
.DESCRIPTION
    Thin docker compose wrapper for the release-install flow. Brings up the
    demo stack (demo-gha + fetcher) -- zero-PAT, offline, populated dashboard
    within ~60s.

.PARAMETER Version
    Release tag to install (e.g. v1.2.3) or latest (default). Written into
    DASHBOARD_VERSION so the release compose resolves GHCR image refs to the
    same tag.
.PARAMETER Port
    Host port for the gateway. Default 8080. Written into DASHBOARD_PORT.
.EXAMPLE
    pwsh -NoProfile -File install.ps1
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Version v1.2.3
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Port 9090
#>
#Requires -Version 7.0
param(
    [string]$Version = 'latest',
    [int]$Port = 8080
)
$ErrorActionPreference = 'Stop'

$releaseCompose = Join-Path $PSScriptRoot 'docker-compose.release.yml'
$demoCompose    = Join-Path $PSScriptRoot 'docker-compose.demo.yml'

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

& docker compose -f $releaseCompose -f $demoCompose --profile demo --profile fetcher up -d --wait --force-recreate
exit $LASTEXITCODE
