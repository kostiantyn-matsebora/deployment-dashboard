#!/usr/bin/env pwsh
<#
.SYNOPSIS  ginee compliance — UserPromptSubmit hook (playbook #135 T5 / #141).
.DESCRIPTION  Triggers + bodies + acceptance gates: migrations/user-prompt-submit-hook.md.
.PARAMETER TestInput  Test-only: pass JSON instead of reading stdin.
.PARAMETER TriggersFile  Test-only: override path to the YAML triggers file.
.PARAMETER RepoRoot   Test-only: override repo root detection.
#>
[CmdletBinding()]
param(
  [string]$TestInput,
  [string]$TriggersFile,
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

# Parse the block format in keyword-triggers.yaml (pattern / label / context-heredoc;
# blank-line separated). Returns an array of @{ Pattern; Label; Context }.
function Get-TriggerList { # PSAnalyzer: aggregate-return; plural by design.
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return @() }
  $lines = Get-Content -LiteralPath $Path
  $triggers = @()
  $cur = $null
  $inContext = $false
  foreach ($raw in $lines) {
    $line = [string]$raw
    if ($line -match '^\s*#') { continue }
    if ($line.Trim() -eq '') {
      if ($cur -and $cur.Pattern -and $cur.Label) {
        $cur.Context = ($cur.Context -join "`n").TrimEnd()
        $triggers += [pscustomobject]$cur
      }
      $cur = $null
      $inContext = $false
      continue
    }
    if (-not $cur) { $cur = @{ Pattern=''; Label=''; Context=@() } }
    if ($inContext) {
      if ($line -match '^(  )(.*)$') {
        $cur.Context += $matches[2]
        continue
      } else {
        # Dedent break — context block ended; fall through to header parse.
        $inContext = $false
      }
    }
    if ($line -match "^pattern:\s*'(.*)'\s*$") {
      $cur.Pattern = $matches[1]
    } elseif ($line -match '^pattern:\s*(\S.*)$') {
      $cur.Pattern = $matches[1].Trim()
    } elseif ($line -match '^label:\s*(\S.*)$') {
      $cur.Label = $matches[1].Trim()
    } elseif ($line -match '^context:\s*\|\s*$') {
      $inContext = $true
    }
  }
  if ($cur -and $cur.Pattern -and $cur.Label) {
    $cur.Context = ($cur.Context -join "`n").TrimEnd()
    $triggers += [pscustomobject]$cur
  }
  return $triggers
}

# --- Main ---
try {

$raw = Read-Payload -TestInput $TestInput
if (-not $raw) { exit 0 }

try {
  $payload = $raw | ConvertFrom-Json -ErrorAction Stop
} catch {
  exit 0
}

$prompt = ''
if ($payload.PSObject.Properties.Name -contains 'prompt') {
  $prompt = [string]$payload.prompt
}
if (-not $prompt) { exit 0 }

$root = Get-RepoRoot -Override $RepoRoot
if (-not $root) { exit 0 }

if (Test-OptOut -Root $root -TacticId 'user-prompt-submit-hook') { exit 0 }

$triggersPath = $TriggersFile
if (-not $triggersPath) {
  $triggersPath = Join-Path $root 'adapters/claude/hooks/keyword-triggers.yaml'
}
$triggers = Get-TriggerList -Path $triggersPath
if (-not $triggers -or $triggers.Count -eq 0) { exit 0 }

$injections = @()
foreach ($t in $triggers) {
  try {
    if ([regex]::IsMatch($prompt, $t.Pattern, 'IgnoreCase')) {
      $injections += "[ginee:context:$($t.Label)]`n$($t.Context)"
    }
  } catch { $null = $_ }  # Bad regex in YAML — skip; never break the prompt.
}
if ($injections.Count -eq 0) { exit 0 }

[Console]::Out.WriteLine((@{
  hookSpecificOutput = @{
    hookEventName     = 'UserPromptSubmit'
    additionalContext = ($injections -join "`n`n")
  }
} | ConvertTo-Json -Depth 5 -Compress))
exit 0

} catch {
  $null = $_
  exit 0
}
