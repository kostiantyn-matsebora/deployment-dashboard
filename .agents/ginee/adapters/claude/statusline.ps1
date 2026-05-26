#!/usr/bin/env pwsh
<#
.SYNOPSIS
  ginee compliance — Claude Code statusline (playbook #135 T4).
.DESCRIPTION
  Reads statusline JSON from stdin; writes ≤ 100-char line summarising compliance state.
  Format · fields · opt-out · tests: adapters/claude/install.md § Compliance hooks + statusline.
  MUST NOT crash host — uncaught errors fall back to bare `[ginee]` or no output.
.PARAMETER RepoRoot  Test-only: override repo root detection.
#>
[CmdletBinding()]
param(
  [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
  param([string]$Override)
  $root = if ($Override) { $Override } else {
    $r = & git rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $r) { return $null }
    $r.Trim()
  }
  if (-not $root) { return $null }
  # Validate the resolved root actually carries a .git entry — guards against
  # accidental -RepoRoot overrides outside a real working tree.
  if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) { return $null }
  return $root
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

function Get-IssueNumberFromBranch {
  param([string]$Branch)
  if (-not $Branch) { return $null }
  # Pattern 1: explicit `#N` in branch name.
  if ($Branch -match '#(\d+)') { return [int]$matches[1] }
  # Pattern 2: `t<N>` or `T<N>` prefix (common ginee task pattern).
  if ($Branch -match '/[tT](\d+)\b') { return [int]$matches[1] }
  return $null
}

function Test-OptimizedByTrailer {
  param([string]$Root)
  Push-Location $Root
  try {
    $log = & git log --format='%B%n--END--' 'origin/main..HEAD' 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $log) { return $false }
    return ($log -match '(?m)^Optimized-By:\s*ai-engineer\s*$')
  } finally {
    Pop-Location
  }
}

function Get-MinCapHeadroomPercent {
  param([string]$Root)
  # Walk hot-spec paths in the diff against origin/main; for each file with
  # frontmatter `cap-bytes`, compute headroom = (cap - size) / cap * 100.
  # Return the minimum (tightest file). Null if no hot specs in diff.
  Push-Location $Root
  try {
    $diff = & git diff --name-only 'origin/main..HEAD' 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $diff) { return $null }
    $minHeadroom = $null
    foreach ($path in $diff) {
      if (-not (Test-Path -LiteralPath $path)) { continue }
      $rel = ($path -replace '\\','/')
      $isHotSpec = ($rel -eq 'core/process.md' -or
                    $rel -match '^core/process/[^/]+\.md$' -or
                    $rel -match '^core/protocols/[^/]+\.md$' -or
                    $rel -match '^core/roles/[^/]+\.md$')
      if (-not $isHotSpec) { continue }
      $body = Get-Content -Raw -LiteralPath $path -ErrorAction SilentlyContinue
      if (-not $body) { continue }
      if ($body -notmatch '(?m)^cap-bytes:\s*(\d+)\s*$') { continue }
      $cap = [int]$matches[1]
      if ($cap -le 0) { continue }
      $size = [System.Text.Encoding]::UTF8.GetByteCount($body)
      $headroom = [math]::Round((($cap - $size) / $cap) * 100)
      if ($null -eq $minHeadroom -or $headroom -lt $minHeadroom) { $minHeadroom = $headroom }
    }
    return $minHeadroom
  } finally {
    Pop-Location
  }
}

function Get-CurrentBranch {
  param([string]$Root)
  Push-Location $Root
  try {
    $b = & git rev-parse --abbrev-ref HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $b) { return $null }
    return $b.Trim()
  } finally {
    Pop-Location
  }
}

# --- Main ---
# Statusline MUST NOT crash the host — wrap everything in try/catch with a
# bare `[ginee]` fallback.

try {
  # Consume stdin (Claude Code passes session JSON we don't currently need).
  try { $null = [Console]::In.ReadToEnd() } catch { $null = $_ }

  $root = Get-RepoRoot -Override $RepoRoot
  if (-not $root) {
    [Console]::Out.Write('[ginee] (no repo)')
    exit 0
  }

  if (Test-OptOut -Root $root -TacticId 'compliance-statusline') { exit 0 }

  $branch = Get-CurrentBranch -Root $root
  $issueN = Get-IssueNumberFromBranch -Branch $branch

  $parts = @('[ginee]')
  if ($issueN) { $parts += "#$issueN" }
  elseif ($branch) { $parts += "$branch" }

  # Phase / warm / dispatches / self-lint — placeholders until D43 plumbing.
  $parts += 'phase: ?'
  $parts += 'warm: ?'

  $trailer = if (Test-OptimizedByTrailer -Root $root) { 'ok' } else { 'needed' }
  $parts += "trailer: $trailer"

  $cap = Get-MinCapHeadroomPercent -Root $root
  if ($null -ne $cap) { $parts += "cap: $cap%" }

  $line = ($parts -join ' · ')
  # Enforce ≤ 100 char ceiling (defensive truncation).
  if ($line.Length -gt 100) { $line = $line.Substring(0, 99) + '…' }
  [Console]::Out.Write($line)
  exit 0

} catch {
  $null = $_
  [Console]::Out.Write('[ginee]')
  exit 0
}
