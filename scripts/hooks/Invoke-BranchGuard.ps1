#Requires -Version 7.0

<#
.SYNOPSIS
    PreToolUse hook — blocks git commit in detached HEAD, forcing branch creation first (lazy branching).
.PARAMETER AsLibrary
    Define functions without executing entry block (for Pester).
#>

[CmdletBinding()]
param([switch]$AsLibrary)

function Test-IsGitCommitCommand {
    param([string]$Command)
    return ($Command -match '\bgit\b.*\bcommit\b')
}

function Test-IsDetachedHead {
    param([Parameter(Mandatory)][scriptblock]$GitRunner)
    $raw = (& $GitRunner @('rev-parse', '--abbrev-ref', 'HEAD')) | Select-Object -First 1
    $str = if ($raw) { ([string]$raw).Trim() } else { '' }
    return ($str -eq 'HEAD')
}

function Get-BranchGuardDecision {
    param(
        [string]$Command,
        [Parameter(Mandatory)][scriptblock]$GitRunner
    )
    if (-not (Test-IsGitCommitCommand -Command $Command)) {
        return @{ Block = $false }
    }
    if (-not (Test-IsDetachedHead -GitRunner $GitRunner)) {
        return @{ Block = $false }
    }
    return @{
        Block  = $true
        Reason = 'HEAD is detached. Create a branch first: git checkout -b <descriptive-name>, then commit.'
    }
}

if (-not $AsLibrary) {
    $hookInputJson = ''
    if ([Console]::IsInputRedirected) {
        try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' }
    }

    $command = ''
    if (-not [string]::IsNullOrWhiteSpace($hookInputJson)) {
        try {
            $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop
            if ($payload.tool_input -and $payload.tool_input.command) {
                $command = [string]$payload.tool_input.command
            }
        }
        catch { $null = $_ }
    }

    $gitRunner = { param([string[]]$Argv) & git @Argv 2>$null }.GetNewClosure()
    $decision  = Get-BranchGuardDecision -Command $command -GitRunner $gitRunner

    if ($decision.Block) {
        $json = @{ decision = 'block'; reason = $decision.Reason } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
    }

    exit 0
}
