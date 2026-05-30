#Requires -Version 7.0

<#
.SYNOPSIS
    Claude Code worktree lifecycle hook — tracks dirty worktree sessions and
    proposes cleanup on the next SessionStart.

.DESCRIPTION
    Two invocation surfaces:

    SessionEnd mode (-SessionEnd switch):
      Wired as a Claude Code Stop hook. When run inside a git worktree:
        - If the worktree is clean  → force-remove it and delete any stale marker.
        - If the worktree is dirty  → write a marker file so the next session
          knows there is uncommitted work to resume or discard.
      When run in the main checkout:
        - Runs `git worktree prune` to remove stale references.
        - GC: deletes markers whose worktreePath no longer exists on disk.
      Never blocks (always exit 0).

    SnapshotSession mode (-SnapshotSession switch):
      Wired as a Claude Code SessionStart hook. Scans all
      `.claude/.worktree-state.*.json` markers. When ended-dirty worktrees are
      found, emits a JSON proposal to stdout (Claude Code `additionalContext`)
      so the user is prompted to continue or discard each one.

    Marker file: `.claude/.worktree-state.<sanitized-sid>.json`
    Schema: { sessionId, worktreePath, branch, status:"ended-dirty" }

    Pure functions live above `Invoke-WorktreeCleanup` for Pester coverage.
    Filesystem + git access is injected via scriptblock parameters so the pure
    functions are testable without touching disk. Pass `-AsLibrary` to
    dot-source without executing the entry block.

.PARAMETER RepoRoot
    Git working tree root. Defaults to `$env:CLAUDE_PROJECT_DIR`, falling
    back to `git rev-parse --show-toplevel`.

.PARAMETER SessionId
    Claude session id. Used to namespace the marker file. Read from stdin JSON
    `session_id` field when not provided directly.

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

.PARAMETER SessionEnd
    Run the SessionEnd cleanup path.

.PARAMETER SnapshotSession
    Run the SessionStart proposal path.

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
    [switch]$SessionEnd,
    [switch]$SnapshotSession,
    [switch]$AsLibrary
)

# ---------- Pure helpers: session ID + path resolution ----------

function Get-SafeWorktreeSessionId {
    <#
        Sanitize a session id for use in a filename: keep [A-Za-z0-9._-],
        collapse anything else to '_'. Empty / whitespace -> ''.
    #>
    [CmdletBinding()]
    param([string]$SessionId)
    if ([string]::IsNullOrWhiteSpace($SessionId)) { return '' }
    return ($SessionId -replace '[^A-Za-z0-9._-]', '_')
}

function Get-WorktreeStateFilePath {
    <#
        Returns the absolute path for a worktree state marker file.
        Empty/whitespace sid -> `.claude/.worktree-state.json` (global).
        Non-empty sid        -> `.claude/.worktree-state.<sanitized-sid>.json`.
    #>
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [string]$SessionId
    )
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $sid = Get-SafeWorktreeSessionId -SessionId $SessionId
    $name = if ($sid) { ".worktree-state.$sid.json" } else { '.worktree-state.json' }
    return (Join-Path $dir $name)
}

# ---------- Pure functions: git introspection ----------

function Get-WorktreeInfo {
    <#
        Resolves worktree topology from git. Returns:
          Current    — absolute path of the checkout git commands run in
          Main       — absolute path of the primary (first) worktree
          IsWorktree — $true when Current and Main differ (linked worktree)
          Branch     — short branch name; '' when detached or on error
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][scriptblock]$GitRunner)

    $top = (& $GitRunner @('rev-parse', '--show-toplevel')) | Select-Object -First 1
    $top = if ($top) { ([string]$top).Trim() } else { '' }

    $listRaw = & $GitRunner @('worktree', 'list', '--porcelain')
    $listStr = if ($listRaw -is [array]) { $listRaw -join "`n" } else { [string]$listRaw }
    $mainLine = ($listStr -split "`n" | Where-Object { $_ -match '^worktree ' } | Select-Object -First 1)
    $main = if ($mainLine) { ($mainLine -replace '^worktree\s+', '').Trim() } else { '' }

    $branchRaw = (& $GitRunner @('rev-parse', '--abbrev-ref', 'HEAD')) | Select-Object -First 1
    $branch = if ($branchRaw) { ([string]$branchRaw).Trim() } else { '' }
    if ($branch -eq 'HEAD') { $branch = '' }   # detached HEAD

    return @{
        Current    = $top
        Main       = $main
        IsWorktree = ($top -and $main -and $top -ne $main)
        Branch     = $branch
    }
}

function Test-WorktreeClean {
    <#
        Returns $true when the working tree has no staged, unstaged, or
        untracked changes (git status --porcelain output is empty).
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][scriptblock]$GitRunner)
    $raw = & $GitRunner @('status', '--porcelain')
    $joined = if ($raw -is [array]) { $raw -join '' } else { [string]$raw }
    return [string]::IsNullOrWhiteSpace($joined)
}

# ---------- Pure functions: marker scanning + formatting ----------

function Find-EndedDirtyMarkers {
    <#
        Scans `.claude/` for files matching `.worktree-state.*.json`. Reads
        each, returns an array of parsed marker objects where:
          - status -eq 'ended-dirty'
          - worktreePath still exists on disk (verified via $DirLister)
        $DirLister is called with the absolute path of the directory to check.
        $FileReader is called with the absolute path of the marker file.
    #>
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [Parameter(Mandatory)][scriptblock]$DirLister,
        [Parameter(Mandatory)][scriptblock]$FileReader
    )

    $claudeDir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $entries = & $DirLister $claudeDir
    if (-not $entries) { return @() }

    $results = @()
    foreach ($name in $entries) {
        if ($name -notmatch '^\.worktree-state(\..+)?\.json$') { continue }
        $fullPath = Join-Path $claudeDir $name
        $raw = & $FileReader $fullPath
        if ([string]::IsNullOrWhiteSpace($raw)) { continue }
        try {
            $obj = $raw | ConvertFrom-Json -ErrorAction Stop
        }
        catch { continue }

        if ([string]$obj.status -ne 'ended-dirty') { continue }

        # Verify the worktreePath still exists (DirLister returns non-null/non-empty
        # array for a directory that exists; $null / empty means absent or not a dir).
        $wtPath = [string]$obj.worktreePath
        if ([string]::IsNullOrWhiteSpace($wtPath)) { continue }
        $listing = & $DirLister $wtPath
        # A non-null result (even an empty array for an empty dir) means it exists.
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
    <#
        Formats the additionalContext string for Claude describing leftover
        worktrees from ended sessions that had uncommitted changes.
    #>
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

# ---------- Impure I/O helpers ----------

function Read-WorktreeMarker {
    <#
        Reads and parses a marker JSON file. Returns $null on error or missing.
    #>
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
    <#
        Creates `.claude/` if absent and writes a marker JSON file.
    #>
    [CmdletBinding()]
    param([string]$Path, [hashtable]$Marker)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    ($Marker | ConvertTo-Json -Compress) | Set-Content -LiteralPath $Path -Encoding utf8
}

function Remove-WorktreeMarker {
    <#
        Deletes the marker file if it exists.
    #>
    [CmdletBinding()]
    param([string]$Path)
    if ($Path -and (Test-Path -LiteralPath $Path)) {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    }
}

# ---------- Orchestration ----------

function Invoke-WorktreeCleanup {
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [string]$SessionId,
        [Parameter(Mandatory)][scriptblock]$GitRunner,
        [Parameter(Mandatory)][scriptblock]$DirLister,
        [Parameter(Mandatory)][scriptblock]$FileReader,
        [Parameter(Mandatory)][scriptblock]$MarkerWriter,
        [Parameter(Mandatory)][scriptblock]$MarkerDeleter,
        [switch]$SessionEnd,
        [switch]$SnapshotSession
    )

    if ($SessionEnd) {
        $info = Get-WorktreeInfo -GitRunner $GitRunner
        $clean = $false
        $action = 'pruned'

        if ($info.IsWorktree) {
            $clean = Test-WorktreeClean -GitRunner $GitRunner
            if ($clean) {
                # Remove the worktree from the main checkout.
                & $GitRunner @('-C', $info.Main, 'worktree', 'remove', '--force', $info.Current) 2>$null

                # GC: delete any marker referencing this worktree path.
                $staleMarkers = Find-EndedDirtyMarkers -RepoRoot $RepoRoot -DirLister $DirLister -FileReader $FileReader
                foreach ($m in $staleMarkers) {
                    if ($m.worktreePath -eq $info.Current) {
                        & $MarkerDeleter $m.markerPath
                    }
                }
                $action = 'removed'
            }
            else {
                # Worktree is dirty — persist a marker for the next session.
                $markerPath = Get-WorktreeStateFilePath -RepoRoot $RepoRoot -SessionId $SessionId
                $marker = @{
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
            # Main checkout: prune stale worktree references.
            & $GitRunner @('worktree', 'prune') 2>$null

            # GC: markers whose worktreePath no longer exists on disk.
            # Find-EndedDirtyMarkers only returns markers for paths that exist, so
            # we scan raw marker files here to catch the gone-path case.
            $claudeDir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
            $entries = & $DirLister $claudeDir
            if ($entries) {
                foreach ($name in $entries) {
                    if ($name -notmatch '^\.worktree-state(\..+)?\.json$') { continue }
                    $fullPath = Join-Path $claudeDir $name
                    $raw = & $FileReader $fullPath
                    if ([string]::IsNullOrWhiteSpace($raw)) { continue }
                    try {
                        $obj = $raw | ConvertFrom-Json -ErrorAction Stop
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
        $markers = Find-EndedDirtyMarkers -RepoRoot $RepoRoot -DirLister $DirLister -FileReader $FileReader
        if ($markers.Count -eq 0) {
            return @{ ProposalEmitted = $false }
        }
        $msg = Format-WorktreeProposal -Markers $markers
        $json = (@{ additionalContext = $msg } | ConvertTo-Json -Compress)
        [Console]::Out.WriteLine($json)
        return @{ ProposalEmitted = $true; Count = $markers.Count }
    }

    return @{ Action = 'noop' }
}

# ---------- Entry block ----------

if (-not $AsLibrary) {
    # Resolve RepoRoot.
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

    # Read session_id from stdin JSON payload (same pattern as docs-keeper).
    $hookInputJson = ''
    if ([Console]::IsInputRedirected) {
        try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' }
    }
    if (-not $SessionId -and -not [string]::IsNullOrWhiteSpace($hookInputJson)) {
        try {
            $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop
            if ($payload -and $payload.session_id) { $SessionId = [string]$payload.session_id }
        }
        catch { $null = $_ }
    }

    # Build default injectable scriptblocks (closures capturing $RepoRoot).
    $capturedRoot = $RepoRoot

    if (-not $GitRunner) {
        $GitRunner = {
            param([string[]]$Argv)
            if ($capturedRoot) { & git -C $capturedRoot @Argv }
            else { & git @Argv }
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

    $defaultMarkerWriter = {
        param([string]$Path, [hashtable]$Marker)
        Write-WorktreeMarker -Path $Path -Marker $Marker
    }

    $defaultMarkerDeleter = {
        param([string]$Path)
        Remove-WorktreeMarker -Path $Path
    }

    try {
        Invoke-WorktreeCleanup `
            -RepoRoot $RepoRoot `
            -SessionId $SessionId `
            -GitRunner $GitRunner `
            -DirLister $DirLister `
            -FileReader $FileReader `
            -MarkerWriter $defaultMarkerWriter `
            -MarkerDeleter $defaultMarkerDeleter `
            -SessionEnd:$SessionEnd `
            -SnapshotSession:$SnapshotSession
    }
    catch { $null = $_ }

    exit 0
}
