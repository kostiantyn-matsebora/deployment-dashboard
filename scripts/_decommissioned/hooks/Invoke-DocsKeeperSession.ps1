#Requires -Version 7.0

<#
.SYNOPSIS
    Claude Code docs-keeper session hook — manages the per-session tracker
    that records which .md files were edited and whether they have been revised.

.DESCRIPTION
    Five invocation surfaces:

    SnapshotSession mode (-SnapshotSession switch):
      Wired as a Claude Code SessionStart hook. Captures HEAD + the
      already-dirty path set to `.docs-keeper/session.<sid>.json`
      so the Track hook can isolate THIS session's doc edits. Also surfaces
      unrevised files from prior sessions and pending captures. Never blocks.

    SessionEnd mode (-SessionEnd switch):
      Wired as a Claude Code SessionEnd hook. Deletes this session's
      per-session state files (unless TrackedMd has unrevised entries that
      still differ from HEAD, which are forwarded). Surfaces captured docs
      as a systemMessage. Never blocks.

    Track mode (-Track switch):
      Wired as the Stop hook. Records session-edited .md files into the
      session tracker (TrackedMd). Never blocks.

    MarkRevised mode (-MarkRevised switch):
      Wired as a PostToolUse hook matched on Skill. When a /docs-revise
      skill call completes, marks the revised files in TrackedMd as
      revised: true.

    Dismiss mode (-Dismiss <path>):
      Deletes the specified tracker file (user chose "dismiss" from the
      session-start proposal).

    Drift detection and the pre-commit gate live in the sibling script
    Invoke-DocsKeeperMaintenance.ps1. Capture write operations live in
    Invoke-DocsKeeperCapture.ps1.

    Pure functions live above the entry block for Pester coverage.
    Pass -AsLibrary to dot-source without executing the entry block.

.PARAMETER HookInputJson
    Hook stdin payload (JSON). When omitted, the script reads from
    [Console]::In when stdin is redirected.

.PARAMETER RepoRoot
    Git working tree root. Defaults to $env:CLAUDE_PROJECT_DIR, falling
    back to git rev-parse --show-toplevel.

.PARAMETER SessionId
    Claude session id. Namespaces the per-session files. Read from stdin
    JSON session_id field when not provided directly.

.PARAMETER GitCommandRunner
    Injectable scriptblock — takes [string[]] argv, returns stdout lines.

.PARAMETER SnapshotWriter
    Injectable scriptblock & $SnapshotWriter <snapshot-hashtable> used by
    SnapshotSession mode.

.PARAMETER DirLister
    Injectable scriptblock: & $DirLister <repo-relative-dir> returns an
    array of @{ Name = <string>; IsDir = <bool> }.

.PARAMETER FileReader
    Injectable scriptblock: & $FileReader <repo-relative-path> returns the
    file's raw content (empty string if absent).

.PARAMETER SnapshotSession
    SessionStart mode: capture the per-session baseline and exit 0.

.PARAMETER SessionEnd
    SessionEnd mode: delete this session's per-session state files and exit 0.

.PARAMETER Track
    Stop-hook mode: record session-edited .md files into TrackedMd.

.PARAMETER MarkRevised
    PostToolUse mode: mark the revised files as revised: true in TrackedMd.

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
    [scriptblock]$SnapshotWriter,
    [scriptblock]$DirLister,
    [scriptblock]$FileReader,
    [switch]$SnapshotSession,
    [switch]$SessionEnd,
    [switch]$Track,
    [switch]$MarkRevised,
    [string]$Dismiss,
    [switch]$AsLibrary
)

# ---------- Duplicated helpers (also in Invoke-DocsKeeperMaintenance.ps1) ----------

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
    [CmdletBinding()]
    param([string]$SessionId)
    if ([string]::IsNullOrWhiteSpace($SessionId)) { return '' }
    return ($SessionId -replace '[^A-Za-z0-9._-]', '_')
}

function Test-IsMarkdownPath {
    [CmdletBinding()]
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return $Path -like '*.md'
}

# ---------- Pure functions: git porcelain + session-path computation ----------

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

# ---------- Pure functions: docs-capture read side ----------

function Get-DocsCaptureFilePath {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.docs-keeper' } else { '.docs-keeper' }
    $sid = Get-SafeSessionId -SessionId $SessionId
    $name = if ($sid) { "capture.$sid.json" } else { 'capture.json' }
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
        Pure. Scans .docs-keeper/ for capture.*.json files whose session id does
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
    $stateDir = if ($RepoRoot) { '.docs-keeper' } else { '.docs-keeper' }
    $safeCurrent = Get-SafeSessionId -SessionId $CurrentSessionId

    $dirEntries = @(& $DirLister $stateDir)
    $results = @()
    foreach ($entry in $dirEntries) {
        if ($entry.IsDir) { continue }
        $name = [string]$entry.Name
        if ($name -notmatch '^capture\.(.+)\.json$') { continue }
        $fileSid = $matches[1]
        if ($fileSid -eq $safeCurrent) { continue }

        $relPath = "$stateDir/$name"
        $raw = & $FileReader $relPath
        if ([string]::IsNullOrWhiteSpace($raw)) { continue }
        try {
            $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
            $captures = @()
            if ($parsed.captures) { $captures = @($parsed.captures) }
            if ($captures.Count -eq 0) { continue }

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

# ---------- Session I/O (duplicated path helper + read; write + delete are unique here) ----------

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

function Write-DocsKeeperSession {
    <#
        Writes the full session object @{ Head; Dirty; TrackedMd } to the
        .docs-keeper/session.<sid>.json file. Creates .docs-keeper/ dir if absent.
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
        Impure. Finds all session.*.json files under .docs-keeper/ whose
        session id does NOT match $CurrentSessionId. Returns array of file paths.
    #>
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$CurrentSessionId)
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.docs-keeper' } else { '.docs-keeper' }
    if (-not (Test-Path -LiteralPath $dir)) { return @() }
    $safeCurrent = Get-SafeSessionId -SessionId $CurrentSessionId
    $results = @()
    foreach ($f in (Get-ChildItem -LiteralPath $dir -Filter 'session.*.json' -File -ErrorAction SilentlyContinue)) {
        if ($f.Name -match '^session\.(.+)\.json$') {
            $fileSid = $matches[1]
            if ($fileSid -ne $safeCurrent) { $results += $f.FullName }
        }
    }
    return $results
}

function Test-TrackerHasPendingWork {
    <#
        Pure-ish predicate. Returns $true iff the tracker has at least one entry
        where revised: false AND `git diff HEAD -- <path>` returns non-empty output.
        Injectable $GitCommandRunner for Pester coverage.
    #>
    [CmdletBinding()]
    param(
        [hashtable]$Tracker,
        [scriptblock]$GitCommandRunner,
        [string]$Head = 'HEAD'
    )
    if (-not $Tracker -or -not $Tracker.TrackedMd -or $Tracker.TrackedMd.Count -eq 0) {
        return $false
    }
    foreach ($entry in $Tracker.TrackedMd.GetEnumerator()) {
        if (-not [bool]$entry.Value.revised) {
            try {
                $diffOut = & $GitCommandRunner @('diff', $Head, '--', $entry.Key) 2>$null
                if ($diffOut) { return $true }
            }
            catch { $null = $_ }
        }
    }
    return $false
}

function Remove-DocsSessionState {
    <#
        SessionEnd cleanup.
        - CURRENT session file: delete unless Test-TrackerHasPendingWork is true
          (at least one revised:false entry still differs from HEAD).
        - EACH leftover session file: delete when Test-TrackerHasPendingWork is
          false; keep when true (still has work to carry forward).
        - Delete the legacy attempts file if it still exists (backward compat).
        Best-effort; never throws.
    #>
    [CmdletBinding()]
    param(
        [string]$RepoRoot,
        [string]$SessionId,
        [scriptblock]$GitCommandRunner
    )

    if (-not $GitCommandRunner) {
        $capturedRoot = $RepoRoot
        $GitCommandRunner = {
            param([string[]]$Argv)
            if ($capturedRoot) { & git -C $capturedRoot @Argv } else { & git @Argv }
        }.GetNewClosure()
    }

    # Current session file.
    $sessionFile = Get-DocsKeeperSessionPath -RepoRoot $RepoRoot -SessionId $SessionId
    if (Test-Path -LiteralPath $sessionFile) {
        try {
            $session = Read-DocsKeeperSession -RepoRoot $RepoRoot -SessionId $SessionId
            $hasPending = Test-TrackerHasPendingWork -Tracker $session -GitCommandRunner $GitCommandRunner
            if (-not $hasPending) {
                Remove-Item -LiteralPath $sessionFile -Force -ErrorAction SilentlyContinue
            }
        }
        catch { $null = $_ }
    }

    # Leftover session files from other sessions.
    $leftovers = @(Get-LeftoverSessionFiles -RepoRoot $RepoRoot -CurrentSessionId $SessionId)
    foreach ($leftoverPath in $leftovers) {
        try {
            $raw = Get-Content -LiteralPath $leftoverPath -Raw -ErrorAction SilentlyContinue
            if ([string]::IsNullOrWhiteSpace($raw)) {
                Remove-Item -LiteralPath $leftoverPath -Force -ErrorAction SilentlyContinue
                continue
            }
            $o = $raw | ConvertFrom-Json -ErrorAction Stop
            $trackedMd = @{}
            if ($o.TrackedMd) {
                foreach ($prop in $o.TrackedMd.PSObject.Properties) {
                    $trackedMd[$prop.Name] = @{ revised = [bool]$prop.Value.revised }
                }
            }
            $leftoverTracker = @{ Head = [string]$o.Head; Dirty = @(); TrackedMd = $trackedMd }
            $hasPending = Test-TrackerHasPendingWork -Tracker $leftoverTracker -GitCommandRunner $GitCommandRunner
            if (-not $hasPending) {
                Remove-Item -LiteralPath $leftoverPath -Force -ErrorAction SilentlyContinue
            }
        }
        catch { $null = $_ }
    }

    # Backward compat: remove legacy attempts file if present.
    $dir = if ($RepoRoot) { Join-Path $RepoRoot '.docs-keeper' } else { '.docs-keeper' }
    $sid = Get-SafeSessionId -SessionId $SessionId
    $attemptsName = if ($sid) { "attempts.$sid.json" } else { 'attempts.json' }
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
        Returns the leftover-proposal string (empty string when none), so the
        caller can combine it with other proposals into a single emission.
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
        return (Format-SessionStartProposal -UnrevisedByFile $unrevisedByFile)
    }
    return ''
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

    if (-not $HookInputJson -and [Console]::IsInputRedirected) {
        try { $HookInputJson = [Console]::In.ReadToEnd() } catch { $HookInputJson = '' }
    }
    if (-not $SessionId) {
        $SessionId = Get-SessionIdFromPayload -Payload (Read-HookPayload -Json $HookInputJson)
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
        $leftoverProposal = ''
        try {
            $leftoverProposal = Invoke-SessionSnapshot -RepoRoot $RepoRoot -SessionId $SessionId -GitCommandRunner $GitCommandRunner -SnapshotWriter $SnapshotWriter
        }
        catch { $null = $_ }

        # Surface pending captures from prior sessions.
        $captureProposal = ''
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
                $captureProposal = Format-CaptureProposal -CaptureFiles $pendingCaptures
            }
        }
        catch { $null = $_ }

        # Combine proposals and emit a single JSON object.
        $parts = @($leftoverProposal, $captureProposal) | Where-Object { -not [string]::IsNullOrEmpty($_) }
        if ($parts.Count -gt 0) {
            $combined = $parts -join "`n`n"
            [Console]::Out.WriteLine((@{
                systemMessage    = $combined
                hookSpecificOutput = @{
                    hookEventName    = 'SessionStart'
                    additionalContext = $combined
                }
            } | ConvertTo-Json -Compress -Depth 5))
        }
        exit 0
    }

    # -SessionEnd: delete this session's per-session state files, then exit.
    if ($SessionEnd) {
        $capturedRoot = $RepoRoot
        $runner = if ($GitCommandRunner) { $GitCommandRunner } else {
            {
                param([string[]]$Argv)
                if ($capturedRoot) { & git -C $capturedRoot @Argv } else { & git @Argv }
            }.GetNewClosure()
        }
        try { Remove-DocsSessionState -RepoRoot $RepoRoot -SessionId $SessionId -GitCommandRunner $runner } catch { $null = $_ }

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
}
