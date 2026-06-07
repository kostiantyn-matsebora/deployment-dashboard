#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-ProtocolFormGuard.ps1')).Path
    . $script:ScriptPath -AsLibrary

    $script:ValidReview = @'
REVIEW

| Field | Value |
|---|---|
| role | backend |
| scope | backend/fetcher/** |
| checked | PollLoop × [SOLID, smells] |
| verdict | changes-requested |
| remarks | F1 · cloud:resilience · GithubClient.cs:156 · add timeout |
| block | none |
'@

    $script:ValidResult = @'
RESULT

| Field | Value |
|---|---|
| role | backend |
| changed | backend/fetcher/PollLoop.cs |
| gate | build ok; unit 12/12 |
| block | none |
'@
}

# ============================================================
Describe 'Get-FormTag' {

    It 'detects a bare leading form name' {
        Get-FormTag -Text "REVIEW`n| role | backend |" | Should -Be 'REVIEW'
    }

    It 'detects a #-prefixed tag' {
        Get-FormTag -Text "#RESULT`nstuff" | Should -Be 'RESULT'
    }

    It 'is case-insensitive on the tag' {
        Get-FormTag -Text "review`n..." | Should -Be 'REVIEW'
    }

    It 'returns null when the first non-empty line is prose' {
        Get-FormTag -Text "Here are my findings:`n- a bug" | Should -BeNullOrEmpty
    }
}

# ============================================================
Describe 'Test-FieldPresent' {

    It 'matches a table cell' {
        Test-FieldPresent -Text '| verdict | pass |' -Label 'verdict' | Should -BeTrue
    }

    It 'matches a colon form' {
        Test-FieldPresent -Text 'role: backend' -Label 'role' | Should -BeTrue
    }

    It 'does not match the label inside prose' {
        Test-FieldPresent -Text 'the role of the fetcher is to poll' -Label 'role' | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision' {

    It 'passes a well-formed REVIEW' {
        (Get-ProtocolFormDecision -Text $script:ValidReview).Block | Should -BeFalse
    }

    It 'passes a well-formed RESULT' {
        (Get-ProtocolFormDecision -Text $script:ValidResult).Block | Should -BeFalse
    }

    It 'blocks a REVIEW missing the checked row' {
        $bad = $script:ValidReview -replace '(?im)^\| checked .*$', ''
        $d = Get-ProtocolFormDecision -Text $bad
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'checked'
    }

    It 'blocks a REVIEW with an invalid verdict value' {
        $bad = $script:ValidReview -replace 'changes-requested', 'maybe'
        $d = Get-ProtocolFormDecision -Text $bad
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'verdict'
    }

    It 'blocks an untagged hand-back table that is form-like (missing tag)' {
        $untagged = @'
Here is my review:

| role | backend |
| scope | backend/fetcher |
| verdict | changes-requested |
| remarks | a few issues |
'@
        $d = Get-ProtocolFormDecision -Text $untagged
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'no form tag'
    }

    It 'allows an informal coordination message' {
        (Get-ProtocolFormDecision -Text 'Please re-run iteration 2 when you get a chance.').Block | Should -BeFalse
    }

    It 'allows an empty message' {
        (Get-ProtocolFormDecision -Text '').Block | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-SendMessageText' {

    It 'returns the string message verbatim' {
        $ti = [pscustomobject]@{ message = 'hello'; to = 'lead' }
        Get-SendMessageText -ToolInput $ti | Should -Be 'hello'
    }

    It 'returns empty for an object (legacy protocol response) message' {
        $ti = [pscustomobject]@{ message = [pscustomobject]@{ type = 'shutdown_response'; approve = $true } }
        Get-SendMessageText -ToolInput $ti | Should -Be ''
    }

    It 'returns empty when there is no message' {
        Get-SendMessageText -ToolInput ([pscustomobject]@{ to = 'lead' }) | Should -Be ''
    }
}
