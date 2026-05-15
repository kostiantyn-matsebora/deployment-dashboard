<#
.SYNOPSIS
    Runs the mockup-only Playwright visual-invariants harness against
    docs/deployment-dashboard.html. Zero-setup: no dev_env stack required.

.DESCRIPTION
    Loads the mockup HTML directly via file:// in a real Chromium browser
    and asserts six geometric visual invariants for each of the 12
    (view x layout) combinations declared in harness.config.json. After
    the Playwright run completes, prints a clean per-combination
    PASS / FAIL / SKIPPED table sourced from __screenshots__/_report.json.

    Default invocation:
        pwsh -NoProfile -File testing/mockup-visual/run-tests.ps1

    With no arguments the runner:
      1. Verifies docs/deployment-dashboard.html exists (the harness is
         pure mockup-load — no Read API / Write API / Postgres needed).
      2. Installs Playwright npm deps + Chromium binary silently on
         first invocation (idempotent thereafter).
      3. Invokes Playwright with the spec under this directory.
      4. Parses __screenshots__/_report.json and prints a structured
         pass/fail table. Exits 0 if every combination is PASS, else 1.

.PARAMETER Filter
    Optional Playwright `--grep` pattern (e.g. 'detailed' to run only
    detailed-view combinations).

.PARAMETER Headed
    Run Playwright in headed mode (visible browser window).

.EXAMPLE
    pwsh -NoProfile -File testing/mockup-visual/run-tests.ps1

    Default zero-setup run.

.NOTES
    File:   testing/mockup-visual/run-tests.ps1
    Owner:  qa-engineer (.claude/agents/qa-engineer.md)
#>
[CmdletBinding()]
param(
    [Parameter()] [string]$Filter,
    [Parameter()] [switch]$Headed
)
$ErrorActionPreference = 'Stop'

$cfgPath = Join-Path $PSScriptRoot 'harness.config.json'
if (-not (Test-Path -LiteralPath $cfgPath)) { Write-Error "harness.config.json not found next to runner."; exit 1 }
$cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json

$mockupPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $cfg.mockupRelativePath))
if (-not (Test-Path -LiteralPath $mockupPath)) {
    Write-Host "Mockup not found at $mockupPath" -ForegroundColor Red
    exit 1
}

$shotsDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $cfg.screenshotsDir))
if (-not (Test-Path -LiteralPath $shotsDir)) { New-Item -ItemType Directory -Path $shotsDir | Out-Null }

$partialsDir = Join-Path $shotsDir '_partials'
if (Test-Path -LiteralPath $partialsDir) { Remove-Item -LiteralPath $partialsDir -Recurse -Force }
New-Item -ItemType Directory -Path $partialsDir | Out-Null

$reportPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $cfg.reportPath))
if (Test-Path -LiteralPath $reportPath) { Remove-Item -LiteralPath $reportPath -Force }

Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/@playwright/test'))) {
        Write-Host "[mockup-visual] installing npm deps..." -ForegroundColor Cyan
        & npm install --no-audit --no-fund --silent
        if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed (exit $LASTEXITCODE)."; exit $LASTEXITCODE }
    }
    & npx playwright install chromium --with-deps 2>&1 | Out-Null

    $pwArgs = @('playwright', 'test', '--project=chromium')
    if ($PSBoundParameters.ContainsKey('Filter') -and -not [string]::IsNullOrWhiteSpace($Filter)) { $pwArgs += @('--grep', $Filter) }
    if ($Headed) { $pwArgs += '--headed' }

    Write-Host "[mockup-visual] npx $($pwArgs -join ' ')" -ForegroundColor Cyan
    & npx @pwArgs
    $playwrightExit = $LASTEXITCODE
}
finally {
    Pop-Location
}

# --------- Consolidate per-test partials into the final report ----------
# Playwright restarts the worker on test failure, so the spec writes one
# JSON partial per test invocation. We stitch them here, ordered by the
# views x layouts declaration in harness.config.json.
$results = @()
foreach ($v in $cfg.views) {
    foreach ($l in $cfg.layouts) {
        $partial = Join-Path $partialsDir "$v`__$l.json"
        if (Test-Path -LiteralPath $partial) {
            $results += (Get-Content -LiteralPath $partial -Raw | ConvertFrom-Json)
        } else {
            $results += [pscustomobject]@{
                view = $v; layout = $l; status = 'FAIL'
                reason = 'No partial produced — test crashed before writing one (see Playwright output above).'
                violations = @(); screenshotPath = ''
            }
        }
    }
}
$consolidated = [pscustomobject]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    mockup      = ('file:///' + ($mockupPath -replace '\\', '/'))
    results     = $results
}
$consolidated | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8

# --------- Print the per-combination table from _report.json -----------
Write-Host ''
Write-Host '================ MOCKUP VISUAL HARNESS - RESULTS ================' -ForegroundColor White
if (-not (Test-Path -LiteralPath $reportPath)) {
    Write-Host "No report generated at $reportPath (Playwright may have crashed)." -ForegroundColor Red
    exit ($playwrightExit -ne 0 ? $playwrightExit : 1)
}
$report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
$colorFor = @{ 'PASS' = 'Green'; 'FAIL' = 'Red'; 'SKIPPED' = 'Yellow' }
$fmtRow = '{0,-10} x {1,-15} {2,-8} {3}'
Write-Host ($fmtRow -f 'view', 'layout', 'status', 'reason / first violations')
Write-Host ('-' * 100)
$failCount = 0
$skipCount = 0
foreach ($r in $report.results) {
    $first = ''
    if ($r.status -eq 'FAIL') {
        $failCount++
        if ($r.violations -and $r.violations.Count -gt 0) {
            $samples = $r.violations | Select-Object -First 2 | ForEach-Object { "[$($_.invariantId)] $($_.message)" }
            $first = ($samples -join ' | ')
            if ($r.violations.Count -gt 2) { $first += " (+$($r.violations.Count - 2) more)" }
        } elseif ($r.reason) { $first = $r.reason }
    } elseif ($r.status -eq 'SKIPPED') {
        $skipCount++
        if ($r.reason) { $first = $r.reason }
    }
    Write-Host ($fmtRow -f $r.view, $r.layout, $r.status, $first) -ForegroundColor $colorFor[$r.status]
}
Write-Host ('-' * 100)
Write-Host ("Totals: {0} combinations | PASS={1} FAIL={2} SKIPPED={3}" -f $report.results.Count, ($report.results.Count - $failCount - $skipCount), $failCount, $skipCount)
Write-Host "Report: $reportPath"
Write-Host "Screenshots: $shotsDir"

if ($failCount -gt 0 -or $playwrightExit -ne 0) { exit 1 } else { exit 0 }
