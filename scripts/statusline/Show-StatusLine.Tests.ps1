#Requires -Version 7.0

<#
.SYNOPSIS
    Pester v5 suite for Show-StatusLine.ps1.
    Dot-sources with -AsLibrary so the entry block is skipped.
#>

BeforeAll {
    $scriptPath = Join-Path $PSScriptRoot 'Show-StatusLine.ps1'
    . $scriptPath -AsLibrary
}

Describe 'Get-StatusLine' {
    It 'emits nothing when no sessions' {
        $result = Get-StatusLine -Sessions @()
        $result | Should -BeNullOrEmpty
    }

    It 'emits team name and phase for one session' {
        $session = [PSCustomObject]@{ id = 'feat-1'; phase = 'implement' }
        $result = Get-StatusLine -Sessions @($session)
        $result | Should -Be 'team: feat-1 (implement)'
    }

    It 'emits ? when phase absent' {
        $session = [PSCustomObject]@{ id = 'feat-1' }
        $result = Get-StatusLine -Sessions @($session)
        $result | Should -Be 'team: feat-1 (?)'
    }

    It 'appends the team summary when present' {
        $session = [PSCustomObject]@{ id = 'feat-351'; phase = 'implement'; summary = 'service visibility glob filter' }
        $result = Get-StatusLine -Sessions @($session)
        $result | Should -Be 'team: feat-351 - service visibility glob filter (implement)'
    }

    It 'appends the agent digest (role: task) when a roster is present' {
        $session = [PSCustomObject]@{
            id = 'feat-1'; phase = 'implement'
            roster = @(
                [PSCustomObject]@{ role = 'backend'; task = 'extract adapter' },
                [PSCustomObject]@{ role = 'frontend'; task = 'glob widget' }
            )
        }
        $result = Get-StatusLine -Sessions @($session)
        $result | Should -Be 'team: feat-1 (implement) | backend: extract adapter, frontend: glob widget'
    }

    It 'combines summary and agent digest' {
        $session = [PSCustomObject]@{
            id = 'feat-351'; phase = 'implement'; summary = 'glob filter'
            roster = @([PSCustomObject]@{ role = 'backend'; task = 'extract adapter' })
        }
        $result = Get-StatusLine -Sessions @($session)
        $result | Should -Be 'team: feat-351 - glob filter (implement) | backend: extract adapter'
    }

    It 'falls back to the bare role when a member has no task' {
        $session = [PSCustomObject]@{
            id = 'feat-1'; phase = 'plan'
            roster = @([PSCustomObject]@{ role = 'backend' }, [PSCustomObject]@{ role = 'docs'; task = 'index' })
        }
        $result = Get-StatusLine -Sessions @($session)
        $result | Should -Be 'team: feat-1 (plan) | backend, docs: index'
    }

    It 'truncates a long member task' {
        $session = [PSCustomObject]@{
            id = 'feat-1'; phase = 'implement'
            roster = @([PSCustomObject]@{ role = 'backend'; task = 'this is a very long task description that should be cut' })
        }
        $result = Get-StatusLine -Sessions @($session)
        $result | Should -Match 'backend: this is a very long .+\.$'
        $result.Length | Should -BeLessThan 65   # untruncated would be ~91
    }

    It 'emits count for multiple sessions when no branch is given' {
        $s1 = [PSCustomObject]@{ id = 'feat-1'; phase = 'plan'; summary = 'a'; branch = 'feat/1' }
        $s2 = [PSCustomObject]@{ id = 'feat-2'; phase = 'implement'; branch = 'feat/2' }
        $s3 = [PSCustomObject]@{ id = 'feat-3'; phase = 'review'; branch = 'feat/3' }
        $result = Get-StatusLine -Sessions @($s1, $s2, $s3)
        $result | Should -Be 'teams (3 active)'
    }

    It 'shows the CURRENT run (matched by branch) plus a count of the others' {
        $s1 = [PSCustomObject]@{ id = 'feat-1'; phase = 'plan'; branch = 'feat/1' }
        $s2 = [PSCustomObject]@{ id = 'feat-351'; phase = 'implement'; summary = 'glob filter'; branch = 'feat/351'
            roster = @([PSCustomObject]@{ role = 'backend'; task = 'extract adapter' }) }
        $s3 = [PSCustomObject]@{ id = 'feat-3'; phase = 'review'; branch = 'feat/3' }
        $result = Get-StatusLine -Sessions @($s1, $s2, $s3) -CurrentBranch 'feat/351'
        $result | Should -Be 'team: feat-351 - glob filter (implement) | backend: extract adapter (+2 other)'
    }

    It 'falls back to the count when the branch matches no record' {
        $s1 = [PSCustomObject]@{ id = 'feat-1'; phase = 'plan'; branch = 'feat/1' }
        $s2 = [PSCustomObject]@{ id = 'feat-2'; phase = 'implement'; branch = 'feat/2' }
        $result = Get-StatusLine -Sessions @($s1, $s2) -CurrentBranch 'main'
        $result | Should -Be 'teams (2 active)'
    }

    It 'falls back to the count when the branch is ambiguous (two records share it)' {
        $s1 = [PSCustomObject]@{ id = 'feat-1a'; phase = 'plan'; branch = 'feat/dup' }
        $s2 = [PSCustomObject]@{ id = 'feat-1b'; phase = 'implement'; branch = 'feat/dup' }
        $result = Get-StatusLine -Sessions @($s1, $s2) -CurrentBranch 'feat/dup'
        $result | Should -Be 'teams (2 active)'
    }

    It 'resolves the current run by claudeSessionId even when the branch is shared' {
        $s1 = [PSCustomObject]@{ id = 'feat-1a'; phase = 'plan'; branch = 'feat/dup'; claudeSessionId = 'sess-A' }
        $s2 = [PSCustomObject]@{ id = 'feat-1b'; phase = 'implement'; branch = 'feat/dup'; claudeSessionId = 'sess-B' }
        $result = Get-StatusLine -Sessions @($s1, $s2) -CurrentBranch 'feat/dup' -CurrentSessionId 'sess-B'
        $result | Should -Be 'team: feat-1b (implement) (+1 other)'
    }

    It 'prefers claudeSessionId over branch when they point at different records' {
        $s1 = [PSCustomObject]@{ id = 'owned'; phase = 'implement'; branch = 'feat/other'; claudeSessionId = 'sess-X' }
        $s2 = [PSCustomObject]@{ id = 'on-branch'; phase = 'plan'; branch = 'feat/here' }
        $result = Get-StatusLine -Sessions @($s1, $s2) -CurrentBranch 'feat/here' -CurrentSessionId 'sess-X'
        $result | Should -Be 'team: owned (implement) (+1 other)'
    }

    It 'falls back to branch when the session id matches no record' {
        $s1 = [PSCustomObject]@{ id = 'feat-1'; phase = 'plan'; branch = 'feat/1' }
        $s2 = [PSCustomObject]@{ id = 'feat-2'; phase = 'implement'; branch = 'feat/2' }
        $result = Get-StatusLine -Sessions @($s1, $s2) -CurrentBranch 'feat/2' -CurrentSessionId 'sess-unknown'
        $result | Should -Be 'team: feat-2 (implement) (+1 other)'
    }
}

Describe 'Limit-Text' {
    It 'returns the text unchanged when within the limit' {
        Limit-Text -Text 'short' -Max 24 | Should -Be 'short'
    }
    It 'truncates and appends an ellipsis when over the limit' {
        Limit-Text -Text 'abcdefghij' -Max 5 | Should -Be 'abcd.'
    }
}

Describe 'Format-AgentDigest' {
    It 'returns empty when there is no roster' {
        Format-AgentDigest -Record ([PSCustomObject]@{ id = 'x' }) | Should -Be ''
    }
    It 'renders role: task pairs' {
        $rec = [PSCustomObject]@{ roster = @([PSCustomObject]@{ role = 'backend'; task = 'do it' }) }
        Format-AgentDigest -Record $rec | Should -Be 'backend: do it'
    }
}

Describe 'Get-ActiveSessions' {
    BeforeEach {
        $testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ShowStatusLineTest_" + [System.Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
    }

    AfterEach {
        if (Test-Path -LiteralPath $testRoot) {
            Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'reads a valid session.json' {
        $sessionsDir = Join-Path $testRoot '.team-process' 'sessions' 'feat-1'
        New-Item -ItemType Directory -Force -Path $sessionsDir | Out-Null
        $sessionFile = Join-Path $sessionsDir 'session.json'
        @{ id = 'feat-1'; phase = 'implement' } | ConvertTo-Json | Set-Content -LiteralPath $sessionFile -Encoding utf8NoBOM

        $result = Get-ActiveSessions -Root $testRoot
        $result | Should -Not -BeNullOrEmpty
        $result.Count | Should -Be 1
        $result[0].id | Should -Be 'feat-1'
    }

    It 'ignores malformed json' {
        $sessionsDir = Join-Path $testRoot '.team-process' 'sessions' 'bad-session'
        New-Item -ItemType Directory -Force -Path $sessionsDir | Out-Null
        $sessionFile = Join-Path $sessionsDir 'session.json'
        Set-Content -LiteralPath $sessionFile -Value 'not valid json {{{' -Encoding utf8NoBOM

        # Should not throw, and should return empty (malformed record is silently ignored)
        $result = Get-ActiveSessions -Root $testRoot
        $result.Count | Should -Be 0
    }

    It 'returns empty when sessions dir absent' {
        # $testRoot exists but has no .team-process/sessions subdirectory
        $result = Get-ActiveSessions -Root $testRoot
        $result.Count | Should -Be 0
    }
}
