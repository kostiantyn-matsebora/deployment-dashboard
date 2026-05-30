#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-WorktreeEntryGuard.ps1')).Path
    . $script:ScriptPath -AsLibrary

    function New-FileReader {
        param([hashtable]$Files)
        $normalized = @{}
        foreach ($k in $Files.Keys) {
            $nk = $k -replace '[/\\]', [IO.Path]::DirectorySeparatorChar
            $normalized[$nk] = $Files[$k]
        }
        return {
            param([string]$AbsPath)
            $key = $AbsPath -replace '[/\\]', [IO.Path]::DirectorySeparatorChar
            if ($normalized.ContainsKey($key)) { return $normalized[$key] }
            return ''
        }.GetNewClosure()
    }
}

# ============================================================
Describe 'Get-WorktreePendingFilePath' {

    It 'no sid -> path ending in .worktree-pending.json' {
        $path = Get-WorktreePendingFilePath -RepoRoot '/repo' -SessionId ''
        $path | Should -Match '\.worktree-pending\.json$'
        $path | Should -Not -Match '\.worktree-pending\.\.'
    }

    It 'with sid "abc" -> path ending in .worktree-pending.abc.json' {
        $path = Get-WorktreePendingFilePath -RepoRoot '/repo' -SessionId 'abc'
        $path | Should -Match '\.worktree-pending\.abc\.json$'
    }

    It 'unsafe chars in sid sanitized to _' {
        $path = Get-WorktreePendingFilePath -RepoRoot '/repo' -SessionId 'abc/def@123!'
        $path | Should -Match '\.worktree-pending\.abc_def_123_\.json$'
    }

    It 'null sid treated as empty -> global path' {
        $path = Get-WorktreePendingFilePath -RepoRoot '/repo' -SessionId $null
        $path | Should -Match '\.worktree-pending\.json$'
    }
}

# ============================================================
Describe 'Get-WorktreeEntryDecision' {

    It 'Block=false when no pending marker exists' {
        $reader = New-FileReader @{}
        $result = Get-WorktreeEntryDecision -ToolName 'Read' -PendingPath '/repo/.claude/.worktree-pending.sid.json' -FileReader $reader
        $result.Block | Should -BeFalse
    }

    It 'Block=false for EnterWorktree tool even when marker exists' {
        $reader = New-FileReader @{
            '/repo/.claude/.worktree-pending.sid.json' = '{"sessionId":"sid","worktreePath":"/repo/wt"}'
        }
        $result = Get-WorktreeEntryDecision -ToolName 'EnterWorktree' -PendingPath '/repo/.claude/.worktree-pending.sid.json' -FileReader $reader
        $result.Block | Should -BeFalse
    }

    It 'Block=true for non-EnterWorktree tool when marker exists' {
        $reader = New-FileReader @{
            '/repo/.claude/.worktree-pending.sid.json' = '{"sessionId":"sid","worktreePath":"/repo/wt"}'
        }
        $result = Get-WorktreeEntryDecision -ToolName 'Read' -PendingPath '/repo/.claude/.worktree-pending.sid.json' -FileReader $reader
        $result.Block  | Should -BeTrue
        $result.Reason | Should -Not -BeNullOrEmpty
    }

    It 'Reason includes the worktree path' {
        $reader = New-FileReader @{
            '/repo/.claude/.worktree-pending.sid.json' = '{"sessionId":"sid","worktreePath":"/repo/wt/my-session"}'
        }
        $result = Get-WorktreeEntryDecision -ToolName 'Bash' -PendingPath '/repo/.claude/.worktree-pending.sid.json' -FileReader $reader
        $result.Reason | Should -Match ([regex]::Escape('/repo/wt/my-session'))
    }

    It 'Block=true even when marker JSON lacks worktreePath' {
        $reader = New-FileReader @{
            '/repo/.claude/.worktree-pending.sid.json' = '{"sessionId":"sid"}'
        }
        $result = Get-WorktreeEntryDecision -ToolName 'Edit' -PendingPath '/repo/.claude/.worktree-pending.sid.json' -FileReader $reader
        $result.Block | Should -BeTrue
    }
}
