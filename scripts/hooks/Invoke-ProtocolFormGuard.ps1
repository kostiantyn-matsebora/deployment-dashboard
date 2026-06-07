#Requires -Version 7.0

<#
.SYNOPSIS
    PreToolUse(SendMessage) hook — enforces the typed-form Communication protocol
    (process.md). A cross-role hand-back must be one of the six typed forms, tagged
    with the form name on its own opening line:
        REVIEW · RESULT · BRIEF · FINDING · FIX · ARTIFACT

    Enforcement is SHAPE-ONLY (honest limit): it blocks free-prose hand-backs and
    forms missing required fields / with an invalid verdict. It cannot judge whether
    a `checked` row is thorough. Informal coordination messages (no form tag, not
    form-like) pass through untouched.
.PARAMETER AsLibrary
    Define functions without executing entry block (for Pester).
#>

[CmdletBinding()]
param([switch]$AsLibrary)

function Get-FormTag {
    param([string]$Text)
    foreach ($line in ($Text -split "`r?`n")) {
        $t = $line.Trim()
        if ($t -eq '') { continue }
        if ($t -match '^#?\s*(REVIEW|RESULT|BRIEF|FINDING|FIX|ARTIFACT)\b') {
            return $Matches[1].ToUpper()
        }
        return $null   # first non-empty line is not a tag
    }
    return $null
}

function Get-RequiredFields {
    param([string]$Form)
    switch ($Form) {
        'REVIEW' { return @('role', 'scope', 'checked', 'verdict', 'remarks', 'block') }
        'RESULT' { return @('role', 'changed', 'gate', 'block') }
        'BRIEF' { return @('spec', 'lane', 'task', 'gate') }
        'FINDING' { return @('where', 'issue', 'options', 'need') }
        'FIX' { return @('test', 'expect', 'actual', 'suspect') }
        'ARTIFACT' { return @('spec', 'delta') }
        default { return @() }
    }
}

function Test-FieldPresent {
    # Matches both table cells (`| role |`) and colon form (`role:`).
    param([string]$Text, [string]$Label)
    return ($Text -match "(?im)(^|\|)\s*$([regex]::Escape($Label))\s*(\||:)")
}

function Get-FormFieldHits {
    param([string]$Text)
    $labels = @('role', 'scope', 'checked', 'verdict', 'remarks', 'changed', 'gate',
        'spec', 'lane', 'task', 'where', 'issue', 'options', 'need',
        'expect', 'actual', 'suspect', 'delta', 'block')
    $hits = 0
    foreach ($l in $labels) {
        if (Test-FieldPresent -Text $Text -Label $l) { $hits++ }
    }
    return $hits
}

function Test-IsFormLike {
    # A message that carries hand-back content but may lack a tag.
    param([string]$Text)
    if (Get-FormTag -Text $Text) { return $true }
    return ((Get-FormFieldHits -Text $Text) -ge 3)
}

function Get-ProtocolFormDecision {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return @{ Block = $false } }

    $tag = Get-FormTag -Text $Text

    if (-not $tag) {
        if (Test-IsFormLike -Text $Text) {
            return @{
                Block  = $true
                Reason = 'This looks like a typed-form hand-back but has no form tag. Open the message with the form name on its own line (REVIEW / RESULT / BRIEF / FINDING / FIX / ARTIFACT) and emit that form''s fields. Free-prose hand-backs are returned UNREAD (process.md Communication protocol).'
            }
        }
        return @{ Block = $false }   # informal coordination — allowed
    }

    $missing = @(Get-RequiredFields -Form $tag | Where-Object { -not (Test-FieldPresent -Text $Text -Label $_) })
    if ($missing.Count -gt 0) {
        return @{
            Block  = $true
            Reason = "Malformed $tag — missing required field(s): $($missing -join ', '). Emit every $tag row in fixed order, omit only empty rows (process.md Communication protocol)."
        }
    }

    if ($tag -eq 'REVIEW' -and ($Text -notmatch '(?im)verdict[^\n]*\b(pass|changes-requested)\b')) {
        return @{
            Block  = $true
            Reason = "Malformed REVIEW — verdict must be 'pass' or 'changes-requested'."
        }
    }

    return @{ Block = $false }
}

function Get-SendMessageText {
    param($ToolInput)
    if ($null -eq $ToolInput) { return '' }
    $m = $ToolInput.message
    if ($null -eq $m) { return '' }
    if ($m -is [string]) { return $m }
    return ''   # object messages (legacy protocol responses) are not validated
}

if (-not $AsLibrary) {
    $hookInputJson = ''
    if ([Console]::IsInputRedirected) {
        try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' }
    }

    $text = ''
    if (-not [string]::IsNullOrWhiteSpace($hookInputJson)) {
        try {
            $payload = $hookInputJson | ConvertFrom-Json -ErrorAction Stop
            $text = Get-SendMessageText -ToolInput $payload.tool_input
        }
        catch { $null = $_ }
    }

    $decision = Get-ProtocolFormDecision -Text $text

    if ($decision.Block) {
        $json = @{ decision = 'block'; reason = $decision.Reason } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
    }

    exit 0
}
