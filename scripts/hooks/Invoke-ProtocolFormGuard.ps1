#Requires -Version 7.0

<#
.SYNOPSIS
    PreToolUse(SendMessage) hook — enforces the JSON Communication protocol
    (protocol.md). A cross-role hand-back must be one of the six typed forms:
        REVIEW · RESULT · BRIEF · FINDING · FIX · ARTIFACT
    serialized as a JSON object carrying a "type" discriminator.

.DESCRIPTION
    Validation is single-sourced: this hook dot-sources Format-ProtocolForm.ps1 with
    -AsLibrary and calls Test-ProtocolJson, which validates the message against the
    matching JSON Schema (.claude/team-process/schemas/<form>.schema.json) plus the
    cross-field REVIEW rule. The schema enforces: known "type", required fields present,
    no extra/renamed fields (additionalProperties:false), correct value types, array
    fields are arrays, nested shapes (spec / failure / remarks[] / options[]), and the
    REVIEW.verdict enum.

    Key order, discriminator casing, and empty optional fields are NOT enforced — JSON is
    order-insensitive and the normalizer canonicalizes those cosmetically. Only semantic
    validity is blocked on.

    Honest limit: it judges STRUCTURE, not substance — it cannot tell whether a `checked`
    walk is thorough or a `remarks` entry is correct. Per protocol.md, EVERY cross-role
    message must be a typed form — so any non-empty string that is not a valid typed-form
    JSON object is BLOCKED. Empty strings and object (non-string) messages pass.

.PARAMETER AsLibrary
    Define functions without executing entry block (for Pester).
#>

[CmdletBinding()]
param([switch]$AsLibrary)

# Capture our own -AsLibrary state BEFORE dot-sourcing: that dot-source binds the
# sourced script's own [switch]$AsLibrary into THIS shared scope, which would otherwise
# clobber $AsLibrary to $true and silently skip our entry block.
$guardAsLibrary = [bool]$AsLibrary

# Reuse the single source of validation truth (Test-ProtocolJson + schema loading).
. (Join-Path $PSScriptRoot 'Format-ProtocolForm.ps1') -AsLibrary

# Copy-pasteable recipe appended to every block reason, so an agent never has to guess
# the form shape or the normalizer invocation. Kept DRY in one place.
function Get-RenderRecipe {
    $script = 'scripts/hooks/Format-ProtocolForm.ps1'
    return @"
Every cross-role message MUST be one of the six typed forms as a JSON object with a "type" field: REVIEW / RESULT / BRIEF / FINDING / FIX / ARTIFACT (fields + examples in .claude/team-process/protocol.md; schemas in .claude/team-process/schemas/). Build it: (1) write the form JSON to a temp file. (2) Normalize + validate: pwsh -NoProfile -File $script -InputFile <file>. (3) Send its stdout VERBATIM as the message. Free prose is returned UNREAD.
"@.Trim()
}

# Extract the SendMessage text payload. Object messages (legacy protocol responses,
# shutdown signals) are not string hand-backs and flatten to '' (not validated).
function Get-SendMessageText {
    param($ToolInput)
    if ($null -eq $ToolInput) { return '' }
    $m = $ToolInput.message
    if ($null -eq $m) { return '' }
    if ($m -is [string]) { return $m }
    return ''
}

function Get-ProtocolFormDecision {
    param(
        [string]$Text,
        [string]$SchemaDir
    )
    # Empty / whitespace — includes object protocol-response messages flattened to ''.
    # Not a cross-role hand-back; allow.
    if ([string]::IsNullOrWhiteSpace($Text)) { return @{ Block = $false } }

    $check = Test-ProtocolJson -Json $Text -SchemaDir $SchemaDir
    if ($check.Ok) { return @{ Block = $false } }

    $label  = if ($check.Type) { $check.Type } else { 'cross-role message' }
    $errors = ($check.Errors) -join '; '
    return @{
        Block  = $true
        Reason = "Malformed $label - $errors. $(Get-RenderRecipe)"
    }
}

if (-not $guardAsLibrary) {
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
