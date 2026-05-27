#!/usr/bin/env pwsh
<#
.SYNOPSIS  ginee compliance — PreToolUse hook on SendMessage (playbook #135 T8 / #144).
.DESCRIPTION  Anchor gate + per-cardinal rules: migrations/carry-forward-injection.md.
              In scope: SendMessage. Out of scope: Agent (first dispatch).
.PARAMETER TestInput  Test-only: pass JSON instead of reading stdin.
.PARAMETER RulesFile  Test-only: override path to the rules YAML.
.PARAMETER RepoRoot   Test-only: override repo root detection.
#>
[CmdletBinding()]
param(
  [string]$TestInput,
  [string]$RulesFile,
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

function Get-RuleTable {
  param([string]$Path)
  $rules = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $rules }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*$') { continue }
    if ($line -match '^([a-z][a-z0-9-]*):\s*(.+?)\s*$') {
      $rules[$matches[1].ToLower()] = $matches[2]
    }
  }
  return $rules
}

function Find-RuleForTarget {
  param([hashtable]$Rules, [string]$Target)
  if (-not $Target) { return $null }
  $t = $Target.ToLower()
  if ($Rules.ContainsKey($t)) { return $Rules[$t] }
  foreach ($k in $Rules.Keys) {
    if ($t.Contains($k)) { return $Rules[$k] }
  }
  return $null
}

function Write-Block {
  param([string]$Rule, [string]$Detail, [string]$Remediation)
  [Console]::Error.WriteLine("[ginee:gate] $Rule — $Detail")
  [Console]::Error.WriteLine("  Remediation: $Remediation")
  [Console]::Error.WriteLine("  Bypass (emergency): SKIP_GINEE_COMPLIANCE=1")
  [Console]::Error.WriteLine("  Opt out repo-wide: local/framework.config.yaml § compliance.disabled: [pretooluse-send-message-hook]")
  exit 2
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

# Only SendMessage (continuations). Not Agent (first dispatch — no anchor required).
if ([string]$payload.tool_name -ne 'SendMessage') { exit 0 }

$root = Get-RepoRoot -Override $RepoRoot
if (-not $root) { exit 0 }
if (Test-OptOut -Root $root -TacticId 'pretooluse-send-message-hook') { exit 0 }

$ti = $payload.tool_input
if (-not $ti) { exit 0 }

# Target (recipient) — try common field names. Claude Code uses `to`.
$target = ''
foreach ($k in @('to','target','recipient','agent','agent_name')) {
  if ($ti.PSObject.Properties.Name -contains $k -and $ti.$k) { $target = [string]$ti.$k; break }
}
if (-not $target) { exit 0 }

# Message body — try common field names.
$message = ''
foreach ($k in @('message','prompt','body','content')) {
  if ($ti.PSObject.Properties.Name -contains $k -and $ti.$k) { $message = [string]$ti.$k; break }
}
if (-not $message) { exit 0 }

# Anchor check — first non-blank line must lead with `[carry-forward]`.
$leading = ($message -split "`r?`n") | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1
if ($leading -and ($leading -match '^\[carry-forward\]')) { exit 0 }

$rulesPath = $RulesFile
if (-not $rulesPath) {
  $rulesPath = Join-Path $root 'adapters/claude/hooks/carry-forward-rules.yaml'
}
$rules = Get-RuleTable -Path $rulesPath
$ruleText = Find-RuleForTarget -Rules $rules -Target $target
if (-not $ruleText) { $ruleText = "stay within your role's surface; never edit outside owned paths." }

Write-Block `
  -Rule 'SendMessage continuation missing [carry-forward] anchor' `
  -Detail "Continuation to '$target' lacks the leading `[carry-forward] Remember: …` line required for warm-cardinal drift defence." `
  -Remediation "Prepend a single line: ``[carry-forward] Remember: $ruleText`` then the continuation body. Format spec: core/protocols/dispatch-prompt-schema.md."

exit 0

} catch {
  $null = $_
  exit 0
}
