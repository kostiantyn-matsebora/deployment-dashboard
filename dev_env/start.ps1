<#
.SYNOPSIS
    Bring up the Deployment Dashboard local stack. Thin wrapper: compose up -> poll /health -> print URLs.
.PARAMETER Scaled
    Use docker-compose.scaled.yml (3 Read API + 2 Write API replicas behind one gateway). NFR-05 validation only.
.PARAMETER HealthTimeoutSeconds
    How long to wait for the gateway-fronted /health endpoint. Default 60. On failure, logs are dumped and the script exits 1.
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1
#>
#Requires -Version 7.0
[CmdletBinding()]
param([switch]$Scaled, [int]$HealthTimeoutSeconds = 60)
$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot ($Scaled ? 'docker-compose.scaled.yml' : 'docker-compose.local.yml')
Write-Host "==> docker compose -f $composeFile up -d --build" -ForegroundColor Cyan
& docker compose -f $composeFile up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed with exit code $LASTEXITCODE" }
$healthUrl = "http://localhost:8080/health"
Write-Host "==> Waiting up to $HealthTimeoutSeconds s for $healthUrl" -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try { if ((Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch { }
    Start-Sleep -Seconds 2
}
if (-not $ok) { & docker compose -f $composeFile logs --tail=50; throw "Gateway-fronted /health did not return 200 at $healthUrl within $HealthTimeoutSeconds s." }
Write-Host ""
Write-Host "  Dashboard / Gateway: http://localhost:8080/"
Write-Host "  Postgres (dev):      localhost:5432 (user: dashboard / password: local-dev-password)"
Write-Host "  pgAdmin:             http://localhost:5050/  (admin@example.com / admin)"
Write-Host ""
Write-Host "  curl -X POST http://localhost:8080/api/deployments -H 'Content-Type: application/json' -H 'X-Api-Key: local-dev-token-not-for-production' -d '{`"service`":`"adminportal`",`"environment`":`"dev`",`"version`":`"v2.3.1`",`"status`":`"success`",`"run_url`":`"https://example.test/run/1`",`"run_number`":1,`"actor`":`"local`"}'"
