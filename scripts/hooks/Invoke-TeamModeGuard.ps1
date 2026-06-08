#Requires -Version 7.0

<#
.SYNOPSIS
    Multi-mode hook that enforces "mode is sticky" for /feature-team sessions.

    PreToolUse(Agent|Task) mode (default): when .claude-team-active exists, blocks
    foreground in-session subagent spawns (no team_name). Subagents and legitimate
    member spawns (tool_input.team_name present) pass through.

    -SetMarker: create/overwrite <root>/.claude-team-active (called PostToolUse(TeamCreate)).
    -ClearMarker: remove <root>/.claude-team-active (called PostToolUse(TeamDelete)
                  and SessionStart).
.PARAMETER AsLibrary
    Define functions without executing entry block (for Pester).
.PARAMETER SetMarker
    Create/overwrite the team-active marker file and exit.
.PARAMETER ClearMarker
    Remove the team-active marker file and exit.
#>

[CmdletBinding()]
param(
    [switch]$AsLibrary,
    [switch]$SetMarker,
    [switch]$ClearMarker
)

function Get-TeamModeDecision {
    param(
        [bool]$IsSubagent,
        [bool]$MarkerPresent,
        [bool]$HasTeamName
    )
    if ($IsSubagent)    { return @{ Block = $false } }
    if (-not $MarkerPresent) { return @{ Block = $false } }
    if ($HasTeamName)   { return @{ Block = $false } }
    return @{
        Block  = $true
        Reason = "Team mode is active (/feature-team): dispatch to a spawned member via SendMessage, or spawn a member with 'team_name' set - not a foreground in-session subagent. Mode is sticky; to change substrate, surface it as a decision. See .claude/team-process/process.md -> 'Mode is sticky'."
    }
}

if (-not $AsLibrary) {
    $root = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
    if (-not $root) { $root = (Get-Location).Path }
    $root   = ([string]$root).Trim()
    $marker = Join-Path $root '.claude-team-active'

    if ($SetMarker) {
        Set-Content -LiteralPath $marker -Value 'active' -Encoding utf8NoBOM
        exit 0
    }

    if ($ClearMarker) {
        if (Test-Path -LiteralPath $marker) {
            Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
        }
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
    $markerPresent = Test-Path -LiteralPath $marker
    $hasTeamName   = $payload.tool_input -and
                     (-not [string]::IsNullOrWhiteSpace($payload.tool_input.team_name))

    $decision = Get-TeamModeDecision -IsSubagent $isSubagent -MarkerPresent $markerPresent -HasTeamName $hasTeamName

    if ($decision.Block) {
        $json = @{ decision = 'block'; reason = $decision.Reason } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
    }

    exit 0
}
