<#
.SYNOPSIS
    Bring up the Deployment Dashboard local stack.
    Thin alias: delegates to install/install.ps1 -BuildLocally via subprocess per CR-0014 S3.
.DESCRIPTION
    Contributor flow entrypoint. Translates start.ps1-specific flags into install.ps1
    arguments, then delegates via subprocess:
        & pwsh -NoProfile -File install/install.ps1 -BuildLocally <translated args>

    Image-source divergence (build locally vs pull from GHCR) is carried entirely by
    docker compose -f merge-override (dev_env/docker-compose.local.yml layered on
    install/docker-compose.release.yml per ADR-0010). The -BuildLocally flag is a
    no-op at the helper boundary per CR-0014 S5.

    Flag-translation table:
      start.ps1 -Demo          -> install.ps1 (no flag; demo is the default per CR-0013)
      start.ps1 (no flag)      -> install.ps1 (no flag; same demo default)
      start.ps1 -RealGha       -> install.ps1 -RealGha
      start.ps1 -Empty         -> install.ps1 -Empty  (not a start.ps1 flag; not applicable)
      start.ps1 -Integration   -> install.ps1 -RealGha (fetcher profile needed; env-vars set below)
      start.ps1 -Scaled        -> standalone scaled compose; NOT delegated to install.ps1

    Note: the pre-CR-0014 PostHog seed branch (line 47+ in the old start.ps1) is deleted
    outright per OI-2 (SA pin 2026-05-23). Contributors wanting to point the fetcher at a
    live GitHub repo use -RealGha + set $env:GHA_REPOSITORIES before running.

.PARAMETER Scaled
    Use docker-compose.scaled.yml (3 Read API + 2 Write API replicas behind one gateway).
    NFR-05 validation only. NOT delegated to install.ps1 -- the scaled stack is standalone.
.PARAMETER Fetcher
    Activate the optional `fetcher` Compose profile. When set (and -Demo is NOT also set),
    requires $env:GHA_TOKEN to be non-empty unless -AllowMissingGhaToken is also supplied.
    Composable with -Scaled.
.PARAMETER Demo
    Zero-PAT demo run. Routes to install.ps1's demo default (demo-gha + fetcher; offline,
    zero-PAT, fixed credentials per CR-0014). Implies -AllowMissingGhaToken.
.PARAMETER AllowMissingGhaToken
    Permit -Fetcher to proceed when $env:GHA_TOKEN is unset/empty. -Demo implies this.
.PARAMETER Integration
    Activate the `integration` Compose profile (CR-0012). Brings up the `mock-gha`
    WireMock.Net container, re-points the fetcher at http://mock-gha:80 via
    $env:GHA_API_BASE_URL, tunes $env:FETCHER_POLL_INTERVAL_SECONDS=1. Implies
    -Fetcher + -AllowMissingGhaToken. Mutually exclusive with -Scaled and -Demo.
.PARAMETER HealthTimeoutSeconds
    How long to wait for the gateway-fronted /health endpoint. Default 60.
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Fetcher
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Fetcher -AllowMissingGhaToken
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Demo
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Scaled -Fetcher
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Integration
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Scaled,
    [switch]$Fetcher,
    [switch]$Demo,
    [switch]$AllowMissingGhaToken,
    [switch]$Integration,
    [int]$HealthTimeoutSeconds = 60
)
$ErrorActionPreference = 'Stop'

# -Integration canonicalisation (CR-0012).
if ($Integration) {
    if ($Scaled) {
        Write-Host "ERROR: -Integration and -Scaled are mutually exclusive. The scaled stack uses a standalone compose file (docker-compose.scaled.yml) that does not include the mock-gha integration substrate." -ForegroundColor Red
        exit 1
    }
    if ($Demo) {
        Write-Host "ERROR: -Integration and -Demo are mutually exclusive. -Demo points the fetcher at the offline demo-gha; -Integration points it at the in-network mock-gha at a 1 s cadence. Pick one." -ForegroundColor Red
        exit 1
    }
    $Fetcher = $true
    $AllowMissingGhaToken = $true
    $env:GHA_API_BASE_URL = 'http://mock-gha:80'
    $env:FETCHER_POLL_INTERVAL_SECONDS = '1'
    if ([string]::IsNullOrWhiteSpace($env:GHA_REPOSITORIES)) {
        $env:GHA_REPOSITORIES = '[{"owner":"integration-test-org","repo":"integration-test-repo"}]'
    }
}

if ($Demo) {
    $AllowMissingGhaToken = $true
}

if ($Fetcher -and -not $Demo -and -not $Integration) {
    $tokenSet = -not [string]::IsNullOrWhiteSpace($env:GHA_TOKEN)
    if (-not $tokenSet -and -not $AllowMissingGhaToken) {
        Write-Host "ERROR: -Fetcher requires `$env:GHA_TOKEN to be set. Set `$env:GHA_TOKEN = '<PAT>' or re-run with -AllowMissingGhaToken (or -Demo) to use the placeholder." -ForegroundColor Red
        exit 1
    }
    if (-not $tokenSet) {
        Write-Host "GHA_TOKEN not set - fetcher will boot with placeholder; GitHub API calls will 401." -ForegroundColor Yellow
    }
}

if ($Scaled) {
    # Scaled stack (NFR-05 validation) is structurally distinct from the release
    # stack: different project name, container-name suffixes, 3-replica api,
    # no fetcher, no pgadmin. Kept as a standalone compose file -- NOT delegated
    # to install.ps1.
    $composeArgs = @('-f', (Join-Path $PSScriptRoot 'docker-compose.scaled.yml'))
    if ($Fetcher) { $composeArgs += @('--profile', 'fetcher') }
    if ($Integration) { $composeArgs += @('--profile', 'integration') }
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
    Write-Host ""
    Write-Host "  curl -X POST http://localhost:8080/api/deployments -H 'Content-Type: application/json' -H 'X-Api-Key: local-dev-token-not-for-production' -d '{`"service`":`"adminportal`",`"environment`":`"dev`",`"version`":`"v2.3.1`",`"status`":`"success`",`"run_url`":`"https://example.test/run/1`",`"run_number`":1,`"actor`":`"local`"}'"
    exit 0
}

# ---- Default contributor stack: delegate to install.ps1 -BuildLocally per CR-0014 S3 ----
# Env-var mutations ($env:GHA_API_BASE_URL / $env:FETCHER_POLL_INTERVAL_SECONDS /
# $env:GHA_REPOSITORIES / $env:GHA_TOKEN) set above are inherited by the subprocess
# via OS env-block per OI-1 (Option alpha) -- no explicit pass-through needed.
$installScript = Join-Path $PSScriptRoot '..' 'install' 'install.ps1'

# Build the argument list for install.ps1.
$installArgs = @('-BuildLocally', '-HealthTimeoutSeconds', $HealthTimeoutSeconds)

# Flag translation:
#   -Demo / (no flag) -> no mode flag (install.ps1 defaults to demo)
#   -RealGha          -> -RealGha
#   -Integration      -> -RealGha (fetcher profile; mock-gha env-vars set above)
# Note: -Fetcher without -Demo maps to -RealGha (live GitHub upstream)
if ($Fetcher -and -not $Demo -and -not $Integration) {
    $installArgs += '-RealGha'
} elseif ($Integration) {
    $installArgs += '-RealGha'
}
# -Demo and (no flag) both map to the demo default (no flag to install.ps1).

Write-Host "==> Delegating to install.ps1 -BuildLocally (CR-0014 S3)" -ForegroundColor Cyan
Write-Host "==> pwsh -NoProfile -File $installScript $($installArgs -join ' ')" -ForegroundColor DarkGray

& pwsh -NoProfile -File $installScript @installArgs
exit $LASTEXITCODE
