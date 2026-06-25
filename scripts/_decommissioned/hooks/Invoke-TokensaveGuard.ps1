#Requires -Version 7.0

<#
.SYNOPSIS
    PreToolUse(Read|Grep) hook — enforces the project rule that CODE exploration goes
    through tokensave + serena, not raw Read/Grep (CLAUDE.md "Code intelligence").

    Blocks Read/Grep that targets a source file (.cs/.ts/.tsx/.js/.jsx) ONLY WHEN the
    current git branch is tracked by tokensave (a key in `.tokensave/branch-meta.json`)
    — i.e. tokensave can actually answer for branch-local symbols.

    If the branch is NOT tracked, tokensave silently falls back to the default branch
    and returns empty for branch-new symbols; blocking there would dead-end the agent,
    so the hook ALLOWS Read/Grep in that case. Declarative files (.json/.yaml/.csproj/
    .md/...) and non-code-targeted Greps are always allowed.

    OPERATIONAL NOTE: the tokensave MCP server binds the active branch at startup. After
    `tokensave branch add <branch>`, the running server keeps serving the default branch
    until a fresh session / MCP reconnect. So: track the branch BEFORE the session that
    runs the agents, or the guard may block while live queries still fall back.
.PARAMETER AsLibrary
    Define functions without executing the entry block (for Pester).
#>

[CmdletBinding()]
param([switch]$AsLibrary)

$script:DefaultCodeExtensions = @('.cs', '.ts', '.tsx', '.js', '.jsx')
$script:DefaultCodeGrepTypes = @('cs', 'csharp', 'ts', 'tsx', 'typescript', 'js', 'jsx', 'javascript')

function Test-IsCodePath {
    param([string]$Path, [string[]]$CodeExtensions)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    $p = ($Path -replace '\\', '/').ToLowerInvariant()
    foreach ($ext in $CodeExtensions) {
        if ($p.EndsWith($ext.ToLowerInvariant())) { return $true }
    }
    return $false
}

function Test-BranchTracked {
    param([string]$Branch, [string]$MetaPath)
    if ([string]::IsNullOrWhiteSpace($Branch)) { return $false }
    if (-not (Test-Path -LiteralPath $MetaPath)) { return $false }
    try {
        $meta = Get-Content -LiteralPath $MetaPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    }
    catch { return $false }
    if (-not $meta.branches) { return $false }
    $names = @($meta.branches.PSObject.Properties.Name)
    return ($names -contains $Branch)
}

function Get-TokensaveGuardDecision {
    param(
        [string]$ToolName,
        [object]$ToolInput,
        [bool]$BranchTracked,
        [string[]]$CodeExtensions = $script:DefaultCodeExtensions,
        [string[]]$CodeTypes = $script:DefaultCodeGrepTypes
    )

    # Enforce only when tokensave actually serves this branch — never dead-end.
    if (-not $BranchTracked) { return @{ Block = $false } }
    if ($ToolName -ne 'Read' -and $ToolName -ne 'Grep') { return @{ Block = $false } }

    $isCode = $false
    $target = ''

    if ($ToolName -eq 'Read') {
        $target = [string]$ToolInput.file_path
        $isCode = Test-IsCodePath -Path $target -CodeExtensions $CodeExtensions
    }
    else {
        # Grep counts as code exploration when it explicitly targets source:
        # a code `type`, a glob ending in a code extension, or a code-file `path`.
        $type = [string]$ToolInput.type
        $glob = [string]$ToolInput.glob
        $path = [string]$ToolInput.path
        $target = if ($glob) { $glob } elseif ($path) { $path } else { [string]$ToolInput.pattern }
        if ($type -and ($CodeTypes -contains $type.ToLowerInvariant())) { $isCode = $true }
        elseif (Test-IsCodePath -Path $glob -CodeExtensions $CodeExtensions) { $isCode = $true }
        elseif (Test-IsCodePath -Path $path -CodeExtensions $CodeExtensions) { $isCode = $true }
    }

    if (-not $isCode) { return @{ Block = $false } }

    return @{
        Block  = $true
        Reason = "Code-intelligence guard: explore source with tokensave + serena, not raw $ToolName ('$target'). " + `
            'Use tokensave_context / tokensave_callers / tokensave_outline for understanding & call sites, and ' + `
            'serena find_symbol / get_symbols_overview for exact symbol bodies. Read/Grep are for declarative ' + `
            'files (json/yaml/csproj/md) or exact line ranges only (CLAUDE.md "Code intelligence"). ' + `
            'If tokensave returns empty for a branch-new symbol the branch index may be stale — report to the ' + `
            'lead rather than silently falling back.'
    }
}

if (-not $AsLibrary) {
    $hookInputJson = ''
    if ([Console]::IsInputRedirected) {
        try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' }
    }
    if ([string]::IsNullOrWhiteSpace($hookInputJson)) { exit 0 }

    try { $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop } catch { exit 0 }

    $toolName = [string]$payload.tool_name
    if ($toolName -ne 'Read' -and $toolName -ne 'Grep') { exit 0 }

    $root = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
    if (-not $root) { $root = (Get-Location).Path }
    $root = ([string]$root).Trim()

    $branch = (& git rev-parse --abbrev-ref HEAD 2>$null) | Select-Object -First 1
    $branch = ([string]$branch).Trim()

    $metaPath = Join-Path $root '.tokensave/branch-meta.json'
    $tracked = Test-BranchTracked -Branch $branch -MetaPath $metaPath

    $decision = Get-TokensaveGuardDecision -ToolName $toolName -ToolInput $payload.tool_input -BranchTracked $tracked

    if ($decision.Block) {
        $json = @{ decision = 'block'; reason = $decision.Reason } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
    }

    exit 0
}
