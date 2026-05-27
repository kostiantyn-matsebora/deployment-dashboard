#!/usr/bin/env pwsh
<#
.SYNOPSIS
  ginee compliance — PreToolUse hook on Bash (playbook #135 T3).
.DESCRIPTION
  Reads PreToolUse JSON from stdin; blocks (exit 2 + stderr) on 4 shell-command violations.
  Block conditions + opt-out + tests: adapters/claude/install.md § Compliance hooks.
.PARAMETER TestInput  Test-only: pass JSON instead of reading stdin.
.PARAMETER RepoRoot   Test-only: override repo root detection.
#>
[CmdletBinding()]
param(
  [string]$TestInput,
  [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:SKIP_GINEE_COMPLIANCE -eq '1') { exit 0 }

function Read-Payload {
  param([string]$TestInput)
  if ($TestInput) { return $TestInput }
  try { return [Console]::In.ReadToEnd() } catch { return '' }
}

function Get-RepoRoot {
  param([string]$Override)
  if ($Override) { return $Override }
  $root = & git rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $root) { return $null }
  return $root.Trim()
}

function Test-OptOut {
  param([string]$Root, [string]$TacticId)
  $config = Join-Path $Root 'local/framework.config.yaml'
  if (-not (Test-Path -LiteralPath $config)) { return $false }
  $body = Get-Content -Raw -LiteralPath $config
  if (-not $body) { return $false }
  if ($body -notmatch '(?m)^compliance:\s*$') { return $false }
  $pattern = "(?m)^\s+-\s+$([regex]::Escape($TacticId))\s*$"
  return ($body -match $pattern)
}

function Write-Block {
  param([string]$Rule, [string]$Detail, [string]$Remediation)
  [Console]::Error.WriteLine("[ginee:gate] $Rule — $Detail")
  [Console]::Error.WriteLine("  Remediation: $Remediation")
  [Console]::Error.WriteLine("  Bypass (emergency): SKIP_GINEE_COMPLIANCE=1")
  [Console]::Error.WriteLine("  Opt out repo-wide: local/framework.config.yaml § compliance.disabled: [pretooluse-bash-hook]")
  exit 2
}

# --- Main ---
# Wrap the entire main block in try/catch — any uncaught error fails open.

try {

$raw = Read-Payload -TestInput $TestInput
if (-not $raw) { exit 0 }

try {
  $payload = $raw | ConvertFrom-Json -ErrorAction Stop
} catch {
  exit 0
}

if ($payload.tool_name -ne 'Bash') { exit 0 }

$root = Get-RepoRoot -Override $RepoRoot
if (-not $root) { exit 0 }

if (Test-OptOut -Root $root -TacticId 'pretooluse-bash-hook') { exit 0 }

$ti = $payload.tool_input
if (-not $ti) { exit 0 }
$cmd = [string]$ti.command
if (-not $cmd) { exit 0 }

# Normalise whitespace for pattern matching (collapse newlines, multiple spaces).
$norm = ($cmd -replace '[\r\n]+', ' ') -replace '\s+', ' '

# --- Violation 1: git commit --no-verify ---
if ($norm -match '\bgit\s+commit\b.*?(--no-verify|-n\b)') {
  Write-Block `
    -Rule 'git commit --no-verify blocked' `
    -Detail "Skipping pre-commit hooks bypasses the context-economy gate + ginee's compliance enforcement." `
    -Remediation 'Resolve the underlying hook failure (run hooks individually with -v); commit normally afterwards.'
}

# --- Violation 2: git push --force on main/master ---
if ($norm -match '\bgit\s+push\b' -and $norm -match '(--force|-f\b|--force-with-lease)') {
  if ($norm -match '\b(main|master)\b') {
    Write-Block `
      -Rule 'git push --force on main / master blocked' `
      -Detail "Force-pushing the trunk rewrites history other contributors have pulled." `
      -Remediation 'Push to a feature branch and open a PR. If trunk recovery is genuinely needed, coordinate explicitly with the user first.'
  }
}

# --- Violation 3: git reset --hard ---
if ($norm -match '\bgit\s+reset\b' -and $norm -match '(?<![\w-])--hard(?![\w-])') {
  Write-Block `
    -Rule 'git reset --hard blocked' `
    -Detail "Discards uncommitted work + repositions HEAD destructively." `
    -Remediation 'Use `git restore <path>` or `git checkout <ref> -- <path>` for targeted resets. If full reset is truly required, set SKIP_GINEE_COMPLIANCE=1 for this invocation.'
}

# --- Violation 4: gh pr create without --body ---
if ($norm -match '\bgh\s+pr\s+create\b') {
  $hasBody = ($norm -match '(?<![\w-])(--body|--body-file|-B|--draft)(?![\w-])')
  if (-not $hasBody) {
    Write-Block `
      -Rule 'gh pr create missing PR body' `
      -Detail "Every ginee PR cites a requirement / NFR / mockup section / CR / ADR per core/templates/pr-description.md." `
      -Remediation 'Compose the PR body using the template (--body / --body-file); --draft also accepted for in-progress PRs.'
  }
}

exit 0

} catch {
  $null = $_
  exit 0
}
