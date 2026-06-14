#Requires -Version 7.0

<#
.SYNOPSIS
    Validates and normalizes a typed protocol form (REVIEW / RESULT / BRIEF / FINDING /
    FIX / ARTIFACT) as JSON per protocol.md. Single source of validation truth — the
    SendMessage guard (Invoke-ProtocolFormGuard.ps1) dot-sources this with -AsLibrary.

.DESCRIPTION
    Input is a JSON object carrying a "type" discriminator (one of the six forms). The
    structural contract for each form lives as a JSON Schema under
    .claude/team-process/schemas/<form>.schema.json; this script validates the input
    against the matching schema (Test-Json -Schema) plus the one cross-field rule schema
    cannot express (REVIEW: verdict 'pass' <=> zero remarks).

    On success the JSON is NORMALIZED: keys reordered to canonical order, empty optional
    fields dropped, nested objects (spec / failure / remarks[] / options[]) ordered, and
    pretty-printed. Agents write rough JSON, run it through here, and send the stdout
    verbatim as the SendMessage body.

.PARAMETER Text
    The form JSON to validate/normalize (inline string).

.PARAMETER InputFile
    Path to a file holding the form JSON. Preferred over -Text from a shell.

.PARAMETER SchemaDir
    Override the schema directory (tests). Defaults to the repo's
    .claude/team-process/schemas relative to this script.

.PARAMETER AsLibrary
    Define functions without executing the entry block (for Pester / guard reuse).

.EXAMPLE
    # Robust shell flow:
    #   1. Write the form JSON to a file (Write tool or here-string):
    #          { "type": "RESULT", "role": "backend",
    #            "changed": ["GithubActionsAdapter.cs"], "gate": ["build ok", "264/264 tests"] }
    #   2. Normalize it:
    pwsh -NoProfile -File scripts/hooks/Format-ProtocolForm.ps1 -InputFile form.json
    #   3. Send its stdout VERBATIM as the SendMessage body.

.EXAMPLE
    Get-Content form.json -Raw | pwsh -NoProfile -File scripts/hooks/Format-ProtocolForm.ps1
#>

[CmdletBinding()]
param(
    [string]$Text,
    [string]$InputFile,
    [string]$SchemaDir,
    [switch]$AsLibrary
)

# The six typed forms and their canonical top-level key order (type first).
$script:FormKeyOrder = @{
    BRIEF    = @('type', 'spec', 'lane', 'task', 'gate', 'seed')
    RESULT   = @('type', 'role', 'changed', 'gate', 'notes', 'follow', 'block')
    REVIEW   = @('type', 'role', 'scope', 'checked', 'verdict', 'remarks', 'block')
    FINDING  = @('type', 'where', 'issue', 'options', 'need')
    FIX      = @('type', 'failure', 'suspect')
    ARTIFACT = @('type', 'spec', 'delta', 'open')
}

# Optional keys per form — dropped on normalize when empty (null / '' / empty array).
$script:FormOptionalKeys = @{
    BRIEF    = @('seed')
    RESULT   = @('notes', 'follow', 'block')
    REVIEW   = @('remarks', 'block')
    FINDING  = @()
    FIX      = @()
    ARTIFACT = @('open')
}

# Canonical key order for nested objects, keyed by the parent path token.
$script:NestedKeyOrder = @{
    spec    = @('path', 'gate')                # BRIEF.spec
    failure = @('test', 'expect', 'actual')    # FIX.failure
    remark  = @('smell', 'location', 'change') # REVIEW.remarks[] item
    option  = @('id', 'path')                  # FINDING.options[] item
}

function Get-ProtocolSchemaDir {
    param([string]$Override)
    if (-not [string]::IsNullOrWhiteSpace($Override)) { return $Override }
    # scripts/hooks -> repo root -> .claude/team-process/schemas
    return (Join-Path $PSScriptRoot '..' '..' '.claude' 'team-process' 'schemas')
}

# Reorder a PSCustomObject's properties into $keys order; unknown keys appended in
# their original order. Returns an [ordered] hashtable.
function ConvertTo-OrderedByKeys {
    param($Object, [string[]]$Keys)
    $ordered = [ordered]@{}
    $present = @($Object.PSObject.Properties.Name)
    foreach ($k in $Keys) {
        if ($present -contains $k) { $ordered[$k] = $Object.$k }
    }
    foreach ($k in $present) {
        if (-not $ordered.Contains($k)) { $ordered[$k] = $Object.$k }
    }
    return $ordered
}

# True when a field value counts as empty for the drop-optional rule.
function Test-EmptyFormValue {
    param($Value)
    if ($null -eq $Value) { return $true }
    if ($Value -is [string]) { return [string]::IsNullOrWhiteSpace($Value) }
    if ($Value -is [System.Collections.IEnumerable]) {
        return (@($Value).Count -eq 0)
    }
    return $false
}

# Parse + validate a form JSON. Returns a hashtable:
#   Ok (bool), Type (string|null), Object (PSCustomObject|null), Errors (string[]).
function Test-ProtocolJson {
    param(
        [string]$Json,
        [string]$SchemaDir
    )

    $result = @{ Ok = $false; Type = $null; Object = $null; Errors = @() }

    if ([string]::IsNullOrWhiteSpace($Json)) {
        $result.Errors = @('empty message')
        return $result
    }

    # 1. Parse.
    $obj = $null
    try { $obj = $Json | ConvertFrom-Json -ErrorAction Stop }
    catch {
        $result.Errors = @("not valid JSON: $($_.Exception.Message)")
        return $result
    }
    if ($obj -isnot [psobject] -or $obj -is [System.Array]) {
        $result.Errors = @('top level must be a single JSON object')
        return $result
    }
    $result.Object = $obj

    # 2. Discriminator.
    $type = if ($obj.PSObject.Properties.Name -contains 'type') { [string]$obj.type } else { '' }
    $type = $type.ToUpper()
    if (-not $script:FormKeyOrder.ContainsKey($type)) {
        $valid = ($script:FormKeyOrder.Keys | Sort-Object) -join ' / '
        $result.Errors = @("missing or unknown ""type"" (got '$($obj.type)') - must be one of: $valid")
        return $result
    }
    $result.Type = $type
    # Canonicalize the discriminator's casing on the object so a lowercase 'result'
    # validates and normalizes the same as 'RESULT'.
    $obj.type = $type

    # 3. Schema validation (against the case-normalized object).
    $dir = Get-ProtocolSchemaDir -Override $SchemaDir
    $schemaPath = Join-Path $dir ("{0}.schema.json" -f $type.ToLower())
    if (-not (Test-Path -LiteralPath $schemaPath)) {
        $result.Errors = @("schema not found for $type at $schemaPath")
        return $result
    }
    $schema = Get-Content -LiteralPath $schemaPath -Raw
    $jsonForSchema = $obj | ConvertTo-Json -Depth 8
    $schemaErrors = $null
    $ok = $jsonForSchema | Test-Json -Schema $schema -ErrorVariable schemaErrors -ErrorAction SilentlyContinue
    if (-not $ok) {
        $msgs = @($schemaErrors | ForEach-Object { ($_.ToString() -replace '^The JSON is not valid with the schema:\s*', '').Trim() })
        if ($msgs.Count -eq 0) { $msgs = @("does not match the $type schema") }
        $result.Errors = $msgs
        return $result
    }

    # 4. Cross-field rule schema cannot express: REVIEW verdict <-> remarks.
    if ($type -eq 'REVIEW') {
        $remarkCount = if ($obj.PSObject.Properties.Name -contains 'remarks') { @($obj.remarks).Count } else { 0 }
        if ($obj.verdict -eq 'pass' -and $remarkCount -gt 0) {
            $result.Errors = @("verdict 'pass' requires zero remarks (found $remarkCount) - use 'changes-requested'")
            return $result
        }
        if ($obj.verdict -eq 'changes-requested' -and $remarkCount -eq 0) {
            $result.Errors = @("verdict 'changes-requested' requires at least one remark")
            return $result
        }
    }

    $result.Ok = $true
    return $result
}

# Normalize a validated form object: canonical key order, drop empty optionals,
# order nested objects. Returns an [ordered] hashtable ready for ConvertTo-Json.
function ConvertTo-NormalizedForm {
    param($Object, [string]$Type)

    $optional = $script:FormOptionalKeys[$Type]
    $ordered  = ConvertTo-OrderedByKeys -Object $Object -Keys $script:FormKeyOrder[$Type]

    $final = [ordered]@{}
    foreach ($key in $ordered.Keys) {
        $val = $ordered[$key]
        if ($optional -contains $key -and (Test-EmptyFormValue -Value $val)) { continue }

        switch ($key) {
            'spec' {
                # BRIEF.spec is a nested object; ARTIFACT.spec is a plain string.
                if ($val -is [psobject] -and $val -isnot [string]) {
                    $val = ConvertTo-OrderedByKeys -Object $val -Keys $script:NestedKeyOrder.spec
                }
            }
            'failure' {
                $val = ConvertTo-OrderedByKeys -Object $val -Keys $script:NestedKeyOrder.failure
            }
            'remarks' {
                $val = @($val | ForEach-Object { ConvertTo-OrderedByKeys -Object $_ -Keys $script:NestedKeyOrder.remark })
            }
            'options' {
                $val = @($val | ForEach-Object { ConvertTo-OrderedByKeys -Object $_ -Keys $script:NestedKeyOrder.option })
            }
        }
        $final[$key] = $val
    }
    return $final
}

# Entry point — validate then normalize a form JSON string. Throws on invalid input
# with all collected errors joined; returns pretty-printed canonical JSON on success.
function Format-ProtocolForm {
    param(
        [string]$Text,
        [string]$SchemaDir
    )

    $check = Test-ProtocolJson -Json $Text -SchemaDir $SchemaDir
    if (-not $check.Ok) {
        $label = if ($check.Type) { $check.Type } else { 'form' }
        throw "Invalid ${label}: $(($check.Errors) -join '; ')"
    }

    $normalized = ConvertTo-NormalizedForm -Object $check.Object -Type $check.Type
    return ($normalized | ConvertTo-Json -Depth 8)
}

# Resolve the form text from -Text, then -InputFile, then redirected stdin.
function Resolve-FormText {
    param([string]$Text, [string]$InputFile)
    if (-not [string]::IsNullOrWhiteSpace($Text)) { return $Text }
    if (-not [string]::IsNullOrWhiteSpace($InputFile)) {
        if (-not (Test-Path -LiteralPath $InputFile)) { throw "InputFile not found: $InputFile" }
        return (Get-Content -LiteralPath $InputFile -Raw)
    }
    if ([Console]::IsInputRedirected) { return [Console]::In.ReadToEnd() }
    return ''
}

if (-not $AsLibrary) {
    $formText = Resolve-FormText -Text $Text -InputFile $InputFile
    if ([string]::IsNullOrWhiteSpace($formText)) { exit 0 }
    try {
        Format-ProtocolForm -Text $formText -SchemaDir $SchemaDir
    }
    catch {
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 1
    }
    exit 0
}
