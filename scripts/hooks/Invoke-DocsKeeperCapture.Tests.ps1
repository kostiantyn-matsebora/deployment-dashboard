#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:HookPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-DocsKeeperCapture.ps1')).Path
    . $script:HookPath -AsLibrary
}

Describe 'Get-DocsCaptureFilePath (new .docs-keeper layout)' {
    It 'no sid -> path ends in capture.json' {
        $result = Get-DocsCaptureFilePath -RepoRoot '/repo' -SessionId ''
        $result | Should -Match 'capture\.json$'
        $result | Should -Not -Match 'capture\.\.'
    }
    It 'with sid "abc" -> path ends in capture.abc.json' {
        $result = Get-DocsCaptureFilePath -RepoRoot '/repo' -SessionId 'abc'
        $result | Should -Match 'capture\.abc\.json$'
    }
    It 'path is inside .docs-keeper not .claude' {
        $result = Get-DocsCaptureFilePath -RepoRoot '/repo' -SessionId 'abc'
        $result | Should -Match '\.docs-keeper'
        $result | Should -Not -Match '\.claude'
    }
}

Describe 'New-DocsCaptureEntry' {
    It 'returns hashtable with correct fields' {
        $e = New-DocsCaptureEntry -Content 'Fix the auth flow docs.' -SuggestedDoc 'docs/SAD.md' -Source 'manual' -CapturedAt '2026-05-30T18:00:00Z'
        $e.content      | Should -Be 'Fix the auth flow docs.'
        $e.suggestedDoc | Should -Be 'docs/SAD.md'
        $e.source       | Should -Be 'manual'
        $e.capturedAt   | Should -Be '2026-05-30T18:00:00Z'
    }
    It 'unknown source defaults to manual' {
        $e = New-DocsCaptureEntry -Content 'x' -SuggestedDoc '' -Source 'bogus' -CapturedAt '2026-01-01T00:00:00Z'
        $e.source | Should -Be 'manual'
    }
    It 'valid source manual passes through' {
        $e = New-DocsCaptureEntry -Content 'x' -SuggestedDoc '' -Source 'manual' -CapturedAt '2026-01-01T00:00:00Z'
        $e.source | Should -Be 'manual'
    }
    It 'valid source compaction passes through' {
        $e = New-DocsCaptureEntry -Content 'x' -SuggestedDoc '' -Source 'compaction' -CapturedAt '2026-01-01T00:00:00Z'
        $e.source | Should -Be 'compaction'
    }
}

Describe 'Add-DocsCaptureEntry' {
    It 'appends entry to existing captures array' {
        $file  = @{ sessionId = 's1'; captures = @(@{ content = 'first'; suggestedDoc = ''; source = 'manual'; capturedAt = 'T1' }) }
        $entry = @{ content = 'second'; suggestedDoc = ''; source = 'compaction'; capturedAt = 'T2' }
        $result = Add-DocsCaptureEntry -CaptureFile $file -Entry $entry
        @($result.captures).Count | Should -Be 2
        @($result.captures)[1].content | Should -Be 'second'
    }
    It 'creates captures array when absent' {
        $file  = @{ sessionId = 's1' }
        $entry = @{ content = 'only'; suggestedDoc = ''; source = 'manual'; capturedAt = 'T1' }
        $result = Add-DocsCaptureEntry -CaptureFile $file -Entry $entry
        @($result.captures).Count | Should -Be 1
    }
    It 'does not mutate input' {
        $file  = @{ sessionId = 's1'; captures = @() }
        $entry = @{ content = 'x'; suggestedDoc = ''; source = 'manual'; capturedAt = 'T1' }
        $null  = Add-DocsCaptureEntry -CaptureFile $file -Entry $entry
        @($file.captures).Count | Should -Be 0
    }
}
