#Requires -Version 7.0

<#
.SYNOPSIS
    Claude Code docs-keeper hook — pre-commit drift gate and CI drift check.

.DESCRIPTION
    Two invocation surfaces:

    PreToolUse mode (default):
      Wired via `.claude/settings.json` as a PreToolUse hook matched on the
      `Bash` tool. Reads the hook JSON payload from stdin, filters for
      `git commit` invocations that touch any `.md` file, and runs deterministic
      drift detection plus the Mode B revise scope (the STAGED `.md` set).
      Files already marked `revised: true` in the session tracker are skipped.

    DriftOnly mode (-DriftOnly switch):
      CI path — index + registry drift check only, no session/revise logic.
      Exits 0 (clean) or 2 (drift detected, message on stderr).

    Session lifecycle modes (SnapshotSession, SessionEnd, Track, MarkRevised,
    Dismiss) live in the sibling script Invoke-DocsKeeperSession.ps1.
    Capture write operations (AddCapture / CaptureFromSummary) live in
    Invoke-DocsKeeperCapture.ps1.

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

.PARAMETER SessionReader
    Injectable scriptblock returning the full session `@{ Head; Dirty; TrackedMd }`
    (or $null). Used by PreToolUse mode to check which files are already revised.

.PARAMETER EnforcementMode
    Gate hardness: `block` (default) or `warn`. Falls back to
    `$env:DOCS_KEEPER_ENFORCE`.


.PARAMETER DriftOnly
    CI path — drift check only, no session/revise logic.

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
    [scriptblock]$SessionReader,
    [string]$EnforcementMode,
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
        $capturedGcr = $GitCommandRunner
        $capturedMerger = ${function:Read-MergedDocsKeeperSessions}
        $SessionReader = {
            $head = ''
            try {
                $headRaw = & $capturedGcr @('rev-parse', 'HEAD')
                if ($headRaw) { $head = ($headRaw -join '').Trim() }
            } catch { $null = $_ }
            & $capturedMerger -RepoRoot $capturedRoot -CurrentHead $head
        }.GetNewClosure()
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
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.docs-keeper' } else { '.docs-keeper' }
    $sid = Get-SafeSessionId -SessionId $SessionId
    $name = if ($sid) { "session.$sid.json" } else { 'session.json' }
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

function Read-MergedDocsKeeperSessions {
    <#
        Returns @{ Head; Dirty; TrackedMd } where TrackedMd is the union of
        revised:true entries across ALL session files whose Head matches
        $CurrentHead. Returns $null when no matching sessions exist.

        Accepts injectable scriptblocks for Pester coverage without disk I/O.
        $SessionFileLister — returns an array of absolute file paths.
        $SessionFileReader — takes a path, returns raw JSON string.
    #>
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [string]$CurrentHead,
        [scriptblock]$SessionFileLister,
        [scriptblock]$SessionFileReader
    )
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.docs-keeper' } else { '.docs-keeper' }

    if (-not $SessionFileLister) {
        $capturedDir = $dir
        $SessionFileLister = {
            if (-not (Test-Path -LiteralPath $capturedDir)) { return @() }
            @(Get-ChildItem -LiteralPath $capturedDir -Filter 'session*.json' -ErrorAction SilentlyContinue |
              ForEach-Object { $_.FullName })
        }.GetNewClosure()
    }

    if (-not $SessionFileReader) {
        $SessionFileReader = {
            param([string]$Path)
            if (Test-Path -LiteralPath $Path) { return (Get-Content -LiteralPath $Path -Raw) }
            return ''
        }
    }

    $merged = @{}
    $found = $false
    foreach ($filePath in (& $SessionFileLister)) {
        try {
            $raw = & $SessionFileReader $filePath
            if ([string]::IsNullOrWhiteSpace($raw)) { continue }
            $o = $raw | ConvertFrom-Json
            if (-not $CurrentHead -or -not $o.Head -or $o.Head -ne $CurrentHead) { continue }
            $found = $true
            if ($o.TrackedMd) {
                foreach ($prop in $o.TrackedMd.PSObject.Properties) {
                    if ([bool]$prop.Value.revised) {
                        $merged[$prop.Name] = @{ revised = $true }
                    }
                }
            }
        }
        catch { continue }
    }
    if (-not $found) { return $null }
    return @{ Head = $CurrentHead; Dirty = @(); TrackedMd = $merged }
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

    if (-not $EnforcementMode) { $EnforcementMode = $env:DOCS_KEEPER_ENFORCE }

    $result = Invoke-DocsKeeperMaintenance `
        -HookInputJson $HookInputJson `
        -RepoRoot $RepoRoot `
        -GitCommandRunner $GitCommandRunner `
        -DirLister $DirLister `
        -FileReader $FileReader `
        -SessionReader $SessionReader `
        -EnforcementMode $EnforcementMode

    if ($result.ExitCode -ne 0 -and $result.Message) {
        # Block mode: stderr is surfaced by Claude Code on exit 2.
        [Console]::Error.WriteLine($result.Message)
    }
    elseif ($result.ExitCode -eq 0 -and $result.Message) {
        # Warn mode: exit 0 — Claude Code ignores stderr on exit 0.
        # Emit systemMessage on stdout so the user sees it.
        [Console]::Out.WriteLine((@{ systemMessage = $result.Message } | ConvertTo-Json -Compress))
    }
    exit $result.ExitCode
}
