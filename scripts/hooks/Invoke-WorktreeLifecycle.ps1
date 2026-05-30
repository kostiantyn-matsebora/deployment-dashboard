#Requires -Version 7.0

<#
.SYNOPSIS
    Claude Code worktree session lifecycle hook — creates a per-session
    isolated worktree at SessionStart and cleans up at SessionEnd.

.DESCRIPTION
    Two invocation surfaces:

    SessionEnd mode (-SessionEnd switch):
      Wired as a Claude Code SessionEnd hook. When run inside a git worktree:
        - If the worktree is clean  → force-remove it and delete any stale marker.
        - If the worktree is dirty  → write a marker file so the next session
          knows there is uncommitted work to resume or discard.
      When run in the main checkout:
        - Runs `git worktree prune` to remove stale references.
        - GC: deletes markers whose worktreePath no longer exists on disk.
      Never blocks (always exit 0).

    SnapshotSession mode (-SnapshotSession switch):
      Wired as a Claude Code SessionStart hook.
      1. When CLAUDE_AUTO_WORKTREE=1: creates a new git worktree for the
         current session on a fresh `session/<session-id>` branch, then emits
         an EnterWorktree instruction via additionalContext, and writes a
         pending-entry marker so Invoke-WorktreeEntryGuard.ps1 can gate calls.
      2. Scans all `.claude/.worktree-state.*.json` markers for ended-dirty
         worktrees and proposes continue/discard per entry.
      Both results are combined into a single additionalContext output.

    Entry gating (CheckEntry / ClearEntry) lives in the sibling script
    Invoke-WorktreeEntryGuard.ps1, wired as its own PreToolUse / PostToolUse
    hooks.

    Marker file: `.claude/.worktree-state.<sanitized-sid>.json`
    Schema: { sessionId, worktreePath, branch, status:"ended-dirty" }

    Pure functions live above `Invoke-WorktreeLifecycle` for Pester coverage.
    Filesystem + git access is injected via scriptblock parameters so the pure
    functions are testable without touching disk. Pass `-AsLibrary` to
    dot-source without executing the entry block.

.PARAMETER RepoRoot
    Git working tree root. Defaults to `$env:CLAUDE_PROJECT_DIR`, falling
    back to `git rev-parse --show-toplevel`.

.PARAMETER SessionId
    Claude session id. Used to namespace the marker file and the branch/path
    for auto-created worktrees. Read from stdin JSON `session_id` field when
    not provided directly.

.PARAMETER GitRunner
    Injectable scriptblock `& $GitRunner [string[]]$Argv` — returns stdout
    lines. Defaults to calling git directly. Tests pass a stub.

.PARAMETER DirLister
    Injectable scriptblock: `& $DirLister <absolute-dir>` returns an array of
    file/directory names (strings). Used to scan `.claude/` for marker files
    and to verify worktreePath existence.

.PARAMETER FileReader
    Injectable scriptblock: `& $FileReader <absolute-path>` returns the file's
    raw content as a string. Used to read marker JSON files.

.PARAMETER WorktreeCreator
    Injectable scriptblock: `& $WorktreeCreator <path>` — creates a new git
    worktree at `path` in detached HEAD mode. Only invoked when
    CLAUDE_AUTO_WORKTREE=1. Tests pass a spy.

.PARAMETER SessionEnd
    Run the SessionEnd cleanup path.

.PARAMETER SnapshotSession
    Run the SessionStart lifecycle path.

.PARAMETER AsLibrary
    Define helper functions but skip the entry block (used by Pester).
#>

[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string]$SessionId,
    [scriptblock]$GitRunner,
    [scriptblock]$DirLister,
    [scriptblock]$FileReader,
    [scriptblock]$WorktreeCreator,
    [switch]$SessionEnd,
    [switch]$SnapshotSession,
    [switch]$AsLibrary
)

# ---------- Pure helpers: session ID + path resolution ----------

function Get-SafeWorktreeSessionId {
    [CmdletBinding()]
    param([string]$SessionId)
    if ([string]::IsNullOrWhiteSpace($SessionId)) { return '' }
    return ($SessionId -replace '[^A-Za-z0-9._-]', '_')
}

function Get-WorktreeStateFilePath {
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [string]$SessionId
    )
    $dir  = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $sid  = Get-SafeWorktreeSessionId -SessionId $SessionId
    $name = if ($sid) { ".worktree-state.$sid.json" } else { '.worktree-state.json' }
    return (Join-Path $dir $name)
}

function Get-WorktreePendingFilePath {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $dir  = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $sid  = Get-SafeWorktreeSessionId -SessionId $SessionId
    $name = if ($sid) { ".worktree-pending.$sid.json" } else { '.worktree-pending.json' }
    return (Join-Path $dir $name)
}

function Get-SessionBranchName {
    [CmdletBinding()]
    param([string]$SessionId)
    $safe = Get-SafeWorktreeSessionId -SessionId $SessionId
    if (-not $safe) { return '' }
    return "session/$safe"
}

function Get-SessionWorktreePath {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $safe = Get-SafeWorktreeSessionId -SessionId $SessionId
    if (-not $safe -or -not $RepoRoot) { return '' }
    # Use GetDirectoryName — Split-Path -Parent returns '' for single-component
    # absolute paths (e.g. '/repo') on Linux, which Join-Path rejects.
    $parent   = [System.IO.Path]::GetDirectoryName($RepoRoot)
    $repoName = [System.IO.Path]::GetFileName($RepoRoot)
    if ([string]::IsNullOrWhiteSpace($parent) -or [string]::IsNullOrWhiteSpace($repoName)) { return '' }
    return (Join-Path $parent "${repoName}-wt-${safe}")
}

# ---------- Pure functions: git introspection ----------

function Get-WorktreeInfo {
    [CmdletBinding()]
    param([Parameter(Mandatory)][scriptblock]$GitRunner)

    $top = (& $GitRunner @('rev-parse', '--show-toplevel')) | Select-Object -First 1
    $top = if ($top) { ([string]$top).Trim() } else { '' }

    $listRaw = & $GitRunner @('worktree', 'list', '--porcelain')
    $listStr  = if ($listRaw -is [array]) { $listRaw -join "`n" } else { [string]$listRaw }
    $mainLine = ($listStr -split "`n" | Where-Object { $_ -match '^worktree ' } | Select-Object -First 1)
    $main     = if ($mainLine) { ($mainLine -replace '^worktree\s+', '').Trim() } else { '' }

    $branchRaw = (& $GitRunner @('rev-parse', '--abbrev-ref', 'HEAD')) | Select-Object -First 1
    $branch    = if ($branchRaw) { ([string]$branchRaw).Trim() } else { '' }
    if ($branch -eq 'HEAD') { $branch = '' }

    return @{
        Current    = $top
        Main       = $main
        IsWorktree = ($top -and $main -and $top -ne $main)
        Branch     = $branch
    }
}

function Test-WorktreeClean {
    [CmdletBinding()]
    param([Parameter(Mandatory)][scriptblock]$GitRunner)
    $raw    = & $GitRunner @('status', '--porcelain')
    $joined = if ($raw -is [array]) { $raw -join '' } else { [string]$raw }
    return [string]::IsNullOrWhiteSpace($joined)
}

function Test-WorktreeHasUnpushedCommits {
    <#
        Returns $true when the worktree has commits that have not been pushed.
        Detached HEAD: compares against main worktree HEAD via $MainGitRunner.
          - No $MainGitRunner supplied → return $true (preserve, cannot assess).
        Named branch: checks @{u}..HEAD; empty output (no upstream) → $true.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][scriptblock]$GitRunner,
        [scriptblock]$MainGitRunner
    )

    $headRef = (& $GitRunner @('rev-parse', '--abbrev-ref', 'HEAD')) | Select-Object -First 1
    $headRef = if ($headRef) { ([string]$headRef).Trim() } else { '' }

    if ($headRef -eq 'HEAD') {
        if (-not $MainGitRunner) { return $true }
        $mainSha = (& $MainGitRunner @('rev-parse', 'HEAD')) | Select-Object -First 1
        $mainSha = if ($mainSha) { ([string]$mainSha).Trim() } else { '' }
        if ([string]::IsNullOrWhiteSpace($mainSha)) { return $true }
        $raw = & $GitRunner @('rev-list', '--count', "$mainSha..HEAD")
        $str = if ($raw) { "$($raw | Select-Object -First 1)".Trim() } else { '' }
        if ([string]::IsNullOrWhiteSpace($str)) { return $true }
        return ($str -ne '0')
    }

    $raw = & $GitRunner @('rev-list', '--count', '@{u}..HEAD')
    $str = if ($raw) { "$($raw | Select-Object -First 1)".Trim() } else { '' }
    if ([string]::IsNullOrWhiteSpace($str)) { return $true }
    return ($str -ne '0')
}

# ---------- Pure functions: marker scanning + formatting ----------

function Find-EndedDirtyMarkers {
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [Parameter(Mandatory)][scriptblock]$DirLister,
        [Parameter(Mandatory)][scriptblock]$FileReader
    )

    $claudeDir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $entries   = & $DirLister $claudeDir
    if (-not $entries) { return @() }

    $results = @()
    foreach ($name in $entries) {
        if ($name -notmatch '^\.worktree-state(\..+)?\.json$') { continue }
        $fullPath = Join-Path $claudeDir $name
        $raw      = & $FileReader $fullPath
        if ([string]::IsNullOrWhiteSpace($raw)) { continue }
        try   { $obj = $raw | ConvertFrom-Json -ErrorAction Stop }
        catch { continue }

        if ([string]$obj.status -ne 'ended-dirty') { continue }

        $wtPath = [string]$obj.worktreePath
        if ([string]::IsNullOrWhiteSpace($wtPath)) { continue }
        $listing = & $DirLister $wtPath
        if ($null -eq $listing) { continue }

        $results += [PSCustomObject]@{
            sessionId    = [string]$obj.sessionId
            worktreePath = $wtPath
            branch       = [string]$obj.branch
            status       = 'ended-dirty'
            markerPath   = $fullPath
        }
    }
    return $results
}

function Format-WorktreeProposal {
    [CmdletBinding()]
    param([array]$Markers)

    $lines = @('Leftover worktree(s) from ended sessions with uncommitted changes:', '')
    foreach ($m in $Markers) {
        $markerName = if ($m.markerPath) { Split-Path -Leaf $m.markerPath } else { '' }
        $lines += "  - Branch: $($m.branch)  Path: $($m.worktreePath)  (marker: .claude/$markerName)"
    }
    $lines += ''
    $lines += 'Options per entry (tell me which to apply):'
    $lines += '  - "continue <branch>" — re-enter that worktree and resume work'
    $lines += '  - "discard <branch>" — force-remove worktree and delete marker'
    return ($lines -join "`n")
}

function Format-WorktreeCreatedContext {
    [CmdletBinding()]
    param([string]$Path)
    return @(
        'Session worktree created for isolation.',
        "  Path   : $Path",
        '',
        "Call EnterWorktree with path `"$Path`" to switch to it before doing any work."
    ) -join "`n"
}

# ---------- Impure I/O helpers ----------

function Read-WorktreeMarker {
    [CmdletBinding()]
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
        return ($raw | ConvertFrom-Json -ErrorAction Stop)
    }
    catch { return $null }
}

function Write-WorktreeMarker {
    [CmdletBinding()]
    param([string]$Path, [hashtable]$Marker)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    ($Marker | ConvertTo-Json -Compress) | Set-Content -LiteralPath $Path -Encoding utf8
}

function Remove-WorktreeMarker {
    [CmdletBinding()]
    param([string]$Path)
    if ($Path -and (Test-Path -LiteralPath $Path)) {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    }
}

# ---------- Orchestration ----------

function Invoke-WorktreeLifecycle {
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [string]$SessionId,
        [Parameter(Mandatory)][scriptblock]$GitRunner,
        [Parameter(Mandatory)][scriptblock]$DirLister,
        [Parameter(Mandatory)][scriptblock]$FileReader,
        [Parameter(Mandatory)][scriptblock]$MarkerWriter,
        [Parameter(Mandatory)][scriptblock]$MarkerDeleter,
        [scriptblock]$WorktreeCreator,
        [scriptblock]$MainGitRunner,
        [switch]$AutoWorktree,
        [switch]$SessionEnd,
        [switch]$SnapshotSession
    )

    if ($SessionEnd) {
        $info   = Get-WorktreeInfo -GitRunner $GitRunner
        $clean  = $false
        $action = 'pruned'

        if ($info.IsWorktree) {
            $mainGitForUnpushed = if ($MainGitRunner) { $MainGitRunner } else {
                $mainPath = $info.Main
                { param([string[]]$Argv) & git -C $mainPath @Argv 2>$null }.GetNewClosure()
            }
            $clean = (Test-WorktreeClean -GitRunner $GitRunner) -and
                     (-not (Test-WorktreeHasUnpushedCommits -GitRunner $GitRunner -MainGitRunner $mainGitForUnpushed))
            if ($clean) {
                & $GitRunner @('-C', $info.Main, 'worktree', 'remove', '--force', $info.Current) 2>$null

                $staleMarkers = Find-EndedDirtyMarkers -RepoRoot $RepoRoot -DirLister $DirLister -FileReader $FileReader
                foreach ($m in $staleMarkers) {
                    if ($m.worktreePath -eq $info.Current) {
                        & $MarkerDeleter $m.markerPath
                    }
                }
                $action = 'removed'
            }
            else {
                $markerPath = Get-WorktreeStateFilePath -RepoRoot $RepoRoot -SessionId $SessionId
                $marker     = @{
                    sessionId    = $SessionId
                    worktreePath = $info.Current
                    branch       = $info.Branch
                    status       = 'ended-dirty'
                }
                & $MarkerWriter $markerPath $marker
                $action = 'marked-dirty'
            }
        }
        else {
            & $GitRunner @('worktree', 'prune') 2>$null

            $claudeDir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
            $entries   = & $DirLister $claudeDir
            if ($entries) {
                foreach ($name in $entries) {
                    if ($name -notmatch '^\.worktree-state(\..+)?\.json$') { continue }
                    $fullPath = Join-Path $claudeDir $name
                    $raw      = & $FileReader $fullPath
                    if ([string]::IsNullOrWhiteSpace($raw)) { continue }
                    try {
                        $obj    = $raw | ConvertFrom-Json -ErrorAction Stop
                        $wtPath = [string]$obj.worktreePath
                        if (-not [string]::IsNullOrWhiteSpace($wtPath)) {
                            $listing = & $DirLister $wtPath
                            if ($null -eq $listing) {
                                & $MarkerDeleter $fullPath
                            }
                        }
                    }
                    catch { $null = $_ }
                }
            }
            $action = 'pruned'
        }

        return @{
            IsWorktree = $info.IsWorktree
            WasClean   = $clean
            Action     = $action
        }
    }

    if ($SnapshotSession) {
        $parts = @()

        if ($AutoWorktree -and $SessionId -and $WorktreeCreator) {
            $info = Get-WorktreeInfo -GitRunner $GitRunner
            if (-not $info.IsWorktree) {
                $path = Get-SessionWorktreePath -RepoRoot $RepoRoot -SessionId $SessionId
                if ($path) {
                    & $WorktreeCreator $path
                    $parts += Format-WorktreeCreatedContext -Path $path
                    $pendingPath = Get-WorktreePendingFilePath -RepoRoot $RepoRoot -SessionId $SessionId
                    & $MarkerWriter $pendingPath @{ sessionId = $SessionId; worktreePath = $path }
                }
            }
        }

        $markers = Find-EndedDirtyMarkers -RepoRoot $RepoRoot -DirLister $DirLister -FileReader $FileReader
        if ($markers.Count -gt 0) {
            $parts += Format-WorktreeProposal -Markers $markers
        }

        if ($parts.Count -gt 0) {
            $msg  = $parts -join "`n`n"
            $json = (@{ additionalContext = $msg } | ConvertTo-Json -Compress)
            [Console]::Out.WriteLine($json)
            return @{ ProposalEmitted = $true; Count = $markers.Count; AutoWorktree = $AutoWorktree.IsPresent }
        }

        return @{ ProposalEmitted = $false }
    }

    return @{ Action = 'noop' }
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
    if (-not [string]::IsNullOrWhiteSpace($hookInputJson)) {
        try {
            $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop
            if ($payload -and $payload.session_id -and -not $SessionId) { $SessionId = [string]$payload.session_id }
        }
        catch { $null = $_ }
    }

    $capturedRoot = $RepoRoot
    $autoWorktree = $env:CLAUDE_AUTO_WORKTREE -eq '1'

    if (-not $GitRunner) {
        $GitRunner = {
            param([string[]]$Argv)
            if ($capturedRoot) { & git -C $capturedRoot @Argv }
            else               { & git @Argv }
        }.GetNewClosure()
    }

    if (-not $DirLister) {
        $DirLister = {
            param([string]$AbsDir)
            if (-not $AbsDir -or -not (Test-Path -LiteralPath $AbsDir -PathType Container)) { return $null }
            return @(Get-ChildItem -LiteralPath $AbsDir -Force -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
        }.GetNewClosure()
    }

    if (-not $FileReader) {
        $FileReader = {
            param([string]$AbsPath)
            if ($AbsPath -and (Test-Path -LiteralPath $AbsPath)) {
                return (Get-Content -LiteralPath $AbsPath -Raw)
            }
            return ''
        }.GetNewClosure()
    }

    if (-not $WorktreeCreator) {
        $WorktreeCreator = {
            param([string]$Path)
            if ($capturedRoot) { & git -C $capturedRoot worktree add --detach $Path 2>$null }
            else               { & git worktree add --detach $Path 2>$null }
        }.GetNewClosure()
    }

    $defaultMarkerWriter = {
        param([string]$Path, [hashtable]$Marker)
        Write-WorktreeMarker -Path $Path -Marker $Marker
    }

    $defaultMarkerDeleter = {
        param([string]$Path)
        Remove-WorktreeMarker -Path $Path
    }

    try {
        Invoke-WorktreeLifecycle `
            -RepoRoot        $RepoRoot `
            -SessionId       $SessionId `
            -GitRunner       $GitRunner `
            -DirLister       $DirLister `
            -FileReader      $FileReader `
            -MarkerWriter    $defaultMarkerWriter `
            -MarkerDeleter   $defaultMarkerDeleter `
            -WorktreeCreator $WorktreeCreator `
            -AutoWorktree:$autoWorktree `
            -SessionEnd:$SessionEnd `
            -SnapshotSession:$SnapshotSession
    }
    catch { $null = $_ }

    exit 0
}
