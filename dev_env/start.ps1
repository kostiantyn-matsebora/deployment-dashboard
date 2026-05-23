<#
.SYNOPSIS
    Bring up the Deployment Dashboard local-dev stack.
.DESCRIPTION
    Thin docker compose wrapper for contributor flow. Always builds images locally.
    Default (no flags): demo mode + fetcher (demo-gha + demo-driver + fetcher).

.PARAMETER Scaled
    Use docker-compose.scaled.yml (3 Read API + 2 Write API replicas). NFR-05 validation only.
.PARAMETER Integration
    Activate the `integration` profile (CR-0012): brings up mock-gha, points fetcher at it,
    poll interval 1 s. Mutually exclusive with -Scaled.
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Scaled
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Integration
#>
#Requires -Version 7.0
param(
    [switch]$Scaled,
    [switch]$Integration
)
$ErrorActionPreference = 'Stop'

$releaseCompose = Join-Path $PSScriptRoot '..' 'install' 'docker-compose.release.yml'
$localCompose   = Join-Path $PSScriptRoot 'docker-compose.local.yml'
$scaledCompose  = Join-Path $PSScriptRoot 'docker-compose.scaled.yml'

if ($Scaled -and $Integration) {
    Write-Host "ERROR: -Scaled and -Integration are mutually exclusive." -ForegroundColor Red; exit 1
}

if ($Scaled) {
    & docker compose -f $scaledCompose up -d --build --wait
    exit $LASTEXITCODE
}

if ($Integration) {
    $env:GHA_API_BASE_URL              = 'http://mock-gha:80'
    $env:FETCHER_POLL_INTERVAL_SECONDS = '1'
    if (-not $env:GHA_REPOSITORIES) { $env:GHA_REPOSITORIES = '[{"owner":"integration-test-org","repo":"integration-test-repo"}]' }
    if (-not $env:GHA_TOKEN)        { $env:GHA_TOKEN        = 'integration-test-placeholder-mock-gha-ignores-this' }
    & docker compose -f $releaseCompose -f $localCompose --profile fetcher --profile integration up -d --build --wait
    exit $LASTEXITCODE
}

& docker compose -f $releaseCompose -f $localCompose --profile demo --profile fetcher up -d --build --wait
exit $LASTEXITCODE
