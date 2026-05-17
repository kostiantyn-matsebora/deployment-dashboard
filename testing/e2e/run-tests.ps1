<#
.SYNOPSIS
    Runs the Playwright end-to-end suite against a running Deployment
    Dashboard stack described by a JSON config file. Zero-setup for
    local dev.

.DESCRIPTION
    Thin wrapper around `npx playwright test`. Implements WBS MVP §3.3
    of docs/architecture.md and the
    "Zero-setup rule for test runners" section of
    .claude/agents/qa-engineer.md.

    Default invocation:
        pwsh -NoProfile -File testing/e2e/run-tests.ps1

    With no arguments the runner:
      1. Loads testing/config/local.json.
      2. Preflights `${readBaseUrl}/health`. On failure emits
         "Local stack not reachable at <url> -
         run dev_env/start.ps1 first." and exits 1.
      3. Installs Playwright npm deps + browser binaries silently on
         first invocation (idempotent thereafter).
      4. Exports DASHBOARD_READ_BASE_URL / DASHBOARD_WRITE_BASE_URL /
         DASHBOARD_API_KEY for testing/e2e/tests/support/env.ts and
         playwright.config.ts, then invokes Playwright. Propagates the
         Playwright exit code.

    The runner does NOT accept loose -BaseUrl / -ApiKey overrides —
    those are configuration and live in the JSON config file. It also
    does NOT re-seed the database; run testing/scripts/seed.ps1 once
    before the suite if the corpus is missing.

.PARAMETER Config
    Path to a target config JSON file under testing/config/. Default
    `testing/config/local.json`. See testing/config/README.md.

.PARAMETER Filter
    Optional Playwright `--grep` pattern.

.PARAMETER FailFast
    Pass `--max-failures=1` to Playwright.

.PARAMETER Headed
    Run Playwright in headed mode (visible browser window).

.PARAMETER Project
    Playwright project name (chromium / firefox / webkit). Default
    chromium.

.PARAMETER NoTeardown
    Skip the post-run TRUNCATE of the `deployments` table. Default off:
    the runner invokes `testing/scripts/seed.ps1 -CleanOnly` after the
    test pass to scrub state pollution (ephemeral `qa-bot-*` and
    similar rows POSTed by individual tests). Only honoured against
    a localhost target - the cleanup script refuses non-local URLs.

.PARAMETER NoReseed
    Skip the post-cleanup re-seed. Default off: after teardown the
    runner invokes `seed.ps1` so the next interactive browser session
    sees the canonical 6-state corpus + topology fixtures. Useful only
    if you want a truly empty DB after the run (rare).

.EXAMPLE
    pwsh -NoProfile -File testing/e2e/run-tests.ps1

    Zero-setup local run against chromium.

.EXAMPLE
    pwsh -NoProfile -File testing/e2e/run-tests.ps1 -Headed -Filter 'drawer-history'

    Run only the drawer-history scenario in a visible browser.

.EXAMPLE
    pwsh -NoProfile -File testing/e2e/run-tests.ps1 -Config testing/config/dev.json

    Run against the dev target.

.NOTES
    File:   testing/e2e/run-tests.ps1
    Owner:  qa-engineer (.claude/agents/qa-engineer.md)
    WBS:    MVP §3.3 in docs/architecture.md
#>
[CmdletBinding()]
param(
    [Parameter()] [string]$Config = (Join-Path $PSScriptRoot '..\config\local.json'),
    [Parameter()] [string]$Filter,
    [Parameter()] [switch]$FailFast,
    [Parameter()] [switch]$Headed,
    [Parameter()] [ValidateSet('chromium','firefox','webkit')] [string]$Project = 'chromium',
    [Parameter()] [switch]$NoTeardown,
    [Parameter()] [switch]$NoReseed
)
$ErrorActionPreference = 'Stop'
$ConfigPath = [System.IO.Path]::GetFullPath($Config)
if (-not (Test-Path -LiteralPath $ConfigPath)) { Write-Error "Config not found at '$ConfigPath' (see testing/config/README.md)."; exit 1 }
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
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/@playwright/test'))) {
        & npm install --no-audit --no-fund --silent
        if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed (exit $LASTEXITCODE)."; exit $LASTEXITCODE }
    }
    & npx playwright install $Project --with-deps 2>&1 | Out-Null
    $env:DASHBOARD_READ_BASE_URL  = $readUrl
    $env:DASHBOARD_WRITE_BASE_URL = $writeUrl
    $env:DASHBOARD_API_KEY        = $apiKey
    $pwArgs = @('playwright', 'test', "--project=$Project")
    if ($PSBoundParameters.ContainsKey('Filter') -and -not [string]::IsNullOrWhiteSpace($Filter)) { $pwArgs += @('--grep', $Filter) }
    if ($Headed)   { $pwArgs += '--headed' }
    if ($FailFast) { $pwArgs += '--max-failures=1' }
    Write-Host "[e2e/run-tests] npx $($pwArgs -join ' ')" -ForegroundColor Cyan
    & npx @pwArgs
    $testExit = $LASTEXITCODE
}
finally { Pop-Location }

# Auto-teardown: every e2e spec POSTs ephemeral `qa-bot-*` rows for the
# realtime / discovery / focus-on-last-event scenarios. We TRUNCATE the
# deployments table via seed.ps1 -CleanOnly to keep state-pollution out
# of the SPA on the next interactive browser session, then re-seed the
# canonical corpus so the SPA still shows the 12-service grid for ad-hoc
# inspection. Both phases are local-only (seed.ps1 -Clean / -CleanOnly
# refuses non-localhost targets).
if (-not $NoTeardown) {
    $seedScript = Join-Path $PSScriptRoot '..\scripts\seed.ps1'
    if (Test-Path -LiteralPath $seedScript) {
        Write-Host "[e2e/run-tests] teardown: seed.ps1 -CleanOnly -Config $ConfigPath" -ForegroundColor DarkCyan
        & pwsh -NoProfile -File $seedScript -Config $ConfigPath -CleanOnly | Out-Null
        if (-not $NoReseed) {
            Write-Host "[e2e/run-tests] reseeding canonical corpus..." -ForegroundColor DarkCyan
            & pwsh -NoProfile -File $seedScript -Config $ConfigPath | Out-Null
        }
    } else {
        Write-Host "[e2e/run-tests] teardown skipped - seed.ps1 not found at $seedScript" -ForegroundColor Yellow
    }
}

exit $testExit
