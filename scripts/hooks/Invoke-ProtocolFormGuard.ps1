#Requires -Version 7.0

<#
.SYNOPSIS
    PreToolUse(SendMessage) hook — enforces the typed-form Communication protocol
    (process.md). A cross-role hand-back must be one of the six typed forms, tagged
    with the form name on its own opening line:
        REVIEW · RESULT · BRIEF · FINDING · FIX · ARTIFACT

    Validates STRUCTURE, not just keyword presence:
      - each field must be a real structured row — a markdown table row
        `| field | value |` OR a definition/bullet line `field: value` / `- field: value`;
        a label merely mentioned in prose does NOT count;
      - mandatory fields must be present with a NON-EMPTY value;
      - each value cell must be a `•` bullet list — one item per line (`<br>`-separated
        in a table cell); prose or inline-separated values are rejected;
      - the fields must appear in the form's fixed row order (process.md: "Fixed row order");
      - REVIEW.verdict must be `pass` or `changes-requested`.

    Still shape-only by design (honest limit): it cannot judge whether a `checked`
    row is thorough or a `remarks` entry is correct. Per process.md, EVERY cross-role
    message must be a typed form — so any non-empty string that is not a valid tagged
    form is BLOCKED (no "informal coordination" escape). Only empty strings and object
    protocol-response messages (shutdown etc., which arrive as '') pass through.
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

# Full canonical field order per form (process.md Communication protocol).
function Get-CanonicalFields {
    param([string]$Form)
    switch ($Form) {
        'REVIEW' { return @('role', 'scope', 'checked', 'verdict', 'remarks', 'block') }
        'RESULT' { return @('role', 'changed', 'gate', 'notes', 'follow', 'block') }
        'BRIEF' { return @('spec', 'lane', 'task', 'gate', 'seed') }
        'FINDING' { return @('where', 'issue', 'options', 'need') }
        'FIX' { return @('test', 'expect', 'actual', 'suspect') }
        'ARTIFACT' { return @('spec', 'delta', 'open') }
        default { return @() }
    }
}

# Fields that MUST be present with a value (others may be omitted when empty).
function Get-MandatoryFields {
    param([string]$Form)
    switch ($Form) {
        'REVIEW' { return @('role', 'scope', 'checked', 'verdict') }
        'RESULT' { return @('role', 'changed', 'gate') }
        'BRIEF' { return @('spec', 'lane', 'task', 'gate') }
        'FINDING' { return @('where', 'issue', 'options', 'need') }
        'FIX' { return @('test', 'expect', 'actual', 'suspect') }
        'ARTIFACT' { return @('spec', 'delta') }
        default { return @() }
    }
}

# Locate a field as a STRUCTURED row (table cell or definition/bullet line) and
# capture its value + line index. A prose mention does not match.
function Get-FieldLine {
    param([string]$Text, [string]$Label)
    $esc = [regex]::Escape($Label)
    $lines = $Text -split "`r?`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $ln = $lines[$i]
        # Markdown table row:  | field | value |   (trailing pipe optional)
        if ($ln -match "(?i)^\s*\|\s*$esc\s*\|\s*(?<v>[^|]*?)\s*\|?\s*$") {
            return @{ Found = $true; Value = $Matches['v'].Trim(); Index = $i }
        }
        # Definition / bullet line:  field: value   |   - field: value   |   * field: value
        if ($ln -match "(?i)^\s*[-*]?\s*$esc\s*:\s*(?<v>.*?)\s*$") {
            return @{ Found = $true; Value = $Matches['v'].Trim(); Index = $i }
        }
    }
    return @{ Found = $false; Value = ''; Index = -1 }
}

# A populated value cell must be a '•' bullet list: each item starts with '•',
# one item per line (items separated by <br> in a table cell, or by newlines).
function Test-IsBulletCell {
    param([string]$Value)
    $bullet = [char]0x2022
    $items = @([regex]::Split($Value, '(?i)<br\s*/?>|\r?\n') |
        ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    if ($items.Count -eq 0) { return $false }
    foreach ($it in $items) {
        if ($it[0] -ne $bullet) { return $false }            # each item starts with '•'
        $rest = $it.Substring(1)
        if ($rest.IndexOf($bullet) -ge 0) { return $false }  # only one item per line
        if ($rest.Trim() -eq '') { return $false }           # bullet must carry content
    }
    return $true
}

function Get-ProtocolFormDecision {
    param([string]$Text)
    # Empty / whitespace — includes object protocol-response messages (shutdown etc.),
    # which Get-SendMessageText flattens to ''. Not a cross-role hand-back; allow.
    if ([string]::IsNullOrWhiteSpace($Text)) { return @{ Block = $false } }

    $tag = Get-FormTag -Text $Text

    # No form tag → free prose. process.md: every cross-role message MUST be a typed
    # form. No "informal coordination" escape — block and require re-emission.
    if (-not $tag) {
        return @{
            Block  = $true
            Reason = 'Free-prose cross-role message — not permitted. Every cross-role message MUST be one of the six typed forms (REVIEW / RESULT / BRIEF / FINDING / FIX / ARTIFACT), opened with the form name on its own line and emitting that form''s fields. Informal prose is returned UNREAD (process.md Communication protocol). Re-emit in the correct typed form.'
        }
    }

    $canonical = Get-CanonicalFields -Form $tag
    $mandatory = Get-MandatoryFields -Form $tag
    $occ = @{}
    foreach ($f in $canonical) { $occ[$f] = Get-FieldLine -Text $Text -Label $f }

    # 1. Mandatory fields must each be present as a structured row.
    $missing = @($mandatory | Where-Object { -not $occ[$_].Found })
    if ($missing.Count -gt 0) {
        return @{
            Block  = $true
            Reason = "Malformed $tag — missing required field row(s): $($missing -join ', '). Emit each as a table row '| field | value |' (or 'field: value'), not prose."
        }
    }

    # 2. Any present field row must carry a non-empty value (omit empty rows instead).
    $empty = @($canonical | Where-Object { $occ[$_].Found -and [string]::IsNullOrWhiteSpace($occ[$_].Value) })
    if ($empty.Count -gt 0) {
        return @{
            Block  = $true
            Reason = "Malformed $tag — field row(s) present but empty: $($empty -join ', '). Give a value or omit the row (process.md: omit empty rows)."
        }
    }

    # 2b. Each present value cell must be a '•' bullet list, one item per line.
    $notBulleted = @($canonical | Where-Object {
            $occ[$_].Found -and -not [string]::IsNullOrWhiteSpace($occ[$_].Value) -and
            -not (Test-IsBulletCell -Value $occ[$_].Value)
        })
    if ($notBulleted.Count -gt 0) {
        return @{
            Block  = $true
            Reason = "Malformed $tag — value cell(s) not a bullet list: $($notBulleted -join ', '). Each value must be a '$([char]0x2022)' bullet list with one item per line (separate items with <br> in a table cell)."
        }
    }

    # 3. Present fields must appear in the form's fixed row order.
    $presentIndices = @($canonical | Where-Object { $occ[$_].Found } | ForEach-Object { $occ[$_].Index })
    for ($i = 1; $i -lt $presentIndices.Count; $i++) {
        if ($presentIndices[$i] -le $presentIndices[$i - 1]) {
            return @{
                Block  = $true
                Reason = "Malformed $tag — fields out of order. Emit in fixed order: $($canonical -join ', ')."
            }
        }
    }

    # 4. REVIEW.verdict value must be pass | changes-requested.
    if ($tag -eq 'REVIEW' -and ($occ['verdict'].Value -notmatch '(?i)\b(pass|changes-requested)\b')) {
        return @{
            Block  = $true
            Reason = "Malformed REVIEW — verdict must be 'pass' or 'changes-requested' (got '$($occ['verdict'].Value)')."
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
