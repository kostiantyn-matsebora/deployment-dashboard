<#
.SYNOPSIS
    Tear down the Deployment Dashboard local stack.

.DESCRIPTION
    Implements `docs/WBS.md` MVP §2.3.

    Runs `docker compose down` for both the default local compose file
    (`docker-compose.local.yml`) and, if present, the scaled compose
    file (`docker-compose.scaled.yml`). Safe to run when nothing is up.

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

$scriptDir      = $PSScriptRoot
$defaultCompose = Join-Path $scriptDir 'docker-compose.local.yml'
$scaledCompose  = Join-Path $scriptDir 'docker-compose.scaled.yml'

function Invoke-Down {
    param(
        [string]$ComposeFile,
        [switch]$RemoveVolumes
    )
    if (-not (Test-Path -LiteralPath $ComposeFile)) {
        Write-Host "    [skip] $ComposeFile (not found)" -ForegroundColor Yellow
        return
    }
    $dargs = @('-f', $ComposeFile, 'down', '--remove-orphans')
    if ($RemoveVolumes) { $dargs += '--volumes' }
    Write-Host "    docker compose $($dargs -join ' ')" -ForegroundColor DarkGray
    & docker compose @dargs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    [warn] docker compose exited with code $LASTEXITCODE (continuing)" -ForegroundColor Yellow
    } else {
        Write-Host "    [ok] tore down $ComposeFile" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "==> Tearing down local compose" -ForegroundColor Cyan
Invoke-Down -ComposeFile $defaultCompose -RemoveVolumes:$Volumes

Write-Host ""
Write-Host "==> Tearing down scaled compose (if present)" -ForegroundColor Cyan
Invoke-Down -ComposeFile $scaledCompose -RemoveVolumes:$Volumes

Write-Host ""
if ($Volumes) {
    Write-Host "Removed named volumes (pg-data, pg-data-scaled, dotnet-tools*, nuget-cache*)." -ForegroundColor Green
} else {
    Write-Host "Preserved named volumes — re-run with -Volumes to drop pg-data and friends." -ForegroundColor DarkGray
}
Write-Host "Done." -ForegroundColor Green
