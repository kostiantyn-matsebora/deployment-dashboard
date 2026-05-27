#!/usr/bin/env pwsh
<#
.SYNOPSIS  ginee compliance — SessionStart hook (playbook #135 T12 / #148).
.DESCRIPTION  Scans + injection format: migrations/session-start-hook.md.
#>
[CmdletBinding()]
param([string]$TestInput, [string]$RepoRoot, [switch]$NoGh)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:SKIP_GINEE_COMPLIANCE -eq '1') { exit 0 }

function Read-Payload([string]$T) {
  if ($T) { return $T }
  try { return [Console]::In.ReadToEnd() } catch { return '' }
}

function Get-RepoRoot([string]$Override) {
  if ($Override) { return $Override }
  $r = & git rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $r) { return $null } else { return $r.Trim() }
}

function Test-OptOut([string]$Root, [string]$Id) {
  $cfg = Join-Path $Root 'local/framework.config.yaml'
  if (-not (Test-Path -LiteralPath $cfg)) { return $false }
  $body = Get-Content -Raw -LiteralPath $cfg
  if (-not $body -or $body -notmatch '(?m)^compliance:\s*$') { return $false }
  return ($body -match "(?m)^\s+-\s+$([regex]::Escape($Id))\s*$")
}

function Get-IssueScan([switch]$NoGh) { # PSAnalyzer: aggregate-return.
  if ($NoGh -or -not (Get-Command gh -ErrorAction SilentlyContinue)) { return @() }
  $json = & gh issue list --label ginee:in-progress --json number,title,labels --limit 20 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $json) { return @() }
  try { $list = $json | ConvertFrom-Json -ErrorAction Stop } catch { return @() }
  if (-not $list) { return @() }
  return @($list | ForEach-Object {
    $phase = ''
    foreach ($l in @($_.labels)) { if ([string]$l.name -match '^ginee:phase-(\d+)$') { $phase = $matches[1] } }
    [pscustomobject]@{ Number = $_.number; Title = $_.title; Phase = $phase }
  })
}

function Get-BranchScan([string]$Root) {
  Push-Location $Root
  try {
    $branch = (& git rev-parse --abbrev-ref HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $branch -or ($branch.Trim() -notmatch '^issue/\d+')) { return $null }
    $b = $branch.Trim()
    $ahead = 0
    $rl = & git rev-list --count --left-right "origin/main...HEAD" 2>$null
    if ($LASTEXITCODE -eq 0 -and $rl -match '\d+\s+(\d+)') { $ahead = [int]$matches[1] }
    $dirty = $false
    $st = & git status --porcelain 2>$null
    if ($LASTEXITCODE -eq 0 -and $st -and $st.Trim()) { $dirty = $true }
    return [pscustomobject]@{ Branch = $b; Ahead = $ahead; Dirty = $dirty }
  } finally { Pop-Location }
}

# --- Main ---
try {
  $null = Read-Payload $TestInput   # Drain stdin; SessionStart payload presence not required.
  $root = Get-RepoRoot $RepoRoot
  if (-not $root -or (Test-OptOut $root 'session-start-hook')) { exit 0 }

  $lines = @()
  $bi = Get-BranchScan $root
  if ($bi) {
    $line = "branch: $($bi.Branch) — $($bi.Ahead) ahead of origin/main"
    if ($bi.Dirty) { $line += ' · uncommitted changes' }
    $lines += $line
  }

  $issues = @(Get-IssueScan -NoGh:$NoGh)
  if ($issues.Count -gt 0) {
    $lines += 'open ginee:in-progress issues:'
    foreach ($i in $issues) {
      $tag = if ($i.Phase) { " · phase $($i.Phase)" } else { '' }
      $lines += "  - #$($i.Number)$tag — $($i.Title)"
    }
  }

  if ($lines.Count -eq 0) { exit 0 }   # Quiet on empty.

  [Console]::Out.WriteLine((@{
    hookSpecificOutput = @{
      hookEventName     = 'SessionStart'
      additionalContext = "[ginee:resume]`n" + ($lines -join "`n")
    }
  } | ConvertTo-Json -Depth 5 -Compress))
  exit 0
} catch { $null = $_; exit 0 }
