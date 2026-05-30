#Requires -Version 7.0

<#
.SYNOPSIS
    Claude Code worktree entry guard — blocks all tool calls until
    EnterWorktree is called (CheckEntry), then clears the gate (ClearEntry).

.DESCRIPTION
    Two invocation surfaces:

    CheckEntry mode (-CheckEntry switch):
      Wired as a Claude Code PreToolUse hook (all tools).
      Blocks any tool other than EnterWorktree while a pending-entry marker
      exists for this session. Cost: one Test-Path per tool call; becomes a
      no-op once ClearEntry removes the marker.

    ClearEntry mode (-ClearEntry switch):
      Wired as a Claude Code PostToolUse hook on EnterWorktree.
      Deletes the pending-entry marker, unblocking all subsequent tool calls.

    Pending marker: `.claude/.worktree-pending.<sanitized-sid>.json`
    Written by Invoke-WorktreeLifecycle.ps1 -SnapshotSession when
    CLAUDE_AUTO_WORKTREE=1 creates a new worktree.

    Pure functions live above the entry block for Pester coverage.
    Pass `-AsLibrary` to dot-source without executing the entry block.

.PARAMETER RepoRoot
    Git working tree root. Defaults to `$env:CLAUDE_PROJECT_DIR`, falling
    back to `git rev-parse --show-toplevel`.

.PARAMETER SessionId
    Claude session id. Namespaces the pending marker file. Read from stdin
    JSON `session_id` field when not provided directly.

.PARAMETER CheckEntry
    PreToolUse mode — block all tools except EnterWorktree while pending.

.PARAMETER ClearEntry
    PostToolUse mode (EnterWorktree) — delete the pending marker.

.PARAMETER AsLibrary
    Define helper functions but skip the entry block (used by Pester).
#>

[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string]$SessionId,
    [switch]$CheckEntry,
    [switch]$ClearEntry,
    [switch]$AsLibrary
)

# ---------- Pure helpers ----------

function Get-SafeWorktreeSessionId {
    [CmdletBinding()]
    param([string]$SessionId)
    if ([string]::IsNullOrWhiteSpace($SessionId)) { return '' }
    return ($SessionId -replace '[^A-Za-z0-9._-]', '_')
}

function Get-WorktreePendingFilePath {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $dir  = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $sid  = Get-SafeWorktreeSessionId -SessionId $SessionId
    $name = if ($sid) { ".worktree-pending.$sid.json" } else { '.worktree-pending.json' }
    return (Join-Path $dir $name)
}

function Get-WorktreeEntryDecision {
    [CmdletBinding()]
    param(
        [string]$ToolName,
        [string]$PendingPath,
        [Parameter(Mandatory)][scriptblock]$FileReader
    )
    $raw = & $FileReader $PendingPath
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{ Block = $false } }
    if ($ToolName -eq 'EnterWorktree') { return @{ Block = $false } }
    $wtPath = ''
    try {
        $obj    = $raw | ConvertFrom-Json -ErrorAction Stop
        $wtPath = [string]$obj.worktreePath
    }
    catch { $null = $_ }
    $hint = if ($wtPath) { " Call EnterWorktree with path `"$wtPath`"." } else { '' }
    return @{ Block = $true; Reason = "A session worktree is pending entry.$hint" }
}

# ---------- Entry block ----------

if (-not $AsLibrary) {
    if (-not $RepoRoot) {
        if ($env:CLAUDE_PROJECT_DIR) { $RepoRoot = $env:CLAUDE_PROJECT_DIR }
        else {
            try {
                $detected = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
                if ($detected) { $RepoRoot = $detected.Trim() }
            }
            catch { $null = $_ }
        }
    }

    $hookInputJson = ''
    if ([Console]::IsInputRedirected) {
        try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' }
    }
    $toolName = ''
    if (-not [string]::IsNullOrWhiteSpace($hookInputJson)) {
        try {
            $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop
            if ($payload -and $payload.session_id -and -not $SessionId) { $SessionId = [string]$payload.session_id }
            if ($payload -and $payload.tool_name)                        { $toolName  = [string]$payload.tool_name }
        }
        catch { $null = $_ }
    }

    if ($CheckEntry) {
        $pendingPath = Get-WorktreePendingFilePath -RepoRoot $RepoRoot -SessionId $SessionId
        $fileReader  = {
            param([string]$AbsPath)
            if ($AbsPath -and (Test-Path -LiteralPath $AbsPath)) {
                return (Get-Content -LiteralPath $AbsPath -Raw)
            }
            return ''
        }
        $decision = Get-WorktreeEntryDecision -ToolName $toolName -PendingPath $pendingPath -FileReader $fileReader
        if ($decision.Block) {
            $json = @{ decision = 'block'; reason = $decision.Reason } | ConvertTo-Json -Compress
            [Console]::Out.WriteLine($json)
        }
        exit 0
    }

    if ($ClearEntry) {
        $pendingPath = Get-WorktreePendingFilePath -RepoRoot $RepoRoot -SessionId $SessionId
        if ($pendingPath -and (Test-Path -LiteralPath $pendingPath)) {
            Remove-Item -LiteralPath $pendingPath -Force -ErrorAction SilentlyContinue
        }
        exit 0
    }

    exit 0
}
