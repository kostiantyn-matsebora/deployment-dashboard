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
Describe 'Get-PointerInfo' {
    It 'detects a {type, ref} pointer' {
        $p = Get-PointerInfo -Text '{ "type":"RESULT","ref":"/tmp/x.json" }'
        $p.IsPointer | Should -BeTrue
        $p.Type | Should -Be 'RESULT'
        $p.Ref  | Should -Be '/tmp/x.json'
        $p.ExtraKeys.Count | Should -Be 0
    }
    It 'flags extra keys beyond type/ref' {
        (Get-PointerInfo -Text '{ "type":"RESULT","ref":"/tmp/x.json","role":"backend" }').ExtraKeys | Should -Contain 'role'
    }
    It 'is not a pointer when ref is absent (a full form)' {
        (Get-PointerInfo -Text '{ "type":"RESULT","role":"backend" }').IsPointer | Should -BeFalse
    }
    It 'is not a pointer for free prose' {
        (Get-PointerInfo -Text 'just text').IsPointer | Should -BeFalse
    }
}

# ============================================================
Describe 'Test-RefInOutbox' {
    It 'accepts a path inside a session outbox' {
        Test-RefInOutbox -Path '/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json' | Should -BeTrue
    }
    It 'accepts a Windows-separator outbox path' {
        Test-RefInOutbox -Path 'C:\wt\.team-process\sessions\feat-1\outbox\backend.RESULT.json' | Should -BeTrue
    }
    It 'rejects a path outside any outbox' {
        Test-RefInOutbox -Path '/wt/secret.txt' | Should -BeFalse
    }
    It 'rejects the session record itself (not the outbox)' {
        Test-RefInOutbox -Path '/wt/.team-process/sessions/feat-1/session.json' | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-OutboxWriteDecision — write-time JSON enforcement' {

    It 'allows a valid typed-form JSON written to an outbox file' {
        $p = '/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json'
        (Get-OutboxWriteDecision -FilePath $p -Content $script:ValidResult).Block | Should -BeFalse
    }
    It 'blocks prose written to an outbox file (the cheat)' {
        $p = '/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json'
        $d = Get-OutboxWriteDecision -FilePath $p -Content 'Done! Build passes, 264/264 tests green.'
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'typed-form JSON'
    }
    It 'blocks a markdown .md dump written to an outbox file' {
        $p = '/wt/.team-process/sessions/feat-1/outbox/backend.result.md'
        (Get-OutboxWriteDecision -FilePath $p -Content "# Result`n- changed X").Block | Should -BeTrue
    }
    It 'ignores a write OUTSIDE any outbox (not this guard concern)' {
        (Get-OutboxWriteDecision -FilePath 'backend/fetcher/X.cs' -Content 'whatever' -Root '/repo').Block | Should -BeFalse
    }
    It 'ignores a write with no content body (Edit/MultiEdit — pointer guard validates)' {
        $p = '/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json'
        (Get-OutboxWriteDecision -FilePath $p -Content $null).Block | Should -BeFalse
    }
    It 'resolves a relative outbox file_path against -Root' {
        $rel = '.team-process/sessions/feat-1/outbox/backend.RESULT.json'
        (Get-OutboxWriteDecision -FilePath $rel -Content 'just prose' -Root '/repo').Block | Should -BeTrue
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — file-based hand-back pointers' {

    BeforeEach {
        $script:PtrRoot = Join-Path ([System.IO.Path]::GetTempPath()) "pfg-$(New-Guid)"
        $script:Outbox  = Join-Path $script:PtrRoot '.team-process/sessions/feat-1/outbox'
        New-Item -ItemType Directory -Path $script:Outbox -Force | Out-Null
    }
    AfterEach {
        Remove-Item -Recurse -Force -LiteralPath $script:PtrRoot -ErrorAction SilentlyContinue
    }

    It 'passes a pointer to a valid RESULT file (absolute ref)' {
        $f = Join-Path $script:Outbox 'backend.RESULT.json'
        Set-Content -LiteralPath $f -Value $script:ValidResult
        (Get-ProtocolFormDecision -Text "{ ""type"":""RESULT"",""ref"":""$($f -replace '\\','/')"" }").Block | Should -BeFalse
    }

    It 'resolves a relative ref against -Root' {
        $f = Join-Path $script:Outbox 'backend.RESULT.json'
        Set-Content -LiteralPath $f -Value $script:ValidResult
        $rel = '.team-process/sessions/feat-1/outbox/backend.RESULT.json'
        (Get-ProtocolFormDecision -Text "{ ""type"":""RESULT"",""ref"":""$rel"" }" -Root $script:PtrRoot).Block | Should -BeFalse
    }

    It 'blocks a pointer whose (in-outbox) ref file does not exist' {
        $missing = (Join-Path $script:Outbox 'missing.RESULT.json') -replace '\\', '/'
        $d = Get-ProtocolFormDecision -Text "{ ""type"":""RESULT"",""ref"":""$missing"" }"
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'not found'
    }

    It 'blocks a pointer whose ref is OUTSIDE any session outbox (no arbitrary-file read)' {
        $secret = (Join-Path $script:PtrRoot 'secret.txt') -replace '\\', '/'
        Set-Content -LiteralPath $secret -Value 'TOPSECRET'
        $d = Get-ProtocolFormDecision -Text "{ ""type"":""RESULT"",""ref"":""$secret"" }"
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'outbox'
        $d.Reason | Should -Not -Match 'TOPSECRET'   # no content leak in the reason
    }

    It 'blocks a pointer whose ref uses .. to escape the outbox' {
        # A valid form parked outside the outbox, reached via traversal from inside it.
        $outside = Join-Path $script:PtrRoot 'evil.RESULT.json'
        Set-Content -LiteralPath $outside -Value $script:ValidResult
        $traverse = ($script:Outbox -replace '\\', '/') + '/../../../../evil.RESULT.json'
        $d = Get-ProtocolFormDecision -Text "{ ""type"":""RESULT"",""ref"":""$traverse"" }"
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'outbox'
    }

    It 'blocks a pointer to a malformed form file' {
        $f = Join-Path $script:Outbox 'backend.RESULT.json'
        Set-Content -LiteralPath $f -Value '{ "type":"RESULT","role":"backend" }'  # missing changed/gate
        $d = Get-ProtocolFormDecision -Text "{ ""type"":""RESULT"",""ref"":""$($f -replace '\\','/')"" }"
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'RESULT'
    }

    It 'blocks a pointer with extra keys' {
        $f = Join-Path $script:Outbox 'backend.RESULT.json'
        Set-Content -LiteralPath $f -Value $script:ValidResult
        $d = Get-ProtocolFormDecision -Text "{ ""type"":""RESULT"",""ref"":""$($f -replace '\\','/')"",""role"":""backend"" }"
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'type, ref'
    }

    It 'blocks when the pointer type disagrees with the file form' {
        $f = Join-Path $script:Outbox 'backend.RESULT.json'
        Set-Content -LiteralPath $f -Value $script:ValidResult
        $d = Get-ProtocolFormDecision -Text "{ ""type"":""REVIEW"",""ref"":""$($f -replace '\\','/')"" }"
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'does not match'
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

    It 'blocks a prose Write into a session outbox' {
        $payload = '{ "tool_name": "Write", "tool_input": { "file_path": "/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json", "content": "Done, all 264 tests pass." } }'
        $out = ($payload | pwsh -NoProfile -File $script:ScriptPath) -join "`n"
        $out | Should -Match '"decision":\s*"block"'
        $out | Should -Match 'typed-form JSON'
    }

    It 'allows a valid-form Write into a session outbox' {
        $valid = '{\"type\":\"RESULT\",\"role\":\"backend\",\"changed\":[\"A.cs\"],\"gate\":[\"build ok\"]}'
        $payload = '{ "tool_name": "Write", "tool_input": { "file_path": "/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json", "content": "' + $valid + '" } }'
        $out = ($payload | pwsh -NoProfile -File $script:ScriptPath) -join "`n"
        $out.Trim() | Should -BeNullOrEmpty
    }

    It 'ignores a Write outside any outbox' {
        $payload = '{ "tool_name": "Write", "tool_input": { "file_path": "backend/fetcher/X.cs", "content": "// code" } }'
        $out = ($payload | pwsh -NoProfile -File $script:ScriptPath) -join "`n"
        $out.Trim() | Should -BeNullOrEmpty
    }
}
