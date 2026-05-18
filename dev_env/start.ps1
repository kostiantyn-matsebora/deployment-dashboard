<#
.SYNOPSIS
    Bring up the Deployment Dashboard local stack. Thin wrapper: compose up -> poll /health -> print URLs.
.PARAMETER Scaled
    Use docker-compose.scaled.yml (3 Read API + 2 Write API replicas behind one gateway). NFR-05 validation only.
.PARAMETER Fetcher
    Activate the optional `fetcher` Compose profile (CR-0009 pull-mode fetcher). When set, requires
    `$env:GHA_TOKEN` to be non-empty unless `-AllowMissingGhaToken` is also supplied. Composable with `-Scaled`.
.PARAMETER AllowMissingGhaToken
    Permit `-Fetcher` to proceed when `$env:GHA_TOKEN` is unset/empty. The fetcher boots with the placeholder
    token from docker-compose.local.yml; GitHub API calls will 401. Use for boot-smoke / fetcher-code work
    that does not need real GH API access.
.PARAMETER HealthTimeoutSeconds
    How long to wait for the gateway-fronted /health endpoint. Default 60. On failure, logs are dumped and the script exits 1.
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Fetcher
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Fetcher -AllowMissingGhaToken
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Scaled -Fetcher
#>
#Requires -Version 7.0
[CmdletBinding()]
param([switch]$Scaled, [switch]$Fetcher, [switch]$AllowMissingGhaToken, [int]$HealthTimeoutSeconds = 60)
$ErrorActionPreference = 'Stop'
if ($Fetcher) {
    $tokenSet = -not [string]::IsNullOrWhiteSpace($env:GHA_TOKEN)
    if (-not $tokenSet -and -not $AllowMissingGhaToken) {
        Write-Host "ERROR: -Fetcher requires `$env:GHA_TOKEN to be set. Set `$env:GHA_TOKEN = '<PAT>' or re-run with -AllowMissingGhaToken to use the placeholder." -ForegroundColor Red
        exit 1
    }
    if (-not $tokenSet) {
        Write-Host "GHA_TOKEN not set - fetcher will boot with placeholder; GitHub API calls will 401." -ForegroundColor Yellow
    }
}
$composeFile = Join-Path $PSScriptRoot ($Scaled ? 'docker-compose.scaled.yml' : 'docker-compose.local.yml')
$composeArgs = @('-f', $composeFile)
if ($Fetcher) { $composeArgs += @('--profile', 'fetcher') }
Write-Host "==> docker compose $($composeArgs -join ' ') up -d --build" -ForegroundColor Cyan
& docker compose @composeArgs up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed with exit code $LASTEXITCODE" }
$healthUrl = "http://localhost:8080/health"
Write-Host "==> Waiting up to $HealthTimeoutSeconds s for $healthUrl" -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try { if ((Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch { }
    Start-Sleep -Seconds 2
}
if (-not $ok) { & docker compose @composeArgs logs --tail=50; throw "Gateway-fronted /health did not return 200 at $healthUrl within $HealthTimeoutSeconds s." }
Write-Host ""
Write-Host "  Dashboard / Gateway: http://localhost:8080/"
Write-Host "  Postgres (dev):      localhost:5432 (user: dashboard / password: local-dev-password)"
Write-Host "  pgAdmin:             http://localhost:5050/  (admin@example.com / admin)"
if ($Fetcher) {
    Write-Host "  Fetcher:             profile 'fetcher' active - POSTs to gateway as dashboard-fetcher/github-actions"
}
Write-Host ""
Write-Host "  curl -X POST http://localhost:8080/api/deployments -H 'Content-Type: application/json' -H 'X-Api-Key: local-dev-token-not-for-production' -d '{`"service`":`"adminportal`",`"environment`":`"dev`",`"version`":`"v2.3.1`",`"status`":`"success`",`"run_url`":`"https://example.test/run/1`",`"run_number`":1,`"actor`":`"local`"}'"
