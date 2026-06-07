#Requires -Version 7.0

<#
.SYNOPSIS
    PreToolUse(SendMessage) hook — enforces the typed-form Communication protocol
    (process.md). A cross-role hand-back must be one of the six typed forms:
        REVIEW · RESULT · BRIEF · FINDING · FIX · ARTIFACT

    Validates STRUCTURE against the aligned 2-column table format defined in
    process.md "Emitted rendering":
      - Form tag on its own opening line.
      - Field name appears on the FIRST row of that field only; blank field cell
        on continuation rows.
      - Each value cell holds exactly ONE '•' bullet item — no <br> tags, no two
        bullets glued on one line.
      - Every field block is terminated by a full-width dash rule.
      - All table rows must be column-aligned (identical row length).
      - Mandatory fields must be present with a non-empty value.
      - Fields must appear in the form's fixed row order (process.md).
      - REVIEW.verdict must be 'pass' or 'changes-requested'.

    Still shape-only by design (honest limit): it cannot judge whether a `checked`
    row is thorough or a `remarks` entry is correct. Per process.md, EVERY cross-role
    message must be a typed form — so any non-empty string that is not a valid tagged
    form is BLOCKED. Only empty strings and object protocol-response messages pass.

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
        'REVIEW'  { return @('role', 'scope', 'checked', 'verdict', 'remarks', 'block') }
        'RESULT'  { return @('role', 'changed', 'gate', 'notes', 'follow', 'block') }
        'BRIEF'   { return @('spec', 'lane', 'task', 'gate', 'seed') }
        'FINDING' { return @('where', 'issue', 'options', 'need') }
        'FIX'     { return @('test', 'expect', 'actual', 'suspect') }
        'ARTIFACT'{ return @('spec', 'delta', 'open') }
        default   { return @() }
    }
}

# Fields that MUST be present with a value (others may be omitted when empty).
function Get-MandatoryFields {
    param([string]$Form)
    switch ($Form) {
        'REVIEW'  { return @('role', 'scope', 'checked', 'verdict') }
        'RESULT'  { return @('role', 'changed', 'gate') }
        'BRIEF'   { return @('spec', 'lane', 'task', 'gate') }
        'FINDING' { return @('where', 'issue', 'options', 'need') }
        'FIX'     { return @('test', 'expect', 'actual', 'suspect') }
        'ARTIFACT'{ return @('spec', 'delta') }
        default   { return @() }
    }
}

# Parse the aligned table body into an ordered list of fields with their items.
# Returns $null if the body is not in aligned-table format.
#
# Expected table row shapes:
#   | fieldname | • item text |   — first row of a field
#   |           | • item text |   — continuation row (blank first cell)
# Dash rules (lines of '-') delimit field blocks; they are consumed, not stored.
#
# Returns a list of [hashtable] with keys: Name, Items (list of string), HasDashRule.
function Get-AlignedTableFields {
    param([string]$Text)

    $lines  = $Text -split "`r?`n"
    $fields = [System.Collections.Generic.List[hashtable]]::new()
    $current = $null
    $skippedTag = $false
    $hasTableRow = $false

    foreach ($raw in $lines) {
        $ln = $raw.TrimEnd()
        $t  = $ln.Trim()

        # Skip tag line.
        if (-not $skippedTag) {
            if ($t -eq '') { continue }
            $skippedTag = $true
            continue
        }

        if ($t -eq '') { continue }

        # Dash rule — marks end of the current field block.
        if ($t -match '^-+$') {
            if ($null -ne $current) { $current.HasDashRule = $true }
            continue
        }

        # Table row: | cell1 | cell2 |
        if ($ln -match '^\s*\|(?<c1>[^|]*)\|(?<c2>[^|]*)\|') {
            $hasTableRow = $true
            $c1 = $Matches['c1'].Trim()
            $c2 = $Matches['c2'].Trim()

            if ($c1 -ne '') {
                # Non-empty first cell → new field.
                $current = @{
                    Name        = $c1
                    Items       = [System.Collections.Generic.List[string]]::new()
                    HasDashRule = $false
                    RowLength   = $ln.TrimEnd().Length
                }
                [void]$fields.Add($current)
                if ($c2 -ne '') { [void]$current.Items.Add($c2) }
            }
            else {
                # Blank first cell → continuation of current field.
                if ($null -ne $current -and $c2 -ne '') {
                    [void]$current.Items.Add($c2)
                }
            }
            continue
        }
    }

    if (-not $hasTableRow) { return $null }
    # Return the list as a single object (comma operator prevents enumeration).
    , $fields
}

# Validate that a single item cell string is exactly one '•' bullet with content.
# Returns a string describing the violation, or $null if valid.
function Test-BulletCell {
    param([string]$Cell)
    $bullet = [char]0x2022

    # Reject <br> tags — format requires separate rows, not inline breaks.
    if ($Cell -match '(?i)<br') {
        return 'contains a <br> tag — emit each item as a separate table row'
    }

    if (-not $Cell.StartsWith($bullet)) {
        return "does not start with '$bullet' bullet"
    }

    $rest = $Cell.Substring(1)

    # More than one bullet on the line.
    if ($rest.IndexOf($bullet) -ge 0) {
        return 'contains two bullets on one row — emit each item as a separate table row'
    }

    if ($rest.Trim() -eq '') {
        return 'bullet carries no content'
    }

    return $null
}

function Get-SendMessageText {
    param($ToolInput)
    if ($null -eq $ToolInput) { return '' }
    $m = $ToolInput.message
    if ($null -eq $m) { return '' }
    if ($m -is [string]) { return $m }
    return ''   # object messages (legacy protocol responses) are not validated
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
            Reason = 'Free-prose cross-role message — not permitted. Every cross-role message MUST be one of the six typed forms (REVIEW / RESULT / BRIEF / FINDING / FIX / ARTIFACT), opened with the form name on its own line. Informal prose is returned UNREAD (process.md Communication protocol). Re-emit in the correct typed form.'
        }
    }

    $canonical  = Get-CanonicalFields  -Form $tag
    $mandatory  = Get-MandatoryFields  -Form $tag
    $fields     = Get-AlignedTableFields -Text $Text

    # No table rows found — body is prose or not in the aligned table format.
    if ($null -eq $fields) {
        return @{
            Block  = $true
            Reason = "Malformed $tag — body must be an aligned 2-column table (process.md 'Emitted rendering'). Use Format-ProtocolForm.ps1 to render the form."
        }
    }

    # Build lookup by field name.
    $occ = @{}
    foreach ($f in $fields) { $occ[$f.Name] = $f }

    # 1. Mandatory fields must each be present as a table row with at least one item.
    $missing = @($mandatory | Where-Object { -not $occ.ContainsKey($_) -or $occ[$_].Items.Count -eq 0 })
    if ($missing.Count -gt 0) {
        return @{
            Block  = $true
            Reason = "Malformed $tag — missing required field row(s): $($missing -join ', '). Emit each as a table row '| field | • value |' with field name in the first cell."
        }
    }

    # 2. Each item cell in every present field must be exactly one '•' bullet.
    foreach ($f in $fields) {
        foreach ($item in $f.Items) {
            $violation = Test-BulletCell -Cell $item
            if ($null -ne $violation) {
                return @{
                    Block  = $true
                    Reason = "Malformed $tag — field '$($f.Name)' value cell $violation. Each cell must hold exactly one '$([char]0x2022)' bullet item; use a separate row per item."
                }
            }
        }
    }

    # 3. Every field block must be terminated by a dash rule.
    $missingDash = @($fields | Where-Object { -not $_.HasDashRule } | ForEach-Object { $_.Name })
    if ($missingDash.Count -gt 0) {
        return @{
            Block  = $true
            Reason = "Malformed $tag — field block(s) missing dash rule terminator: $($missingDash -join ', '). Add a full-width '---...' rule after each field block."
        }
    }

    # 4. All table rows must be column-aligned (same row length).
    $lines     = $Text -split "`r?`n"
    $tableRows = @($lines | Where-Object { $_ -match '^\s*\|[^|]*\|[^|]*\|' })
    if ($tableRows.Count -gt 0) {
        $widths = @($tableRows | ForEach-Object { $_.TrimEnd().Length } | Sort-Object -Unique)
        if ($widths.Count -gt 1) {
            return @{
                Block  = $true
                Reason = "Malformed $tag — table rows are not column-aligned (found row lengths: $($widths -join ', ')). Use Format-ProtocolForm.ps1 to produce auto-padded aligned output."
            }
        }
    }

    # 5. Present fields must appear in the form's fixed row order.
    # Verify that the order in the parsed fields list matches canonical order.
    $parsedNames    = @($fields | ForEach-Object { $_.Name })
    $canonicalSlice = @($canonical | Where-Object { $occ.ContainsKey($_) })
    for ($i = 0; $i -lt $canonicalSlice.Count; $i++) {
        if ($i -lt $parsedNames.Count -and $parsedNames[$i] -ne $canonicalSlice[$i]) {
            return @{
                Block  = $true
                Reason = "Malformed $tag — fields out of order. Emit in fixed order: $($canonical -join ' → ')."
            }
        }
    }

    # 6. REVIEW.verdict value must be pass | changes-requested.
    if ($tag -eq 'REVIEW') {
        $verdictField = $occ['verdict']
        $verdictVal   = if ($verdictField -and $verdictField.Items.Count -gt 0) { $verdictField.Items[0] } else { '' }
        if ($verdictVal -notmatch '(?i)\b(pass|changes-requested)\b') {
            return @{
                Block  = $true
                Reason = "Malformed REVIEW — verdict must be 'pass' or 'changes-requested' (got '$verdictVal')."
            }
        }
    }

    return @{ Block = $false }
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
