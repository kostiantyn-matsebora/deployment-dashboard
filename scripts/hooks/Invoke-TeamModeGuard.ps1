#Requires -Version 7.0

<#
.SYNOPSIS
    Multi-mode hook that enforces "mode is sticky" for team-process sessions and
    persists resumable, per-session run records.

    Each concurrent run owns a directory .team-process/sessions/<id>/ (gitignored
    runtime state; <id> = sanitized team name) holding session.json (the ledger),
    inbox/ (orchestrator typed-form dispatches: BRIEF/FIX) and outbox/ (member typed-form
    hand-backs). The EXISTENCE of ANY sessions/<id>/session.json
    = team mode is active. A record is the durable run ledger: the hook
    writes an initial record (and creates the inbox + outbox dirs) on TeamCreate; the orchestrator
    enriches it (roster, phase, ledger) as the run proceeds; it is read on SessionStart
    to resume + remind rather than wiped. 'workflow' classifies how to resume
    (feature-team vs freeform). The session roster is the source of truth for the lane
    file, which is a generated projection (see -SyncLane).

    A legacy single-file record at .team-process/session.json (pre-multi-session)
    is still read as one active session for back-compat.

    Modes:
      (default, PreToolUse(Agent|Task)) when any session record exists, block foreground
        in-session subagent spawns (no team_name). Subagents and member spawns
        (tool_input.team_name present) pass through.
      -SetMarker     PostToolUse(TeamCreate): create/merge the session record for the
                     created team (preserves an existing record's ledger/roster/createdAt).
                     -Workflow sets the classifier (default feature-team).
      -ClearMarker   PostToolUse(TeamDelete): remove the named team's session record + lane.
      -EndSession    Manual abandon. -Id <id> abandons one session; no -Id abandons all.
      -SyncLane      Project a member's lane from the session roster into run/lane
                     (-Id <id> -Role <role>). Session roster = source of truth.
      -OnSessionStart SessionStart: if any session record exists, emit a resume reminder
                     listing every active run as additionalContext. Does NOT clear.

.PARAMETER AsLibrary    Define functions without executing entry block (for Pester).
.PARAMETER SetMarker    Write/merge the session record and exit.
.PARAMETER ClearMarker  Remove the named team's session record + lane and exit.
.PARAMETER EndSession   Manual abandon (one -Id, or all) and exit.
.PARAMETER SyncLane     Project run/lane from a roster entry and exit.
.PARAMETER OnSessionStart Emit the resume reminder (SessionStart) and exit.
.PARAMETER Id           Session id (filename stem) for -EndSession / -SyncLane.
.PARAMETER Role         Member role for -SyncLane.
.PARAMETER Workflow     Workflow classifier for -SetMarker (feature-team | freeform).
#>

[CmdletBinding()]
param(
    [switch]$AsLibrary,
    [switch]$SetMarker,
    [switch]$ClearMarker,
    [switch]$EndSession,
    [switch]$SyncLane,
    [switch]$OnSessionStart,
    [string]$Id,
    [string]$Role,
    [string]$Workflow
)

function Get-TeamProcessBaseDir  { param([string]$Root) return (Join-Path $Root '.team-process') }
function Get-SessionsDir         { param([string]$Root) return (Join-Path (Get-TeamProcessBaseDir $Root) 'sessions') }
function Get-LaneFilePath        { param([string]$Root) return (Join-Path (Get-TeamProcessBaseDir $Root) 'lane') }
function Get-LegacySessionFilePath { param([string]$Root) return (Join-Path (Get-TeamProcessBaseDir $Root) 'session.json') }

# Sanitize a team name into a filesystem-safe session id (the record's filename stem).
# Path-separator chars collapse to '-'; a dot-only result (., .., ...) is rejected so a
# crafted name can never resolve to a parent directory under -Recurse removal.
function ConvertTo-SessionId {
    param([string]$Team)
    $t = [string]$Team
    if ([string]::IsNullOrWhiteSpace($t)) { return 'unknown' }
    $id = ($t.Trim() -replace '[^A-Za-z0-9._-]', '-').Trim('-')
    if ([string]::IsNullOrWhiteSpace($id)) { return 'unknown' }
    if ($id -match '^\.+$') { return 'unknown' }   # '.', '..', '...' -> traversal guard
    return $id
}

# A session id is safe iff it is a single path segment of the allowed charset and not
# dot-only. Backstop before any filesystem op that builds a path from an id — even if a
# future caller forgets ConvertTo-SessionId, a '..'/'/'-bearing id cannot delete a parent.
function Test-SafeSessionId {
    param([string]$Id)
    if ([string]::IsNullOrWhiteSpace($Id)) { return $false }
    if ($Id -notmatch '^[A-Za-z0-9._-]+$') { return $false }   # rejects '/', '\', spaces
    if ($Id -match '^\.+$') { return $false }                   # rejects '.', '..', '...'
    return $true
}

function Get-SessionDir {
    param([string]$Root, [string]$Id)
    return (Join-Path (Get-SessionsDir $Root) $Id)
}

function Get-SessionFilePath {
    param([string]$Root, [string]$Id)
    return (Join-Path (Get-SessionDir $Root $Id) 'session.json')
}

# Per-session outbox: members drop typed-form hand-backs here; the orchestrator drains them.
function Get-OutboxDir {
    param([string]$Root, [string]$Id)
    return (Join-Path (Get-SessionDir $Root $Id) 'outbox')
}

# Per-session inbox: the orchestrator drops typed-form dispatches (BRIEF/FIX) here; members
# read their task by reference.
function Get-InboxDir {
    param([string]$Root, [string]$Id)
    return (Join-Path (Get-SessionDir $Root $Id) 'inbox')
}

# Parse a session record from disk (-DateKind String keeps ISO timestamps as strings so
# they round-trip exactly). Returns $null if missing or unparseable.
function Read-SessionRecord {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -DateKind String -ErrorAction Stop) }
    catch { return $null }
}

# All active session record paths: every sessions/<id>/session.json plus a legacy session.json if present.
function Get-ActiveSessionFiles {
    param([string]$Root)
    $files = @()
    $dir = Get-SessionsDir -Root $Root
    if (Test-Path -LiteralPath $dir) {
        $files += @(Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'session.json' } |
            Where-Object { Test-Path -LiteralPath $_ })
    }
    $legacy = Get-LegacySessionFilePath -Root $Root
    if (Test-Path -LiteralPath $legacy) { $files += $legacy }
    return @($files)
}

function Test-AnySessionActive {
    param([string]$Root)
    return ((Get-ActiveSessionFiles -Root $Root).Count -gt 0)
}

# PreToolUse decision — unchanged rule, now keyed on "any session record exists".
function Get-TeamModeDecision {
    param(
        [bool]$IsSubagent,
        [bool]$SessionActive,
        [bool]$HasTeamName
    )
    if ($IsSubagent)         { return @{ Block = $false } }
    if (-not $SessionActive) { return @{ Block = $false } }
    if ($HasTeamName)        { return @{ Block = $false } }
    return @{
        Block  = $true
        Reason = "Team mode is active (a team-process run is in progress): dispatch to a spawned member via SendMessage, or spawn a member with 'team_name' set - not a foreground in-session subagent. Mode is sticky; to change substrate, surface it as a decision. To abandon a stale session: pwsh -NoProfile -File scripts/hooks/Invoke-TeamModeGuard.ps1 -EndSession -Id <id>. See .claude/team-process/process.md -> 'Mode is sticky' / 'Session state & resume'."
    }
}

# Extract the team name from a PostToolUse(TeamCreate|TeamDelete) payload (tool_input/tool_response).
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
        [string]$Id,
        [string]$Team,
        [string]$Workflow,
        [string]$Branch,
        [datetime]$Now,
        [string]$ClaudeSessionId,
        $Existing
    )
    $ts  = $Now.ToUniversalTime().ToString('o')
    $rec = [ordered]@{}
    $rec.id       = if ($Id) { $Id } elseif ($Existing -and $Existing.id) { [string]$Existing.id } else { ConvertTo-SessionId -Team $Team }
    $rec.workflow = if ($Workflow) { $Workflow } elseif ($Existing -and $Existing.workflow) { [string]$Existing.workflow } else { 'feature-team' }
    $rec.team     = if ($Team) { $Team } elseif ($Existing -and $Existing.team) { [string]$Existing.team } else { 'unknown' }
    # Owning Claude session: a NEW value (resume re-create) refreshes; else preserve the existing.
    $cs = if ($ClaudeSessionId) { $ClaudeSessionId } elseif ($Existing -and $Existing.claudeSessionId) { [string]$Existing.claudeSessionId } else { '' }
    if ($cs) { $rec.claudeSessionId = $cs }
    if ($Branch) { $rec.branch = $Branch }
    elseif ($Existing -and $Existing.branch) { $rec.branch = [string]$Existing.branch }
    if ($Existing -and $Existing.issue)   { $rec.issue   = [string]$Existing.issue }
    if ($Existing -and $Existing.summary) { $rec.summary = [string]$Existing.summary }
    if ($Existing -and $Existing.task)    { $rec.task    = [string]$Existing.task }
    $rec.phase     = if ($Existing -and $Existing.phase) { [string]$Existing.phase } else { 'created' }
    $rec.createdAt = if ($Existing -and $Existing.createdAt) { [string]$Existing.createdAt } else { $ts }
    $rec.updatedAt = $ts
    # Omit roster/ledger when empty (optional; avoids ConvertTo-Json's @()->null quirk).
    # The orchestrator adds them as the run produces waves.
    $roster = if ($Existing -and $Existing.roster) { @($Existing.roster) } else { @() }
    if ($roster.Count -gt 0) { $rec.roster = $roster }
    $ledger = if ($Existing -and $Existing.ledger) { @($Existing.ledger) } else { @() }
    if ($ledger.Count -gt 0) { $rec.ledger = $ledger }
    # Acceptance criteria + decision record are durable resume state — preserve on re-create.
    $acceptance = if ($Existing -and $Existing.acceptance) { @($Existing.acceptance) } else { @() }
    if ($acceptance.Count -gt 0) { $rec.acceptance = $acceptance }
    $decisions = if ($Existing -and $Existing.decisions) { @($Existing.decisions) } else { @() }
    if ($decisions.Count -gt 0) { $rec.decisions = $decisions }
    return $rec
}

# "role=status" digest of the roster, or '' when no roster. Tells the lead which member to
# re-dispatch (and from what status) on resume.
function Format-RosterStatus {
    param($Record)
    if (-not $Record.roster) { return '' }
    $parts = @(@($Record.roster) | ForEach-Object {
            $role = if ($_.role) { $_.role } else { '?' }
            $st   = if ($_.status) { $_.status } else { 'spawned' }
            "$role=$st"
        })
    return ($parts -join ', ')
}

# Compact digest of the locked/proposed decisions, capped so the reminder stays scannable.
# Surfacing the CONTENT (not a count) is what lets the lead re-attach without re-reading the
# file — and the decisions OVERRIDE a conflicting compaction summary. '' when none.
function Format-DecisionDigest {
    param($Record, [int]$Max = 6)
    if (-not $Record.decisions) { return '' }
    $all   = @($Record.decisions)
    $shown = @($all | Select-Object -First $Max | ForEach-Object {
            $id  = if ($null -ne $_.id) { "#$($_.id) " } else { '' }
            $txt = if ($_.decision) { [string]$_.decision } else { '(unstated)' }
            $sup = if ($_.supersedes) { " (supersedes: $($_.supersedes))" } else { '' }
            "$id$txt$sup"
        })
    $line = ($shown -join '; ')
    if ($all.Count -gt $Max) { $line += " (+$($all.Count - $Max) more)" }
    return $line
}

# A per-session resume block: header line + (when present) agent statuses and the decision
# digest. Multi-line so the lead sees CONTENT, not just counts.
function Format-SessionLine {
    param($Record)
    $id     = if ($Record.id) { $Record.id } elseif ($Record.team) { $Record.team } else { 'unknown' }
    $wf     = if ($Record.workflow) { $Record.workflow } else { 'feature-team' }
    $branch = if ($Record.branch) { $Record.branch } else { '(unrecorded)' }
    $phase  = if ($Record.phase) { $Record.phase } else { '(unrecorded)' }
    $issue  = if ($Record.issue) { " | issue: $($Record.issue)" } else { '' }
    $nLed   = if ($Record.ledger) { @($Record.ledger).Count } else { 0 }
    $lines  = @("  - $id [$wf] | branch: $branch | phase: $phase$issue | ledger: $nLed wave(s)")
    $agents = Format-RosterStatus -Record $Record
    if ($agents) { $lines += "      agents: $agents" }
    $dec = Format-DecisionDigest -Record $Record
    if ($dec) { $lines += "      decisions: $dec" }
    return ($lines -join "`n")
}

# Compose the SessionStart resume reminder from the parsed session records.
function Get-SessionReminder {
    param($Records)
    $recs  = @($Records)
    $n     = $recs.Count
    $lines = @($recs | ForEach-Object { Format-SessionLine -Record $_ }) -join "`n"
    return @"
[!] team-process session(s) ACTIVE - $n run(s) in progress (mode is sticky).
$lines
RESUME, do not restart: continue each run from its record; spawn members with team_name set, never
foreground in-session subagents (the team-mode guard will block them). Re-dispatch an in-flight member
with its BRIEF (from the session inbox) + its roster progress + the decisions below.
RECORD IS AUTHORITATIVE: the session record OVERRIDES any conflicting compaction summary - re-read its
decisions before acting; do not trust a summary that contradicts a locked decision.
Records live at .team-process/sessions/<id>/session.json. To ABANDON one: pwsh -NoProfile -File
scripts/hooks/Invoke-TeamModeGuard.ps1 -EndSession -Id <id>. See
.claude/team-process/process.md -> 'Session state & resume'.
"@.Trim()
}

# Write/merge a session record under $Root. Returns the written record.
function Set-TeamSession {
    param([string]$Root, [string]$Team, [string]$Workflow, [string]$Branch, [datetime]$Now, [string]$ClaudeSessionId)
    $id          = ConvertTo-SessionId -Team $Team
    $sessionFile = Get-SessionFilePath -Root $Root -Id $id
    $existing    = Read-SessionRecord -Path $sessionFile
    $record      = New-SessionRecord -Id $id -Team $Team -Workflow $Workflow -Branch $Branch -Now $Now -ClaudeSessionId $ClaudeSessionId -Existing $existing
    $dir         = Get-SessionDir -Root $Root -Id $id
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    # Create both boxes up front: the inbox so the orchestrator can drop dispatches, and the
    # outbox so a member that shares this worktree (non-isolated run) always finds the hand-back
    # directory; worktree-isolated members mkdir their own outbox.
    $inbox = Get-InboxDir -Root $Root -Id $id
    if (-not (Test-Path -LiteralPath $inbox)) { New-Item -ItemType Directory -Force -Path $inbox | Out-Null }
    $outbox = Get-OutboxDir -Root $Root -Id $id
    if (-not (Test-Path -LiteralPath $outbox)) { New-Item -ItemType Directory -Force -Path $outbox | Out-Null }
    Set-Content -LiteralPath $sessionFile -Value ($record | ConvertTo-Json -Depth 8) -Encoding utf8NoBOM
    return $record
}

# Remove session director(ies) + the lane projection. -Id removes one; no -Id removes all.
function Clear-TeamSession {
    param([string]$Root, [string]$Id)
    if ($Id) {
        # Refuse an unsafe id outright — never let a '..'/separator id reach -Recurse removal.
        if (-not (Test-SafeSessionId -Id $Id)) { return }
        $d = Get-SessionDir -Root $Root -Id $Id
        if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
    }
    else {
        $sessionsDir = Get-SessionsDir -Root $Root
        if (Test-Path -LiteralPath $sessionsDir) { Remove-Item -LiteralPath $sessionsDir -Recurse -Force -ErrorAction SilentlyContinue }
        $legacy = Get-LegacySessionFilePath -Root $Root
        if (Test-Path -LiteralPath $legacy) { Remove-Item -LiteralPath $legacy -Force -ErrorAction SilentlyContinue }
    }
    # lane is a per-worktree projection of the roster — clear it when a session ends.
    $lane = Get-LaneFilePath -Root $Root
    if (Test-Path -LiteralPath $lane) { Remove-Item -LiteralPath $lane -Force -ErrorAction SilentlyContinue }
}

# Project a member's lane from the session roster into run/lane. Returns the written globs (or $null).
function Sync-LaneFromSession {
    param([string]$Root, [string]$Id, [string]$Role)
    if (-not (Test-SafeSessionId -Id $Id)) { return $null }
    $rec = Read-SessionRecord -Path (Get-SessionFilePath -Root $Root -Id $Id)
    if (-not $rec -or -not $rec.roster) { return $null }
    $entry = @($rec.roster) | Where-Object { $_.role -eq $Role } | Select-Object -First 1
    if (-not $entry -or [string]::IsNullOrWhiteSpace([string]$entry.lane)) { return $null }
    # roster[].lane may carry one glob or several (comma/newline-separated).
    $globs = @([regex]::Split([string]$entry.lane, '[,\r\n]+') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($globs.Count -eq 0) { return $null }
    $dir = Get-TeamProcessBaseDir -Root $Root
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Set-Content -LiteralPath (Get-LaneFilePath -Root $Root) -Value ($globs -join "`n") -Encoding utf8NoBOM
    return $globs
}

# Return the SessionStart additionalContext JSON when any session is active, else ''.
function Get-SessionStartContext {
    param([string]$Root)
    $files = Get-ActiveSessionFiles -Root $Root
    if ($files.Count -eq 0) { return '' }
    $records = @()
    foreach ($f in $files) { $r = Read-SessionRecord -Path $f; if ($r) { $records += $r } }
    if ($records.Count -eq 0) { return '' }
    $msg = Get-SessionReminder -Records $records
    return (@{ hookSpecificOutput = @{ hookEventName = 'SessionStart'; additionalContext = $msg } } | ConvertTo-Json -Depth 5 -Compress)
}

if (-not $AsLibrary) {
    $root = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
    if (-not $root) { $root = (Get-Location).Path }
    $root = ([string]$root).Trim()

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
        # The owning Claude session_id (present on the hook payload) — captured here and
        # refreshed on every re-create, so it tracks the session that currently drives the run.
        $claudeSessionId = if ($payload) { [string]$payload.session_id } else { '' }
        # Pass -Workflow through RAW (empty when not supplied) so New-SessionRecord can
        # PRESERVE an existing record's workflow on re-create and default only a brand-new
        # record to feature-team. Defaulting here would clobber a freeform session.
        Set-TeamSession -Root $root -Team $team -Workflow $Workflow -Branch $branch -Now (Get-Date) -ClaudeSessionId $claudeSessionId | Out-Null
        exit 0
    }

    if ($ClearMarker) {
        $hookInputJson = ''
        if ([Console]::IsInputRedirected) { try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' } }
        $payload = $null
        if (-not [string]::IsNullOrWhiteSpace($hookInputJson)) {
            try { $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop } catch { $null = $_ }
        }
        $team = if ($payload) { Get-TeamCreateName -Payload $payload } else { '' }
        # Only clear the named team's session — never nuke concurrent runs on a missing name.
        if (-not [string]::IsNullOrWhiteSpace($team)) {
            Clear-TeamSession -Root $root -Id (ConvertTo-SessionId -Team $team)
        }
        exit 0
    }

    if ($EndSession) {
        # Sanitize the id through the same gate as TeamCreate names — a raw '..' must
        # never reach -Recurse removal.
        if ($Id) { Clear-TeamSession -Root $root -Id (ConvertTo-SessionId -Team $Id) } else { Clear-TeamSession -Root $root }
        exit 0
    }

    if ($SyncLane) {
        Sync-LaneFromSession -Root $root -Id (ConvertTo-SessionId -Team $Id) -Role $Role | Out-Null
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
    $sessionActive = Test-AnySessionActive -Root $root
    $hasTeamName   = $payload.tool_input -and
                     (-not [string]::IsNullOrWhiteSpace($payload.tool_input.team_name))

    $decision = Get-TeamModeDecision -IsSubagent $isSubagent -SessionActive $sessionActive -HasTeamName $hasTeamName

    if ($decision.Block) {
        $json = @{ decision = 'block'; reason = $decision.Reason } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
    }

    exit 0
}
