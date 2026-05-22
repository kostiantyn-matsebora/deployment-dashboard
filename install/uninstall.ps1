<#
.SYNOPSIS
    Tear down a release-installed Deployment Dashboard stack.
.DESCRIPTION
    Companion to install.ps1. Runs `docker compose down` against
    `<InstallDir>/docker-compose.release.yml` using the same env-file the
    installer wrote, so service names + image refs resolve identically.

    Default behaviour preserves the named `pg-data` volume and
    `<InstallDir>/dashboard.env` -- a subsequent `install.ps1` reuses the
    persisted `API_TOKEN` + `POSTGRES_PASSWORD`. Pass `-RemoveData` to
    drop the volume; pass `-RemoveSecrets` to delete `dashboard.env`.

    `-RemoveData` is irreversible -- the database is gone.
.PARAMETER InstallDir
    Install directory previously passed to install.ps1. Defaults to
    `./dashboard-release`.
.PARAMETER RemoveData
    Append `-v` to `docker compose down` -- removes the `pg-data` named volume.
    IRREVERSIBLE.
.PARAMETER RemoveSecrets
    Additionally delete `<InstallDir>/dashboard.env`. Without this, a subsequent
    install reuses the persisted secrets.
.EXAMPLE
    pwsh -NoProfile -File uninstall.ps1
.EXAMPLE
    pwsh -NoProfile -File uninstall.ps1 -RemoveData -RemoveSecrets
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $PWD 'dashboard-release'),
    [switch]$RemoveData,
    [switch]$RemoveSecrets
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $InstallDir)) {
    Write-Host "ERROR: no install found at $InstallDir (directory does not exist)." -ForegroundColor Red
    exit 1
}
$InstallDir = (Resolve-Path $InstallDir).Path

$composeFile = Join-Path $InstallDir 'docker-compose.release.yml'
$envFile = Join-Path $InstallDir 'dashboard.env'

if (-not (Test-Path $composeFile)) {
    Write-Host "ERROR: no install found at $InstallDir (missing docker-compose.release.yml)." -ForegroundColor Red
    exit 1
}

$composeArgs = @('-f', $composeFile)
if (Test-Path $envFile) { $composeArgs += @('--env-file', $envFile) }
# Include every profile-gated service so any active container is also torn
# down regardless of which install mode brought it up:
#   fetcher     -- CR-0009 pull-mode worker (no-flag default + -RealGha)
#   demo        -- CR-0013 demo-gha mock GitHub upstream (no-flag default)
#   integration -- CR-0012 mock-gha (dev-time test runner; not normally
#                  reachable from a release-install host, but defensive
#                  inclusion is cheap and keeps `down` exhaustive).
# Migrations apply in-process inside the api container (ADR-0009); no separate profile.
$composeArgs += @('--profile', 'fetcher', '--profile', 'demo', '--profile', 'integration')

$downArgs = @('down')
if ($RemoveData) { $downArgs += '-v' }

Write-Host "==> docker compose $($composeArgs -join ' ') $($downArgs -join ' ')" -ForegroundColor Cyan
& docker compose @composeArgs @downArgs
if ($LASTEXITCODE -ne 0) { throw "docker compose down failed with exit code $LASTEXITCODE" }

if ($RemoveSecrets -and (Test-Path $envFile)) {
    Remove-Item $envFile -Force
    Write-Host "==> Removed $envFile" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "  Stack torn down. Install dir: $InstallDir"
if ($RemoveData)    { Write-Host "  Data volume removed (pg-data). All deployment history lost." -ForegroundColor Yellow }
if ($RemoveSecrets) { Write-Host "  Secrets removed -- a fresh install will generate a new API_TOKEN." -ForegroundColor Yellow }
if (-not $RemoveData) {
    Write-Host "  Data volume preserved -- a subsequent install reattaches to it."
}
