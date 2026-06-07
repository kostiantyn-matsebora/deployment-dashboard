#Requires -Version 7.0

<#
.SYNOPSIS
    Renders a typed protocol form (REVIEW / RESULT / BRIEF / FINDING / FIX / ARTIFACT)
    as an aligned 2-column table per process.md "Emitted rendering".

.DESCRIPTION
    Input is a simple form text:
        Line 1:     the form tag (e.g. RESULT)
        Subsequent: field lines and indented bullet lines, e.g.
                        role: backend
                        changed:
                          PollLoop.cs
                          ControlStream.cs
                        gate: build ok

    Field lines are detected as "<fieldname>:" (with or without a same-line value).
    Bullet items are lines following a field header (indented or blank-separated),
    or the same-line value of a field header. Each item becomes one row.

    Output layout:
        RESULT
        | role    | • backend       |
        ---------------------------------
        | changed | • PollLoop.cs   |
        |         | • ControlStream |
        ---------------------------------
        | gate    | • build ok      |
        ---------------------------------

    Rules:
      - Field name appears on its first row only; blank on continuation rows.
      - One bullet item per row (• prefix added if absent).
      - Columns auto-padded so every | lines up.
      - Full-width dash rule after each field block.

.PARAMETER Text
    The simple form text to render.

.PARAMETER AsLibrary
    Define functions without executing entry block (for Pester).
#>

[CmdletBinding()]
param(
    [string]$Text,
    [switch]$AsLibrary
)

# Parse a simple form into an ordered list of [field, items[]] pairs.
# Each item is a string (without leading bullet — caller adds it).
function ConvertTo-FormFields {
    param([string]$Text)

    $lines   = $Text -split "`r?`n"
    $fields  = [System.Collections.Generic.List[hashtable]]::new()
    $current = $null

    # Skip the tag line (first non-empty line).
    $skippedTag = $false

    foreach ($raw in $lines) {
        $ln = $raw.TrimEnd()

        if (-not $skippedTag) {
            $t = $ln.Trim()
            if ($t -eq '') { continue }
            # First non-empty line is the tag — skip it.
            $skippedTag = $true
            continue
        }

        $t = $ln.Trim()
        if ($t -eq '') { continue }

        # Field header: "fieldname:" optionally followed by a same-line value.
        if ($t -match '^(?<name>[a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?<val>.*)$') {
            $name = $Matches['name']
            $val  = $Matches['val'].Trim()
            $current = @{ Name = $name; Items = [System.Collections.Generic.List[string]]::new() }
            [void]$fields.Add($current)
            if ($val -ne '') {
                # Strip leading bullet if already present.
                $item = $val -replace '^[•\*\-]\s*', ''
                if ($item -ne '') { [void]$current.Items.Add($item) }
            }
            continue
        }

        # Continuation / bullet line under the current field.
        if ($null -ne $current) {
            $item = $t -replace '^[•\*\-]\s*', ''
            if ($item -ne '') { [void]$current.Items.Add($item) }
        }
    }

    Write-Output -NoEnumerate $fields
}

# Render parsed fields as the aligned 2-column table.
function Format-FieldTable {
    param(
        [System.Collections.Generic.List[hashtable]]$Fields,
        [string]$Tag
    )

    $bullet = [char]0x2022

    # Build a flat list of rows: [fieldName, itemText] — fieldName blank on continuation.
    $rows = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($f in $Fields) {
        $items = if ($f.Items.Count -gt 0) { $f.Items } else { @('') }
        $first = $true
        foreach ($item in $items) {
            [void]$rows.Add(@{
                Field = if ($first) { $f.Name } else { '' }
                Item  = if ($item -ne '') { "$bullet $item" } else { '' }
            })
            $first = $false
        }
    }

    if ($rows.Count -eq 0) {
        return $Tag
    }

    # Column widths.
    $fieldW = ($rows | ForEach-Object { $_.Field.Length } | Measure-Object -Maximum).Maximum
    $itemW  = ($rows | ForEach-Object { $_.Item.Length  } | Measure-Object -Maximum).Maximum

    # Minimum useful widths.
    if ($fieldW -lt 4) { $fieldW = 4 }
    if ($itemW  -lt 4) { $itemW  = 4 }

    # Full-width dash rule: "| field-pad | item-pad |"
    # Total row length: 2 (| + space) + fieldW + 3 ( + space + | + space) + itemW + 2 (space + |)
    $totalWidth = 2 + $fieldW + 3 + $itemW + 2
    $dashRule   = '-' * $totalWidth

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine($Tag)

    # Track field boundaries to emit dash rules.
    $fieldIndex = 0
    $fieldBoundaryRows = [System.Collections.Generic.List[int]]::new()
    foreach ($f in $Fields) {
        $count = if ($f.Items.Count -gt 0) { $f.Items.Count } else { 1 }
        $fieldIndex += $count
        [void]$fieldBoundaryRows.Add($fieldIndex - 1)
    }

    for ($i = 0; $i -lt $rows.Count; $i++) {
        $r         = $rows[$i]
        $fieldCell = $r.Field.PadRight($fieldW)
        $itemCell  = $r.Item.PadRight($itemW)
        [void]$sb.AppendLine("| $fieldCell | $itemCell |")
        if ($fieldBoundaryRows.Contains($i)) {
            [void]$sb.AppendLine($dashRule)
        }
    }

    # Remove the trailing newline added by the last AppendLine.
    return $sb.ToString().TrimEnd("`r", "`n")
}

# Entry point — render a simple form text to an aligned table string.
function Format-ProtocolForm {
    param([string]$Text)

    $lines = $Text -split "`r?`n"
    $tag   = $null
    foreach ($ln in $lines) {
        $t = $ln.Trim()
        if ($t -eq '') { continue }
        if ($t -match '^#?\s*(REVIEW|RESULT|BRIEF|FINDING|FIX|ARTIFACT)\b') {
            $tag = $Matches[1].ToUpper()
        }
        break
    }

    if (-not $tag) {
        # No recognized tag — return as-is.
        return $Text
    }

    $fields = ConvertTo-FormFields -Text $Text
    return Format-FieldTable -Fields $fields -Tag $tag
}

if (-not $AsLibrary) {
    if (-not [string]::IsNullOrWhiteSpace($Text)) {
        Format-ProtocolForm -Text $Text
    }
}
