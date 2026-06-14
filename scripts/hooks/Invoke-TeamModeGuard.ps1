#Requires -Version 7.0

<#
.SYNOPSIS
    Multi-mode hook that enforces "mode is sticky" for /feature-team sessions and
    persists a resumable session record.

    The session record lives at .team-process/run/session.json (gitignored runtime
    state). Its EXISTENCE = team mode is active. It is the durable run ledger: the
    hook writes an initial record on TeamCreate; the orchestrator enriches it
    (roster, phase, ledger) as the run proceeds; it is read on SessionStart to
    resume + remind rather than wiped.

    Modes:
      (default, PreToolUse(Agent|Task)) when a session record exists, block foreground
        in-session subagent spawns (no team_name). Subagents and member spawns
        (tool_input.team_name present) pass through.
      -SetMarker     PostToolUse(TeamCreate): create/merge the session record (preserves
                     an existing record's ledger/roster/createdAt on re-create).
      -ClearMarker   PostToolUse(TeamDelete): remove the session record + lane.
      -EndSession    Manual abandon of a stale session (same effect as -ClearMarker;
                     use after a reboot where no TeamDelete will fire).
      -OnSessionStart SessionStart: if a session record exists, emit a resume reminder
                     as additionalContext. Does NOT clear (that is the whole point —
                     the run survives a session boundary / reboot).

.PARAMETER AsLibrary    Define functions without executing entry block (for Pester).
.PARAMETER SetMarker    Write/merge the session record and exit.
.PARAMETER ClearMarker  Remove the session record + lane and exit.
.PARAMETER EndSession   Alias of -ClearMarker for manual abandonment.
.PARAMETER OnSessionStart Emit the resume reminder (SessionStart) and exit.
#>

[CmdletBinding()]
param(
    [switch]$AsLibrary,
    [switch]$SetMarker,
    [switch]$ClearMarker,
    [switch]$EndSession,
    [switch]$OnSessionStart
)

function Get-TeamProcessRunDir { param([string]$Root) return (Join-Path $Root '.team-process' 'run') }
function Get-SessionFilePath   { param([string]$Root) return (Join-Path (Get-TeamProcessRunDir $Root) 'session.json') }
function Get-LaneFilePath      { param([string]$Root) return (Join-Path (Get-TeamProcessRunDir $Root) 'lane') }

# PreToolUse decision — unchanged rule, now keyed on the session record's existence.
function Get-TeamModeDecision {
    param(
        [bool]$IsSubagent,
        [bool]$SessionActive,
        [bool]$HasTeamName
    )
    if ($IsSubagent)        { return @{ Block = $false } }
    if (-not $SessionActive) { return @{ Block = $false } }
    if ($HasTeamName)       { return @{ Block = $false } }
    return @{
        Block  = $true
        Reason = "Team mode is active (/feature-team session in progress): dispatch to a spawned member via SendMessage, or spawn a member with 'team_name' set - not a foreground in-session subagent. Mode is sticky; to change substrate, surface it as a decision. To abandon a stale session: pwsh -NoProfile -File scripts/hooks/Invoke-TeamModeGuard.ps1 -EndSession. See .claude/team-process/process.md -> 'Mode is sticky' / 'Session state & resume'."
    }
}

# Extract the team name from a PostToolUse(TeamCreate) payload (tool_input/tool_response).
function Get-TeamCreateName {
    param($Payload)
    foreach ($src in @($Payload.tool_input, $Payload.tool_response)) {
        if ($null -eq $src) { continue }
        foreach ($f in @('team_name', 'name', 'team')) {
            $v = $src.$f
            if (-not [string]::IsNullOrWhiteSpace([string]$v)) { return [string]$v }
        }
    }
    return ''
}

# Build a fresh session record. $Existing (if any) preserves resume data on re-create.
function New-SessionRecord {
    param(
        [string]$Team,
        [string]$Branch,
        [datetime]$Now,
        $Existing
    )
    $ts  = $Now.ToUniversalTime().ToString('o')
    $rec = [ordered]@{}
    $rec.team      = if ($Team) { $Team } elseif ($Existing -and $Existing.team) { [string]$Existing.team } else { 'unknown' }
    if ($Branch) { $rec.branch = $Branch }
    elseif ($Existing -and $Existing.branch) { $rec.branch = [string]$Existing.branch }
    if ($Existing -and $Existing.issue) { $rec.issue = [string]$Existing.issue }
    $rec.phase     = if ($Existing -and $Existing.phase) { [string]$Existing.phase } else { 'created' }
    $rec.createdAt = if ($Existing -and $Existing.createdAt) { [string]$Existing.createdAt } else { $ts }
    $rec.updatedAt = $ts
    # Omit roster/ledger when empty (optional; avoids ConvertTo-Json's @()->null quirk).
    # The orchestrator adds them as the run produces waves.
    $roster = if ($Existing -and $Existing.roster) { @($Existing.roster) } else { @() }
    if ($roster.Count -gt 0) { $rec.roster = $roster }
    $ledger = if ($Existing -and $Existing.ledger) { @($Existing.ledger) } else { @() }
    if ($ledger.Count -gt 0) { $rec.ledger = $ledger }
    return $rec
}

# Compose the SessionStart resume reminder from a parsed session record.
function Get-SessionReminder {
    param($Record)
    $team   = if ($Record.team) { $Record.team } else { 'unknown' }
    $branch = if ($Record.branch) { $Record.branch } else { '(unrecorded)' }
    $phase  = if ($Record.phase) { $Record.phase } else { '(unrecorded)' }
    $opened = if ($Record.createdAt) { $Record.createdAt } else { '(unrecorded)' }
    $nRost  = if ($Record.roster) { @($Record.roster).Count } else { 0 }
    $nLed   = if ($Record.ledger) { @($Record.ledger).Count } else { 0 }
    return @"
[!] team-process session ACTIVE - a /feature-team run is in progress (mode is sticky).
Team: $team | Branch: $branch | Phase: $phase | Opened: $opened
RESUME, do not restart: continue from the ledger; spawn members with team_name set, never
foreground in-session subagents (the team-mode guard will block them). Roster: $nRost member(s).
Ledger: $nLed wave(s). To ABANDON: pwsh -NoProfile -File scripts/hooks/Invoke-TeamModeGuard.ps1 -EndSession.
Full record: .team-process/run/session.json. See .claude/team-process/process.md -> 'Session state & resume'.
"@.Trim()
}

# Write/merge the session record under $Root. Returns the written record.
function Set-TeamSession {
    param([string]$Root, [string]$Team, [string]$Branch, [datetime]$Now)
    $sessionFile = Get-SessionFilePath -Root $Root
    $existing = $null
    if (Test-Path -LiteralPath $sessionFile) {
        # -DateKind String: keep ISO timestamps as strings so they round-trip exactly
        # (default parsing types them as [DateTime], corrupting the format on re-write).
        try { $existing = Get-Content -LiteralPath $sessionFile -Raw | ConvertFrom-Json -DateKind String -ErrorAction Stop } catch { $existing = $null }
    }
    $record = New-SessionRecord -Team $Team -Branch $Branch -Now $Now -Existing $existing
    $dir = Get-TeamProcessRunDir -Root $Root
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Set-Content -LiteralPath $sessionFile -Value ($record | ConvertTo-Json -Depth 8) -Encoding utf8NoBOM
    return $record
}

# Remove the session record + lane (TeamDelete or manual -EndSession).
function Clear-TeamSession {
    param([string]$Root)
    foreach ($f in @((Get-SessionFilePath -Root $Root), (Get-LaneFilePath -Root $Root))) {
        if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
    }
}

# Return the SessionStart additionalContext JSON for an active session, or '' if none.
function Get-SessionStartContext {
    param([string]$Root)
    $sessionFile = Get-SessionFilePath -Root $Root
    if (-not (Test-Path -LiteralPath $sessionFile)) { return '' }
    $record = $null
    try { $record = Get-Content -LiteralPath $sessionFile -Raw | ConvertFrom-Json -DateKind String -ErrorAction Stop } catch { return '' }
    if (-not $record) { return '' }
    $msg = Get-SessionReminder -Record $record
    return (@{ hookSpecificOutput = @{ hookEventName = 'SessionStart'; additionalContext = $msg } } | ConvertTo-Json -Depth 5 -Compress)
}

if (-not $AsLibrary) {
    $root = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
    if (-not $root) { $root = (Get-Location).Path }
    $root        = ([string]$root).Trim()
    $sessionFile = Get-SessionFilePath -Root $root

    if ($SetMarker) {
        $hookInputJson = ''
        if ([Console]::IsInputRedirected) { try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' } }
        $payload = $null
        if (-not [string]::IsNullOrWhiteSpace($hookInputJson)) {
            try { $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop } catch { $null = $_ }
        }
        $team   = if ($payload) { Get-TeamCreateName -Payload $payload } else { '' }
        $branch = (& git -C $root rev-parse --abbrev-ref HEAD 2>$null) | Select-Object -First 1
        $branch = ([string]$branch).Trim()
        Set-TeamSession -Root $root -Team $team -Branch $branch -Now (Get-Date) | Out-Null
        exit 0
    }

    if ($ClearMarker -or $EndSession) {
        Clear-TeamSession -Root $root
        exit 0
    }

    if ($OnSessionStart) {
        $ctx = Get-SessionStartContext -Root $root
        if (-not [string]::IsNullOrWhiteSpace($ctx)) { [Console]::Out.WriteLine($ctx) }
        exit 0
    }

    # PreToolUse mode
    $hookInputJson = ''
    if ([Console]::IsInputRedirected) {
        try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' }
    }
    if ([string]::IsNullOrWhiteSpace($hookInputJson)) { exit 0 }

    $payload = $null
    try { $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop } catch { $null = $_ }
    if (-not $payload) { exit 0 }

    $isSubagent    = (-not [string]::IsNullOrWhiteSpace($payload.agent_type)) -or
                     (-not [string]::IsNullOrWhiteSpace($payload.agent_id))
    $sessionActive = Test-Path -LiteralPath $sessionFile
    $hasTeamName   = $payload.tool_input -and
                     (-not [string]::IsNullOrWhiteSpace($payload.tool_input.team_name))

    $decision = Get-TeamModeDecision -IsSubagent $isSubagent -SessionActive $sessionActive -HasTeamName $hasTeamName

    if ($decision.Block) {
        $json = @{ decision = 'block'; reason = $decision.Reason } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
    }

    exit 0
}
