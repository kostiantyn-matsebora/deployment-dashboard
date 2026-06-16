#Requires -Version 7.0

<#
.SYNOPSIS
    Reads all active team-process sessions and emits a one-line status string for
    the Claude Code statusbar.

.DESCRIPTION
    Output rules:
      - Zero active sessions  -> emit nothing (empty stdout = no status to Claude Code).
      - Exactly one session   -> emit "team: <id> (<phase>)" where phase defaults to "?".
      - Two or more sessions  -> emit "teams (N active)".

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

function Get-StatusLine {
    <#
    .SYNOPSIS
        Returns the status string based on session count.
        Returns '' (empty string) when there are no active sessions.
    #>
    param([object[]]$Sessions)

    $s = @($Sessions)
    $n = $s.Count

    if ($n -eq 0) { return '' }

    if ($n -eq 1) {
        $rec   = $s[0]
        $id    = if ($rec.id)    { [string]$rec.id }    else { 'unknown' }
        $phase = if ($rec.phase) { [string]$rec.phase } else { '?' }
        return "team: $id ($phase)"
    }

    return "teams ($n active)"
}

if (-not $ownAsLibrary) {
    $root = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
    if (-not $root) { $root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path }
    $root = ([string]$root).Trim()

    $sessions = Get-ActiveSessions -Root $root
    $line     = Get-StatusLine -Sessions $sessions
    if (-not [string]::IsNullOrWhiteSpace($line)) { Write-Output $line }
}
