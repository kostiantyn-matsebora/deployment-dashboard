#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-ProtocolFormGuard.ps1')).Path
    . $script:ScriptPath -AsLibrary

    $script:ValidReviewTable = @'
REVIEW

| Field | Value |
|---|---|
| role | • backend |
| scope | • backend/fetcher/** |
| checked | • PollLoop × [SOLID, smells] |
| verdict | • changes-requested |
| remarks | • F1 · cloud:resilience · GithubClient.cs:156 · add timeout |
| block | • none |
'@

    $script:ValidReviewDefList = @'
REVIEW
role: • backend
scope: • backend/fetcher
checked: • PollLoop × SOLID
verdict: • pass
remarks: • none
block: • none
'@

    $script:ValidResult = @'
RESULT
| role | • backend |
| changed | • backend/fetcher/PollLoop.cs |
| gate | • build ok<br>• unit 12/12 |
| block | • none |
'@
}

# ============================================================
Describe 'Get-FormTag' {

    It 'detects a bare leading form name' {
        Get-FormTag -Text "REVIEW`n| role | backend |" | Should -Be 'REVIEW'
    }

    It 'detects a #-prefixed tag, case-insensitive' {
        Get-FormTag -Text "#result`nstuff" | Should -Be 'RESULT'
    }

    It 'returns null when the first non-empty line is prose' {
        Get-FormTag -Text "Here are my findings:`n- a bug" | Should -BeNullOrEmpty
    }
}

# ============================================================
Describe 'Get-FieldLine (structural)' {

    It 'captures the value from a table row' {
        $r = Get-FieldLine -Text '| verdict | changes-requested |' -Label 'verdict'
        $r.Found | Should -BeTrue
        $r.Value | Should -Be 'changes-requested'
    }

    It 'captures the value from a definition line' {
        $r = Get-FieldLine -Text 'role: backend' -Label 'role'
        $r.Found | Should -BeTrue
        $r.Value | Should -Be 'backend'
    }

    It 'captures the value from a bullet definition line' {
        (Get-FieldLine -Text '- gate: build ok' -Label 'gate').Value | Should -Be 'build ok'
    }

    It 'does NOT match a label mentioned in prose' {
        (Get-FieldLine -Text 'the role of the fetcher is to poll' -Label 'role').Found | Should -BeFalse
    }

    It 'reports an empty value for an empty table cell' {
        $r = Get-FieldLine -Text '| scope |  |' -Label 'scope'
        $r.Found | Should -BeTrue
        $r.Value | Should -BeNullOrEmpty
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — valid forms pass' {

    It 'passes a well-formed REVIEW table' {
        (Get-ProtocolFormDecision -Text $script:ValidReviewTable).Block | Should -BeFalse
    }

    It 'passes a REVIEW as a definition list' {
        (Get-ProtocolFormDecision -Text $script:ValidReviewDefList).Block | Should -BeFalse
    }

    It 'passes a RESULT that omits optional rows (notes/follow)' {
        (Get-ProtocolFormDecision -Text $script:ValidResult).Block | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — structural violations block' {

    It 'blocks a REVIEW missing a mandatory field row (checked)' {
        $bad = $script:ValidReviewTable -replace '(?im)^\| checked .*$', ''
        $d = Get-ProtocolFormDecision -Text $bad
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'checked'
    }

    It 'blocks a REVIEW with a present-but-empty mandatory value' {
        $bad = $script:ValidReviewTable -replace '(?m)^\| scope \|.*$', '| scope |  |'
        $d = Get-ProtocolFormDecision -Text $bad
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'empty'
    }

    It 'blocks a REVIEW whose fields are out of order' {
        $outOfOrder = @'
REVIEW
| role | • backend |
| verdict | • pass |
| scope | • x |
| checked | • y |
'@
        $d = Get-ProtocolFormDecision -Text $outOfOrder
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'out of order'
    }

    It 'blocks a REVIEW with an invalid verdict value' {
        $bad = $script:ValidReviewTable -replace 'changes-requested', 'maybe'
        $d = Get-ProtocolFormDecision -Text $bad
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'verdict'
    }

    It 'blocks a tagged REVIEW whose body is prose (no structured rows)' {
        $prose = "REVIEW`nThis is my review. The role is backend and the verdict is pass, looks fine."
        $d = Get-ProtocolFormDecision -Text $prose
        $d.Block | Should -BeTrue
    }

    It 'blocks an untagged hand-back table (missing form tag)' {
        $untagged = @'
Here is my review:
| role | backend |
| scope | x |
| verdict | changes-requested |
| remarks | y |
'@
        $d = Get-ProtocolFormDecision -Text $untagged
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'typed form'
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — value cells must be bullet lists' {

    It 'blocks a RESULT whose value cells are prose, not bullets' {
        $prose = @'
RESULT
| role | backend |
| changed | x.cs |
| gate | build ok |
'@
        $d = Get-ProtocolFormDecision -Text $prose
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'bullet'
    }

    It 'blocks a cell with two bullets glued on one line (one item per line)' {
        $glued = @'
RESULT
| role | • backend |
| changed | • a.cs • b.cs |
| gate | • build ok |
'@
        $d = Get-ProtocolFormDecision -Text $glued
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'bullet'
    }

    It 'passes a multi-item bulleted cell separated by <br>' {
        (Get-ProtocolFormDecision -Text $script:ValidResult).Block | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — free prose is blocked (strict)' {

    It 'blocks an informal coordination message' {
        $d = Get-ProtocolFormDecision -Text 'Please re-run iteration 2 when you can.'
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'typed form'
    }

    It 'blocks prose that merely mentions a couple of field words' {
        (Get-ProtocolFormDecision -Text 'The role here is to verify the scope of the change.').Block | Should -BeTrue
    }

    It 'allows an empty message (empty + object protocol-response messages)' {
        (Get-ProtocolFormDecision -Text '').Block | Should -BeFalse
    }
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
