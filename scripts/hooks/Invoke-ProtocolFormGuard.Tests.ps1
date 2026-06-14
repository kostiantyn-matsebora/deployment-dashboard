#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-ProtocolFormGuard.ps1')).Path
    . $script:ScriptPath -AsLibrary

    function New-FormJson { param($Obj) $Obj | ConvertTo-Json -Depth 10 }

    $script:ValidResult = New-FormJson ([ordered]@{
        type = 'RESULT'; role = 'backend'; changed = @('PollLoop.cs', 'ControlStream.cs'); gate = @('build ok', '264/264 tests')
    })
    $script:ValidReviewPass = New-FormJson ([ordered]@{
        type = 'REVIEW'; role = 'backend'; scope = @('backend/fetcher/**'); checked = @('PollLoop x SOLID'); verdict = 'pass'
    })
    $script:ValidReviewChanges = New-FormJson ([ordered]@{
        type = 'REVIEW'; role = 'backend'; scope = @('backend/fetcher/**'); checked = @('PollLoop x SOLID')
        verdict = 'changes-requested'
        remarks = @(@{ smell = 'SRP'; location = 'PollLoop.cs:42'; change = 'extract polling loop' })
        block = 'none'
    })
    $script:ValidBrief = New-FormJson ([ordered]@{
        type = 'BRIEF'; spec = @{ path = 'docs/api/openapi.yaml#deployments'; gate = 'tile shows badge' }
        lane = @('backend/fetcher-github/**'); task = 'decompose long methods'; gate = @('build ok', '264/264 tests')
    })
}

# ============================================================
Describe 'Get-SendMessageText' {

    It 'returns the string message verbatim' {
        Get-SendMessageText -ToolInput ([pscustomobject]@{ message = 'hello'; to = 'lead' }) | Should -Be 'hello'
    }
    It 'returns empty for an object (legacy protocol response) message' {
        $ti = [pscustomobject]@{ message = [pscustomobject]@{ type = 'shutdown_response'; approve = $true } }
        Get-SendMessageText -ToolInput $ti | Should -Be ''
    }
    It 'returns empty when there is no message' {
        Get-SendMessageText -ToolInput ([pscustomobject]@{ to = 'lead' }) | Should -Be ''
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — valid forms pass' {

    It 'passes a well-formed RESULT' {
        (Get-ProtocolFormDecision -Text $script:ValidResult).Block | Should -BeFalse
    }
    It 'passes a REVIEW with pass verdict' {
        (Get-ProtocolFormDecision -Text $script:ValidReviewPass).Block | Should -BeFalse
    }
    It 'passes a REVIEW with changes-requested verdict and remarks' {
        (Get-ProtocolFormDecision -Text $script:ValidReviewChanges).Block | Should -BeFalse
    }
    It 'passes a well-formed BRIEF with nested spec' {
        (Get-ProtocolFormDecision -Text $script:ValidBrief).Block | Should -BeFalse
    }
    It 'allows an empty message (empty + object protocol-response messages)' {
        (Get-ProtocolFormDecision -Text '').Block | Should -BeFalse
    }
    It 'passes a valid but UNNORMALIZED form (key order is not enforced)' {
        $messy = '{ "gate":["ok"], "type":"RESULT", "changed":["A.cs"], "role":"backend" }'
        (Get-ProtocolFormDecision -Text $messy).Block | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — invalid forms block' {

    It 'blocks free-prose (not JSON)' {
        $d = Get-ProtocolFormDecision -Text 'Please re-run iteration 2 when you can.'
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'JSON'
    }
    It 'blocks an unknown type' {
        $d = Get-ProtocolFormDecision -Text '{ "type":"MEMO","x":1 }'
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'type'
    }
    It 'blocks a RESULT missing a mandatory field (changed)' {
        $d = Get-ProtocolFormDecision -Text '{ "type":"RESULT","role":"backend","gate":["ok"] }'
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'RESULT'
    }
    It 'blocks an extra/renamed field' {
        $d = Get-ProtocolFormDecision -Text '{ "type":"FIX","failure":{"test":"t","expect":"e","actual":"a"},"suspect":"s","bogus":1 }'
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'bogus'
    }
    It 'blocks a REVIEW with an invalid verdict' {
        $d = Get-ProtocolFormDecision -Text '{ "type":"REVIEW","role":"backend","scope":["x"],"checked":["y"],"verdict":"maybe" }'
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'REVIEW'
    }
    It 'blocks a REVIEW pass that carries remarks (cross-field rule)' {
        $bad = '{ "type":"REVIEW","role":"backend","scope":["x"],"checked":["y"],"verdict":"pass","remarks":[{"smell":"a","location":"b","change":"c"}] }'
        $d = Get-ProtocolFormDecision -Text $bad
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'zero remarks'
    }
}

# ============================================================
Describe 'Get-RenderRecipe — block reasons carry the JSON recipe' {

    It 'recipe names the six forms, the schema location, and the normalizer invocation' {
        $recipe = Get-RenderRecipe
        $recipe | Should -Match 'REVIEW / RESULT / BRIEF / FINDING / FIX / ARTIFACT'
        $recipe | Should -Match 'Format-ProtocolForm\.ps1'
        $recipe | Should -Match '-InputFile'
        $recipe | Should -Match 'VERBATIM'
    }
    It 'a malformed-form reason embeds the recipe' {
        $d = Get-ProtocolFormDecision -Text 'Please re-run iteration 2 when you can.'
        $d.Reason | Should -Match '-InputFile'
        $d.Reason | Should -Match 'typed forms'
    }
}

# ============================================================
Describe 'Invoke-ProtocolFormGuard.ps1 — real-process stdin entry point' {
    # Regression guard: dot-sourcing Format-ProtocolForm.ps1 -AsLibrary must NOT clobber
    # this script's own -AsLibrary and skip the entry block. These run the real process.

    It 'emits a block decision for a free-prose message' {
        $payload = '{ "tool_input": { "to": "lead", "message": "hey can you re-run wave 2" } }'
        $out = ($payload | pwsh -NoProfile -File $script:ScriptPath) -join "`n"
        $out | Should -Match '"decision":\s*"block"'
        $out | Should -Match 'not valid JSON'
    }

    It 'emits a block decision for a schema-invalid form' {
        $payload = '{ "tool_input": { "to": "lead", "message": "{\"type\":\"RESULT\",\"role\":\"backend\"}" } }'
        $out = ($payload | pwsh -NoProfile -File $script:ScriptPath) -join "`n"
        $out | Should -Match '"decision":\s*"block"'
        $out | Should -Match 'RESULT'
    }

    It 'stays silent (allows) for a valid form' {
        $payload = '{ "tool_input": { "to": "lead", "message": "{\"type\":\"RESULT\",\"role\":\"backend\",\"changed\":[\"A.cs\"],\"gate\":[\"build ok\"]}" } }'
        $out = ($payload | pwsh -NoProfile -File $script:ScriptPath) -join "`n"
        $out.Trim() | Should -BeNullOrEmpty
    }

    It 'stays silent (allows) for an object (non-string) message' {
        $payload = '{ "tool_input": { "to": "lead", "message": { "type": "shutdown_response", "approve": true } } }'
        $out = ($payload | pwsh -NoProfile -File $script:ScriptPath) -join "`n"
        $out.Trim() | Should -BeNullOrEmpty
    }
}
