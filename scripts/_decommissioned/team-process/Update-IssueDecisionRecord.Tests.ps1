#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Update-IssueDecisionRecord.ps1')).Path
    . $script:ScriptPath -AsLibrary

    $script:FullRecord = [pscustomobject]@{
        id = 'feat-351'; workflow = 'feature-team'; team = 'feat-351'; branch = 'feat/351-svc-visibility'
        issue = '#351'; phase = 'ship'; updatedAt = '2026-06-19T12:00:00Z'
        acceptance = @('services board filters by glob', 'notification prefs share the widget')
        roster = @([pscustomobject]@{ role = 'frontend'; status = 'done' })
        ledger = @(
            [pscustomobject]@{ wave = 1; deferred = 'E2E coverage' },
            [pscustomobject]@{ wave = 2 }
        )
        decisions = @(
            [pscustomobject]@{ id = 1; decision = 'glob include/exclude widget, not checkbox'; why = 'matches a1675d8 mockup; user-confirmed'; supersedes = 'original issue text'; status = 'locked'; refs = @('docs/design/mockup/a1675d8') }
            [pscustomobject]@{ id = 2; decision = 'notif upgrade exact-match -> glob'; why = 'shared widget'; status = 'locked'; refs = @('docs/design/mockup/a1675d8') }
        )
    }
}

# ============================================================
Describe 'Get-DecisionMarker' {
    It 'is a stable hidden HTML marker' {
        Get-DecisionMarker | Should -Be '<!-- team-process:decision-record -->'
    }
}

# ============================================================
Describe 'Get-IssueNumber' {
    It 'strips a leading # ' { Get-IssueNumber -Ref '#351' | Should -Be '351' }
    It 'passes a bare number' { Get-IssueNumber -Ref '351' | Should -Be '351' }
    It 'handles a GH- prefix' { Get-IssueNumber -Ref 'GH-42' | Should -Be '42' }
    It 'returns empty for no number' { Get-IssueNumber -Ref 'none' | Should -Be '' }
    It 'returns empty for blank' { Get-IssueNumber -Ref '' | Should -Be '' }
}

# ============================================================
Describe 'Format-Cell' {
    It 'escapes pipes so the table is not broken' {
        Format-Cell -Text 'a | b' | Should -Be 'a \| b'
    }
    It 'collapses newlines to spaces' {
        Format-Cell -Text "line1`nline2" | Should -Be 'line1 line2'
    }
}

# ============================================================
Describe 'ConvertTo-DecisionMarkdown' {

    It 'leads with the managed marker (so re-publish can find it)' {
        $md = ConvertTo-DecisionMarkdown -Record $script:FullRecord
        $md.TrimStart() | Should -Match '^<!-- team-process:decision-record -->'
    }
    It 'titles with the issue and branch' {
        $md = ConvertTo-DecisionMarkdown -Record $script:FullRecord
        $md | Should -Match 'Decision record — #351'
        $md | Should -Match 'feat/351-svc-visibility'
    }
    It 'renders acceptance criteria as a list' {
        $md = ConvertTo-DecisionMarkdown -Record $script:FullRecord
        $md | Should -Match '### Acceptance criteria \(locked\)'
        $md | Should -Match '- services board filters by glob'
    }
    It 'renders the decisions table with the supersedes column' {
        $md = ConvertTo-DecisionMarkdown -Record $script:FullRecord
        $md | Should -Match '\| # \| Decision \| Why \| Supersedes \| Status \|'
        $md | Should -Match '\| 1 \| glob include/exclude widget, not checkbox \|'
        $md | Should -Match 'original issue text'
    }
    It 'aggregates deferred items from the ledger with their wave' {
        $md = ConvertTo-DecisionMarkdown -Record $script:FullRecord
        $md | Should -Match '### Deferred / follow-ups'
        $md | Should -Match '- wave 1: E2E coverage'
    }
    It 'dedupes artifact refs across decisions' {
        $md = ConvertTo-DecisionMarkdown -Record $script:FullRecord
        $md | Should -Match '### Artifacts \(source of truth\)'
        ([regex]::Matches($md, 'docs/design/mockup/a1675d8')).Count | Should -Be 1
    }
    It 'defaults a decision status to locked when unset' {
        $rec = [pscustomobject]@{ decisions = @([pscustomobject]@{ id = 1; decision = 'x' }) }
        $md = ConvertTo-DecisionMarkdown -Record $rec
        $md | Should -Match '\| 1 \| x \|  \|  \| locked \|'
    }
    It 'shows a placeholder when there are no decisions yet' {
        $md = ConvertTo-DecisionMarkdown -Record ([pscustomobject]@{ issue = '#9'; branch = 'b' })
        $md | Should -Match '_No decisions recorded yet._'
    }
    It 'omits empty sections (no acceptance / deferred / artifacts)' {
        $md = ConvertTo-DecisionMarkdown -Record ([pscustomobject]@{ issue = '#9'; branch = 'b'; decisions = @([pscustomobject]@{ id = 1; decision = 'x' }) })
        $md | Should -Not -Match 'Acceptance criteria'
        $md | Should -Not -Match 'Deferred'
        $md | Should -Not -Match 'Artifacts'
    }
}

# ============================================================
Describe 'Find-ManagedCommentId' {
    It 'returns the id of the comment carrying the marker' {
        $comments = @(
            [pscustomobject]@{ id = 100; body = 'unrelated chatter' },
            [pscustomobject]@{ id = 200; body = "$(Get-DecisionMarker)`n## Decision record" }
        )
        Find-ManagedCommentId -Comments $comments | Should -Be 200
    }
    It 'returns null when no comment is managed' {
        $comments = @([pscustomobject]@{ id = 100; body = 'nope' })
        Find-ManagedCommentId -Comments $comments | Should -BeNullOrEmpty
    }
    It 'returns null for an empty comment list' {
        Find-ManagedCommentId -Comments @() | Should -BeNullOrEmpty
    }
}

# ============================================================
Describe 'Round-trip: rendered body is findable by its own marker' {
    It 'a body produced by ConvertTo-DecisionMarkdown is matched by Find-ManagedCommentId' {
        $body = ConvertTo-DecisionMarkdown -Record $script:FullRecord
        $comments = @([pscustomobject]@{ id = 42; body = $body })
        Find-ManagedCommentId -Comments $comments | Should -Be 42
    }
}
