#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-ProtocolFormGuard.ps1')).Path
    . $script:ScriptPath -AsLibrary

    # Canonical aligned-table RESULT (3 fields, dash rules, aligned columns).
    $script:ValidResult = @'
RESULT
| role    | • backend         |
-------------------------------
| changed | • PollLoop.cs     |
|         | • ControlStream   |
-------------------------------
| gate    | • build ok        |
|         | • 264/264 tests   |
-------------------------------
'@

    # Canonical aligned-table REVIEW (pass verdict).
    $script:ValidReviewPass = @'
REVIEW
| role    | • backend                                  |
-------------------------------------------------------
| scope   | • backend/fetcher/**                       |
-------------------------------------------------------
| checked | • PollLoop × SOLID / smells                |
-------------------------------------------------------
| verdict | • pass                                     |
-------------------------------------------------------
'@

    # Canonical aligned-table REVIEW (changes-requested with remarks + block).
    $script:ValidReviewChanges = @'
REVIEW
| role    | • backend                                       |
------------------------------------------------------------
| scope   | • backend/fetcher/**                            |
------------------------------------------------------------
| checked | • PollLoop × SOLID / smells                     |
------------------------------------------------------------
| verdict | • changes-requested                             |
------------------------------------------------------------
| remarks | • SRP · PollLoop.cs:42 · extract polling loop   |
------------------------------------------------------------
| block   | • none                                          |
------------------------------------------------------------
'@
}

# ============================================================
Describe 'Get-FormTag' {

    It 'detects a bare leading form name' {
        Get-FormTag -Text "REVIEW`n| role    | • backend |`n-----------`n" | Should -Be 'REVIEW'
    }

    It 'detects a #-prefixed tag, case-insensitive' {
        Get-FormTag -Text "#result`nstuff" | Should -Be 'RESULT'
    }

    It 'returns null when the first non-empty line is prose' {
        Get-FormTag -Text "Here are my findings:`n- a bug" | Should -BeNullOrEmpty
    }
}

# ============================================================
Describe 'Get-AlignedTableFields' {

    It 'parses a single-item field with a dash rule' {
        $text = "RESULT`n| role | • backend |`n-----------------`n"
        $fields = Get-AlignedTableFields -Text $text
        $fields.Count | Should -Be 1
        $fields[0].Name | Should -Be 'role'
        $fields[0].Items[0] | Should -Be '• backend'
        $fields[0].HasDashRule | Should -BeTrue
    }

    It 'parses continuation rows as items of the current field' {
        $text = "RESULT`n| changed | • PollLoop.cs |`n|         | • ControlStream |`n-----------------------`n"
        $fields = Get-AlignedTableFields -Text $text
        $fields.Count | Should -Be 1
        $fields[0].Items.Count | Should -Be 2
    }

    It 'detects a field block missing its dash rule' {
        $text = "RESULT`n| role | • backend |`n| gate | • build ok |`n-------------------`n"
        $fields = Get-AlignedTableFields -Text $text
        # 'role' field gets no dash rule (dash rule came after 'gate')
        $role = $fields | Where-Object { $_.Name -eq 'role' }
        $role.HasDashRule | Should -BeFalse
    }

    It 'returns null when there are no table rows' {
        $result = Get-AlignedTableFields -Text "RESULT`nThis is just prose."
        $result | Should -BeNullOrEmpty
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — valid forms pass' {

    It 'passes a well-formed aligned RESULT' {
        (Get-ProtocolFormDecision -Text $script:ValidResult).Block | Should -BeFalse
    }

    It 'passes a well-formed aligned REVIEW with pass verdict' {
        (Get-ProtocolFormDecision -Text $script:ValidReviewPass).Block | Should -BeFalse
    }

    It 'passes a well-formed aligned REVIEW with changes-requested verdict' {
        (Get-ProtocolFormDecision -Text $script:ValidReviewChanges).Block | Should -BeFalse
    }

    It 'passes a RESULT that omits optional rows (notes/follow/block)' {
        (Get-ProtocolFormDecision -Text $script:ValidResult).Block | Should -BeFalse
    }

    It 'allows an empty message (empty + object protocol-response messages)' {
        (Get-ProtocolFormDecision -Text '').Block | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — aligned format violations block' {

    It 'blocks misaligned table rows (different row lengths)' {
        # Deliberately unpadded columns.
        $misaligned = @'
RESULT
| role | • backend |
-------------------------------
| changed | • PollLoop.cs |
-------------------------------
| gate | • build ok |
-------------------------------
'@
        $d = Get-ProtocolFormDecision -Text $misaligned
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'aligned'
    }

    It 'blocks a value cell containing a <br> tag' {
        $withBr = @'
RESULT
| role    | • backend                          |
------------------------------------------------
| changed | • PollLoop.cs<br>• ControlStream   |
------------------------------------------------
| gate    | • build ok                         |
------------------------------------------------
'@
        $d = Get-ProtocolFormDecision -Text $withBr
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'br'
    }

    It 'blocks two bullets glued on one row' {
        $glued = @'
RESULT
| role    | • backend                  |
-----------------------------------------
| changed | • PollLoop.cs • Control.cs |
-----------------------------------------
| gate    | • build ok                 |
-----------------------------------------
'@
        $d = Get-ProtocolFormDecision -Text $glued
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'bullet'
    }

    It 'blocks a field block missing its dash rule' {
        $noDash = @'
RESULT
| role    | • backend         |
| changed | • PollLoop.cs     |
-------------------------------
| gate    | • build ok        |
-------------------------------
'@
        $d = Get-ProtocolFormDecision -Text $noDash
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'dash rule'
    }

    It 'blocks a body that is prose (not a table)' {
        $prose = "RESULT`nThis is my result. The role is backend and the gate is green."
        $d = Get-ProtocolFormDecision -Text $prose
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'aligned 2-column table'
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — existing structural rules still enforced' {

    It 'blocks a RESULT missing a mandatory field row (changed)' {
        $missingChanged = @'
RESULT
| role | • backend     |
------------------------
| gate | • build ok    |
------------------------
'@
        $d = Get-ProtocolFormDecision -Text $missingChanged
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'changed'
    }

    It 'blocks a value cell that has an empty bullet' {
        $emptyBullet = @'
RESULT
| role    | •              |
----------------------------
| changed | • PollLoop.cs  |
----------------------------
| gate    | • build ok     |
----------------------------
'@
        $d = Get-ProtocolFormDecision -Text $emptyBullet
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'bullet'
    }

    It 'blocks fields out of canonical order' {
        $outOfOrder = @'
RESULT
| role    | • backend         |
-------------------------------
| gate    | • build ok        |
-------------------------------
| changed | • PollLoop.cs     |
-------------------------------
'@
        $d = Get-ProtocolFormDecision -Text $outOfOrder
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'out of order'
    }

    It 'blocks a REVIEW with an invalid verdict value' {
        # Replace with same-length string ('nope'='pass'=4 chars) to avoid triggering alignment check first.
        $badVerdict = $script:ValidReviewPass -replace ([char]0x2022 + ' pass'), ([char]0x2022 + ' nope')
        $d = Get-ProtocolFormDecision -Text $badVerdict
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'verdict'
    }

    It 'blocks an untagged hand-back (missing form tag)' {
        $untagged = @'
| role    | • backend         |
-------------------------------
| changed | • PollLoop.cs     |
-------------------------------
| gate    | • build ok        |
-------------------------------
'@
        $d = Get-ProtocolFormDecision -Text $untagged
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'typed form'
    }

    It 'blocks free-prose informal coordination message' {
        $d = Get-ProtocolFormDecision -Text 'Please re-run iteration 2 when you can.'
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'typed form'
    }
}

# ============================================================
Describe 'Get-ProtocolFormDecision — BRIEF form' {

    BeforeAll {
        $script:ValidBrief = @'
BRIEF
| spec | • docs/api/openapi.yaml                        |
---------------------------------------------------------
| lane | • backend/fetcher-github/**                    |
---------------------------------------------------------
| task | • decompose long methods in GithubAdapter.cs   |
---------------------------------------------------------
| gate | • build ok                                     |
|      | • 264/264 tests                                |
---------------------------------------------------------
'@
    }

    It 'passes a well-formed aligned BRIEF' {
        (Get-ProtocolFormDecision -Text $script:ValidBrief).Block | Should -BeFalse
    }

    It 'blocks a BRIEF missing mandatory field task' {
        $bad = $script:ValidBrief -replace '(?m)^\| task \|.*$', ''
        $d   = Get-ProtocolFormDecision -Text $bad
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'task'
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
