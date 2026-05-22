<#
.SYNOPSIS
    Runs the Dashboard.Integration.Tests xUnit suite against a running
    Deployment Dashboard stack brought up with the `integration` compose
    profile. Zero-setup for local dev once dev_env/start.ps1 -Integration
    is up.

.DESCRIPTION
    Thin wrapper around `dotnet test`. Implements the qa-engineer
    Phase 4 slice for CR-0012 (docs/cr/CR-0012-integration-test-substrate.md).
    Mirrors testing/functional/run-tests.ps1 shape; the differences are:

      1. Two preflights, not one. Both must pass before tests run:
         - GET ${readBaseUrl}/health           (the dashboard stack)
         - GET ${mockGhaAdminBaseUrl}/__admin/ (the mock-gha admin surface)
      2. Five env vars set from integration.json (vs three for functional):
           DASHBOARD_READ_BASE_URL
           DASHBOARD_WRITE_BASE_URL
           DASHBOARD_API_KEY
           MOCK_GHA_ADMIN_BASE_URL
           FETCHER_SOURCE_IDS                  (JSON array; runner serialises)
      3. Teardown TRUNCATEs the deployments table via
         testing/scripts/seed.ps1 -CleanOnly -Config <config>. seed.ps1
         already accepts -Config and -CleanOnly (verified pre-Phase-4).

    Per CR-0012 § 3b, the integration compose profile pins
    FETCHER_POLL_INTERVAL_SECONDS=1 so the per-scenario NFR-03 5 s envelope
    is exercised meaningfully.

.PARAMETER Config
    Path to a target config JSON file under testing/config/. Default
    'testing/config/integration.json'. See testing/config/README.md
    § "Schema — integration target".

.PARAMETER Filter
    Optional xUnit filter expression forwarded as `dotnet test --filter`.

.PARAMETER FailFast
    Stop the run on the first failure (`-- xUnit.StopOnFail=true`).

.PARAMETER NoTeardown
    Skip the post-run TRUNCATE of the `deployments` table. Default off.
    The teardown invokes seed.ps1 -CleanOnly with the same -Config the
    runner used. seed.ps1 -CleanOnly is local-only by contract — it
    refuses non-localhost writeBaseUrl values.

.EXAMPLE
    pwsh -NoProfile -File testing/integration/run-tests.ps1

    Zero-setup local run against the integration profile.

.EXAMPLE
    pwsh -NoProfile -File testing/integration/run-tests.ps1 -Filter 'FullyQualifiedName~States.SuccessStateTests'

    Run only the success-state scenario.

.NOTES
    File:   testing/integration/run-tests.ps1
    Owner:  qa-engineer (.claude/agents/qa-engineer.md)
    Spec:   docs/cr/CR-0012-integration-test-substrate.md
    Guide:  docs/integration-tests.md
#>
[CmdletBinding()]
param(
    [Parameter()] [string]$Config = (Join-Path $PSScriptRoot '..\config\integration.json'),
    [Parameter()] [string]$Filter,
    [Parameter()] [switch]$FailFast,
    [Parameter()] [switch]$NoTeardown
)
$ErrorActionPreference = 'Stop'
$ProjectDir = Join-Path $PSScriptRoot 'Dashboard.Integration.Tests'
$ConfigPath = [System.IO.Path]::GetFullPath($Config)
if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Error "Config not found at '$ConfigPath' (see testing/config/README.md § Schema - integration target)."
    exit 1
}
if (-not (Test-Path -LiteralPath $ProjectDir)) {
    Write-Error "Test project not found at '$ProjectDir'."
    exit 1
}
$cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json

foreach ($k in 'readBaseUrl','writeBaseUrl','apiKey','mockGhaAdminBaseUrl') {
    if ([string]::IsNullOrWhiteSpace([string]$cfg.$k)) {
        Write-Error "Config '$ConfigPath' missing required key '$k'."
        exit 1
    }
}
if (-not $cfg.fetcherSourceIds -or @($cfg.fetcherSourceIds).Count -eq 0) {
    Write-Error "Config '$ConfigPath' missing required array 'fetcherSourceIds' (must contain at least one 'owner/repo')."
    exit 1
}

$readUrl       = ([string]$cfg.readBaseUrl).TrimEnd('/')
$writeUrl      = ([string]$cfg.writeBaseUrl).TrimEnd('/')
$apiKey        = [string]$cfg.apiKey
$adminUrl      = ([string]$cfg.mockGhaAdminBaseUrl).TrimEnd('/')
$sourceIdsJson = ConvertTo-Json -InputObject @($cfg.fetcherSourceIds) -Compress

# Preflight #1 — Read API /health.
try {
    $resp = Invoke-WebRequest -Uri "$readUrl/health" -Method GET -TimeoutSec 5 -UseBasicParsing -SkipHttpErrorCheck -ErrorAction Stop
    $stackReachable = ([int]$resp.StatusCode -ge 200 -and [int]$resp.StatusCode -lt 500)
} catch { $stackReachable = $false }
if (-not $stackReachable) {
    Write-Host "Local stack not reachable at $readUrl - run dev_env/start.ps1 -Integration first." -ForegroundColor Yellow
    exit 1
}

# Preflight #2 — mock-gha admin API.
try {
    $adminResp = Invoke-WebRequest -Uri "$adminUrl/__admin/" -Method GET -TimeoutSec 5 -UseBasicParsing -SkipHttpErrorCheck -ErrorAction Stop
    # Both 200 and 404 are acceptable - some WireMock.Net builds return 404 on the bare /__admin/ root.
    $mockReachable = ([int]$adminResp.StatusCode -ge 200 -and [int]$adminResp.StatusCode -lt 500)
} catch { $mockReachable = $false }
if (-not $mockReachable) {
    Write-Host "mock-gha admin API not reachable at $adminUrl/__admin/ - integration compose profile not up. Run dev_env/start.ps1 -Integration first." -ForegroundColor Yellow
    exit 1
}

# Export env-vars consumed by TestEnvironment.cs.
$env:DASHBOARD_READ_BASE_URL  = $readUrl
$env:DASHBOARD_WRITE_BASE_URL = $writeUrl
$env:DASHBOARD_API_KEY        = $apiKey
$env:MOCK_GHA_ADMIN_BASE_URL  = $adminUrl
$env:FETCHER_SOURCE_IDS       = $sourceIdsJson
# ScenarioFixture.TruncateDeploymentsAsync uses this to pass the right
# -Config flag through to seed.ps1.
$env:DASHBOARD_INTEGRATION_CONFIG = $ConfigPath

$dotnetArgs = @('test', $ProjectDir, '--nologo', '--verbosity', 'normal')
if ($PSBoundParameters.ContainsKey('Filter') -and -not [string]::IsNullOrWhiteSpace($Filter)) {
    $dotnetArgs += @('--filter', $Filter)
}
if ($FailFast) { $dotnetArgs += @('--', 'xUnit.StopOnFail=true') }
Write-Host "[integration/run-tests] dotnet $($dotnetArgs -join ' ')" -ForegroundColor Cyan
& dotnet @dotnetArgs
$testExit = $LASTEXITCODE

# Auto-teardown: every integration test produces 'gha-<id>' rows that
# would otherwise accumulate across runs and skew the matrix view. We
# TRUNCATE the deployments table via seed.ps1 -CleanOnly. The cleanup is
# local-only by design: seed.ps1 -CleanOnly refuses non-localhost
# targets.
if (-not $NoTeardown) {
    $seedScript = Join-Path $PSScriptRoot '..\scripts\seed.ps1'
    if (Test-Path -LiteralPath $seedScript) {
        Write-Host "[integration/run-tests] teardown: seed.ps1 -CleanOnly -Config $ConfigPath" -ForegroundColor DarkCyan
        & pwsh -NoProfile -File $seedScript -Config $ConfigPath -CleanOnly | Out-Null
    } else {
        Write-Host "[integration/run-tests] teardown skipped - seed.ps1 not found at $seedScript" -ForegroundColor Yellow
    }
}

exit $testExit
