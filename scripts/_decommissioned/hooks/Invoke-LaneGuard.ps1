#Requires -Version 7.0

<#
.SYNOPSIS
    PreToolUse(Edit|Write|MultiEdit|NotebookEdit) hook — enforces the "stay in your
    lane" rule. If the worktree root holds a `.team-process/lane` file (written by
    the lead when a member is spawned), edits are allowed only to paths matching one of
    its globs. No lane file (e.g. the lead's main worktree) → no restriction.

    `.team-process/lane` format: one glob per line; blank lines and `#` comments ignored.
    Globs: `*` = within a path segment, `**` = across segments, `?` = one char.
    Example:
        backend/fetcher/**
        backend/fetcher-github/**
        backend/fetcher-host/**
.PARAMETER AsLibrary
    Define functions without executing entry block (for Pester).
#>

[CmdletBinding()]
param([switch]$AsLibrary)

function ConvertFrom-LaneGlob {
    param([string]$Glob)
    $g = ($Glob.Trim()) -replace '\\', '/'
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append('^')
    $i = 0
    while ($i -lt $g.Length) {
        $ch = $g[$i]
        if ($ch -eq '*') {
            if ($i + 1 -lt $g.Length -and $g[$i + 1] -eq '*') {
                [void]$sb.Append('.*'); $i += 2; continue
            }
            [void]$sb.Append('[^/]*'); $i += 1; continue
        }
        if ($ch -eq '?') { [void]$sb.Append('[^/]'); $i += 1; continue }
        [void]$sb.Append([regex]::Escape([string]$ch)); $i += 1
    }
    [void]$sb.Append('$')
    return $sb.ToString()
}

function Get-ActiveLanes {
    param([string[]]$Lines)
    return @($Lines | Where-Object {
            $_ -and -not [string]::IsNullOrWhiteSpace($_) -and -not ($_.TrimStart().StartsWith('#'))
        } | ForEach-Object { $_.Trim() })
}

function Test-PathInLanes {
    param([string]$RelPath, [string[]]$Lanes)
    $p = ($RelPath -replace '\\', '/')
    if ($p.StartsWith('./')) { $p = $p.Substring(2) }
    foreach ($lane in $Lanes) {
        $rx = ConvertFrom-LaneGlob -Glob $lane
        if ($p -match $rx) { return $true }
    }
    return $false
}

function Get-RelativePath {
    param([string]$FullPath, [string]$Root)
    $f = ($FullPath -replace '\\', '/')
    $r = (($Root -replace '\\', '/').TrimEnd('/'))
    if ($f.StartsWith($r + '/', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $f.Substring($r.Length + 1)
    }
    return $f
}

# A member's hand-back outbox is NOT part of its code lane; allow writes there so the
# file-based protocol (typed forms dropped in the session directory) is not blocked.
function Test-PathIsOutbox {
    param([string]$RelPath)
    $p = ($RelPath -replace '\\', '/')
    if ($p.StartsWith('./')) { $p = $p.Substring(2) }
    return ($p -match '(^|/)\.team-process/sessions/[^/]+/outbox/')
}

# True if the path contains a '..' segment. A lane / outbox match is a STRING test, so a
# traversal like 'outbox/../../../backend/X.cs' would otherwise be exempted yet resolve
# outside the lane. Reject '..' up front — edits never legitimately need it.
function Test-PathHasDotDot {
    param([string]$RelPath)
    $p = ($RelPath -replace '\\', '/')
    return (@($p -split '/') -contains '..')
}

function Get-LaneGuardDecision {
    param([string]$RelPath, [string[]]$Lanes)
    $active = Get-ActiveLanes -Lines $Lanes
    if ($active.Count -eq 0) { return @{ Block = $false } }
    if (Test-PathHasDotDot -RelPath $RelPath) {
        return @{
            Block  = $true
            Reason = "Path traversal rejected: '$RelPath' contains a '..' segment. Use a normalized in-lane path — '..' cannot be used to escape a lane or the outbox."
        }
    }
    if (Test-PathIsOutbox -RelPath $RelPath) { return @{ Block = $false } }
    if (Test-PathInLanes -RelPath $RelPath -Lanes $active) { return @{ Block = $false } }
    return @{
        Block  = $true
        Reason = "Out of lane: '$RelPath' is not in your assigned lane(s): $($active -join ', '). Stay in your lane — hand cross-lane needs back to the lead via RESULT.follow (write it to your session outbox)."
    }
}

if (-not $AsLibrary) {
    $hookInputJson = ''
    if ([Console]::IsInputRedirected) {
        try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' }
    }

    $filePath = ''
    if (-not [string]::IsNullOrWhiteSpace($hookInputJson)) {
        try {
            $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop
            if ($payload.tool_input -and $payload.tool_input.file_path) {
                $filePath = [string]$payload.tool_input.file_path
            }
        }
        catch { $null = $_ }
    }

    if ([string]::IsNullOrWhiteSpace($filePath)) { exit 0 }

    $root = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
    if (-not $root) { $root = (Get-Location).Path }
    $root = ([string]$root).Trim()

    $laneFile = Join-Path $root '.team-process' 'lane'
    if (-not (Test-Path -LiteralPath $laneFile)) { exit 0 }

    $lines = Get-Content -LiteralPath $laneFile -ErrorAction SilentlyContinue
    $relPath = Get-RelativePath -FullPath $filePath -Root $root
    $decision = Get-LaneGuardDecision -RelPath $relPath -Lanes $lines

    if ($decision.Block) {
        $json = @{ decision = 'block'; reason = $decision.Reason } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
    }

    exit 0
}
