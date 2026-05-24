<#
.SYNOPSIS
    Tear down the Deployment Dashboard local stack.

.DESCRIPTION
    Implements `docs/WBS.md` MVP §2.3.

    Runs `docker compose down` for each compose variant that may be active.
    The overlay chain is reconstructed to match the possible start.ps1 modes
    (issue #72 ASR-C: stop mirrors the start switch surface 1-for-1).

    Modes handled:
      - Default (demo): release + demo + local + demo-local overlays, --profile db + fetcher
      - LocalDb:        release + local, --profile db
      - RealGha:        release + local, --profile fetcher (or --profile db + fetcher)
      - Integration:    release + local + integration overlays, --profile db + fetcher
      - Scaled:         scaled compose standalone

    `docker compose down --remove-orphans` is safe to call on a stopped or
    partially-running stack -- it is idempotent.

    No env-file involvement: all configuration is inline in the compose files.

.PARAMETER Volumes
    Also remove the named Postgres data volume(s). Default: off.
    USE WITH CARE -- this destroys all locally stored deployment events.

.EXAMPLE
    pwsh -NoProfile -File dev_env/stop.ps1

.EXAMPLE
    pwsh -NoProfile -File dev_env/stop.ps1 -Volumes
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [switch]$Volumes
)

$ErrorActionPreference = 'Stop'

$scriptDir          = $PSScriptRoot
$releaseCompose     = Join-Path $scriptDir '..' 'install' 'docker-compose.release.yml'
$demoCompose        = Join-Path $scriptDir '..' 'install' 'docker-compose.demo.yml'
$localCompose       = Join-Path $scriptDir 'docker-compose.local.yml'
$demoLocalCompose   = Join-Path $scriptDir 'docker-compose.demo-local.yml'
$integrationCompose = Join-Path $scriptDir 'docker-compose.integration.yml'
$scaledCompose      = Join-Path $scriptDir 'docker-compose.scaled.yml'

function Invoke-Down {
    param(
        [string[]]$ComposeFiles,
        [string[]]$Profiles = @(),
        [switch]$RemoveVolumes
    )
    # Skip if any required compose file is missing.
    foreach ($f in $ComposeFiles) {
        if (-not (Test-Path -LiteralPath $f)) {
            Write-Host "    [skip] $f (not found)" -ForegroundColor Yellow
            return
        }
    }
    $dargs = @()
    foreach ($f in $ComposeFiles) { $dargs += @('-f', $f) }
    foreach ($p in $Profiles)     { $dargs += @('--profile', $p) }
    $dargs += @('down', '--remove-orphans')
    if ($RemoveVolumes) { $dargs += '--volumes' }
    Write-Host "    docker compose $($dargs -join ' ')" -ForegroundColor DarkGray
    & docker compose @dargs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    [warn] docker compose exited with code $LASTEXITCODE (continuing)" -ForegroundColor Yellow
    } else {
        Write-Host "    [ok] tore down $($ComposeFiles -join ' + ')" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "==> Tearing down demo stack (release + demo + local + demo-local overlays)" -ForegroundColor Cyan
Invoke-Down `
    -ComposeFiles @($releaseCompose, $demoCompose, $localCompose, $demoLocalCompose) `
    -Profiles @('db', 'fetcher') `
    -RemoveVolumes:$Volumes

Write-Host ""
Write-Host "==> Tearing down integration stack (release + local + integration overlays)" -ForegroundColor Cyan
Invoke-Down `
    -ComposeFiles @($releaseCompose, $localCompose, $integrationCompose) `
    -Profiles @('db', 'fetcher') `
    -RemoveVolumes:$Volumes

Write-Host ""
Write-Host "==> Tearing down local-db stack (release + local overlays, db profile)" -ForegroundColor Cyan
Invoke-Down `
    -ComposeFiles @($releaseCompose, $localCompose) `
    -Profiles @('db') `
    -RemoveVolumes:$Volumes

Write-Host ""
Write-Host "==> Tearing down fetcher stack (release + local overlays, fetcher profile)" -ForegroundColor Cyan
Invoke-Down `
    -ComposeFiles @($releaseCompose, $localCompose) `
    -Profiles @('fetcher') `
    -RemoveVolumes:$Volumes

Write-Host ""
Write-Host "==> Tearing down scaled compose (if present)" -ForegroundColor Cyan
Invoke-Down -ComposeFiles @($scaledCompose) -RemoveVolumes:$Volumes

Write-Host ""
if ($Volumes) {
    Write-Host "Removed named volumes (pg-data, pg-data-scaled, etc.)." -ForegroundColor Green
} else {
    Write-Host "Preserved named volumes -- re-run with -Volumes to drop pg-data and friends." -ForegroundColor DarkGray
}
Write-Host "Done." -ForegroundColor Green
