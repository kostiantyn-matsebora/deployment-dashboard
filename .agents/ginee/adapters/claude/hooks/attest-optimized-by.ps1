#!/usr/bin/env pwsh
<#
.SYNOPSIS  ginee compliance — Optimized-By trailer attestation gate (playbook #135 T13).
.DESCRIPTION  Ask-mode gate firing at `git push`: scans the to-be-pushed range
              (<upstream>..HEAD) for any commit carrying `Optimized-By: ai-engineer`.
              If found AND no `Agent(subagent_type=ai-engineer)` dispatch in the
              session transcript → emits `permissionDecision: "ask"` so Claude Code
              prompts the user before allowing the push.
              Spec: migrations/optimized-by-attestation.md.
#>
[CmdletBinding()]
param([string]$TestInput, [string]$RepoRoot, [string]$TranscriptOverride, [string]$RangeOverride)

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

function Get-TranscriptText($Payload, [string]$Root, [string]$Override) {
  if ($Override) {
    if (Test-Path -LiteralPath $Override) { return Get-Content -Raw -LiteralPath $Override } else { return '' }
  }
  if ($Payload.PSObject.Properties.Name -contains 'transcript' -and $Payload.transcript) {
    return [string]$Payload.transcript
  }
  if ($Payload.PSObject.Properties.Name -contains 'transcript_path' -and $Payload.transcript_path) {
    $tp = [string]$Payload.transcript_path
    if (-not [System.IO.Path]::IsPathRooted($tp) -and $Root) { $tp = Join-Path $Root $tp }
    if (Test-Path -LiteralPath $tp) { try { return Get-Content -Raw -LiteralPath $tp } catch { return '' } }
  }
  return ''
}

# Get the concatenated commit-message text for every commit in <range>. Returns
# '' if the range is empty or git fails. (Singular Get-RangeBody by analyzer
# convention — the return is one combined blob, not per-commit objects.)
function Get-RangeBody([string]$Root, [string]$Range) {
  Push-Location $Root
  try {
    $out = & git log $Range --format=%B%n--END-COMMIT-- 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { return '' }
    return [string]$out
  } finally { Pop-Location }
}

# Resolve the to-be-pushed range. Honours an explicit override (test injection
# OR adopter-supplied env var); otherwise asks git for the configured upstream.
function Get-PushRange([string]$Root, [string]$Override) {
  if ($Override) { return $Override }
  Push-Location $Root
  try {
    $upstream = & git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $upstream) { return "$($upstream.Trim())..HEAD" }
    # No upstream configured (first push) — compare against origin/main if it exists,
    # else origin/master, else give up + let `git push` resolve itself.
    foreach ($base in @('origin/main','origin/master')) {
      $check = & git rev-parse --verify --quiet $base 2>$null
      if ($LASTEXITCODE -eq 0 -and $check) { return "$base..HEAD" }
    }
    return ''
  } finally { Pop-Location }
}

# --- Main ---
try {
  $raw = Read-Payload $TestInput
  if (-not $raw) { exit 0 }
  try { $payload = $raw | ConvertFrom-Json -ErrorAction Stop } catch { exit 0 }

  $tool = ''
  if ($payload.PSObject.Properties.Name -contains 'tool_name') { $tool = [string]$payload.tool_name }
  if ($tool -ne 'Bash') { exit 0 }

  $cmd = ''
  if ($payload.PSObject.Properties.Name -contains 'tool_input' -and $payload.tool_input -and
      ($payload.tool_input.PSObject.Properties.Name -contains 'command')) {
    $cmd = [string]$payload.tool_input.command
  }
  if (-not $cmd) { exit 0 }

  # Self-filter: only fire on `git push` invocations.
  if ($cmd -notmatch '\bgit\s+push\b') { exit 0 }

  $root = Get-RepoRoot $RepoRoot
  if (-not $root) { exit 0 }
  if (Test-OptOut $root 'optimized-by-attestation') { exit 0 }

  $range = Get-PushRange $root $RangeOverride
  if (-not $range) { exit 0 }   # No resolvable range — fail-open.

  $bodies = Get-RangeBody -Root $root -Range $range
  if (-not $bodies) { exit 0 }  # Empty range — fail-open.

  # No Optimized-By trailer in any commit in the range → no attestation needed.
  if ($bodies -notmatch 'Optimized-By:\s*ai-engineer') { exit 0 }

  # Trailer present in the range → require ai-engineer dispatch in the transcript.
  $transcript = Get-TranscriptText -Payload $payload -Root $root -Override $TranscriptOverride
  if ($transcript -and ($transcript -match '"subagent_type"\s*:\s*"ai-engineer"')) { exit 0 }

  # Trailer claimed in the to-be-pushed range without verifiable dispatch — ask the user.
  $reason = "[ginee:attest] Push range $range contains a commit with Optimized-By: ai-engineer trailer, but no Agent(subagent_type=ai-engineer) dispatch found in this session's transcript. Proceed anyway (cross-session optimization · manual lossless pass · WIP push) or cancel + run the ai-engineer optimization pass first?"
  [Console]::Out.WriteLine((@{
    hookSpecificOutput = @{
      hookEventName            = 'PreToolUse'
      permissionDecision       = 'ask'
      permissionDecisionReason = $reason
    }
  } | ConvertTo-Json -Depth 5 -Compress))
  exit 0
} catch { $null = $_; exit 0 }
