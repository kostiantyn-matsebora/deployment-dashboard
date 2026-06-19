#Requires -Version 7.0

<#
.SYNOPSIS
    Reads all active team-process sessions and emits a one-line status string for
    the Claude Code statusbar.

.DESCRIPTION
    Output rules:
      - Zero active sessions  -> emit nothing (empty stdout = no status to Claude Code).
      - Exactly one session   -> emit
          "team: <id> - <summary> (<phase>) | <role>: <task>, <role>: <task>"
        where <summary> (the team's issue title / feature essence) and the agent digest
        are appended only when present; phase defaults to "?".
      - Two or more sessions  -> show the CURRENT run's detail (the record whose `branch`
        matches the checked-out branch) plus "(+N other)"; fall back to "teams (N active)"
        when no single record matches the branch.

    "Current run" is resolved by git branch: a worktree has one branch checked out, and each
    session record stores its `branch`, so at most one record matches — that is the run the
    user is in. (Claude Code's own session_id does not map to a team-process team, so the
    branch is the available disambiguator.)

    ASCII separators only ('-' and '|') — the statusline goes to a terminal and must not
    trip console (cp1252) encoding.

    Session discovery reuses helpers from Invoke-TeamModeGuard.ps1 (Get-SessionsDir,
    Get-ActiveSessionFiles, Read-SessionRecord). Repo root resolved via git; fallback
    to $PSScriptRoot/../..

.PARAMETER AsLibrary
    Define functions without executing entry block (for Pester).
#>

[CmdletBinding()]
param([switch]$AsLibrary)

# Capture own -AsLibrary state BEFORE dot-sourcing TeamModeGuard.
# The dot-source binds the sourced script's $AsLibrary into this shared scope,
# which would otherwise clobber $AsLibrary and silently skip our entry block.
$ownAsLibrary = [bool]$AsLibrary

# Reuse session-discovery helpers (Get-SessionsDir, Get-ActiveSessionFiles, Read-SessionRecord, etc.)
$guardPath = Join-Path $PSScriptRoot '..' 'hooks' 'Invoke-TeamModeGuard.ps1'
. $guardPath -AsLibrary

function Get-ActiveSessions {
    <#
    .SYNOPSIS
        Returns an array of parsed session objects for all active sessions under $Root.
        Ignores unreadable / malformed files silently.
    #>
    param([string]$Root)

    $files = Get-ActiveSessionFiles -Root $Root
    $sessions = @()
    foreach ($f in $files) {
        $record = Read-SessionRecord -Path $f
        if ($null -ne $record) {
            $sessions += $record
        }
    }
    return $sessions
}

# Truncate to keep the statusline from running away; appends a single '.' ellipsis (ASCII).
function Limit-Text {
    param([string]$Text, [int]$Max)
    $t = [string]$Text
    if ($Max -gt 0 -and $t.Length -gt $Max) {
        return $t.Substring(0, [Math]::Max(1, $Max - 1)).TrimEnd() + '.'
    }
    return $t
}

# "role: task, role: task" from the roster (task truncated). Falls back to the bare role when a
# member has no task yet. '' when there is no roster.
function Format-AgentDigest {
    param($Record, [int]$MaxTask = 24)
    if (-not $Record.roster) { return '' }
    $parts = @(@($Record.roster) | ForEach-Object {
            $role = if ($_.role) { [string]$_.role } else { '?' }
            $task = if ($_.task) { Limit-Text -Text ([string]$_.task) -Max $MaxTask } else { '' }
            if ($task) { "${role}: $task" } else { $role }
        })
    return ($parts -join ', ')
}

# One session's full detail line: "team: <id> - <summary> (<phase>) | <agent digest>".
# Summary and the agent digest are appended only when present.
function Format-SessionDetail {
    param($Record)
    $id    = if ($Record.id)    { [string]$Record.id }    else { 'unknown' }
    $phase = if ($Record.phase) { [string]$Record.phase } else { '?' }
    $sum   = if ($Record.summary) { ' - ' + (Limit-Text -Text ([string]$Record.summary) -Max 48) } else { '' }
    $line  = "team: $id$sum ($phase)"
    $agents = Format-AgentDigest -Record $Record
    if ($agents) { $line += " | $agents" }
    return $line
}

function Get-StatusLine {
    <#
    .SYNOPSIS
        Returns the status string for the active sessions.
        - none      -> '' (empty).
        - one       -> that session's detail line.
        - many      -> the CURRENT run (record whose `branch` == $CurrentBranch) detailed +
                       "(+N other)"; falls back to "teams (N active)" when no single record
                       matches the branch.
    #>
    param([object[]]$Sessions, [string]$CurrentBranch)

    $s = @($Sessions)
    $n = $s.Count

    if ($n -eq 0) { return '' }
    if ($n -eq 1) { return (Format-SessionDetail -Record $s[0]) }

    # Multi-session: surface the run the user is actually in, matched by checked-out branch.
    if (-not [string]::IsNullOrWhiteSpace($CurrentBranch)) {
        $onBranch = @($s | Where-Object { $_.branch -and ([string]$_.branch) -eq $CurrentBranch })
        if ($onBranch.Count -eq 1) {
            return (Format-SessionDetail -Record $onBranch[0]) + " (+$($n - 1) other)"
        }
    }

    return "teams ($n active)"
}

if (-not $ownAsLibrary) {
    $root = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
    if (-not $root) { $root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path }
    $root = ([string]$root).Trim()

    # The checked-out branch disambiguates which run is "current" when several are active.
    $branch = (& git -C $root rev-parse --abbrev-ref HEAD 2>$null) | Select-Object -First 1
    $branch = ([string]$branch).Trim()

    $sessions = Get-ActiveSessions -Root $root
    $line     = Get-StatusLine -Sessions $sessions -CurrentBranch $branch
    if (-not [string]::IsNullOrWhiteSpace($line)) { Write-Output $line }
}
