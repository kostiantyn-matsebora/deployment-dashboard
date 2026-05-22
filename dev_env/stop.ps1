<#
.SYNOPSIS
    Tear down the Deployment Dashboard local stack.

.DESCRIPTION
    Implements `docs/WBS.md` MVP §2.3.

    Runs `docker compose down` for both the default local compose file
    (`docker-compose.local.yml`) and, if present, the scaled compose
    file (`docker-compose.scaled.yml`). Safe to run when nothing is up.
    `docker compose down` removes services from any Compose profile that
    was activated at bring-up time (including the `fetcher` profile from
    `start.ps1 -Fetcher` and the scaled variant from `start.ps1 -Scaled`),
    so no extra flag is needed here.

    No env-file involvement: all configuration is inline in the compose
    files, so there is nothing to interpolate on teardown.

.PARAMETER Volumes
    Also remove the named Postgres data volume(s). Default: off.
    USE WITH CARE — this destroys all locally stored deployment events.

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

$scriptDir = $PSScriptRoot
# Default contributor stack derives from install/docker-compose.release.yml
# via Compose's `-f` chaining (issue #21). Both files must be passed to
# `docker compose down` so the merged service set tears down cleanly. The
# scaled stack stays standalone (see start.ps1 comment).
$defaultComposeFiles = @(
    Join-Path $scriptDir '..' 'install' 'docker-compose.release.yml'
    Join-Path $scriptDir 'docker-compose.local.yml'
)
$scaledComposeFiles = @(
    Join-Path $scriptDir 'docker-compose.scaled.yml'
)

function Invoke-Down {
    param(
        [string[]]$ComposeFiles,
        [switch]$RemoveVolumes
    )
    foreach ($f in $ComposeFiles) {
        if (-not (Test-Path -LiteralPath $f)) {
            Write-Host "    [skip] $f (not found)" -ForegroundColor Yellow
            return
        }
    }
    $dargs = @()
    foreach ($f in $ComposeFiles) { $dargs += @('-f', $f) }
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
Write-Host "==> Tearing down local compose" -ForegroundColor Cyan
Invoke-Down -ComposeFiles $defaultComposeFiles -RemoveVolumes:$Volumes

Write-Host ""
Write-Host "==> Tearing down scaled compose (if present)" -ForegroundColor Cyan
Invoke-Down -ComposeFiles $scaledComposeFiles -RemoveVolumes:$Volumes

Write-Host ""
if ($Volumes) {
    Write-Host "Removed named volumes (pg-data, pg-data-scaled, dotnet-tools*, nuget-cache*)." -ForegroundColor Green
} else {
    Write-Host "Preserved named volumes — re-run with -Volumes to drop pg-data and friends." -ForegroundColor DarkGray
}
Write-Host "Done." -ForegroundColor Green
