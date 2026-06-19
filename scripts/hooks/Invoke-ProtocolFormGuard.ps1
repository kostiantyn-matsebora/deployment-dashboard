#Requires -Version 7.0

<#
.SYNOPSIS
    PreToolUse(SendMessage | Edit|Write|MultiEdit) hook — enforces the JSON Communication
    protocol (protocol.md). A cross-role message must be one of the six typed forms:
        REVIEW · RESULT · BRIEF · FINDING · FIX · ARTIFACT
    serialized as a JSON object carrying a "type" discriminator.

    Both directions are file + pointer, symmetric across two session boxes:
      - inbox  — dispatch (orch → member): BRIEF / FIX.
      - outbox — hand-back (member → orch): RESULT / REVIEW / FINDING / ARTIFACT.

    Two enforcement points:
      - SendMessage: the message body is a typed form, or a { type, ref } pointer whose
        referenced inbox/outbox file is a typed form.
      - Write into a session inbox/outbox: the written file MUST already be a valid
        typed-form JSON — not prose / markdown / a .txt dump. Closes the gap where a task
        or result is parked as text in a box (the SendMessage guard fires later, and only
        if a pointer is ever sent).

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

# A file-based message is sent as a POINTER: { "type": "<FORM>", "ref": "<path to the
# inbox/outbox file>" }. The full typed form lives in the file (durable, in the session
# dir); the SendMessage just wakes the peer. Presence of a "ref" key = pointer intent.
function Get-PointerInfo {
    param([string]$Text)
    $info = @{ IsPointer = $false; Type = ''; Ref = ''; ExtraKeys = @() }
    if ([string]::IsNullOrWhiteSpace($Text)) { return $info }
    $o = $null
    try { $o = $Text | ConvertFrom-Json -ErrorAction Stop } catch { return $info }
    if ($null -eq $o -or $o -is [System.Array] -or $o -isnot [psobject]) { return $info }
    $names = @($o.PSObject.Properties.Name)
    if ($names -notcontains 'ref') { return $info }
    $info.IsPointer = $true
    $info.Type      = if ($names -contains 'type') { [string]$o.type } else { '' }
    $info.Ref       = [string]$o.ref
    $info.ExtraKeys = @($names | Where-Object { $_ -notin @('type', 'ref') })
    return $info
}

# A pointer 'ref' (or box write) must resolve INSIDE a session inbox (dispatch: BRIEF/FIX)
# or outbox (hand-back: RESULT/REVIEW/FINDING/ARTIFACT) — never an arbitrary file. Tested
# on the canonicalized (..-collapsed) absolute path.
function Test-RefInSessionBox {
    param([string]$Path)
    $p = ([string]$Path -replace '\\', '/')
    return ($p -match '/\.team-process/sessions/[^/]+/(inbox|outbox)/[^/]')
}

function Get-ProtocolFormDecision {
    param(
        [string]$Text,
        [string]$SchemaDir,
        [string]$Root
    )
    # Empty / whitespace — includes object protocol-response messages flattened to ''.
    # Not a cross-role hand-back; allow.
    if ([string]::IsNullOrWhiteSpace($Text)) { return @{ Block = $false } }

    # Pointer message: validate the REFERENCED inbox/outbox file, not the message.
    $ptr = Get-PointerInfo -Text $Text
    if ($ptr.IsPointer) {
        if ($ptr.ExtraKeys.Count -gt 0) {
            return @{ Block = $true; Reason = "A file-based pointer must be exactly { type, ref } - remove: $($ptr.ExtraKeys -join ', '). $(Get-RenderRecipe)" }
        }
        if ([string]::IsNullOrWhiteSpace($ptr.Ref)) {
            return @{ Block = $true; Reason = "Pointer 'ref' is empty - set it to the absolute path of the inbox/outbox form file. $(Get-RenderRecipe)" }
        }
        $path = $ptr.Ref
        if (-not [System.IO.Path]::IsPathRooted($path) -and -not [string]::IsNullOrWhiteSpace($Root)) {
            $path = Join-Path $Root $path
        }
        # Canonicalize (collapses any '..') and require the result to live inside a session
        # inbox/outbox. Binds the pointer to the session tree: no arbitrary-file read /
        # confused deputy, and no traversal out of the box.
        $full = $null
        try { $full = [System.IO.Path]::GetFullPath($path) } catch { $full = $null }
        if (-not $full -or -not (Test-RefInSessionBox -Path $full)) {
            return @{ Block = $true; Reason = "Pointer 'ref' must resolve to a file under .team-process/sessions/<id>/{inbox,outbox}/ - got '$($ptr.Ref)'. $(Get-RenderRecipe)" }
        }
        if (-not (Test-Path -LiteralPath $full)) {
            return @{ Block = $true; Reason = "Pointer 'ref' not found: '$($ptr.Ref)'. Write the typed form to the session box first, then point at it. $(Get-RenderRecipe)" }
        }
        $path = $full
        $content = Get-Content -LiteralPath $path -Raw
        $fcheck  = Test-ProtocolJson -Json $content -SchemaDir $SchemaDir
        if (-not $fcheck.Ok) {
            $label = if ($fcheck.Type) { $fcheck.Type } else { 'referenced form' }
            return @{ Block = $true; Reason = "Malformed $label at '$($ptr.Ref)' - $(($fcheck.Errors) -join '; '). $(Get-RenderRecipe)" }
        }
        if ($ptr.Type -and $fcheck.Type -and ($ptr.Type.ToUpper() -ne $fcheck.Type.ToUpper())) {
            return @{ Block = $true; Reason = "Pointer type '$($ptr.Type)' does not match the referenced form '$($fcheck.Type)'. $(Get-RenderRecipe)" }
        }
        return @{ Block = $false }
    }

    $check = Test-ProtocolJson -Json $Text -SchemaDir $SchemaDir
    if ($check.Ok) { return @{ Block = $false } }

    $label  = if ($check.Type) { $check.Type } else { 'cross-role message' }
    $errors = ($check.Errors) -join '; '
    return @{
        Block  = $true
        Reason = "Malformed $label - $errors. $(Get-RenderRecipe)"
    }
}

# PreToolUse(Write) whose target is a session inbox/outbox file — the content being written
# MUST already be a valid typed-form JSON, not prose/markdown/text. This rejects the "cheat"
# of dropping a free-text task or result into a box at WRITE time, before any pointer is sent.
# A non-box write, or an Edit/MultiEdit (no full content body to validate), is allowed here —
# the SendMessage pointer guard still validates the final referenced file.
function Get-SessionBoxWriteDecision {
    param(
        [string]$FilePath,
        $Content,
        [string]$SchemaDir,
        [string]$Root
    )
    if ([string]::IsNullOrWhiteSpace($FilePath)) { return @{ Block = $false } }
    $path = $FilePath
    if (-not [System.IO.Path]::IsPathRooted($path) -and -not [string]::IsNullOrWhiteSpace($Root)) {
        $path = Join-Path $Root $path
    }
    $full = $null
    try { $full = [System.IO.Path]::GetFullPath($path) } catch { $full = $null }
    # Not a box write — not this guard's concern (lane guard / lead-edit guard own it).
    if (-not $full -or -not (Test-RefInSessionBox -Path $full)) { return @{ Block = $false } }
    # No content body (Edit / MultiEdit) — can't validate pre-write; the pointer guard will.
    if ($null -eq $Content -or $Content -isnot [string]) { return @{ Block = $false } }
    $check = Test-ProtocolJson -Json $Content -SchemaDir $SchemaDir
    if ($check.Ok) { return @{ Block = $false } }
    $label  = if ($check.Type) { $check.Type } else { 'session box form' }
    $errors = ($check.Errors) -join '; '
    return @{
        Block  = $true
        Reason = "A session inbox/outbox file must be a valid typed-form JSON, not prose/markdown/text. Malformed $label - $errors. $(Get-RenderRecipe)"
    }
}

if (-not $guardAsLibrary) {
    $hookInputJson = ''
    if ([Console]::IsInputRedirected) {
        try { $hookInputJson = [Console]::In.ReadToEnd() } catch { $hookInputJson = '' }
    }

    $payload  = $null
    $toolName = ''
    if (-not [string]::IsNullOrWhiteSpace($hookInputJson)) {
        try {
            $payload  = $hookInputJson | ConvertFrom-Json -ErrorAction Stop
            $toolName = [string]$payload.tool_name
        }
        catch { $null = $_ }
    }

    # Root resolves a relative pointer 'ref' / file_path (absolute refs are cross-worktree).
    $root = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
    if (-not $root) { $root = (Get-Location).Path }
    $root = ([string]$root).Trim()

    # Two enforcement points keyed on the tool: Write into an inbox/outbox validates the
    # written content; everything else is treated as a SendMessage message (text or pointer).
    if ($toolName -in @('Write', 'Edit', 'MultiEdit') -and $payload.tool_input) {
        $decision = Get-SessionBoxWriteDecision -FilePath ([string]$payload.tool_input.file_path) `
            -Content $payload.tool_input.content -Root $root
    }
    else {
        $text = if ($payload) { Get-SendMessageText -ToolInput $payload.tool_input } else { '' }
        $decision = Get-ProtocolFormDecision -Text $text -Root $root
    }

    if ($decision.Block) {
        $json = @{ decision = 'block'; reason = $decision.Reason } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
    }

    exit 0
}
