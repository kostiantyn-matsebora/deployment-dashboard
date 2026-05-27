#!/usr/bin/env pwsh
<#
.SYNOPSIS  ginee compliance — Stop hook (playbook #135 T7 / #143).
.DESCRIPTION  Block conditions + anti-loop guard: migrations/stop-hook.md.
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

function Get-TranscriptText {
  # Claude Code passes transcript inline (older versions) OR via transcript_path.
  param($Payload, [string]$Root)
  if ($Payload.PSObject.Properties.Name -contains 'transcript' -and $Payload.transcript) {
    return [string]$Payload.transcript
  }
  if ($Payload.PSObject.Properties.Name -contains 'transcript_path' -and $Payload.transcript_path) {
    $tp = [string]$Payload.transcript_path
    if (-not [System.IO.Path]::IsPathRooted($tp) -and $Root) { $tp = Join-Path $Root $tp }
    if (Test-Path -LiteralPath $tp) {
      try { return Get-Content -Raw -LiteralPath $tp } catch { return '' }
    }
  }
  return ''
}

function Write-Block {
  param([string]$Rule, [string]$Detail, [string]$Remediation)
  [Console]::Error.WriteLine("[ginee:stop-gate] $Rule — $Detail")
  [Console]::Error.WriteLine("  Remediation: $Remediation")
  [Console]::Error.WriteLine("  Bypass (emergency): SKIP_GINEE_COMPLIANCE=1")
  [Console]::Error.WriteLine("  Opt out repo-wide: local/framework.config.yaml § compliance.disabled: [stop-hook]")
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

# Anti-loop guard — parent #135 anti-pattern forbids trapping the LLM in a re-entry loop.
if ($payload.PSObject.Properties.Name -contains 'stop_hook_active' -and $payload.stop_hook_active) { exit 0 }

$root = Get-RepoRoot -Override $RepoRoot
if (-not $root) { exit 0 }

if (Test-OptOut -Root $root -TacticId 'stop-hook') { exit 0 }

$transcript = Get-TranscriptText -Payload $payload -Root $root

# Block 1 — last cardinal return missing `<!-- self-lint: pass -->` tail.
if ($transcript) {
  $returnHeaders = '(?ms)## (Files touched|Decisions made|Verification log|Open issues|Next dispatch needed|Source reads)'
  $last = -1
  foreach ($m in [regex]::Matches($transcript, $returnHeaders)) { if ($m.Index -gt $last) { $last = $m.Index } }
  if ($last -ge 0 -and ($transcript.Substring($last) -notmatch '<!-- self-lint: pass -->')) {
    Write-Block `
      -Rule 'cardinal return missing self-lint marker' `
      -Detail "The most recent specialist return omits the literal `<!-- self-lint: pass -->` tail required by core/templates/phase-report.md." `
      -Remediation 'Re-dispatch is FORBIDDEN for format alone — acknowledge as advisory in main thread, then continue. Re-running passes the gate.'
  }
}

# Block 2 — gh pr create without acceptance, under poll policy.
if ($transcript -and ($transcript -match 'gh\s+pr\s+create\b')) {
  $idx = $transcript.LastIndexOf('gh pr create')
  $tail = $transcript.Substring($idx)
  $accepted = ($tail -match '(?i)(accept|merged|approve|looks\s+good|lgtm|ship\s+it)\b')
  $config = Join-Path $root 'local/framework.config.yaml'
  $poll = $true  # default policy
  if (Test-Path -LiteralPath $config) {
    $cfg = Get-Content -Raw -LiteralPath $config
    if ($cfg -match '(?m)^\s*ci-watch-policy:\s*(\S+)\s*$' -and $matches[1] -ne 'poll') { $poll = $false }
  }
  if ($poll -and -not $accepted) {
    Write-Block `
      -Rule 'PR opened without CI-watch sign-off' `
      -Detail "A `gh pr create` was issued earlier this turn; default ci-watch policy is `poll` but no CI-green signal is recorded." `
      -Remediation 'Enter CI-watch per core/protocols/ci-watch.md OR hand back. Switch posture via ci-watch-policy: async|hybrid|disabled.'
  }
}

# Block 3 — open ginee:in-progress issue (`<N>-` branch) without Phase-8 close. Offline-safe.
$branch = (& git rev-parse --abbrev-ref HEAD 2>$null)
if ($LASTEXITCODE -eq 0 -and $branch -and ($branch.Trim() -match '^(\d+)[-_/]')) {
  $issueN = [int]$matches[1]
  if ((Get-Command gh -ErrorAction SilentlyContinue)) {
    try {
      $state = & gh issue view $issueN --json state,labels 2>$null
      if ($LASTEXITCODE -eq 0 -and $state) {
        $issue = $state | ConvertFrom-Json -ErrorAction Stop
        $inProg = ($issue.labels | Where-Object { [string]$_.name -eq 'ginee:in-progress' } | Select-Object -First 1)
        $closed = ($transcript -match '(?im)^\s*##\s+Phase\s+8\b' -or $transcript -match "gh\s+issue\s+close\s+$issueN")
        if ($inProg -and -not $closed -and $issue.state -eq 'OPEN') {
          Write-Block `
            -Rule 'open ginee:in-progress issue without Phase-8 close' `
            -Detail "Issue #$issueN remains OPEN with the ginee:in-progress label and no Phase-8 close comment in this turn." `
            -Remediation 'Post `gh issue close <N> -c ...` before ending the turn, OR hand back with a stop-state note.'
        }
      }
    } catch { $null = $_ }
  }
}

exit 0

} catch {
  $null = $_
  exit 0
}
