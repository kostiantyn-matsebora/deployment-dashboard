#!/usr/bin/env pwsh
<#
.SYNOPSIS
  ginee installer hook — idempotently merge compliance-playbook entries into
  the adopter's .claude/settings.json.

.DESCRIPTION
  Invoked from install.ps1 (claude adapter branch) after pointer subagents +
  skills are copied. Wires the compliance playbook (#135) entries that live
  on the adopter side:

    Tier 1 (already shipped)
      - statusLine    (T4 / #140) — `adapters/claude/statusline.ps1`
      - PreToolUse    (T2 / #138) — `Edit|Write|MultiEdit` matcher
      - PreToolUse    (T3 / #139) — `Bash` matcher

    Tier 2 (this sync — playbook batch #141–#144)
      - UserPromptSubmit  (T5 / #141) — task-keyword → spec injection
      - PostToolUse       (T6 / #142) — `Edit|Write|MultiEdit`; self-check
                                       reminder on core/** edits
      - Stop              (T7 / #143) — block turn-end on incomplete work
      - PreToolUse        (T8 / #144) — `SendMessage` matcher; carry-forward
                                       anchor gate for warm cardinals

  NOT wired by this script: `scripts/context-economy-check.ps1`. That gate is
  framework-self-dev — it greps for `Optimized-By: ai-engineer` trailers and
  fires on `core/**` cap-bytes breaches, none of which adopter projects ever
  produce. The framework's own .claude/settings.json.example wires it for
  framework-self-dev use; adopter installs prune top-level `scripts/` so the
  file isn't present on the adopter side anyway.

  Adopter customisations are preserved:
    - `statusLine.command` already set to a non-ginee value → left alone.
    - Hook entries identified by command-string substring matching the ginee
      hook path; existing matches are not duplicated.
    - All other settings.json keys (env, theme, permissions, etc.) untouched.

  Re-running on an already-wired settings.json is a no-op.

.PARAMETER Target
  Adopter project root (the directory containing .claude/).

.PARAMETER FrameworkRel
  Relative path from project root to the ginee framework root.
  Default: `.agents/ginee`.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Target,
  [string]$FrameworkRel = '.agents/ginee'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$claudeDir   = Join-Path $Target '.claude'
$settingsPath = Join-Path $claudeDir 'settings.json'

# Canonical ginee commands.
$editHookCmd       = "pwsh -NoProfile -File $FrameworkRel/adapters/claude/hooks/pre-tool-use-edit.ps1"
$bashHookCmd       = "pwsh -NoProfile -File $FrameworkRel/adapters/claude/hooks/pre-tool-use-bash.ps1"
$sendMsgHookCmd    = "pwsh -NoProfile -File $FrameworkRel/adapters/claude/hooks/pre-tool-use-send-message.ps1"
$postEditHookCmd   = "pwsh -NoProfile -File $FrameworkRel/adapters/claude/hooks/post-tool-use-edit.ps1"
$upshHookCmd       = "pwsh -NoProfile -File $FrameworkRel/adapters/claude/hooks/user-prompt-submit.ps1"
$stopHookCmd       = "pwsh -NoProfile -File $FrameworkRel/adapters/claude/hooks/stop.ps1"
$sessionStartCmd   = "pwsh -NoProfile -File $FrameworkRel/adapters/claude/hooks/session-start.ps1"
$attestObCmd       = "pwsh -NoProfile -File $FrameworkRel/adapters/claude/hooks/attest-optimized-by.ps1"
$statuslineCmd     = "pwsh -NoProfile -File $FrameworkRel/adapters/claude/statusline.ps1"

# Marker substrings used for idempotence — anything matching is considered
# "ginee-owned" and is replaced in place rather than duplicated.
$editHookMarker       = "adapters/claude/hooks/pre-tool-use-edit"
$bashHookMarker       = "adapters/claude/hooks/pre-tool-use-bash"
$sendMsgHookMarker    = "adapters/claude/hooks/pre-tool-use-send-message"
$postEditHookMarker   = "adapters/claude/hooks/post-tool-use-edit"
$upshHookMarker       = "adapters/claude/hooks/user-prompt-submit"
$stopHookMarker       = "adapters/claude/hooks/stop"
$sessionStartMarker   = "adapters/claude/hooks/session-start"
$attestObMarker       = "adapters/claude/hooks/attest-optimized-by"
$statuslineMarker     = "adapters/claude/statusline"

# T11 / #147 — main-thread permission lockdown. Framework-scoped deny rules
# only; adopter project code untouched.
$ginreeDenyRules = @(
  "Edit($FrameworkRel/core/**)"
  "Edit($FrameworkRel/adapters/**)"
  "Edit($FrameworkRel/extras/**)"
  "Write($FrameworkRel/core/**)"
  "Write($FrameworkRel/adapters/**)"
  "Write($FrameworkRel/extras/**)"
  "MultiEdit($FrameworkRel/core/**)"
  "MultiEdit($FrameworkRel/adapters/**)"
  "MultiEdit($FrameworkRel/extras/**)"
  "Bash(rm -rf:*)"
  "Bash(git push --force:*)"
  "Bash(git push -f:*)"
  "Bash(git reset --hard:*)"
)

New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null

# --- Load existing settings (or seed `{}`) ---
if (Test-Path -LiteralPath $settingsPath) {
  $raw = Get-Content -Raw -LiteralPath $settingsPath
  if (-not $raw -or -not $raw.Trim()) { $raw = '{}' }
  try {
    $settings = $raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
  } catch {
    Write-Warning "settings.json: failed to parse — leaving file untouched. Manual merge required per adapters/claude/install.md § Compliance hooks."
    return
  }
} else {
  $settings = @{}
}

$anyChange = $false

# --- statusLine (T4) ---
if (-not $settings.ContainsKey('statusLine')) {
  $settings['statusLine'] = @{
    type    = 'command'
    command = $statuslineCmd
  }
  $anyChange = $true
} else {
  $existingCmd = ''
  if ($settings['statusLine'] -is [hashtable] -and $settings['statusLine'].ContainsKey('command')) {
    $existingCmd = [string]$settings['statusLine']['command']
  }
  if ($existingCmd -match [regex]::Escape($statuslineMarker)) {
    if ($existingCmd -ne $statuslineCmd) {
      $settings['statusLine']['command'] = $statuslineCmd
      $anyChange = $true
    }
  }
}

# --- hooks scaffolding ---
if (-not $settings.ContainsKey('hooks')) { $settings['hooks'] = @{} }
foreach ($eventKey in @('PreToolUse','PostToolUse','UserPromptSubmit','Stop','SessionStart')) {
  if (-not $settings['hooks'].ContainsKey($eventKey)) {
    $settings['hooks'][$eventKey] = @()
  }
}

# Helpers — scan an event's entries for a ginee marker; either anywhere in
# the entry's hooks, or restricted to a specific matcher.
function Test-EntryPresent {
  param([array]$Entries, [string]$Marker)
  foreach ($entry in $Entries) {
    if ($entry -isnot [hashtable]) { continue }
    if (-not $entry.ContainsKey('hooks')) { continue }
    foreach ($hook in $entry['hooks']) {
      if ($hook -is [hashtable] -and $hook.ContainsKey('command')) {
        if ([string]$hook['command'] -match [regex]::Escape($Marker)) { return $true }
      }
    }
  }
  return $false
}

# Ensure a hook entry exists; add a new top-level entry under the event
# (with the provided matcher) when no entry carrying the marker is found.
function Add-EventEntry {
  param([string]$EventKey, [string]$Marker, [string]$Matcher, [string]$Cmd, [int]$Timeout = 10)
  $entries = @($settings['hooks'][$EventKey])
  if (Test-EntryPresent -Entries $entries -Marker $Marker) { return $false }
  $newEntry = @{
    hooks = @(@{ type = 'command'; command = $Cmd; timeout = $Timeout })
  }
  if ($Matcher) { $newEntry['matcher'] = $Matcher }
  $settings['hooks'][$EventKey] = @($entries + $newEntry)
  return $true
}

# Append a hook command to an existing PostToolUse entry that matches a sister
# marker. Used to land T6's post-edit hook inside the same entry as the
# existing context-economy-check (both target Edit|Write|MultiEdit).
# --- PreToolUse entries (T2 / T3 / T8 / T13) ---
if (Add-EventEntry -EventKey 'PreToolUse' -Marker $editHookMarker    -Matcher 'Edit|Write|MultiEdit' -Cmd $editHookCmd)    { $anyChange = $true }
if (Add-EventEntry -EventKey 'PreToolUse' -Marker $bashHookMarker    -Matcher 'Bash'                  -Cmd $bashHookCmd)    { $anyChange = $true }
if (Add-EventEntry -EventKey 'PreToolUse' -Marker $sendMsgHookMarker -Matcher 'SendMessage'           -Cmd $sendMsgHookCmd) { $anyChange = $true }
if (Add-EventEntry -EventKey 'PreToolUse' -Marker $attestObMarker    -Matcher 'Bash'                  -Cmd $attestObCmd)    { $anyChange = $true }

# --- PostToolUse entries (T6 — adopter-side self-check reminder) ---
# Framework-self-dev context-economy-check.ps1 is NOT wired here; it lives in
# the framework's own .claude/settings.json.example only (adopter installs
# prune top-level scripts/ — that file is not present on the adopter side).
if (Add-EventEntry -EventKey 'PostToolUse' -Marker $postEditHookMarker -Matcher 'Edit|Write|MultiEdit' -Cmd $postEditHookCmd) { $anyChange = $true }

# --- UserPromptSubmit (T5) ---
if (Add-EventEntry -EventKey 'UserPromptSubmit' -Marker $upshHookMarker -Matcher $null -Cmd $upshHookCmd) { $anyChange = $true }

# --- Stop (T7) ---
if (Add-EventEntry -EventKey 'Stop' -Marker $stopHookMarker -Matcher $null -Cmd $stopHookCmd) { $anyChange = $true }

# --- SessionStart (T12 / #148) ---
if (Add-EventEntry -EventKey 'SessionStart' -Marker $sessionStartMarker -Matcher $null -Cmd $sessionStartCmd) { $anyChange = $true }

# --- Main-thread permission lockdown (T11 / #147) ---
# Honours per-tactic opt-out: local/framework.config.yaml § compliance.disabled: [main-thread-permissions]
$mainThreadOptOut = $false
$cfgPath = Join-Path $Target 'local/framework.config.yaml'
if (Test-Path -LiteralPath $cfgPath) {
  $cfgBody = Get-Content -Raw -LiteralPath $cfgPath
  if ($cfgBody -and $cfgBody -match '(?m)^compliance:\s*$' -and $cfgBody -match '(?m)^\s+-\s+main-thread-permissions\s*$') {
    $mainThreadOptOut = $true
  }
}
if (-not $mainThreadOptOut) {
  if (-not $settings.ContainsKey('permissions')) { $settings['permissions'] = @{} }
  if ($settings['permissions'] -isnot [hashtable]) { $settings['permissions'] = @{} }
  if (-not $settings['permissions'].ContainsKey('deny')) { $settings['permissions']['deny'] = @() }
  $existingDeny = @($settings['permissions']['deny'])
  $merged = @($existingDeny)
  foreach ($rule in $ginreeDenyRules) {
    if ($existingDeny -notcontains $rule) {
      $merged = @($merged + $rule)
      $anyChange = $true
    }
  }
  $settings['permissions']['deny'] = $merged
}

# --- Persist if changed ---
if ($anyChange) {
  $json = ($settings | ConvertTo-Json -Depth 10)
  Set-Content -LiteralPath $settingsPath -Value $json -NoNewline -Encoding utf8
  Write-Host "Synced .claude/settings.json (statusLine + PreToolUse/PostToolUse/UserPromptSubmit/Stop hooks)" -ForegroundColor Green
} else {
  Write-Host ".claude/settings.json already current — no change" -ForegroundColor DarkGray
}
