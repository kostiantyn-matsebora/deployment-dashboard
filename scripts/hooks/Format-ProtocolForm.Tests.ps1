#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Format-ProtocolForm.ps1')).Path
    . $script:ScriptPath -AsLibrary

    # Real schema dir (functions default here too; passed explicitly for clarity).
    $script:SchemaDir = (Resolve-Path (Join-Path $PSScriptRoot '..' '..' '.claude' 'team-process' 'schemas')).Path

    function New-FormJson { param($Obj) $Obj | ConvertTo-Json -Depth 10 }

    $script:ResultObj = [ordered]@{
        type = 'RESULT'; role = 'backend'
        changed = @('A.cs', 'B.cs'); gate = @('build ok', '264/264 tests')
    }
    $script:ReviewPassObj = [ordered]@{
        type = 'REVIEW'; role = 'backend'; scope = @('B.cs')
        checked = @('Run() x SRP'); verdict = 'pass'
    }
    $script:ReviewChangesObj = [ordered]@{
        type = 'REVIEW'; role = 'backend'; scope = @('B.cs'); checked = @('Run() x SRP')
        verdict = 'changes-requested'
        remarks = @(@{ smell = 'S1541'; location = 'B.cs:42'; change = 'extract' })
    }
    $script:BriefObj = [ordered]@{
        type = 'BRIEF'; spec = @{ path = 'docs/x#y'; gate = 'tile shows badge' }
        lane = @('frontend/**'); task = 'do it'; gate = @('build', 'unit')
    }
    $script:FindingObj = [ordered]@{
        type = 'FINDING'; where = 'openapi.yaml#errors'; issue = 'contradiction'
        options = @(@{ id = 'a'; path = '409' }, @{ id = 'b'; path = '422' }); need = 'which?'
    }
    $script:FixObj = [ordered]@{
        type = 'FIX'; failure = @{ test = 't'; expect = 'e'; actual = 'a' }; suspect = 's.cs'
    }
    $script:ArtifactObj = [ordered]@{
        type = 'ARTIFACT'; spec = 'docs/api/openapi.yaml'; delta = @('GET /things')
    }
}

# ============================================================
Describe 'Test-ProtocolJson — valid forms pass' {

    It 'accepts a well-formed RESULT' {
        (Test-ProtocolJson -Json (New-FormJson $script:ResultObj) -SchemaDir $script:SchemaDir).Ok | Should -BeTrue
    }
    It 'accepts a REVIEW with pass verdict and no remarks' {
        (Test-ProtocolJson -Json (New-FormJson $script:ReviewPassObj) -SchemaDir $script:SchemaDir).Ok | Should -BeTrue
    }
    It 'accepts a REVIEW changes-requested with nested remarks' {
        (Test-ProtocolJson -Json (New-FormJson $script:ReviewChangesObj) -SchemaDir $script:SchemaDir).Ok | Should -BeTrue
    }
    It 'accepts a BRIEF with nested spec' {
        (Test-ProtocolJson -Json (New-FormJson $script:BriefObj) -SchemaDir $script:SchemaDir).Ok | Should -BeTrue
    }
    It 'accepts a FINDING with nested options' {
        (Test-ProtocolJson -Json (New-FormJson $script:FindingObj) -SchemaDir $script:SchemaDir).Ok | Should -BeTrue
    }
    It 'accepts a FIX with nested failure' {
        (Test-ProtocolJson -Json (New-FormJson $script:FixObj) -SchemaDir $script:SchemaDir).Ok | Should -BeTrue
    }
    It 'accepts an ARTIFACT' {
        (Test-ProtocolJson -Json (New-FormJson $script:ArtifactObj) -SchemaDir $script:SchemaDir).Ok | Should -BeTrue
    }
    It 'normalizes a lowercase type discriminator' {
        $obj = [ordered]@{ type = 'result'; role = 'backend'; changed = @('A.cs'); gate = @('ok') }
        $r = Test-ProtocolJson -Json (New-FormJson $obj) -SchemaDir $script:SchemaDir
        $r.Ok | Should -BeTrue
        $r.Type | Should -Be 'RESULT'
    }
}

# ============================================================
Describe 'Test-ProtocolJson — invalid forms block' {

    It 'rejects non-JSON text' {
        $r = Test-ProtocolJson -Json 'Please re-run iteration 2.' -SchemaDir $script:SchemaDir
        $r.Ok | Should -BeFalse
        $r.Errors -join ' ' | Should -Match 'JSON'
    }
    It 'rejects a JSON array at top level' {
        $r = Test-ProtocolJson -Json '[1,2,3]' -SchemaDir $script:SchemaDir
        $r.Ok | Should -BeFalse
        $r.Errors -join ' ' | Should -Match 'single JSON object'
    }
    It 'rejects an unknown type' {
        $r = Test-ProtocolJson -Json '{ "type": "MEMO", "x": 1 }' -SchemaDir $script:SchemaDir
        $r.Ok | Should -BeFalse
        $r.Errors -join ' ' | Should -Match 'type'
    }
    It 'rejects a RESULT missing a mandatory field (changed)' {
        $obj = [ordered]@{ type = 'RESULT'; role = 'backend'; gate = @('ok') }
        (Test-ProtocolJson -Json (New-FormJson $obj) -SchemaDir $script:SchemaDir).Ok | Should -BeFalse
    }
    It 'rejects an extra/renamed field (additionalProperties:false)' {
        $obj = [ordered]@{ type = 'FIX'; failure = @{ test = 't'; expect = 'e'; actual = 'a' }; suspect = 's'; bogus = 1 }
        $r = Test-ProtocolJson -Json (New-FormJson $obj) -SchemaDir $script:SchemaDir
        $r.Ok | Should -BeFalse
        $r.Errors -join ' ' | Should -Match 'bogus'
    }
    It 'rejects a scalar where an array is required (changed)' {
        $r = Test-ProtocolJson -Json '{ "type":"RESULT","role":"backend","changed":"A.cs","gate":["ok"] }' -SchemaDir $script:SchemaDir
        $r.Ok | Should -BeFalse
    }
    It 'rejects an invalid role enum value' {
        $obj = [ordered]@{ type = 'RESULT'; role = 'wizard'; changed = @('A.cs'); gate = @('ok') }
        (Test-ProtocolJson -Json (New-FormJson $obj) -SchemaDir $script:SchemaDir).Ok | Should -BeFalse
    }
    It 'rejects a REVIEW with an invalid verdict' {
        $obj = [ordered]@{ type = 'REVIEW'; role = 'backend'; scope = @('B.cs'); checked = @('x'); verdict = 'maybe' }
        (Test-ProtocolJson -Json (New-FormJson $obj) -SchemaDir $script:SchemaDir).Ok | Should -BeFalse
    }
    It 'rejects a remark missing a nested key (change)' {
        $obj = [ordered]@{
            type = 'REVIEW'; role = 'backend'; scope = @('B.cs'); checked = @('x')
            verdict = 'changes-requested'; remarks = @(@{ smell = 'S1541'; location = 'B.cs:42' })
        }
        $r = Test-ProtocolJson -Json (New-FormJson $obj) -SchemaDir $script:SchemaDir
        $r.Ok | Should -BeFalse
        $r.Errors -join ' ' | Should -Match 'change'
    }
    It 'rejects a FINDING with fewer than two options' {
        $obj = [ordered]@{ type = 'FINDING'; where = 'x'; issue = 'contradiction'; options = @(@{ id = 'a'; path = 'p' }); need = 'n' }
        (Test-ProtocolJson -Json (New-FormJson $obj) -SchemaDir $script:SchemaDir).Ok | Should -BeFalse
    }
}

# ============================================================
Describe 'Test-ProtocolJson — REVIEW cross-field rule (verdict vs remarks)' {

    It 'rejects verdict pass with remarks present' {
        $obj = [ordered]@{
            type = 'REVIEW'; role = 'backend'; scope = @('B.cs'); checked = @('x'); verdict = 'pass'
            remarks = @(@{ smell = 'a'; location = 'b'; change = 'c' })
        }
        $r = Test-ProtocolJson -Json (New-FormJson $obj) -SchemaDir $script:SchemaDir
        $r.Ok | Should -BeFalse
        $r.Errors -join ' ' | Should -Match 'zero remarks'
    }
    It 'rejects verdict changes-requested with no remarks' {
        $obj = [ordered]@{ type = 'REVIEW'; role = 'backend'; scope = @('B.cs'); checked = @('x'); verdict = 'changes-requested' }
        $r = Test-ProtocolJson -Json (New-FormJson $obj) -SchemaDir $script:SchemaDir
        $r.Ok | Should -BeFalse
        $r.Errors -join ' ' | Should -Match 'at least one remark'
    }
}

# ============================================================
Describe 'ConvertTo-OrderedByKeys / Test-EmptyFormValue' {

    It 'orders known keys first and appends unknown keys' {
        $o = [pscustomobject]@{ gate = 'g'; type = 'RESULT'; extra = 'x'; role = 'backend' }
        $ordered = ConvertTo-OrderedByKeys -Object $o -Keys @('type', 'role', 'gate')
        @($ordered.Keys) | Should -Be @('type', 'role', 'gate', 'extra')
    }
    It 'treats null, empty string, and empty array as empty' {
        Test-EmptyFormValue -Value $null | Should -BeTrue
        Test-EmptyFormValue -Value '' | Should -BeTrue
        Test-EmptyFormValue -Value @() | Should -BeTrue
    }
    It 'treats non-empty values as non-empty' {
        Test-EmptyFormValue -Value 'x' | Should -BeFalse
        Test-EmptyFormValue -Value @('a') | Should -BeFalse
    }
}

# ============================================================
Describe 'Format-ProtocolForm — normalization' {

    It 'reorders top-level keys to canonical order' {
        $messy = '{ "gate":["ok"], "type":"RESULT", "changed":["A.cs"], "role":"backend" }'
        $out = Format-ProtocolForm -Text $messy -SchemaDir $script:SchemaDir
        $obj = $out | ConvertFrom-Json
        @($obj.PSObject.Properties.Name) | Should -Be @('type', 'role', 'changed', 'gate')
    }
    It 'drops empty optional array fields (notes/follow)' {
        # Empty optional arrays are schema-valid; the normalizer drops them.
        # (Empty optional SCALARS like block:"" are rejected by schema minLength, not dropped.)
        $obj = [ordered]@{ type = 'RESULT'; role = 'backend'; changed = @('A.cs'); gate = @('ok'); notes = @(); follow = @() }
        $out = Format-ProtocolForm -Text (New-FormJson $obj) -SchemaDir $script:SchemaDir
        $names = @(($out | ConvertFrom-Json).PSObject.Properties.Name)
        $names | Should -Not -Contain 'notes'
        $names | Should -Not -Contain 'follow'
    }
    It 'orders nested spec keys (path before gate)' {
        $obj = [ordered]@{ type = 'BRIEF'; spec = @{ gate = 'g'; path = 'p' }; lane = @('x/**'); task = 't'; gate = @('build') }
        $out = Format-ProtocolForm -Text (New-FormJson $obj) -SchemaDir $script:SchemaDir
        $spec = ($out | ConvertFrom-Json).spec
        @($spec.PSObject.Properties.Name) | Should -Be @('path', 'gate')
    }
    It 'orders nested remark keys (smell, location, change)' {
        $obj = [ordered]@{
            type = 'REVIEW'; role = 'backend'; scope = @('B.cs'); checked = @('x'); verdict = 'changes-requested'
            remarks = @(@{ change = 'c'; location = 'l'; smell = 's' })
        }
        $out = Format-ProtocolForm -Text (New-FormJson $obj) -SchemaDir $script:SchemaDir
        $remark = ($out | ConvertFrom-Json).remarks[0]
        @($remark.PSObject.Properties.Name) | Should -Be @('smell', 'location', 'change')
    }
    It 'throws on invalid input with a descriptive message' {
        { Format-ProtocolForm -Text '{ "type":"RESULT" }' -SchemaDir $script:SchemaDir } |
            Should -Throw '*Invalid RESULT*'
    }
}

# ============================================================
Describe 'Resolve-FormText — input source resolution' {

    It 'prefers -Text over -InputFile' {
        Resolve-FormText -Text 'inline' -InputFile 'does-not-exist.json' | Should -Be 'inline'
    }
    It 'reads from -InputFile when -Text is empty' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "form-$([System.IO.Path]::GetRandomFileName()).json"
        try {
            Set-Content -LiteralPath $tmp -Value '{ "type":"RESULT" }' -NoNewline
            Resolve-FormText -Text '' -InputFile $tmp | Should -Match '"type":"RESULT"'
        }
        finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
    It 'throws a clear error when -InputFile does not exist' {
        { Resolve-FormText -Text '' -InputFile 'C:\nope\missing-form.json' } | Should -Throw '*InputFile not found*'
    }
}

# ============================================================
Describe 'Format-ProtocolForm.ps1 — -InputFile end to end (real process)' {

    It 'normalizes a valid form from a file via the script entry point' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "form-$([System.IO.Path]::GetRandomFileName()).json"
        try {
            Set-Content -LiteralPath $tmp -Value '{ "gate":["build ok"], "type":"result", "changed":["a.cs"], "role":"backend" }' -NoNewline
            $out = (pwsh -NoProfile -File $script:ScriptPath -InputFile $tmp) -join "`n"
            $LASTEXITCODE | Should -Be 0
            $out | Should -Match '"type": "RESULT"'
        }
        finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }

    It 'exits non-zero and writes the error to stderr on invalid input' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "form-$([System.IO.Path]::GetRandomFileName()).json"
        try {
            Set-Content -LiteralPath $tmp -Value '{ "type":"RESULT" }' -NoNewline
            $err = (pwsh -NoProfile -File $script:ScriptPath -InputFile $tmp 2>&1) -join "`n"
            $LASTEXITCODE | Should -Be 1
            $err | Should -Match 'Invalid RESULT'
        }
        finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
}
