#Requires -Version 7.0

<#
.SYNOPSIS
    Claude Code docs-keeper hook — drives the full documentation chain
    automatically: optimize (Mode B `/docs-revise`) -> re-index (Mode A
    `/docs-index`) -> re-register (`/docs-registry-sync`). Blocks or warns
    (configurable) and prints the ordered remediation queue.

.DESCRIPTION
    Three invocation surfaces:

    PreToolUse mode (default):
      Wired via `.claude/settings.json` as a PreToolUse hook matched on the
      `Bash` tool. Reads the hook JSON payload from stdin, filters for
      `git commit` invocations that touch any `.md` file, and runs deterministic
      drift detection plus the Mode B revise scope (the STAGED `.md` set).

    Standalone mode (-Standalone switch):
      Skips stdin parsing and the git-commit filter. Used by CI and the Claude
      Code `Stop` hook. Mode B revise scope here is the SESSION-EDITED `.md` set
      (committed-this-session ∪ newly-dirty), isolated via the SessionStart
      snapshot; degrades to all-uncommitted when no snapshot exists.

    SessionStart mode (-SnapshotSession switch):
      Captures HEAD + the already-dirty path set to `.claude/.docs-session.json`
      so Standalone can isolate THIS session's doc edits. Never blocks.

    Mode B (docs-revise) — semantic, so NOT deterministically satisfiable the way
    index/registry drift is. Kept satisfiable via an ASK-ONCE marker
    (`.claude/.docs-keeper-seen.json`, SHA256 of content-when-asked): a doc is
    re-flagged only when its bytes change. block fires one stop per edit and
    converges; no `--no-verify` escape needed.

    Registry drift now also covers ROLE drift: a present "Sources of truth" entry
    whose text no longer contains the ROOT index's `intro` queues
    `/docs-registry-sync` (so CLAUDE.md re-syncs when the index changed, not only
    when an entry is missing).

    Enforcement (`-EnforcementMode` / `$env:DOCS_KEEPER_ENFORCE`): `block`
    (default; exit 2) or `warn` (exit 0, queue still surfaced).

    Auto-revise — a SEPARATE toggle (`-AutoReviseMode` /
    `$env:DOCS_KEEPER_AUTO_REVISE`, default off): when on, the Stop hook auto-runs
    the chain via a decision:block directive instead of just surfacing it.
    Orthogonal to enforcement; capped by `DOCS_KEEPER_MAX_REVISE_ATTEMPTS`.

    Drift detection (project-agnostic — works for any docs-keeper index tree):

      * Index drift — for every directory holding an `index.md`, recompute
        the EXPECTED `children:` set from the filesystem (same discovery
        algorithm as `/docs-index`: direct files, sub-dir boundaries, recursion
        into index-less sub-dirs, hidden/underscore skipped, `index.md` itself
        skipped) and compare — as a SET, order-insensitive — against the
        DECLARED `children:` in that `index.md`'s front-matter. A mismatch is
        drift -> queue `/docs-index <dir>`.

      * Registry drift — every ROOT index directory (an index dir whose parent
        has no `index.md`) must be referenced in the host root prompt file's
        "Sources of truth" section. A missing ROOT is drift ->
        queue `/docs-registry-sync`.

    Generalization (reusable across any project):
      - Triggers on ANY staged `.md` file change, not a hardcoded path prefix.
      - Discovers indexed trees by scanning from repo root (default), skipping
        common build / dependency directories.
      - Host root prompt file auto-discovered: probes `CLAUDE.md` -> `AGENTS.md`
        -> `.agent/INDEX.md`. No hardcoded filename.

    Satisfiability: when the docs tree is consistent the hook exits 0 regardless
    of what is staged. Running the queued `/docs-*` commands brings it back to
    consistency and the next commit passes. Set comparison means hand-curated
    `children:` ORDER never triggers drift.

    Pure functions live above `Invoke-PreCommitDocsHook` for Pester coverage
    (see sibling `Invoke-PreCommitDocsHook.Tests.ps1`). Filesystem access is
    injected via `-DirLister` / `-FileReader` scriptblocks so the pure functions
    are testable without touching disk. Pass `-AsLibrary` to dot-source the file
    without executing the entry block.

.PARAMETER HookInputJson
    Hook stdin payload (JSON). Ignored in Standalone mode. When omitted in
    normal invocation the script reads from `[Console]::In`. Tests pass it
    directly.

.PARAMETER RepoRoot
    Git working tree root. Defaults to `$env:CLAUDE_PROJECT_DIR`, falling
    back to `git rev-parse --show-toplevel`.

.PARAMETER GitCommandRunner
    Injectable scriptblock — takes `[string[]]` argv, returns stdout lines.
    Lets tests stub `git` without spawning processes.

.PARAMETER DirLister
    Injectable scriptblock: `& $DirLister <repo-relative-dir>` returns an array
    of `@{ Name = <string>; IsDir = <bool> }` for the directory's direct entries
    (empty array if the dir does not exist). Defaults to `Get-ChildItem` rooted
    at `RepoRoot`.

.PARAMETER FileReader
    Injectable scriptblock: `& $FileReader <repo-relative-path>` returns the
    file's raw content (empty string if absent). Defaults to `Get-Content -Raw`
    rooted at `RepoRoot`.

.PARAMETER SnapshotReader
    Injectable scriptblock returning the session snapshot `@{ Head; Dirty }` (or
    $null). Defaults to reading `.claude/.docs-session.json`.

.PARAMETER SnapshotWriter
    Injectable scriptblock `& $SnapshotWriter <snapshot-hashtable>` used by
    SessionStart mode. Defaults to writing `.claude/.docs-session.json`.

.PARAMETER SeenStateReader
    Injectable scriptblock returning the ask-once marker hashtable
    (`path -> content-sha`). Defaults to reading `.claude/.docs-keeper-seen.json`.

.PARAMETER SeenStateWriter
    Injectable scriptblock `& $SeenStateWriter <hashtable>` persisting the
    ask-once marker. Defaults to writing `.claude/.docs-keeper-seen.json`.

.PARAMETER EnforcementMode
    Gate hardness: `block` (default) or `warn`. Falls back to
    `$env:DOCS_KEEPER_ENFORCE`.

.PARAMETER AutoReviseMode
    Separate auto-revise toggle: when truthy (`1`/`true`/`on`/`yes`), the Stop
    hook auto-runs the revise->index->registry chain via a decision:block
    directive (attempt-capped). Default off. Falls back to
    `$env:DOCS_KEEPER_AUTO_REVISE`.

.PARAMETER MaxReviseAttempts
    Per-file auto/blocking revise cap per session (loop backstop; default 3).
    Falls back to `$env:DOCS_KEEPER_MAX_REVISE_ATTEMPTS`.

.PARAMETER Standalone
    Skip stdin parsing and the git-commit / touched-paths filter. Run the drift
    check directly with SESSION-EDITED revise scope. Used for CI
    (`pwsh ... -Standalone`) and the `Stop` hook.

.PARAMETER SessionId
    Claude session id (from the hook stdin payload's `session_id`). Namespaces the
    per-session snapshot + attempt files so concurrent sessions in one checkout do
    not share state. Empty -> non-namespaced global files (CI / single-session).

.PARAMETER SnapshotSession
    SessionStart mode: capture the per-session baseline snapshot and exit 0.

.PARAMETER SessionEnd
    SessionEnd mode: delete this session's per-session snapshot + attempt files
    (the global seen-state is left intact) and exit 0.

.PARAMETER AsLibrary
    Define helper + entry functions but skip the entry block. Used by Pester to
    dot-source the file.
#>

[CmdletBinding()]
param(
    [string]$HookInputJson,
    [string]$RepoRoot,
    [string]$SessionId,
    [scriptblock]$GitCommandRunner,
    [scriptblock]$DirLister,
    [scriptblock]$FileReader,
    [scriptblock]$SnapshotReader,
    [scriptblock]$SnapshotWriter,
    [scriptblock]$SeenStateReader,
    [scriptblock]$SeenStateWriter,
    [string]$EnforcementMode,
    [string]$AutoReviseMode,
    [string]$MaxReviseAttempts,
    [switch]$Standalone,
    [switch]$SnapshotSession,
    [switch]$SessionEnd,
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
    <#
        Pull `session_id` from a parsed hook payload. '' when absent. Used to
        namespace per-session state files so concurrent sessions in one checkout
        don't share a snapshot / attempt counter.
    #>
    [CmdletBinding()]
    param($Payload)
    if ($Payload -and $Payload.session_id) { return [string]$Payload.session_id }
    return ''
}

function Get-SafeSessionId {
    <#
        Sanitize a session id for use in a filename: keep [A-Za-z0-9._-], collapse
        anything else to '_'. Empty / whitespace -> '' (callers fall back to the
        non-namespaced global path for back-compat + CI standalone runs).
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
    <#
        True for any path ending in `.md`. Triggers the drift check for any
        Markdown file change, regardless of directory — keeping the hook
        project-agnostic.
    #>
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
    <#
        Auto-discovers the host project's root prompt file using the same probe
        order as docs-keeper. Returns the first filename whose content is
        non-empty, or '' if none found. Makes registry checks project-agnostic.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][scriptblock]$FileReader)
    foreach ($candidate in @('CLAUDE.md', 'AGENTS.md', '.agent/INDEX.md')) {
        $content = & $FileReader $candidate
        if (-not [string]::IsNullOrWhiteSpace($content)) { return $candidate }
    }
    return ''
}

function Get-ExpectedChildren {
    <#
        Recursive descent under $Dir (repo-relative, NO trailing slash).
        Mirrors the `/docs-index` discovery algorithm and returns the children
        entries it would emit (leading `/`, possibly nested).
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
    <#
        Walk $Dir (repo-relative, NO trailing slash) and return every directory
        that contains an `index.md`, including $Dir itself if applicable.
        Directories whose name appears in $ExcludeDirs are not recursed into.
    #>
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
    <#
        A ROOT index dir is one whose parent directory holds no `index.md`
        (not covered by a higher index). Minimum-footprint registry.
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
        True if the host root prompt file's "Sources of truth" section references
        $DirPath (matched with a trailing slash, e.g. `docs/`).
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

function Test-RegistryRoleInSync {
    <#
        True when the "Sources of truth" line referencing $DirPath also contains
        the ROOT index's $Intro verbatim. An empty $Intro means there is nothing
        to compare -> in sync. A present entry whose role text dropped the intro
        is drift -> queue /docs-registry-sync. Presence is asserted separately by
        Test-RegistryHasEntry; this only judges role freshness.
    #>
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
    <#
        SHA256 of a doc's content, used by the ask-once revise marker so a doc is
        re-flagged for /docs-revise only when its bytes change. Stable, lowercase
        hex. Empty/null content hashes deterministically (never matches a real
        file's hash for non-empty content).
    #>
    [CmdletBinding()]
    param([string]$Content)
    if ($null -eq $Content) { $Content = '' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Content)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
    return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
}

function Get-IntroFromFrontMatter {
    <#
        Extract the `intro:` scalar from an index.md's first front-matter block,
        stripping a single layer of single/double quoting. '' when absent. Used
        to detect registry role drift (CLAUDE.md "Sources of truth" line stale
        vs the ROOT index's intro).
    #>
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
    <#
        Parse `git status --porcelain` output into repo-relative paths. Rename
        entries (`R  old -> new`) resolve to the NEW path. Quotes stripped.
    #>
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
    <#
        Session-edited set for the Stop hook: files committed since the session
        snapshot HEAD, UNION files that became dirty during the session
        (currently dirty minus already-dirty-at-start). Deterministic; excludes
        pre-existing dirty work the session did not introduce.
    #>
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

function Resolve-ReviseCandidates {
    <#
        Ask-once filter: keep only docs whose CURRENT content hash differs from
        the hash recorded the last time we asked for /docs-revise on them. This
        is what keeps a blocking Mode B gate SATISFIABLE — once content settles
        (revise made its edits, or no-op'd), the doc stops being re-flagged.
    #>
    [CmdletBinding()]
    param(
        [string[]]$MdPaths = @(),
        [hashtable]$SeenState = @{},
        [Parameter(Mandatory)][scriptblock]$FileReader
    )
    $out = @()
    foreach ($p in @($MdPaths)) {
        $sha = Get-ContentSha -Content (& $FileReader $p)
        $prev = if ($SeenState.ContainsKey($p)) { [string]$SeenState[$p] } else { '' }
        if ($sha -ne $prev) { $out += $p }
    }
    return @($out)
}

function Resolve-ReviseQueue {
    <#
        One `/docs-revise` entry carrying all candidate paths (the command
        accepts multiple). Paths sorted for deterministic output. Empty when no
        candidates.
    #>
    [CmdletBinding()]
    param([string[]]$Paths = @())
    $sorted = @(@($Paths) | Sort-Object)
    if ($sorted.Count -eq 0) { return @() }
    return @(@{ Command = '/docs-revise'; Args = ($sorted -join ' ') })
}

function Resolve-EnforcementMode {
    <#
        How hard the gate is (orthogonal to auto-revise):
          block (default) — exit 2, hard gate.
          warn            — exit 0, surface the queue, do not block.
        Unknown / unset -> block (safe default per fix-gate philosophy).
    #>
    [CmdletBinding()]
    param([string]$EnvValue)
    if ($EnvValue -and $EnvValue.Trim().ToLowerInvariant() -eq 'warn') { return 'warn' }
    return 'block'
}

function Resolve-AutoReviseMode {
    <#
        Dedicated, separate toggle (env `DOCS_KEEPER_AUTO_REVISE`): when ON, the
        Stop hook auto-runs the revise->index->registry chain by returning a
        decision:block directive (attempt-capped to converge). When OFF (default),
        the Stop hook is passive and obeys EnforcementMode (block / warn).
        Truthy: 1 / true / on / yes (case-insensitive). Everything else -> OFF.
    #>
    [CmdletBinding()]
    param([string]$EnvValue)
    if (-not $EnvValue) { return $false }
    return @('1', 'true', 'on', 'yes') -contains $EnvValue.Trim().ToLowerInvariant()
}

function Resolve-MaxReviseAttempts {
    <#
        Per-file auto-revise cap for the session (loop backstop). Defaults to 3;
        clamps to a minimum of 1. Non-numeric / unset -> default.
    #>
    [CmdletBinding()]
    param([string]$EnvValue, [int]$Default = 3)
    if (-not $EnvValue) { return $Default }
    $n = 0
    if ([int]::TryParse($EnvValue.Trim(), [ref]$n)) {
        if ($n -lt 1) { return 1 }
        return $n
    }
    return $Default
}

function Split-ByAttemptCap {
    <#
        Partition revise candidates against the session attempt counter. A path
        with fewer than $Max recorded auto-invocations goes to ToInvoke (and its
        count is incremented in the returned NextAttempts map); one at/over $Max
        goes to Exhausted (the loop backstop fired). Pure.
    #>
    [CmdletBinding()]
    param(
        [string[]]$Paths = @(),
        [hashtable]$Attempts = @{},
        [int]$Max = 3
    )
    $next = @{}
    foreach ($k in $Attempts.Keys) { $next[$k] = [int]$Attempts[$k] }
    $toInvoke = @()
    $exhausted = @()
    foreach ($p in @($Paths)) {
        $prior = if ($next.ContainsKey($p)) { [int]$next[$p] } else { 0 }
        if ($prior -lt $Max) {
            $next[$p] = $prior + 1
            $toInvoke += $p
        }
        else {
            $exhausted += $p
        }
    }
    return @{ ToInvoke = @($toInvoke); Exhausted = @($exhausted); NextAttempts = $next }
}

function Format-AutoReviseDirective {
    <#
        The instruction fed back to Claude (Stop decision:block reason) telling it
        to run the documentation chain now. Lists the exact commands in order and
        notes any files skipped by the attempt cap so the loop is visible.
    #>
    [CmdletBinding()]
    param([array]$Queue, [string[]]$Exhausted = @(), [int]$Max = 3)
    if (-not $Queue -or $Queue.Count -eq 0) { return '' }
    $lines = @(
        'Documentation maintenance (auto-revise). Run these now, in order, then finish:'
        ''
    )
    for ($i = 0; $i -lt $Queue.Count; $i++) {
        $item = $Queue[$i]
        $cmd = if ($item.Args) { "$($item.Command) $($item.Args)" } else { $item.Command }
        $lines += "  $($i + 1). $cmd"
    }
    $lines += ''
    $lines += "After running them, stop normally. Auto-revise is capped at $Max attempt(s) per file per session to prevent a hook<->revise loop."
    if ($Exhausted.Count -gt 0) {
        $lines += "Skipped this session (hit the $Max-attempt cap): $((@($Exhausted) | Sort-Object) -join ', ')."
    }
    return ($lines -join "`n")
}

function ConvertTo-StopBlockJson {
    <#
        Stop-hook control payload: blocks the stop and feeds $Reason back to the
        model as an instruction. Emitted on stdout (exit 0) in auto mode.
    #>
    [CmdletBinding()]
    param([string]$Reason)
    return (@{ decision = 'block'; reason = $Reason } | ConvertTo-Json -Compress -Depth 4)
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
    <#
        Detect index + registry drift starting from $DocsRoot (default: repo
        root '.') using injected filesystem accessors. Returns the remediation
        queue (possibly empty).

        Scans for all `index.md` files from $DocsRoot, skipping common build /
        dependency directories. Host root prompt file is auto-discovered via
        Find-HostRootPromptFile rather than hardcoded.
    #>
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
            # Missing ROOT entry — registry incomplete.
            $registryDrift = $true
            continue
        }
        # Present, but its role text may be stale vs the ROOT index's intro
        # ("update CLAUDE.md when the index changed").
        $rootIndexPath = if ($root -eq '.') { 'index.md' } else { "$root/index.md" }
        $intro = Get-IntroFromFrontMatter -Content (& $FileReader $rootIndexPath)
        if (-not (Test-RegistryRoleInSync -Content $hostContent -DirPath $root -Intro $intro)) {
            $registryDrift = $true
        }
    }

    return (Resolve-CommandQueue -DriftedIndexDirs $drifted -RegistryDrift $registryDrift)
}

function Invoke-PreCommitDocsHook {
    [CmdletBinding()]
    param(
        [string]$HookInputJson,
        [string]$RepoRoot,
        [string]$SessionId,
        [scriptblock]$GitCommandRunner,
        [scriptblock]$DirLister,
        [scriptblock]$FileReader,
        [scriptblock]$SnapshotReader,
        [scriptblock]$SeenStateReader,
        [scriptblock]$SeenStateWriter,
        [scriptblock]$AttemptsReader,
        [scriptblock]$AttemptsWriter,
        [string]$EnforcementMode,
        [string]$AutoReviseMode,
        [string]$MaxReviseAttempts,
        [switch]$Standalone
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

    if (-not $SnapshotReader) {
        $capturedRoot = $RepoRoot
        $capturedSid = $SessionId
        $SnapshotReader = { Read-DocsSessionSnapshot -RepoRoot $capturedRoot -SessionId $capturedSid }.GetNewClosure()
    }
    if (-not $SeenStateReader) {
        $capturedRoot = $RepoRoot
        $SeenStateReader = { Read-DocsSeenState -RepoRoot $capturedRoot }.GetNewClosure()
    }
    if (-not $SeenStateWriter) {
        $capturedRoot = $RepoRoot
        $SeenStateWriter = { param($State) Write-DocsSeenState -RepoRoot $capturedRoot -State $State }.GetNewClosure()
    }
    if (-not $AttemptsReader) {
        $capturedRoot = $RepoRoot
        $capturedSid = $SessionId
        $AttemptsReader = { Read-DocsReviseAttempts -RepoRoot $capturedRoot -SessionId $capturedSid }.GetNewClosure()
    }
    if (-not $AttemptsWriter) {
        $capturedRoot = $RepoRoot
        $capturedSid = $SessionId
        $AttemptsWriter = { param($A) Write-DocsReviseAttempts -RepoRoot $capturedRoot -SessionId $capturedSid -Attempts $A }.GetNewClosure()
    }

    $mode = Resolve-EnforcementMode -EnvValue $EnforcementMode
    $autoRevise = Resolve-AutoReviseMode -EnvValue $AutoReviseMode
    $maxAttempts = Resolve-MaxReviseAttempts -EnvValue $MaxReviseAttempts

    # ---- Resolve the Mode B (docs-revise) scope per invocation surface ----
    $reviseMd = @()
    if ($Standalone) {
        # Stop hook: session-edited markdown (committed-this-session ∪ newly-dirty).
        $snapshot = & $SnapshotReader
        if ($snapshot -and $snapshot.Head) {
            $committed = @((& $GitCommandRunner @('diff', '--name-only', "$($snapshot.Head)", 'HEAD')) | Where-Object { $_ })
            $dirtyRaw = & $GitCommandRunner @('status', '--porcelain')
            $dirtyJoined = if ($dirtyRaw -is [array]) { $dirtyRaw -join "`n" } else { [string]$dirtyRaw }
            $currentDirty = @(ConvertFrom-GitPorcelain -Porcelain $dirtyJoined)
            $sessionPaths = @(Get-SessionEditedPaths -CommittedPaths $committed -CurrentDirtyPaths $currentDirty -SnapshotDirtyPaths @($snapshot.Dirty))
        }
        else {
            # No session snapshot (SessionStart hook never ran): degrade to all uncommitted.
            $dirtyRaw = & $GitCommandRunner @('status', '--porcelain')
            $dirtyJoined = if ($dirtyRaw -is [array]) { $dirtyRaw -join "`n" } else { [string]$dirtyRaw }
            $sessionPaths = @(ConvertFrom-GitPorcelain -Porcelain $dirtyJoined)
        }
        $reviseMd = @(Select-MarkdownPaths -Paths $sessionPaths)
    }
    else {
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
        $reviseMd = @(@($staged) | Select-Object -Unique)
    }

    # ---- Ask-once filter: only flag docs whose content changed since last asked ----
    $seen = & $SeenStateReader
    if ($null -eq $seen) { $seen = @{} }
    $reviseCandidates = @(Resolve-ReviseCandidates -MdPaths $reviseMd -SeenState $seen -FileReader $FileReader)

    # ---- Loop backstop (Stop hook only): cap auto/blocking revise per file per
    #      session. The Stop hook re-fires after every turn; /docs-revise edits
    #      the doc, which the next Stop sees as a fresh session edit. Ask-once
    #      converges when revise is idempotent, but a non-idempotent revise would
    #      loop forever. The attempt cap bounds it: past $maxAttempts, the file is
    #      dropped from the revise queue so the session can finally stop. ----
    $exhausted = @()
    if ($Standalone -and $reviseCandidates.Count -gt 0) {
        $attempts = & $AttemptsReader
        if ($null -eq $attempts) { $attempts = @{} }
        $split = Split-ByAttemptCap -Paths $reviseCandidates -Attempts $attempts -Max $maxAttempts
        $reviseCandidates = @($split.ToInvoke)
        $exhausted = @($split.Exhausted)
        & $AttemptsWriter $split.NextAttempts
    }

    # ---- Index + registry drift (Mode A + registry incl. intro/role drift) ----
    $driftQueue = @(Get-DocsDriftQueue -DirLister $DirLister -FileReader $FileReader)

    # ---- Compose ordered chain: revise -> index -> registry-sync ----
    $queue = @(Resolve-ReviseQueue -Paths $reviseCandidates) + @($driftQueue)

    if ($queue.Count -eq 0) {
        # Nothing actionable. If we dropped revise candidates to break a loop,
        # surface a non-blocking note so the cap is visible; otherwise silent.
        if ($exhausted.Count -gt 0) {
            $note = "docs-keeper: revise auto-attempts exhausted (cap $maxAttempts) for: $((@($exhausted) | Sort-Object) -join ', '). Skipping to avoid a hook loop; run /docs-revise manually if still needed."
            return @{ ExitCode = 0; Message = $note; Reason = 'revise-cap-reached'; Queue = @(); Mode = $mode; Exhausted = $exhausted }
        }
        return @{ ExitCode = 0; Message = ''; Reason = 'no-docs-drift'; Queue = @(); Mode = $mode }
    }

    # Record asked content hashes so a settled doc is not re-flagged (satisfiability).
    # Exhausted files are included: the attempt cap IS the acceptance signal — their
    # current hash is recorded so PreToolUse commits are not permanently blocked.
    $toRecord = @($reviseCandidates) + @($exhausted)
    if ($toRecord.Count -gt 0) {
        foreach ($p in $toRecord) { $seen[$p] = Get-ContentSha -Content (& $FileReader $p) }
        & $SeenStateWriter $seen
    }

    # ---- auto-revise (Stop only, separate DOCS_KEEPER_AUTO_REVISE toggle):
    #      return a decision:block directive so the model runs the chain
    #      automatically. Attempt-capped above. Does not apply to PreToolUse. ----
    if ($autoRevise -and $Standalone) {
        $directive = Format-AutoReviseDirective -Queue $queue -Exhausted $exhausted -Max $maxAttempts
        return @{
            ExitCode  = 0; Message = ''; Reason = 'docs-auto-revise'; Queue = $queue
            Mode      = $mode; AutoInvoke = $true; Directive = $directive; Exhausted = $exhausted
        }
    }

    $exit = if ($mode -eq 'warn') { 0 } else { 2 }
    $reason = if ($mode -eq 'warn') { 'docs-action-suggested' } else { 'docs-drift-detected' }
    $msg = Format-BlockMessage -Queue $queue -Standalone:$Standalone -Mode $mode
    return @{ ExitCode = $exit; Message = $msg; Reason = $reason; Queue = $queue; Mode = $mode; Exhausted = $exhausted }
}

# ---------- Session snapshot + ask-once state I/O (impure) ----------

function Get-DocsSessionPath {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $sid = Get-SafeSessionId -SessionId $SessionId
    $name = if ($sid) { ".docs-session.$sid.json" } else { '.docs-session.json' }
    return (Join-Path $dir $name)
}

function Get-DocsSeenStatePath {
    [CmdletBinding()]
    param([string]$RepoRoot)
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    return (Join-Path $dir '.docs-keeper-seen.json')
}

function Read-DocsSessionSnapshot {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $f = Get-DocsSessionPath -RepoRoot $RepoRoot -SessionId $SessionId
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    try {
        $o = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
        return @{ Head = [string]$o.Head; Dirty = @($o.Dirty) }
    }
    catch { return $null }
}

function Get-DocsReviseAttemptsPath {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $sid = Get-SafeSessionId -SessionId $SessionId
    $name = if ($sid) { ".docs-keeper-attempts.$sid.json" } else { '.docs-keeper-attempts.json' }
    return (Join-Path $dir $name)
}

function Read-DocsReviseAttempts {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $f = Get-DocsReviseAttemptsPath -RepoRoot $RepoRoot -SessionId $SessionId
    if (-not (Test-Path -LiteralPath $f)) { return @{} }
    try {
        $o = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
        $h = @{}
        foreach ($prop in $o.PSObject.Properties) { $h[$prop.Name] = [int]$prop.Value }
        return $h
    }
    catch { return @{} }
}

function Write-DocsReviseAttempts {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId, [hashtable]$Attempts)
    $f = Get-DocsReviseAttemptsPath -RepoRoot $RepoRoot -SessionId $SessionId
    $dir = Split-Path -Parent $f
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    ($Attempts | ConvertTo-Json -Compress) | Set-Content -LiteralPath $f -Encoding utf8
}

function Remove-DocsSessionState {
    <#
        SessionEnd cleanup: delete this session's per-session snapshot + attempt
        files. The global seen-state (content-keyed, cross-session) is left alone.
    #>
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    foreach ($f in @(
            (Get-DocsSessionPath -RepoRoot $RepoRoot -SessionId $SessionId),
            (Get-DocsReviseAttemptsPath -RepoRoot $RepoRoot -SessionId $SessionId)
        )) {
        if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
    }
}

function Read-DocsSeenState {
    [CmdletBinding()]
    param([string]$RepoRoot)
    $f = Get-DocsSeenStatePath -RepoRoot $RepoRoot
    if (-not (Test-Path -LiteralPath $f)) { return @{} }
    try {
        $o = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
        $h = @{}
        foreach ($prop in $o.PSObject.Properties) { $h[$prop.Name] = [string]$prop.Value }
        return $h
    }
    catch { return @{} }
}

function Write-DocsSeenState {
    [CmdletBinding()]
    param([string]$RepoRoot, [hashtable]$State)
    $f = Get-DocsSeenStatePath -RepoRoot $RepoRoot
    $dir = Split-Path -Parent $f
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    ($State | ConvertTo-Json -Compress) | Set-Content -LiteralPath $f -Encoding utf8
}

function Invoke-SessionSnapshot {
    <#
        SessionStart hook: capture HEAD + the already-dirty path set so the Stop
        hook can isolate THIS session's doc edits. Best-effort; never blocks.
    #>
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId, [scriptblock]$GitCommandRunner, [scriptblock]$SnapshotWriter, [scriptblock]$AttemptsWriter)

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
            $f = Get-DocsSessionPath -RepoRoot $capturedRoot -SessionId $capturedSid
            $dir = Split-Path -Parent $f
            if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            ($Snap | ConvertTo-Json -Compress) | Set-Content -LiteralPath $f -Encoding utf8
        }.GetNewClosure()
    }
    if (-not $AttemptsWriter) {
        $capturedRoot = $RepoRoot
        $capturedSid = $SessionId
        $AttemptsWriter = { param($A) Write-DocsReviseAttempts -RepoRoot $capturedRoot -SessionId $capturedSid -Attempts $A }.GetNewClosure()
    }

    $head = ''
    try { $head = ((& $GitCommandRunner @('rev-parse', 'HEAD')) | Select-Object -First 1) } catch { }
    $dirtyRaw = & $GitCommandRunner @('status', '--porcelain')
    $dirtyJoined = if ($dirtyRaw -is [array]) { $dirtyRaw -join "`n" } else { [string]$dirtyRaw }
    $dirty = @(ConvertFrom-GitPorcelain -Porcelain $dirtyJoined)
    & $SnapshotWriter @{ Head = ([string]$head).Trim(); Dirty = $dirty }
    # Reset the per-session auto/blocking revise attempt counter.
    & $AttemptsWriter @{}
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
            catch { }
        }
    }

    # Every hook surface (SessionStart / SessionEnd / Stop / PreToolUse) receives a
    # JSON payload on stdin carrying `session_id`. Read it when stdin is piped
    # (always true under a hook); skip for a bare interactive/CI invocation so
    # ReadToEnd never blocks.
    if (-not $HookInputJson -and [Console]::IsInputRedirected) {
        try { $HookInputJson = [Console]::In.ReadToEnd() } catch { $HookInputJson = '' }
    }
    if (-not $SessionId) {
        $SessionId = Get-SessionIdFromPayload -Payload (Read-HookPayload -Json $HookInputJson)
    }

    # SessionStart: capture the per-session baseline, then exit cleanly.
    if ($SnapshotSession) {
        try { Invoke-SessionSnapshot -RepoRoot $RepoRoot -SessionId $SessionId -GitCommandRunner $GitCommandRunner -SnapshotWriter $SnapshotWriter }
        catch { }
        exit 0
    }

    # SessionEnd: delete this session's per-session state files, then exit.
    if ($SessionEnd) {
        try { Remove-DocsSessionState -RepoRoot $RepoRoot -SessionId $SessionId } catch { }
        exit 0
    }

    if (-not $EnforcementMode) { $EnforcementMode = $env:DOCS_KEEPER_ENFORCE }
    if (-not $AutoReviseMode) { $AutoReviseMode = $env:DOCS_KEEPER_AUTO_REVISE }
    if (-not $MaxReviseAttempts) { $MaxReviseAttempts = $env:DOCS_KEEPER_MAX_REVISE_ATTEMPTS }

    $result = Invoke-PreCommitDocsHook `
        -HookInputJson $HookInputJson `
        -RepoRoot $RepoRoot `
        -SessionId $SessionId `
        -GitCommandRunner $GitCommandRunner `
        -DirLister $DirLister `
        -FileReader $FileReader `
        -SnapshotReader $SnapshotReader `
        -SeenStateReader $SeenStateReader `
        -SeenStateWriter $SeenStateWriter `
        -AttemptsReader $AttemptsReader `
        -AttemptsWriter $AttemptsWriter `
        -EnforcementMode $EnforcementMode `
        -AutoReviseMode $AutoReviseMode `
        -MaxReviseAttempts $MaxReviseAttempts `
        -Standalone:$Standalone

    # auto mode: emit a Stop-hook control payload on stdout so the model runs the
    # chain automatically (decision:block + reason). Exit 0 — the JSON, not the
    # exit code, carries the block.
    if ($result.AutoInvoke -and $result.Directive) {
        [Console]::Out.WriteLine((ConvertTo-StopBlockJson -Reason $result.Directive))
        exit 0
    }

    if ($result.ExitCode -ne 0 -and $result.Message) {
        [Console]::Error.WriteLine($result.Message)
    }
    elseif ($result.ExitCode -eq 0 -and $result.Message) {
        # Non-blocking notes (e.g. revise cap reached) still surface to the user.
        [Console]::Error.WriteLine($result.Message)
    }
    exit $result.ExitCode
}
