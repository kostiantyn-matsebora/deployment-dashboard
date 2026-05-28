#Requires -Version 7.0

<#
.SYNOPSIS
    Claude Code PreToolUse hook — blocks `git commit` ONLY when the docs tree
    has REAL index / registry drift, and prints the remediation command queue.

.DESCRIPTION
    Wired via `.claude/settings.json` as a PreToolUse hook matched on the
    `Bash` tool. Reads the hook JSON payload from stdin, filters for
    `git commit` invocations, and — when the commit touches docs paths —
    runs deterministic drift detection against the working tree:

      * Index drift — for every directory holding an `index.md`, recompute
        the EXPECTED `children:` set from the filesystem (same discovery
        algorithm as `/docs-index`: direct files, sub-dir boundaries, recursion
        into index-less sub-dirs, hidden/underscore skipped, `index.md` itself
        skipped) and compare — as a SET, order-insensitive — against the
        DECLARED `children:` in that `index.md`'s front-matter. A mismatch is
        drift → queue `/docs-index <dir>`.

      * Registry drift — every ROOT index directory (an index dir whose parent
        has no `index.md`) must be referenced in CLAUDE.md's "Sources of truth"
        section. A missing ROOT is drift → queue `/docs-registry-sync`.

    This makes the hook SATISFIABLE: when the docs tree is consistent it exits 0
    regardless of what is staged; when it is drifted, running the queued
    `/docs-*` commands brings it back to consistency and the next commit passes.
    Set comparison means hand-curated `children:` ORDER never triggers drift.

    Scope note — the gate keys off STRUCTURE (`children:` membership) and the
    registry, not body `## Contents` anchors. Heading-only edits inside a doc
    do not block; the `/docs-*` skills still refresh anchors when run.

    Pure functions live above `Invoke-PreCommitDocsHook` for Pester coverage
    (see sibling `Invoke-PreCommitDocsHook.Tests.ps1`). Filesystem access is
    injected via the `-DirLister` / `-FileReader` scriptblocks so the pure
    functions are testable without touching disk. Pass `-AsLibrary` to
    dot-source the file without executing the entry block.

.PARAMETER HookInputJson
    Hook stdin payload (JSON). When omitted in normal invocation, the
    script reads from `[Console]::In`. Tests pass it directly.

.PARAMETER RepoRoot
    Git working tree root. Defaults to `$env:CLAUDE_PROJECT_DIR`, falling
    back to `git rev-parse --show-toplevel`.

.PARAMETER GitCommandRunner
    Injectable scriptblock that takes a `[string[]]` argv and returns
    stdout lines. Lets tests stub `git` without spawning processes.

.PARAMETER DirLister
    Injectable scriptblock: `& $DirLister <repo-relative-dir>` returns an array
    of `@{ Name = <string>; IsDir = <bool> }` for the directory's direct
    entries (empty array if the dir does not exist). Defaults to a
    `Get-ChildItem`-backed lister rooted at `RepoRoot`.

.PARAMETER FileReader
    Injectable scriptblock: `& $FileReader <repo-relative-path>` returns the
    file's raw content (empty string if absent). Defaults to a
    `Get-Content -Raw` reader rooted at `RepoRoot`.

.PARAMETER AsLibrary
    When set, helper + entry functions are defined but the entry block is
    skipped. Used by Pester to dot-source the file.
#>

[CmdletBinding()]
param(
    [string]$HookInputJson,
    [string]$RepoRoot,
    [scriptblock]$GitCommandRunner,
    [scriptblock]$DirLister,
    [scriptblock]$FileReader,
    [switch]$AsLibrary
)

# ---------- Pure functions: payload + git parsing ----------

function Read-HookPayload {
    [CmdletBinding()]
    param([string]$Json)
    if ([string]::IsNullOrWhiteSpace($Json)) { return $null }
    try { return $Json | ConvertFrom-Json -ErrorAction Stop }
    catch { return $null }
}

function Test-IsGitCommit {
    [CmdletBinding()]
    param([string]$Command)
    if ([string]::IsNullOrWhiteSpace($Command)) { return $false }
    # Match `git ... commit` with optional flags between (e.g. `git -C /repo commit`).
    # Exclude lookalikes (`commit-tree`, `commit-graph`) by requiring word boundary or end.
    return $Command -match '(^|[\s;&|])git(\s+-[A-Za-z]+(\s+\S+)?)*\s+commit($|[\s])'
}

function ConvertFrom-GitNameStatus {
    [CmdletBinding()]
    param([string]$NameStatus)
    $changes = @()
    if ([string]::IsNullOrWhiteSpace($NameStatus)) { return $changes }
    foreach ($line in ($NameStatus -split "`r?`n")) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $parts = $line -split "`t"
        $rawStatus = $parts[0]
        if ($rawStatus -match '^[RC]\d*$' -and $parts.Count -ge 3) {
            $changes += @{
                Status  = $rawStatus.Substring(0, 1)
                OldPath = $parts[1]
                Path    = $parts[2]
            }
        }
        elseif ($parts.Count -ge 2) {
            $changes += @{
                Status  = $rawStatus
                Path    = $parts[1]
                OldPath = $null
            }
        }
    }
    if ($changes.Count -eq 0) { return @() }
    return ,$changes
}

function Test-IsDocsPath {
    [CmdletBinding()]
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return ($Path -match '^docs/') -or ($Path -eq 'CLAUDE.md')
}

function Test-TouchesDocs {
    [CmdletBinding()]
    param([array]$Changes)
    foreach ($change in $Changes) {
        foreach ($p in @($change.Path, $change.OldPath)) {
            if (Test-IsDocsPath -Path $p) { return $true }
        }
    }
    return $false
}

# ---------- Pure functions: discovery + drift ----------

function Test-IsHiddenName {
    [CmdletBinding()]
    param([string]$Name)
    return $Name.StartsWith('.') -or $Name.StartsWith('_')
}

function Get-ExpectedChildren {
    <#
        Recursive descent under $Dir (repo-relative, NO trailing slash).
        Mirrors the `/docs-index` discovery algorithm and returns the
        children entries it would emit (leading `/`, possibly nested).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Dir,
        [Parameter(Mandatory)][scriptblock]$DirLister,
        [string]$Prefix = ''
    )
    $entries = @()
    foreach ($entry in (& $DirLister $Dir)) {
        $name = $entry.Name
        if (Test-IsHiddenName -Name $name) { continue }

        if ($entry.IsDir) {
            $childDir = "$Dir/$name"
            $childListing = & $DirLister $childDir
            $hasIndex = @($childListing | Where-Object { $_.Name -eq 'index.md' }).Count -gt 0
            if ($hasIndex) {
                # BOUNDARY — sub-index owns its subtree.
                $entries += "/$Prefix$name"
            }
            else {
                $entries += @(Get-ExpectedChildren -Dir $childDir -DirLister $DirLister -Prefix "$Prefix$name/")
            }
        }
        else {
            if ($name -eq 'index.md') { continue }
            if ($name -like '*.md') {
                $base = $name -replace '\.md$', ''
                $entries += "/$Prefix$base"
            }
            else {
                $entries += "/$Prefix$name"
            }
        }
    }
    return $entries
}

function Get-DeclaredChildren {
    <#
        Parse the `children:` block-list from an index.md's first front-matter
        block. Returns the raw entry strings (leading `/` preserved).
    #>
    [CmdletBinding()]
    param([string]$Content)
    $children = @()
    if ([string]::IsNullOrWhiteSpace($Content)) { return $children }

    $fmDelimiters = 0
    $inChildren = $false
    foreach ($line in ($Content -split "`r?`n")) {
        if ($line -match '^---\s*$') {
            $fmDelimiters++
            if ($fmDelimiters -ge 2) { break }
            continue
        }
        if ($fmDelimiters -ne 1) { continue }      # only inside the first front-matter block

        if ($line -match '^children:\s*$') { $inChildren = $true; continue }
        if ($inChildren) {
            if ($line -match '^\s*-\s*(\S+)\s*$') { $children += $matches[1] }
            elseif ($line -match '^\S') { $inChildren = $false }   # next top-level key
        }
    }
    return $children
}

function Test-SetsEqual {
    [CmdletBinding()]
    param([array]$A, [array]$B)
    $setA = [System.Collections.Generic.HashSet[string]]::new([string[]]@($A))
    $setB = [System.Collections.Generic.HashSet[string]]::new([string[]]@($B))
    if ($setA.Count -ne $setB.Count) { return $false }
    return $setA.SetEquals($setB)
}

function Get-IndexDirs {
    <#
        Walk $Dir (repo-relative, NO trailing slash) and return every directory
        that contains an `index.md`, including $Dir itself if applicable.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Dir,
        [Parameter(Mandatory)][scriptblock]$DirLister
    )
    $result = @()
    $listing = & $DirLister $Dir
    if (@($listing | Where-Object { $_.Name -eq 'index.md' }).Count -gt 0) {
        $result += $Dir
    }
    foreach ($entry in $listing) {
        if ($entry.IsDir -and -not (Test-IsHiddenName -Name $entry.Name)) {
            $result += @(Get-IndexDirs -Dir "$Dir/$($entry.Name)" -DirLister $DirLister)
        }
    }
    return $result
}

function Get-RootIndexDirs {
    <#
        A ROOT index dir is one whose parent directory holds no `index.md`
        (i.e. it is not covered by a higher index). Minimum-footprint registry.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][array]$IndexDirs)
    $set = [System.Collections.Generic.HashSet[string]]::new([string[]]@($IndexDirs))
    $roots = @()
    foreach ($dir in $IndexDirs) {
        $parent = if ($dir -match '^(.*)/[^/]+$') { $matches[1] } else { '' }
        if (-not $set.Contains($parent)) { $roots += $dir }
    }
    return $roots
}

function Test-RegistryHasEntry {
    <#
        True if CLAUDE.md's "Sources of truth" section references $DirPath
        (matched with a trailing slash, e.g. `docs/`).
    #>
    [CmdletBinding()]
    param([string]$Content, [Parameter(Mandatory)][string]$DirPath)
    if ([string]::IsNullOrWhiteSpace($Content)) { return $false }
    $needle = if ($DirPath.EndsWith('/')) { $DirPath } else { "$DirPath/" }

    $inSection = $false
    foreach ($line in ($Content -split "`r?`n")) {
        if ($line -match '^#{1,6}\s') {
            $inSection = $line -match '(?i)sources?\s+of\s+truth|authoritative'
            continue
        }
        if ($inSection -and $line.Contains($needle)) { return $true }
    }
    return $false
}

# ---------- Pure function: queue assembly ----------

function Resolve-CommandQueue {
    <#
        Given pre-computed drift signals, assemble the ordered remediation
        queue: one `/docs-index <dir>` per drifted index dir (lexical), then a
        single `/docs-registry-sync` if the registry is drifted.
    #>
    [CmdletBinding()]
    param(
        [array]$DriftedIndexDirs = @(),
        [bool]$RegistryDrift = $false
    )
    $queue = @()
    foreach ($dir in (@($DriftedIndexDirs) | Sort-Object)) {
        $cmdArgs = if ($dir.EndsWith('/')) { $dir } else { "$dir/" }
        $queue += @{ Command = '/docs-index'; Args = $cmdArgs }
    }
    if ($RegistryDrift) {
        $queue += @{ Command = '/docs-registry-sync'; Args = '' }
    }
    if ($queue.Count -eq 0) { return @() }
    return ,$queue
}

function Format-BlockMessage {
    [CmdletBinding()]
    param([array]$Queue)
    if (-not $Queue -or $Queue.Count -eq 0) { return '' }
    $lines = @(
        'Documentation drift detected in the working tree.',
        'Run the following commands in order, re-stage modified files, then re-commit:',
        ''
    )
    for ($i = 0; $i -lt $Queue.Count; $i++) {
        $item = $Queue[$i]
        $cmd = if ($item.Args) { "$($item.Command) $($item.Args)" } else { $item.Command }
        $lines += "  $($i + 1). $cmd"
    }
    $lines += ''
    $lines += 'Binding gates: `.claude/agents/document-writer.md` §§ Non-overwrite policy + Hard rules.'
    return ($lines -join "`n")
}

# ---------- Orchestration ----------

function Get-DocsDriftQueue {
    <#
        Detect index + registry drift under `docs/` using the injected
        filesystem accessors. Returns the remediation queue (possibly empty).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][scriptblock]$DirLister,
        [Parameter(Mandatory)][scriptblock]$FileReader,
        [string]$DocsRoot = 'docs'
    )
    $indexDirs = @(Get-IndexDirs -Dir $DocsRoot -DirLister $DirLister)
    if ($indexDirs.Count -eq 0) {
        return @()   # nothing indexed → nothing to enforce
    }

    $drifted = @()
    foreach ($dir in $indexDirs) {
        $expected = @(Get-ExpectedChildren -Dir $dir -DirLister $DirLister)
        $declared = @(Get-DeclaredChildren -Content (& $FileReader "$dir/index.md"))
        if (-not (Test-SetsEqual -A $expected -B $declared)) { $drifted += $dir }
    }

    $roots = @(Get-RootIndexDirs -IndexDirs $indexDirs)
    $claude = & $FileReader 'CLAUDE.md'
    $registryDrift = $false
    foreach ($root in $roots) {
        if (-not (Test-RegistryHasEntry -Content $claude -DirPath $root)) { $registryDrift = $true }
    }

    return (Resolve-CommandQueue -DriftedIndexDirs $drifted -RegistryDrift $registryDrift)
}

function Invoke-PreCommitDocsHook {
    [CmdletBinding()]
    param(
        [string]$HookInputJson,
        [string]$RepoRoot,
        [scriptblock]$GitCommandRunner,
        [scriptblock]$DirLister,
        [scriptblock]$FileReader
    )

    if (-not $RepoRoot) {
        try {
            $detected = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
            if ($detected) { $RepoRoot = $detected.Trim() }
        }
        catch { }
    }

    if (-not $GitCommandRunner) {
        $capturedRoot = $RepoRoot
        $GitCommandRunner = {
            param([string[]]$Argv)
            if ($capturedRoot) { & git -C $capturedRoot @Argv }
            else { & git @Argv }
        }.GetNewClosure()
    }

    if (-not $DirLister) {
        $capturedRoot = $RepoRoot
        $DirLister = {
            param([string]$RelDir)
            $base = if ($capturedRoot) { Join-Path $capturedRoot $RelDir } else { $RelDir }
            if (-not (Test-Path -LiteralPath $base)) { return @() }
            return @(Get-ChildItem -LiteralPath $base -Force -ErrorAction SilentlyContinue | ForEach-Object {
                @{ Name = $_.Name; IsDir = $_.PSIsContainer }
            })
        }.GetNewClosure()
    }

    if (-not $FileReader) {
        $capturedRoot = $RepoRoot
        $FileReader = {
            param([string]$RelPath)
            $abs = if ($capturedRoot) { Join-Path $capturedRoot $RelPath } else { $RelPath }
            if (Test-Path -LiteralPath $abs) { return (Get-Content -LiteralPath $abs -Raw) }
            return ''
        }.GetNewClosure()
    }

    $payload = Read-HookPayload -Json $HookInputJson
    if (-not $payload) {
        return @{ ExitCode = 0; Message = ''; Reason = 'no-payload'; Queue = @() }
    }

    $command = $null
    if ($payload.tool_input -and $payload.tool_input.command) {
        $command = [string]$payload.tool_input.command
    }
    if (-not (Test-IsGitCommit -Command $command)) {
        return @{ ExitCode = 0; Message = ''; Reason = 'not-git-commit'; Queue = @() }
    }

    $nameStatusRaw = & $GitCommandRunner @('diff', '--cached', '--name-status', '-M')
    $nameStatus = if ($nameStatusRaw -is [array]) { $nameStatusRaw -join "`n" } else { [string]$nameStatusRaw }
    $changes = ConvertFrom-GitNameStatus -NameStatus $nameStatus

    if (-not (Test-TouchesDocs -Changes $changes)) {
        return @{ ExitCode = 0; Message = ''; Reason = 'no-docs-change'; Queue = @() }
    }

    $queue = @(Get-DocsDriftQueue -DirLister $DirLister -FileReader $FileReader)

    if ($queue.Count -eq 0) {
        return @{ ExitCode = 0; Message = ''; Reason = 'no-docs-drift'; Queue = @() }
    }

    $msg = Format-BlockMessage -Queue $queue
    return @{ ExitCode = 2; Message = $msg; Reason = 'docs-drift-detected'; Queue = $queue }
}

# ---------- Entry block ----------

if (-not $AsLibrary) {
    if (-not $HookInputJson) {
        try { $HookInputJson = [Console]::In.ReadToEnd() } catch { $HookInputJson = '' }
    }

    $result = Invoke-PreCommitDocsHook `
        -HookInputJson $HookInputJson `
        -RepoRoot $RepoRoot `
        -GitCommandRunner $GitCommandRunner `
        -DirLister $DirLister `
        -FileReader $FileReader

    if ($result.ExitCode -ne 0 -and $result.Message) {
        [Console]::Error.WriteLine($result.Message)
    }
    exit $result.ExitCode
}
