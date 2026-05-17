<#
.SYNOPSIS
    Runs the Dashboard.Functional.Tests xUnit suite against a running
    Deployment Dashboard stack described by a JSON config file.
    Zero-setup for local dev.

.DESCRIPTION
    Thin wrapper around `dotnet test`. Implements WBS MVP §3.2 of
    docs/architecture.md and the
    "Zero-setup rule for test runners" section of
    .claude/agents/qa-engineer.md.

    Default invocation:
        pwsh -NoProfile -File testing/functional/run-tests.ps1

    With no arguments the runner:
      1. Loads testing/config/local.json (which points at the local
         docker-compose stack from dev_env/start.ps1).
      2. Preflights `${readBaseUrl}/health` with a short timeout. On
         failure emits "Local stack not reachable at <url> -
         run dev_env/start.ps1 first." and exits 1.
      3. Exports the resolved URLs / key as the env vars consumed by
         Dashboard.Functional.Tests/TestEnvironment.cs
         (DASHBOARD_READ_BASE_URL, DASHBOARD_WRITE_BASE_URL,
         DASHBOARD_API_KEY) plus DASHBOARD_SKIP_SEED=1 to avoid double
         seeding by the in-process SeedFixture.
      4. Invokes `dotnet test` and propagates its exit code.

    The runner does NOT accept loose -BaseUrl / -ApiKey overrides —
    those are configuration and live in the JSON config file. It also
    does NOT re-seed the database; run testing/scripts/seed.ps1 once
    before the suite if the corpus is missing.

.PARAMETER Config
    Path to a target config JSON file under testing/config/. Default
    `testing/config/local.json`. See testing/config/README.md.

.PARAMETER Filter
    Optional xUnit filter expression forwarded as `dotnet test --filter`.

.PARAMETER FailFast
    Stop the run on the first failure (`-- xUnit.StopOnFail=true`).

.PARAMETER NoTeardown
    Skip the post-run TRUNCATE of the `deployments` table. Default off:
    the runner invokes `testing/scripts/seed.ps1 -CleanOnly` after the
    test pass to scrub state pollution (ephemeral `qa-bot-*` and
    similar rows POSTed by individual tests). Only honoured against
    a localhost target — the cleanup script refuses non-local URLs.

.EXAMPLE
    pwsh -NoProfile -File testing/functional/run-tests.ps1

    Zero-setup local run.

.EXAMPLE
    pwsh -NoProfile -File testing/functional/run-tests.ps1 -Config testing/config/dev.json -FailFast

    Run the suite against the dev target with fail-fast.

.EXAMPLE
    pwsh -NoProfile -File testing/functional/run-tests.ps1 -Filter 'FullyQualifiedName~MatrixApiTests'

    Run only the matrix tests against the default (local) target.

.NOTES
    File:   testing/functional/run-tests.ps1
    Owner:  qa-engineer (.claude/agents/qa-engineer.md)
    WBS:    MVP §3.2 in docs/architecture.md
#>
[CmdletBinding()]
param(
    [Parameter()] [string]$Config = (Join-Path $PSScriptRoot '..\config\local.json'),
    [Parameter()] [string]$Filter,
    [Parameter()] [switch]$FailFast,
    [Parameter()] [switch]$NoTeardown
)
$ErrorActionPreference = 'Stop'
$ProjectDir = Join-Path $PSScriptRoot 'Dashboard.Functional.Tests'
$ConfigPath = [System.IO.Path]::GetFullPath($Config)
if (-not (Test-Path -LiteralPath $ConfigPath)) { Write-Error "Config not found at '$ConfigPath' (see testing/config/README.md)."; exit 1 }
if (-not (Test-Path -LiteralPath $ProjectDir)) { Write-Error "Test project not found at '$ProjectDir'."; exit 1 }
$cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
foreach ($k in 'readBaseUrl','writeBaseUrl','apiKey') {
    if ([string]::IsNullOrWhiteSpace([string]$cfg.$k)) { Write-Error "Config '$ConfigPath' missing required key '$k'."; exit 1 }
}
$readUrl  = ([string]$cfg.readBaseUrl).TrimEnd('/')
$writeUrl = ([string]$cfg.writeBaseUrl).TrimEnd('/')
$apiKey   = [string]$cfg.apiKey
try {
    $resp = Invoke-WebRequest -Uri "$readUrl/health" -Method GET -TimeoutSec 5 -UseBasicParsing -SkipHttpErrorCheck -ErrorAction Stop
    $reachable = ([int]$resp.StatusCode -ge 200 -and [int]$resp.StatusCode -lt 500)
} catch { $reachable = $false }
if (-not $reachable) { Write-Host "Local stack not reachable at $readUrl - run dev_env/start.ps1 first." -ForegroundColor Yellow; exit 1 }
$env:DASHBOARD_READ_BASE_URL  = $readUrl
$env:DASHBOARD_WRITE_BASE_URL = $writeUrl
$env:DASHBOARD_API_KEY        = $apiKey
$env:DASHBOARD_SKIP_SEED      = '1'
$dotnetArgs = @('test', $ProjectDir, '--nologo', '--verbosity', 'normal')
if ($PSBoundParameters.ContainsKey('Filter') -and -not [string]::IsNullOrWhiteSpace($Filter)) { $dotnetArgs += @('--filter', $Filter) }
if ($FailFast) { $dotnetArgs += @('--', 'xUnit.StopOnFail=true') }
Write-Host "[functional/run-tests] dotnet $($dotnetArgs -join ' ')" -ForegroundColor Cyan
& dotnet @dotnetArgs
$testExit = $LASTEXITCODE

# Auto-teardown: every functional test POSTs unique `qa-bot-*` rows that
# would otherwise accumulate indefinitely in the local dev database and
# show up in the SPA as stray services. We TRUNCATE the deployments
# table via seed.ps1 -CleanOnly so the next run (or the next e2e run)
# starts from a known-empty state. The cleanup is local-only by design:
# seed.ps1 -CleanOnly refuses non-localhost targets.
if (-not $NoTeardown) {
    $seedScript = Join-Path $PSScriptRoot '..\scripts\seed.ps1'
    if (Test-Path -LiteralPath $seedScript) {
        Write-Host "[functional/run-tests] teardown: seed.ps1 -CleanOnly -Config $ConfigPath" -ForegroundColor DarkCyan
        & pwsh -NoProfile -File $seedScript -Config $ConfigPath -CleanOnly | Out-Null
    } else {
        Write-Host "[functional/run-tests] teardown skipped - seed.ps1 not found at $seedScript" -ForegroundColor Yellow
    }
}

exit $testExit
