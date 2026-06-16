#Requires -Version 7.0

<#
.SYNOPSIS
    PreToolUse(Bash) hook — enforces two Git guardrails:
      1. Single-integrator model: members never commit/push/PR from a linked
         worktree (integration happens only in the main worktree).
      2. Lazy branching: blocks `git commit` in detached HEAD, forcing a branch first.
.PARAMETER AsLibrary
    Define functions without executing entry block (for Pester).
#>

[CmdletBinding()]
param([switch]$AsLibrary)

function Test-IsGitCommitCommand {
    param([string]$Command)
    return ($Command -match '\bgit\b.*\bcommit\b')
}

function Test-IsGitPushCommand {
    param([string]$Command)
    return ($Command -match '\bgit\b.*\bpush\b')
}

function Test-IsPrCreateCommand {
    param([string]$Command)
    return ($Command -match '\bgh\b.*\bpr\b.*\bcreate\b')
}

function Test-IsDetachedHead {
    param([Parameter(Mandatory)][scriptblock]$GitRunner)
    $raw = (& $GitRunner @('rev-parse', '--abbrev-ref', 'HEAD')) | Select-Object -First 1
    $str = if ($raw) { ([string]$raw).Trim() } else { '' }
    return ($str -eq 'HEAD')
}

function Test-IsLinkedWorktree {
    # A linked (member) worktree has --git-dir != --git-common-dir.
    # The main/integration worktree has them equal.
    param([Parameter(Mandatory)][scriptblock]$GitRunner)
    $gitDir    = (& $GitRunner @('rev-parse', '--git-dir'))        | Select-Object -First 1
    $commonDir = (& $GitRunner @('rev-parse', '--git-common-dir')) | Select-Object -First 1
    $g = if ($gitDir) { ([string]$gitDir).Trim() } else { '' }
    $c = if ($commonDir) { ([string]$commonDir).Trim() } else { '' }
    if ([string]::IsNullOrEmpty($g) -or [string]::IsNullOrEmpty($c)) { return $false }
    return ($g -ne $c)
}

function Get-BranchGuardDecision {
    param(
        [string]$Command,
        [Parameter(Mandatory)][scriptblock]$GitRunner
    )

    $isCommit = Test-IsGitCommitCommand -Command $Command
    $isPush   = Test-IsGitPushCommand   -Command $Command
    $isPr     = Test-IsPrCreateCommand  -Command $Command

    if (-not ($isCommit -or $isPush -or $isPr)) {
        return @{ Block = $false }
    }

    # (1) Single-integrator model — no integration ops from a member worktree.
    if (Test-IsLinkedWorktree -GitRunner $GitRunner) {
        return @{
            Block  = $true
            Reason = 'Single-integrator model: members never commit/push/PR from a worktree. Hand your changes back to the lead via RESULT — integration happens only in the main worktree.'
        }
    }

    # (2) Lazy branching — no commit in detached HEAD.
    if ($isCommit -and (Test-IsDetachedHead -GitRunner $GitRunner)) {
        return @{
            Block  = $true
            Reason = 'HEAD is detached. Create a branch first: git checkout -b <descriptive-name>, then commit.'
        }
    }

    return @{ Block = $false }
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
