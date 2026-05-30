#Requires -Version 7.0

<#
.SYNOPSIS
    Claude Code docs-keeper hook — drives the full documentation chain
    automatically: optimize (Mode B `/docs-revise`) -> re-index (Mode A
    `/docs-index`) -> re-register (`/docs-registry-sync`). Blocks or warns
    (configurable) and prints the ordered remediation queue.

.DESCRIPTION
    Six invocation surfaces:

    PreToolUse mode (default):
      Wired via `.claude/settings.json` as a PreToolUse hook matched on the
      `Bash` tool. Reads the hook JSON payload from stdin, filters for
      `git commit` invocations that touch any `.md` file, and runs deterministic
      drift detection plus the Mode B revise scope (the STAGED `.md` set).
      Files already marked `revised: true` in the session tracker are skipped.

    Track mode (-Track switch):
      Wired as the `Stop` hook. Records session-edited `.md` files into the
      session tracker (`TrackedMd`). Never blocks.

    MarkRevised mode (-MarkRevised switch):
      Wired as a `PostToolUse` hook matched on `Skill`. When a `/docs-revise`
      skill call completes, marks the revised files in `TrackedMd` as
      `revised: true`.

    Dismiss mode (-Dismiss <path>):
      Deletes the specified tracker file (user chose "dismiss" from the
      session-start proposal).

    SessionStart mode (-SnapshotSession switch):
      Captures HEAD + the already-dirty path set to
      `.claude/.docs-keeper-session.<sid>.json` so Track can isolate THIS
      session's doc edits. Also surfaces unrevised files and pending captures
      from prior sessions. Never blocks.

    SessionEnd mode (-SessionEnd switch):
      Deletes this session's per-session state files. Surfaces any captured
      docs as a systemMessage. Never blocks.

    Capture write operations (AddCapture / CaptureFromSummary) live in the
    sibling script Invoke-DocsKeeperCapture.ps1.

    Registry drift also covers ROLE drift: a present "Sources of truth" entry
    whose text no longer contains the ROOT index's `intro` queues
    `/docs-registry-sync`.

    Enforcement (`-EnforcementMode` / `$env:DOCS_KEEPER_ENFORCE`): `block`
    (default; exit 2) or `warn` (exit 0, queue still surfaced).

    Drift detection (project-agnostic — works for any docs-keeper index tree):

      * Index drift — for every directory holding an `index.md`, recompute
        the EXPECTED `children:` set from the filesystem and compare as a SET
        (order-insensitive) against the DECLARED `children:` in that
        `index.md`'s front-matter. A mismatch is drift -> queue `/docs-index`.

      * Registry drift — every ROOT index directory must be referenced in the
        host root prompt file's "Sources of truth" section. A missing ROOT is
        drift -> queue `/docs-registry-sync`.

    Satisfiability: when the docs tree is consistent the hook exits 0 regardless
    of what is staged.

    Pure functions live above `Invoke-DocsKeeperMaintenance` for Pester coverage
    (see sibling `Invoke-DocsKeeperMaintenance.Tests.ps1`). Filesystem access is
    injected via `-DirLister` / `-FileReader` scriptblocks so the pure functions
    are testable without touching disk. Pass `-AsLibrary` to dot-source the file
    without executing the entry block.

.PARAMETER HookInputJson
    Hook stdin payload (JSON). When omitted in normal invocation the script
    reads from `[Console]::In`. Tests pass it directly.

.PARAMETER RepoRoot
    Git working tree root. Defaults to `$env:CLAUDE_PROJECT_DIR`, falling
    back to `git rev-parse --show-toplevel`.

.PARAMETER GitCommandRunner
    Injectable scriptblock — takes `[string[]]` argv, returns stdout lines.

.PARAMETER DirLister
    Injectable scriptblock: `& $DirLister <repo-relative-dir>` returns an array
    of `@{ Name = <string>; IsDir = <bool> }` for the directory's direct entries.

.PARAMETER FileReader
    Injectable scriptblock: `& $FileReader <repo-relative-path>` returns the
    file's raw content (empty string if absent).

.PARAMETER SnapshotWriter
    Injectable scriptblock `& $SnapshotWriter <snapshot-hashtable>` used by
    SessionStart mode.

.PARAMETER SessionReader
    Injectable scriptblock returning the full session `@{ Head; Dirty; TrackedMd }`
    (or $null). Used by PreToolUse mode.

.PARAMETER EnforcementMode
    Gate hardness: `block` (default) or `warn`. Falls back to
    `$env:DOCS_KEEPER_ENFORCE`.

.PARAMETER SessionId
    Claude session id (from the hook stdin payload's `session_id`). Namespaces
    the per-session files so concurrent sessions do not share state.

.PARAMETER SnapshotSession
    SessionStart mode: capture the per-session baseline snapshot and exit 0.

.PARAMETER SessionEnd
    SessionEnd mode: delete this session's per-session state files and exit 0.

.PARAMETER Track
    Stop-hook mode: record session-edited `.md` files into the session tracker.
    Never blocks.

.PARAMETER MarkRevised
    PostToolUse mode: when a `/docs-revise` skill completes, mark the revised
    files as `revised: true` in the session tracker.

.PARAMETER Dismiss
    Delete the specified tracker file path and exit 0.

.PARAMETER AsLibrary
    Define helper + entry functions but skip the entry block. Used by Pester.
#>

[CmdletBinding()]
param(
    [string]$HookInputJson,
    [string]$RepoRoot,
    [string]$SessionId,
    [scriptblock]$GitCommandRunner,
    [scriptblock]$DirLister,
    [scriptblock]$FileReader,
    [scriptblock]$SnapshotWriter,
    [scriptblock]$SessionReader,
    [string]$EnforcementMode,
    [switch]$SnapshotSession,
    [switch]$SessionEnd,
    [switch]$Track,
    [switch]$MarkRevised,
    [string]$Dismiss,
    [switch]$DriftOnly,
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

function Get-SessionIdFromPayload {
    [CmdletBinding()]
    param($Payload)
    if ($Payload -and $Payload.session_id) { return [string]$Payload.session_id }
    return ''
}

function Get-SafeSessionId {
    <#
        Sanitize a session id for use in a filename: keep [A-Za-z0-9._-], collapse
        anything else to '_'. Empty / whitespace -> '' (callers fall back to the
        non-namespaced global path).
    #>
    [CmdletBinding()]
    param([string]$SessionId)
    if ([string]::IsNullOrWhiteSpace($SessionId)) { return '' }
    return ($SessionId -replace '[^A-Za-z0-9._-]', '_')
}

function Test-IsGitCommit {
    [CmdletBinding()]
    param([string]$Command)
    if ([string]::IsNullOrWhiteSpace($Command)) { return $false }
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
            $changes += @{ Status = $rawStatus.Substring(0, 1); OldPath = $parts[1]; Path = $parts[2] }
        }
        elseif ($parts.Count -ge 2) {
            $changes += @{ Status = $rawStatus; Path = $parts[1]; OldPath = $null }
        }
    }
    if ($changes.Count -eq 0) { return @() }
    return ,$changes
}

function Test-IsMarkdownPath {
    [CmdletBinding()]
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return $Path -like '*.md'
}

function Test-TouchesIndexedContent {
    [CmdletBinding()]
    param([array]$Changes)
    foreach ($change in $Changes) {
        foreach ($p in @($change.Path, $change.OldPath)) {
            if (Test-IsMarkdownPath -Path $p) { return $true }
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

function Find-HostRootPromptFile {
    [CmdletBinding()]
    param([Parameter(Mandatory)][scriptblock]$FileReader)
    foreach ($candidate in @('CLAUDE.md', 'AGENTS.md', '.agent/INDEX.md')) {
        $content = & $FileReader $candidate
        if (-not [string]::IsNullOrWhiteSpace($content)) { return $candidate }
    }
    return ''
}

function Get-ExpectedChildren {
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
            $childDir = if ($Dir -eq '.') { $name } else { "$Dir/$name" }
            $childListing = & $DirLister $childDir
            $hasIndex = @($childListing | Where-Object { $_.Name -eq 'index.md' }).Count -gt 0
            if ($hasIndex) {
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
        if ($fmDelimiters -ne 1) { continue }

        if ($line -match '^children:\s*$') { $inChildren = $true; continue }
        if ($inChildren) {
            if ($line -match '^\s*-\s*(\S+)\s*$') { $children += $matches[1] }
            elseif ($line -match '^\S') { $inChildren = $false }
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
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Dir,
        [Parameter(Mandatory)][scriptblock]$DirLister,
        [string[]]$ExcludeDirs = @()
    )
    $result = @()
    $listing = & $DirLister $Dir
    if (@($listing | Where-Object { $_.Name -eq 'index.md' }).Count -gt 0) {
        $result += $Dir
    }
    foreach ($entry in $listing) {
        if (-not $entry.IsDir) { continue }
        if (Test-IsHiddenName -Name $entry.Name) { continue }
        if ($ExcludeDirs.Count -gt 0 -and $entry.Name -in $ExcludeDirs) { continue }
        $childPath = if ($Dir -eq '.') { $entry.Name } else { "$Dir/$($entry.Name)" }
        $result += @(Get-IndexDirs -Dir $childPath -DirLister $DirLister -ExcludeDirs $ExcludeDirs)
    }
    return $result
}

function Get-RootIndexDirs {
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

function Test-RegistryRoleInSync {
    [CmdletBinding()]
    param([string]$Content, [Parameter(Mandatory)][string]$DirPath, [string]$Intro)
    if ([string]::IsNullOrWhiteSpace($Intro)) { return $true }
    if ([string]::IsNullOrWhiteSpace($Content)) { return $false }
    $needle = if ($DirPath.EndsWith('/')) { $DirPath } else { "$DirPath/" }

    $inSection = $false
    foreach ($line in ($Content -split "`r?`n")) {
        if ($line -match '^#{1,6}\s') {
            $inSection = $line -match '(?i)sources?\s+of\s+truth|authoritative'
            continue
        }
        if ($inSection -and $line.Contains($needle)) { return $line.Contains($Intro) }
    }
    return $false
}

# ---------- Pure functions: Mode B (docs-revise) ----------

function Get-ContentSha {
    [CmdletBinding()]
    param([string]$Content)
    if ($null -eq $Content) { $Content = '' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Content)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
    return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
}

function Get-IntroFromFrontMatter {
    [CmdletBinding()]
    param([string]$Content)
    if ([string]::IsNullOrWhiteSpace($Content)) { return '' }
    $fmDelimiters = 0
    foreach ($line in ($Content -split "`r?`n")) {
        if ($line -match '^---\s*$') {
            $fmDelimiters++
            if ($fmDelimiters -ge 2) { break }
            continue
        }
        if ($fmDelimiters -ne 1) { continue }
        if ($line -match '^intro:\s*(.+?)\s*$') {
            $val = $matches[1]
            if ($val -match "^'(.*)'$") { return $matches[1] }
            if ($val -match '^"(.*)"$') { return $matches[1] }
            return $val
        }
    }
    return ''
}

function ConvertFrom-GitPorcelain {
    [CmdletBinding()]
    param([string]$Porcelain)
    $paths = @()
    if ([string]::IsNullOrWhiteSpace($Porcelain)) { return @() }
    foreach ($line in ($Porcelain -split "`r?`n")) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $rest = if ($line.Length -gt 3) { $line.Substring(3) } else { $line.Trim() }
        if ($rest -match '->') { $rest = ($rest -split '->')[-1] }
        $rest = $rest.Trim().Trim('"')
        if ($rest) { $paths += $rest }
    }
    return @($paths)
}

function Get-SessionEditedPaths {
    [CmdletBinding()]
    param(
        [string[]]$CommittedPaths = @(),
        [string[]]$CurrentDirtyPaths = @(),
        [string[]]$SnapshotDirtyPaths = @()
    )
    $snapSet = [System.Collections.Generic.HashSet[string]]::new([string[]]@($SnapshotDirtyPaths))
    $seen = [System.Collections.Generic.HashSet[string]]::new()
    $result = @()
    foreach ($p in @($CommittedPaths)) { if ($p -and $seen.Add($p)) { $result += $p } }
    foreach ($p in @($CurrentDirtyPaths)) {
        if ($p -and -not $snapSet.Contains($p) -and $seen.Add($p)) { $result += $p }
    }
    return @($result)
}

function Select-MarkdownPaths {
    [CmdletBinding()]
    param([string[]]$Paths = @())
    $md = @(@($Paths) | Where-Object { Test-IsMarkdownPath -Path $_ })
    return @($md)
}

function Resolve-ReviseQueue {
    [CmdletBinding()]
    param([string[]]$Paths = @())
    $sorted = @(@($Paths) | Sort-Object)
    if ($sorted.Count -eq 0) { return @() }
    return @(@{ Command = '/docs-revise'; Args = ($sorted -join ' ') })
}

function Resolve-EnforcementMode {
    [CmdletBinding()]
    param([string]$EnvValue)
    if ($EnvValue -and $EnvValue.Trim().ToLowerInvariant() -eq 'warn') { return 'warn' }
    return 'block'
}

# ---------- Pure function: queue assembly ----------

function Resolve-CommandQueue {
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
    param(
        [array]$Queue,
        [bool]$Standalone = $false,
        [string]$Mode = 'block'
    )
    if (-not $Queue -or $Queue.Count -eq 0) { return '' }
    $header = if ($Mode -eq 'warn') { 'Documentation maintenance suggested (non-blocking).' } `
              else { 'Documentation drift detected in the working tree.' }
    $followUp = if ($Mode -eq 'warn') { 'Recommended commands, in order:' } `
                elseif ($Standalone) { 'Run the following commands to fix:' } `
                else { 'Run the following commands in order, re-stage modified files, then re-commit:' }
    $lines = @(
        $header,
        $followUp,
        ''
    )
    for ($i = 0; $i -lt $Queue.Count; $i++) {
        $item = $Queue[$i]
        $cmd = if ($item.Args) { "$($item.Command) $($item.Args)" } else { $item.Command }
        $lines += "  $($i + 1). $cmd"
    }
    $lines += ''
    $lines += 'Binding gates: `.claude/agents/docs-keeper.md` §§ Non-overwrite policy + Hard rules.'
    return ($lines -join "`n")
}

# ---------- Pure functions: TrackedMd ----------

function Add-TrackedMdFiles {
    <#
        Pure. Returns updated session hashtable. For each path in $Paths: if NOT
        already in TrackedMd -> add with revised: false. If already present ->
        leave unchanged (preserve revised: true).
    #>
    [CmdletBinding()]
    param([hashtable]$Session, [string[]]$Paths)
    $updated = @{}
    $updated['Head'] = $Session.Head
    $updated['Dirty'] = $Session.Dirty
    $tracked = @{}
    if ($Session.TrackedMd) {
        foreach ($k in $Session.TrackedMd.Keys) { $tracked[$k] = $Session.TrackedMd[$k] }
    }
    foreach ($p in @($Paths)) {
        if (-not $p) { continue }
        if (-not $tracked.ContainsKey($p)) {
            $tracked[$p] = @{ revised = $false }
        }
        # already present -> leave unchanged
    }
    $updated['TrackedMd'] = $tracked
    return $updated
}

function Set-TrackedMdRevised {
    <#
        Pure. Returns updated session hashtable with each path in $Paths set to
        revised: true. Adds path if not present.
    #>
    [CmdletBinding()]
    param([hashtable]$Session, [string[]]$Paths)
    $updated = @{}
    $updated['Head'] = $Session.Head
    $updated['Dirty'] = $Session.Dirty
    $tracked = @{}
    if ($Session.TrackedMd) {
        foreach ($k in $Session.TrackedMd.Keys) { $tracked[$k] = $Session.TrackedMd[$k] }
    }
    foreach ($p in @($Paths)) {
        if (-not $p) { continue }
        $tracked[$p] = @{ revised = $true }
    }
    $updated['TrackedMd'] = $tracked
    return $updated
}

function Format-SessionStartProposal {
    <#
        Pure. Given an array of [trackerPath, fileList] pairs, formats the
        additionalContext string proposing to the user: revise now / snooze / dismiss.
    #>
    [CmdletBinding()]
    param([string[][]]$UnrevisedByFile)
    $lines = @('Docs changed in a previous session but not revised:')
    foreach ($pair in $UnrevisedByFile) {
        $trackerPath = $pair[0]
        $files = $pair[1..($pair.Length - 1)] -join ', '
        $lines += "  From session file $trackerPath`: $files"
    }
    $lines += ''
    $lines += 'Options (reply with your choice):'
    $lines += '  - "revise" — run /docs-revise on these files now'
    $lines += '  - "snooze" — ask me again next session (tracker kept)'
    $lines += '  - "dismiss" — delete the tracker, never ask again'
    return ($lines -join "`n")
}

# ---------- Pure functions: docs-capture ----------

function Get-DocsCaptureFilePath {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $sid = Get-SafeSessionId -SessionId $SessionId
    $name = if ($sid) { ".docs-capture.$sid.json" } else { '.docs-capture.json' }
    return (Join-Path $dir $name)
}

function Format-CaptureReport {
    <#
        Pure. Returns a concise structured string for systemMessage (SessionEnd).
        Returns empty string when captures is absent or empty.
    #>
    [CmdletBinding()]
    param([hashtable]$CaptureFile)
    if (-not $CaptureFile -or -not $CaptureFile.ContainsKey('captures')) { return '' }
    $captures = @($CaptureFile['captures'])
    if ($captures.Count -eq 0) { return '' }

    $lines = @("Docs captured this session ($($captures.Count)):")
    for ($i = 0; $i -lt $captures.Count; $i++) {
        $entry = $captures[$i]
        $text  = [string]$entry.content
        if ($text.Length -gt 80) { $text = $text.Substring(0, 80) + ([char]0x2026) }
        $src   = [string]$entry.source
        $doc   = [string]$entry.suggestedDoc
        $line  = "  $($i + 1). [$src] $text"
        if ($doc) { $line += " -> $doc" }
        $lines += $line
    }
    return ($lines -join "`n")
}

function Format-CaptureProposal {
    <#
        Pure. $CaptureFiles is an array of parsed capture hashtables (one per prior
        session). Returns a concise structured string for additionalContext
        (SessionStart). Returns empty string when empty or all have no captures.
    #>
    [CmdletBinding()]
    param([array]$CaptureFiles)
    if (-not $CaptureFiles -or $CaptureFiles.Count -eq 0) { return '' }

    $allEntries = @()
    foreach ($cf in $CaptureFiles) {
        if (-not $cf -or -not $cf.ContainsKey('captures')) { continue }
        $allEntries += @($cf['captures'])
    }
    if ($allEntries.Count -eq 0) { return '' }

    $lines = @("Pending doc captures from previous session(s) ($($allEntries.Count) total):")
    for ($i = 0; $i -lt $allEntries.Count; $i++) {
        $entry = $allEntries[$i]
        $text  = [string]$entry.content
        if ($text.Length -gt 80) { $text = $text.Substring(0, 80) + ([char]0x2026) }
        $src   = [string]$entry.source
        $doc   = [string]$entry.suggestedDoc
        $line  = "  $($i + 1). [$src] $text"
        if ($doc) { $line += " -> $doc" }
        $lines += $line
    }
    $lines += ''
    $lines += 'Reply "apply" to update the suggested docs now, or "dismiss" to discard.'
    return ($lines -join "`n")
}

function Find-PendingCaptureFiles {
    <#
        Pure. Scans .claude/ for .docs-capture.*.json files whose session id does
        NOT match $CurrentSessionId. Returns array of parsed capture hashtables
        that have at least one entry in captures.
    #>
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [string]$CurrentSessionId,
        [scriptblock]$DirLister,
        [scriptblock]$FileReader
    )
    $claudeDir = if ($RepoRoot) { '.claude' } else { '.claude' }
    $safeCurrent = Get-SafeSessionId -SessionId $CurrentSessionId

    $dirEntries = @(& $DirLister $claudeDir)
    $results = @()
    foreach ($entry in $dirEntries) {
        if ($entry.IsDir) { continue }
        $name = [string]$entry.Name
        if ($name -notmatch '^\.docs-capture\.(.+)\.json$') { continue }
        $fileSid = $matches[1]
        if ($fileSid -eq $safeCurrent) { continue }

        $relPath = "$claudeDir/$name"
        $raw = & $FileReader $relPath
        if ([string]::IsNullOrWhiteSpace($raw)) { continue }
        try {
            $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
            $captures = @()
            if ($parsed.captures) { $captures = @($parsed.captures) }
            if ($captures.Count -eq 0) { continue }

            # Convert PSCustomObject captures to hashtables.
            $captureList = @()
            foreach ($c in $captures) {
                $captureList += @{
                    content      = [string]$c.content
                    suggestedDoc = [string]$c.suggestedDoc
                    source       = [string]$c.source
                    capturedAt   = [string]$c.capturedAt
                }
            }
            $results += @{ sessionId = [string]$parsed.sessionId; captures = $captureList }
        }
        catch { continue }
    }
    return $results
}

# ---------- Orchestration ----------

function Get-DocsDriftQueue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][scriptblock]$DirLister,
        [Parameter(Mandatory)][scriptblock]$FileReader,
        [string]$DocsRoot = '.',
        [string[]]$ExcludeDirs = @(
            'node_modules', 'dist', 'build', 'bin', 'obj',
            'vendor', 'out', '.next', '.nuxt', 'coverage', 'target'
        )
    )
    $indexDirs = @(Get-IndexDirs -Dir $DocsRoot -DirLister $DirLister -ExcludeDirs $ExcludeDirs)
    if ($indexDirs.Count -eq 0) { return @() }

    $drifted = @()
    foreach ($dir in $indexDirs) {
        $expected = @(Get-ExpectedChildren -Dir $dir -DirLister $DirLister)
        $indexPath = if ($dir -eq '.') { 'index.md' } else { "$dir/index.md" }
        $declared = @(Get-DeclaredChildren -Content (& $FileReader $indexPath))
        if (-not (Test-SetsEqual -A $expected -B $declared)) { $drifted += $dir }
    }

    $roots = @(Get-RootIndexDirs -IndexDirs $indexDirs)
    $hostFile = Find-HostRootPromptFile -FileReader $FileReader
    $hostContent = if ($hostFile) { & $FileReader $hostFile } else { '' }
    $registryDrift = $false
    foreach ($root in $roots) {
        if (-not (Test-RegistryHasEntry -Content $hostContent -DirPath $root)) {
            $registryDrift = $true
            continue
        }
        $rootIndexPath = if ($root -eq '.') { 'index.md' } else { "$root/index.md" }
        $intro = Get-IntroFromFrontMatter -Content (& $FileReader $rootIndexPath)
        if (-not (Test-RegistryRoleInSync -Content $hostContent -DirPath $root -Intro $intro)) {
            $registryDrift = $true
        }
    }

    return (Resolve-CommandQueue -DriftedIndexDirs $drifted -RegistryDrift $registryDrift)
}

function Invoke-DocsKeeperMaintenance {
    [CmdletBinding()]
    param(
        [string]$HookInputJson,
        [string]$RepoRoot,
        [string]$SessionId,
        [scriptblock]$GitCommandRunner,
        [scriptblock]$DirLister,
        [scriptblock]$FileReader,
        [scriptblock]$SessionReader,
        [string]$EnforcementMode
    )

    if (-not $RepoRoot) {
        try {
            $detected = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
            if ($detected) { $RepoRoot = $detected.Trim() }
        }
        catch { $null = $_ }
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

    if (-not $SessionReader) {
        $capturedRoot = $RepoRoot
        $capturedSid = $SessionId
        $SessionReader = { Read-DocsKeeperSession -RepoRoot $capturedRoot -SessionId $capturedSid }.GetNewClosure()
    }

    $mode = Resolve-EnforcementMode -EnvValue $EnforcementMode

    # PreToolUse: react only to a git commit that stages markdown.
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

    if (-not (Test-TouchesIndexedContent -Changes $changes)) {
        return @{ ExitCode = 0; Message = ''; Reason = 'no-docs-change'; Queue = @() }
    }

    $staged = @()
    foreach ($change in $changes) {
        if (Test-IsMarkdownPath -Path $change.Path) { $staged += $change.Path }
    }
    $staged = @(@($staged) | Select-Object -Unique)

    # Read session tracker to filter out already-revised files.
    $session = & $SessionReader
    $trackedMd = if ($session -and $session.TrackedMd) { $session.TrackedMd } else { @{} }

    # reviseMd = staged .md files where: NOT in TrackedMd, OR in TrackedMd with revised: false.
    $reviseMd = @($staged | Where-Object {
        $p = $_
        if (-not $trackedMd.ContainsKey($p)) { return $true }
        return -not [bool]$trackedMd[$p].revised
    })

    # Index + registry drift (Mode A + registry incl. intro/role drift).
    $driftQueue = @(Get-DocsDriftQueue -DirLister $DirLister -FileReader $FileReader)

    # Compose ordered chain: revise -> index -> registry-sync.
    $queue = @(Resolve-ReviseQueue -Paths $reviseMd) + @($driftQueue)

    if ($queue.Count -eq 0) {
        return @{ ExitCode = 0; Message = ''; Reason = 'no-docs-drift'; Queue = @(); Mode = $mode }
    }

    $exit = if ($mode -eq 'warn') { 0 } else { 2 }
    $reason = if ($mode -eq 'warn') { 'docs-action-suggested' } else { 'docs-drift-detected' }
    $msg = Format-BlockMessage -Queue $queue -Standalone $false -Mode $mode
    return @{ ExitCode = $exit; Message = $msg; Reason = $reason; Queue = $queue; Mode = $mode }
}

# ---------- Session I/O (impure) ----------

function Get-DocsKeeperSessionPath {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $sid = Get-SafeSessionId -SessionId $SessionId
    $name = if ($sid) { ".docs-keeper-session.$sid.json" } else { '.docs-keeper-session.json' }
    return (Join-Path $dir $name)
}

function Read-DocsKeeperSession {
    <#
        Returns @{ Head; Dirty; TrackedMd } where TrackedMd is a hashtable
        (empty if absent in file). Returns $null when the file does not exist.
    #>
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $f = Get-DocsKeeperSessionPath -RepoRoot $RepoRoot -SessionId $SessionId
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    try {
        $o = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
        $trackedMd = @{}
        if ($o.TrackedMd) {
            foreach ($prop in $o.TrackedMd.PSObject.Properties) {
                $trackedMd[$prop.Name] = @{ revised = [bool]$prop.Value.revised }
            }
        }
        return @{
            Head      = [string]$o.Head
            Dirty     = @($o.Dirty)
            TrackedMd = $trackedMd
        }
    }
    catch { return $null }
}

function Write-DocsKeeperSession {
    <#
        Writes the full session object @{ Head; Dirty; TrackedMd } to the
        .docs-keeper-session.<sid>.json file. Creates .claude/ dir if absent.
    #>
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId, [hashtable]$Session)
    $f = Get-DocsKeeperSessionPath -RepoRoot $RepoRoot -SessionId $SessionId
    $dir = Split-Path -Parent $f
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $Session | ConvertTo-Json -Compress -Depth 5 | Set-Content -LiteralPath $f -Encoding utf8
}

function Get-LeftoverSessionFiles {
    <#
        Impure. Finds all .docs-keeper-session.*.json files under .claude/ whose
        session id does NOT match $CurrentSessionId. Returns array of file paths.
    #>
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$CurrentSessionId)
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    if (-not (Test-Path -LiteralPath $dir)) { return @() }
    $safeCurrent = Get-SafeSessionId -SessionId $CurrentSessionId
    $results = @()
    foreach ($f in (Get-ChildItem -LiteralPath $dir -Filter '.docs-keeper-session.*.json' -File -ErrorAction SilentlyContinue)) {
        # Extract session id from filename: .docs-keeper-session.<sid>.json
        if ($f.Name -match '^\\.docs-keeper-session\\.(.+)\\.json$') {
            $fileSid = $matches[1]
            if ($fileSid -ne $safeCurrent) { $results += $f.FullName }
        }
        elseif ($f.Name -match '^\.docs-keeper-session\.(.+)\.json$') {
            $fileSid = $matches[1]
            if ($fileSid -ne $safeCurrent) { $results += $f.FullName }
        }
    }
    return $results
}

function Remove-DocsSessionState {
    <#
        SessionEnd cleanup.
        - If TrackedMd has any revised: false entries -> keep the session file
          (it carries forward to the next session).
        - If all TrackedMd entries are revised: true, or TrackedMd is empty ->
          delete the session file.
        - Delete the legacy attempts file if it still exists (backward compat).
    #>
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)

    $sessionFile = Get-DocsKeeperSessionPath -RepoRoot $RepoRoot -SessionId $SessionId
    if (Test-Path -LiteralPath $sessionFile) {
        $session = Read-DocsKeeperSession -RepoRoot $RepoRoot -SessionId $SessionId
        $hasUnrevised = $false
        if ($session -and $session.TrackedMd -and $session.TrackedMd.Count -gt 0) {
            foreach ($entry in $session.TrackedMd.Values) {
                if (-not [bool]$entry.revised) { $hasUnrevised = $true; break }
            }
        }
        if (-not $hasUnrevised) {
            Remove-Item -LiteralPath $sessionFile -Force -ErrorAction SilentlyContinue
        }
        # If $hasUnrevised, keep the file so next session picks it up.
    }

    # Backward compat: remove legacy attempts file if present.
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $sid = Get-SafeSessionId -SessionId $SessionId
    $attemptsName = if ($sid) { ".docs-keeper-attempts.$sid.json" } else { '.docs-keeper-attempts.json' }
    $attemptsFile = Join-Path $dir $attemptsName
    if (Test-Path -LiteralPath $attemptsFile) {
        Remove-Item -LiteralPath $attemptsFile -Force -ErrorAction SilentlyContinue
    }
}

function Read-DocsCapture {
    <#
        Reads and parses the capture JSON file. Returns $null on missing/error.
        Guarantees captures key defaults to @() if absent.
    #>
    [CmdletBinding()]
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $o = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
        $captures = @()
        if ($o.captures) {
            foreach ($c in @($o.captures)) {
                $captures += @{
                    content      = [string]$c.content
                    suggestedDoc = [string]$c.suggestedDoc
                    source       = [string]$c.source
                    capturedAt   = [string]$c.capturedAt
                }
            }
        }
        return @{
            sessionId = [string]$o.sessionId
            captures  = $captures
        }
    }
    catch { return $null }
}

function Invoke-SessionSnapshot {
    <#
        SessionStart hook: capture HEAD + the already-dirty path set so the Track
        hook can isolate THIS session's doc edits. Also surfaces unrevised files
        from prior sessions. Best-effort; never blocks.
    #>
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [string]$SessionId,
        [scriptblock]$GitCommandRunner,
        [scriptblock]$SnapshotWriter
    )

    if (-not $GitCommandRunner) {
        $capturedRoot = $RepoRoot
        $GitCommandRunner = {
            param([string[]]$Argv)
            if ($capturedRoot) { & git -C $capturedRoot @Argv } else { & git @Argv }
        }.GetNewClosure()
    }
    if (-not $SnapshotWriter) {
        $capturedRoot = $RepoRoot
        $capturedSid = $SessionId
        $SnapshotWriter = {
            param($Snap)
            Write-DocsKeeperSession -RepoRoot $capturedRoot -SessionId $capturedSid -Session $Snap
        }.GetNewClosure()
    }

    $head = ''
    try { $head = ((& $GitCommandRunner @('rev-parse', 'HEAD')) | Select-Object -First 1) } catch { $null = $_ }
    $dirtyRaw = & $GitCommandRunner @('status', '--porcelain')
    $dirtyJoined = if ($dirtyRaw -is [array]) { $dirtyRaw -join "`n" } else { [string]$dirtyRaw }
    $dirty = @(ConvertFrom-GitPorcelain -Porcelain $dirtyJoined)

    # Preserve existing TrackedMd if the session file already exists.
    $existing = Read-DocsKeeperSession -RepoRoot $RepoRoot -SessionId $SessionId
    $trackedMd = if ($existing -and $existing.TrackedMd) { $existing.TrackedMd } else { @{} }

    & $SnapshotWriter @{ Head = ([string]$head).Trim(); Dirty = $dirty; TrackedMd = $trackedMd }

    # Surface unrevised files from prior sessions.
    $leftovers = @(Get-LeftoverSessionFiles -RepoRoot $RepoRoot -CurrentSessionId $SessionId)
    $unrevisedByFile = @()
    foreach ($trackerPath in $leftovers) {
        try {
            $raw = Get-Content -LiteralPath $trackerPath -Raw | ConvertFrom-Json
            if (-not $raw.TrackedMd) { continue }
            $unrevised = @()
            foreach ($prop in $raw.TrackedMd.PSObject.Properties) {
                if (-not [bool]$prop.Value.revised) {
                    # Check if the file still has changes via git diff HEAD.
                    $relPath = $prop.Name
                    $diffOut = & $GitCommandRunner @('diff', 'HEAD', '--', $relPath) 2>$null
                    if ($diffOut) { $unrevised += $relPath }
                }
            }
            if ($unrevised.Count -gt 0) {
                $pair = @($trackerPath) + $unrevised
                $unrevisedByFile += , [string[]]$pair
            }
        }
        catch { $null = $_ }
    }
    if ($unrevisedByFile.Count -gt 0) {
        $proposal = Format-SessionStartProposal -UnrevisedByFile $unrevisedByFile
        [Console]::Out.WriteLine((@{ additionalContext = $proposal } | ConvertTo-Json -Compress))
    }
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

    # Every hook surface receives a JSON payload on stdin carrying `session_id`.
    if (-not $HookInputJson -and [Console]::IsInputRedirected) {
        try { $HookInputJson = [Console]::In.ReadToEnd() } catch { $HookInputJson = '' }
    }
    if (-not $SessionId) {
        $SessionId = Get-SessionIdFromPayload -Payload (Read-HookPayload -Json $HookInputJson)
    }

    # -DriftOnly: CI path — index + registry drift check only, no session/revise logic.
    if ($DriftOnly) {
        $capturedRoot = $RepoRoot
        $dl = if ($DirLister) { $DirLister } else {
            { param([string]$RelDir)
              $base = if ($capturedRoot) { Join-Path $capturedRoot $RelDir } else { $RelDir }
              if (-not (Test-Path -LiteralPath $base)) { return @() }
              @(Get-ChildItem -LiteralPath $base -Force -ErrorAction SilentlyContinue | ForEach-Object { @{ Name = $_.Name; IsDir = $_.PSIsContainer } })
            }.GetNewClosure()
        }
        $fr = if ($FileReader) { $FileReader } else {
            { param([string]$RelPath)
              $abs = if ($capturedRoot) { Join-Path $capturedRoot $RelPath } else { $RelPath }
              if (Test-Path -LiteralPath $abs) { return (Get-Content -LiteralPath $abs -Raw) }
              return ''
            }.GetNewClosure()
        }
        $mode = Resolve-EnforcementMode -EnvValue $EnforcementMode
        $driftQueue = @(Get-DocsDriftQueue -DirLister $dl -FileReader $fr)
        if ($driftQueue.Count -eq 0) { exit 0 }
        $msg = Format-BlockMessage -Queue $driftQueue -Standalone $true -Mode $mode
        [Console]::Error.WriteLine($msg)
        exit $(if ($mode -eq 'warn') { 0 } else { 2 })
    }

    # -Dismiss: delete the specified tracker file.
    if ($Dismiss) {
        if (Test-Path -LiteralPath $Dismiss) {
            Remove-Item -LiteralPath $Dismiss -Force -ErrorAction SilentlyContinue
        }
        exit 0
    }

    # -MarkRevised: mark files from a completed /docs-revise skill as revised.
    if ($MarkRevised) {
        try {
            $payload = Read-HookPayload -Json $HookInputJson
            if ($payload -and $payload.tool_input -and [string]$payload.tool_input.skill -eq 'docs-revise') {
                $argsStr = [string]$payload.tool_input.args
                $filePaths = @($argsStr -split '\s+' | Where-Object { $_ })
                if ($filePaths.Count -gt 0) {
                    $session = Read-DocsKeeperSession -RepoRoot $RepoRoot -SessionId $SessionId
                    if (-not $session) {
                        $session = @{ Head = ''; Dirty = @(); TrackedMd = @{} }
                    }
                    $session = Set-TrackedMdRevised -Session $session -Paths $filePaths
                    Write-DocsKeeperSession -RepoRoot $RepoRoot -SessionId $SessionId -Session $session
                }
            }
        }
        catch { $null = $_ }
        exit 0
    }

    # -Track: record session-edited .md files into TrackedMd.
    if ($Track) {
        try {
            $session = Read-DocsKeeperSession -RepoRoot $RepoRoot -SessionId $SessionId
            if (-not $session) {
                $session = @{ Head = ''; Dirty = @(); TrackedMd = @{} }
            }

            # Compute session-edited .md paths.
            $capturedRoot = $RepoRoot
            $runner = if ($GitCommandRunner) { $GitCommandRunner } else {
                {
                    param([string[]]$Argv)
                    if ($capturedRoot) { & git -C $capturedRoot @Argv } else { & git @Argv }
                }.GetNewClosure()
            }

            $mdPaths = @()
            if ($session.Head) {
                $committed = @((& $runner @('diff', '--name-only', "$($session.Head)", 'HEAD')) | Where-Object { $_ })
                $dirtyRaw = & $runner @('status', '--porcelain')
                $dirtyJoined = if ($dirtyRaw -is [array]) { $dirtyRaw -join "`n" } else { [string]$dirtyRaw }
                $currentDirty = @(ConvertFrom-GitPorcelain -Porcelain $dirtyJoined)
                $sessionPaths = @(Get-SessionEditedPaths -CommittedPaths $committed -CurrentDirtyPaths $currentDirty -SnapshotDirtyPaths @($session.Dirty))
                $mdPaths = @(Select-MarkdownPaths -Paths $sessionPaths)
            }
            else {
                # No snapshot head: degrade to all dirty .md files.
                $dirtyRaw = & $runner @('status', '--porcelain')
                $dirtyJoined = if ($dirtyRaw -is [array]) { $dirtyRaw -join "`n" } else { [string]$dirtyRaw }
                $allDirty = @(ConvertFrom-GitPorcelain -Porcelain $dirtyJoined)
                $mdPaths = @(Select-MarkdownPaths -Paths $allDirty)
            }

            if ($mdPaths.Count -gt 0) {
                $session = Add-TrackedMdFiles -Session $session -Paths $mdPaths
                Write-DocsKeeperSession -RepoRoot $RepoRoot -SessionId $SessionId -Session $session
            }
        }
        catch { $null = $_ }
        exit 0
    }

    # -SnapshotSession: capture the per-session baseline, then exit cleanly.
    if ($SnapshotSession) {
        try { Invoke-SessionSnapshot -RepoRoot $RepoRoot -SessionId $SessionId -GitCommandRunner $GitCommandRunner -SnapshotWriter $SnapshotWriter }
        catch { $null = $_ }

        # Surface pending captures from prior sessions.
        try {
            $capturedRoot2 = $RepoRoot
            $dl = if ($DirLister) { $DirLister } else {
                {
                    param([string]$RelDir)
                    $base = if ($capturedRoot2) { Join-Path $capturedRoot2 $RelDir } else { $RelDir }
                    if (-not (Test-Path -LiteralPath $base)) { return @() }
                    @(Get-ChildItem -LiteralPath $base -Force -ErrorAction SilentlyContinue | ForEach-Object {
                        @{ Name = $_.Name; IsDir = $_.PSIsContainer }
                    })
                }.GetNewClosure()
            }
            $fr = if ($FileReader) { $FileReader } else {
                {
                    param([string]$RelPath)
                    $abs = if ($capturedRoot2) { Join-Path $capturedRoot2 $RelPath } else { $RelPath }
                    if (Test-Path -LiteralPath $abs) { return (Get-Content -LiteralPath $abs -Raw) }
                    return ''
                }.GetNewClosure()
            }
            $pendingCaptures = @(Find-PendingCaptureFiles -RepoRoot $RepoRoot -CurrentSessionId $SessionId -DirLister $dl -FileReader $fr)
            if ($pendingCaptures.Count -gt 0) {
                $proposal = Format-CaptureProposal -CaptureFiles $pendingCaptures
                if ($proposal) {
                    [Console]::Out.WriteLine((@{ additionalContext = $proposal } | ConvertTo-Json -Compress))
                }
            }
        }
        catch { $null = $_ }
        exit 0
    }

    # -SessionEnd: delete this session's per-session state files, then exit.
    if ($SessionEnd) {
        try { Remove-DocsSessionState -RepoRoot $RepoRoot -SessionId $SessionId } catch { $null = $_ }

        # Surface captured docs as a systemMessage.
        try {
            $capturePath = Get-DocsCaptureFilePath -RepoRoot $RepoRoot -SessionId $SessionId
            $captureFile = Read-DocsCapture -Path $capturePath
            if ($captureFile -and @($captureFile.captures).Count -gt 0) {
                $report = Format-CaptureReport -CaptureFile $captureFile
                if ($report) {
                    [Console]::Out.WriteLine((@{ systemMessage = $report } | ConvertTo-Json -Compress))
                }
            }
        }
        catch { $null = $_ }
        exit 0
    }

    if (-not $EnforcementMode) { $EnforcementMode = $env:DOCS_KEEPER_ENFORCE }

    $result = Invoke-DocsKeeperMaintenance `
        -HookInputJson $HookInputJson `
        -RepoRoot $RepoRoot `
        -SessionId $SessionId `
        -GitCommandRunner $GitCommandRunner `
        -DirLister $DirLister `
        -FileReader $FileReader `
        -SessionReader $SessionReader `
        -EnforcementMode $EnforcementMode

    if ($result.ExitCode -ne 0 -and $result.Message) {
        [Console]::Error.WriteLine($result.Message)
    }
    elseif ($result.ExitCode -eq 0 -and $result.Message) {
        [Console]::Error.WriteLine($result.Message)
    }
    exit $result.ExitCode
}
