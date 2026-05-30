#Requires -Version 7.0

<#
.SYNOPSIS
    Claude Code docs-keeper capture hook — appends doc-capture entries
    written by /docs-capture (AddCapture) or compaction summaries
    (CaptureFromSummary).

.DESCRIPTION
    Two invocation surfaces:

    AddCapture mode (-AddCapture switch):
      Wired as a PostToolUse hook on Skill. When a /docs-capture skill
      completes, appends the captured content + suggestedDoc to the
      per-session capture file.

    CaptureFromSummary mode (-CaptureFromSummary switch):
      Wired as a PostCompact hook. Records the compaction summary as a
      capture entry so it can be surfaced and applied in a later session.

    Capture file: `.claude/.docs-capture.<sanitized-sid>.json`
    Surfacing (SessionStart proposal + SessionEnd report) stays in
    Invoke-DocsKeeperMaintenance.ps1 alongside the session lifecycle.

    Pure functions live above the entry block for Pester coverage.
    Pass `-AsLibrary` to dot-source without executing the entry block.

.PARAMETER RepoRoot
    Git working tree root. Defaults to `$env:CLAUDE_PROJECT_DIR`, falling
    back to `git rev-parse --show-toplevel`.

.PARAMETER SessionId
    Claude session id. Namespaces the capture file. Read from stdin JSON
    `session_id` field when not provided directly.

.PARAMETER HookInputJson
    Hook stdin payload (JSON). When omitted, read from `[Console]::In`.

.PARAMETER AddCapture
    PostToolUse mode — append a /docs-capture skill entry.

.PARAMETER CaptureFromSummary
    PostCompact mode — append a compaction summary as a capture entry.

.PARAMETER AsLibrary
    Define helper functions but skip the entry block (used by Pester).
#>

[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string]$SessionId,
    [string]$HookInputJson,
    [switch]$AddCapture,
    [switch]$CaptureFromSummary,
    [switch]$AsLibrary
)

# ---------- Pure helpers (intentional duplicates from Invoke-DocsKeeperMaintenance) ----------

function Get-SafeSessionId {
    [CmdletBinding()]
    param([string]$SessionId)
    if ([string]::IsNullOrWhiteSpace($SessionId)) { return '' }
    return ($SessionId -replace '[^A-Za-z0-9._-]', '_')
}

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

function Get-DocsCaptureFilePath {
    [CmdletBinding()]
    param([string]$RepoRoot, [string]$SessionId)
    $dir  = if ($RepoRoot) { Join-Path $RepoRoot '.claude' } else { '.claude' }
    $sid  = Get-SafeSessionId -SessionId $SessionId
    $name = if ($sid) { ".docs-capture.$sid.json" } else { '.docs-capture.json' }
    return (Join-Path $dir $name)
}

# ---------- Pure functions ----------

function New-DocsCaptureEntry {
    [CmdletBinding()]
    param(
        [string]$Content,
        [string]$SuggestedDoc,
        [string]$Source,
        [string]$CapturedAt
    )
    $safeSource = if ($Source -in @('manual', 'compaction')) { $Source } else { 'manual' }
    return @{
        content      = $Content
        suggestedDoc = $SuggestedDoc
        source       = $safeSource
        capturedAt   = $CapturedAt
    }
}

function Add-DocsCaptureEntry {
    <#
        Pure. Returns updated capture hashtable with $Entry appended to captures.
        Does not mutate the input.
    #>
    [CmdletBinding()]
    param([hashtable]$CaptureFile, [hashtable]$Entry)
    $result = @{}
    foreach ($k in $CaptureFile.Keys) { $result[$k] = $CaptureFile[$k] }
    $existing = [System.Collections.Generic.List[object]]::new()
    if ($result.ContainsKey('captures') -and $result['captures']) {
        foreach ($item in @($result['captures'])) { $existing.Add($item) }
    }
    $existing.Add($Entry)
    $result['captures'] = $existing.ToArray()
    return $result
}

# ---------- I/O helpers ----------

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

function Write-DocsCapture {
    <#
        Writes the capture hashtable as JSON. Creates .claude/ dir if absent.
    #>
    [CmdletBinding()]
    param([string]$Path, [hashtable]$CaptureFile)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $CaptureFile | ConvertTo-Json -Compress -Depth 5 | Set-Content -LiteralPath $Path -Encoding utf8
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

    if ($AddCapture) {
        try {
            $payload      = Read-HookPayload -Json $HookInputJson
            $content      = ''
            $suggestedDoc = ''
            if ($payload) {
                $src = if ($payload.tool_input) { $payload.tool_input } else { $payload }
                if ($src.content)      { $content      = [string]$src.content }
                if ($src.suggestedDoc) { $suggestedDoc = [string]$src.suggestedDoc }
            }
            if ($content) {
                $capturePath = Get-DocsCaptureFilePath -RepoRoot $RepoRoot -SessionId $SessionId
                $captureFile = Read-DocsCapture -Path $capturePath
                if (-not $captureFile) { $captureFile = @{ sessionId = $SessionId; captures = @() } }
                $entry       = New-DocsCaptureEntry -Content $content -SuggestedDoc $suggestedDoc -Source 'manual' -CapturedAt ([DateTime]::UtcNow.ToString('o'))
                $captureFile = Add-DocsCaptureEntry -CaptureFile $captureFile -Entry $entry
                Write-DocsCapture -Path $capturePath -CaptureFile $captureFile
            }
        }
        catch { $null = $_ }
        exit 0
    }

    if ($CaptureFromSummary) {
        try {
            $payload = Read-HookPayload -Json $HookInputJson
            $summary = ''
            if ($payload) {
                if ($payload.summary)                        { $summary = [string]$payload.summary }
                elseif ($payload.compaction_summary)         { $summary = [string]$payload.compaction_summary }
                elseif ($payload.tool_response -and $payload.tool_response.summary) {
                    $summary = [string]$payload.tool_response.summary
                }
            }
            if ($summary) {
                $capturePath = Get-DocsCaptureFilePath -RepoRoot $RepoRoot -SessionId $SessionId
                $captureFile = Read-DocsCapture -Path $capturePath
                if (-not $captureFile) { $captureFile = @{ sessionId = $SessionId; captures = @() } }
                $entry       = New-DocsCaptureEntry -Content $summary -SuggestedDoc '' -Source 'compaction' -CapturedAt ([DateTime]::UtcNow.ToString('o'))
                $captureFile = Add-DocsCaptureEntry -CaptureFile $captureFile -Entry $entry
                Write-DocsCapture -Path $capturePath -CaptureFile $captureFile
            }
        }
        catch { $null = $_ }
        exit 0
    }

    exit 0
}
