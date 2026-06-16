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

    It 'emits count for multiple sessions' {
        $s1 = [PSCustomObject]@{ id = 'feat-1'; phase = 'plan' }
        $s2 = [PSCustomObject]@{ id = 'feat-2'; phase = 'implement' }
        $s3 = [PSCustomObject]@{ id = 'feat-3'; phase = 'review' }
        $result = Get-StatusLine -Sessions @($s1, $s2, $s3)
        $result | Should -Be 'teams (3 active)'
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
