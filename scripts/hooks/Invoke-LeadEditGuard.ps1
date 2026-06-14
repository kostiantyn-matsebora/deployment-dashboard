#Requires -Version 7.0

<#
.SYNOPSIS
    PreToolUse(Edit|Write|MultiEdit|NotebookEdit) hook — stops the orchestrator/lead
    from editing product/lane files. The lead may only edit paths matching the
    orchestration whitelist. Subagents pass straight through; their lane is
    enforced by the existing LaneGuard.

    Whitelist source: <root>/.team-process/lead-lane if present (one glob per line;
    blank lines and # comments ignored); otherwise the built-in DEFAULT list.
.PARAMETER AsLibrary
    Define functions without executing entry block (for Pester).
#>

[CmdletBinding()]
param([switch]$AsLibrary)

function ConvertFrom-LaneGlob {
    param([string]$Glob)
    $g = ($Glob.Trim()) -replace '\\', '/'
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append('^')
    $i = 0
    while ($i -lt $g.Length) {
        $ch = $g[$i]
        if ($ch -eq '*') {
            if ($i + 1 -lt $g.Length -and $g[$i + 1] -eq '*') {
                [void]$sb.Append('.*'); $i += 2; continue
            }
            [void]$sb.Append('[^/]*'); $i += 1; continue
        }
        if ($ch -eq '?') { [void]$sb.Append('[^/]'); $i += 1; continue }
        [void]$sb.Append([regex]::Escape([string]$ch)); $i += 1
    }
    [void]$sb.Append('$')
    return $sb.ToString()
}

function Test-PathInGlobs {
    param([string]$RelPath, [string[]]$Globs)
    $p = ($RelPath -replace '\\', '/')
    if ($p.StartsWith('./')) { $p = $p.Substring(2) }
    foreach ($glob in $Globs) {
        if ([string]::IsNullOrWhiteSpace($glob)) { continue }
        if ($glob.TrimStart().StartsWith('#')) { continue }
        $rx = ConvertFrom-LaneGlob -Glob $glob.Trim()
        if ($p -match $rx) { return $true }
    }
    return $false
}

function Get-RelativePath {
    param([string]$FullPath, [string]$Root)
    $f = ($FullPath -replace '\\', '/')
    $r = (($Root -replace '\\', '/').TrimEnd('/'))
    if ($f.StartsWith($r + '/', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $f.Substring($r.Length + 1)
    }
    return $f
}

function Get-LeadLaneGlobs {
    param([string]$Root)
    $overrideFile = Join-Path $Root '.team-process' 'lead-lane'
    if (Test-Path -LiteralPath $overrideFile) {
        $lines = Get-Content -LiteralPath $overrideFile -ErrorAction SilentlyContinue
        return @($lines | Where-Object {
            $_ -and -not [string]::IsNullOrWhiteSpace($_) -and -not ($_.TrimStart().StartsWith('#'))
        } | ForEach-Object { $_.Trim() })
    }
    return @(
        '.claude/team-process/**',
        '.claude/bindings/**',
        '.claude/agents/**',
        '.claude/commands/**',
        '.claude/skills/**',
        '.claude/*.md',
        '.claude/settings.json',
        '.claude/settings.local.json',
        '.team-process/**'
    )
}

function Get-LeadEditDecision {
    param(
        [string]$RelPath,
        [bool]$IsSubagent,
        [bool]$UnderRoot,
        [string[]]$Globs
    )
    if ($IsSubagent) { return @{ Block = $false } }
    if (-not $UnderRoot) { return @{ Block = $false } }
    if (Test-PathInGlobs -RelPath $RelPath -Globs $Globs) { return @{ Block = $false } }
    return @{
        Block  = $true
        Reason = "The orchestrator does not edit lane files. '$RelPath' is product-facing, outside the orchestration whitelist (the test is lane membership, not size). Delegate to the owning role via a BRIEF; keep your context to plan + ledger. See .claude/team-process/process.md -> 'Delegate by default'."
    }
}

if (-not $AsLibrary) {
    $hookInputJson = ''
    if ([Console]::IsInputRedirected) {
        try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' }
    }

    if ([string]::IsNullOrWhiteSpace($hookInputJson)) { exit 0 }

    $payload = $null
    try { $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop } catch { $null = $_ }
    if (-not $payload) { exit 0 }

    $filePath = ''
    if ($payload.tool_input -and $payload.tool_input.file_path) {
        $filePath = [string]$payload.tool_input.file_path
    }
    if ([string]::IsNullOrWhiteSpace($filePath)) { exit 0 }

    $isSubagent = (-not [string]::IsNullOrWhiteSpace($payload.agent_type)) -or
                  (-not [string]::IsNullOrWhiteSpace($payload.agent_id))

    $root = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
    if (-not $root) { $root = (Get-Location).Path }
    $root = ([string]$root).Trim() -replace '\\', '/'

    $normalizedFile = $filePath -replace '\\', '/'
    $underRoot = $normalizedFile.StartsWith($root + '/', [System.StringComparison]::OrdinalIgnoreCase)

    $relPath = Get-RelativePath -FullPath $filePath -Root $root
    $globs   = Get-LeadLaneGlobs -Root $root
    $decision = Get-LeadEditDecision -RelPath $relPath -IsSubagent $isSubagent -UnderRoot $underRoot -Globs $globs

    if ($decision.Block) {
        $json = @{ decision = 'block'; reason = $decision.Reason } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
    }

    exit 0
}
