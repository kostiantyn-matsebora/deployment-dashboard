#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-LaneGuard.ps1')).Path
    . $script:ScriptPath -AsLibrary
}

# ============================================================
Describe 'ConvertFrom-LaneGlob' {

    It '** matches across path segments' {
        $rx = ConvertFrom-LaneGlob -Glob 'backend/fetcher/**'
        'backend/fetcher/PollLoop.cs'           | Should -Match $rx
        'backend/fetcher/Control/Stream.cs'     | Should -Match $rx
    }

    It '** lane does not match a sibling directory' {
        $rx = ConvertFrom-LaneGlob -Glob 'backend/fetcher/**'
        'backend/shared/Entities/X.cs'          | Should -Not -Match $rx
    }

    It 'single * stays within a segment' {
        $rx = ConvertFrom-LaneGlob -Glob 'backend/*/Program.cs'
        'backend/api/Program.cs'                | Should -Match $rx
        'backend/api/sub/Program.cs'            | Should -Not -Match $rx
    }

    It 'exact file glob matches only that file' {
        $rx = ConvertFrom-LaneGlob -Glob 'docs/api/openapi.yaml'
        'docs/api/openapi.yaml'                 | Should -Match $rx
        'docs/api/openapi.yaml.bak'             | Should -Not -Match $rx
    }

    It 'escapes regex metacharacters in literal segments' {
        $rx = ConvertFrom-LaneGlob -Glob 'a.b/c.d'
        'a.b/c.d'                               | Should -Match $rx
        'axb/cxd'                               | Should -Not -Match $rx
    }
}

# ============================================================
Describe 'Get-ActiveLanes' {

    It 'drops blanks and comments, trims' {
        $lanes = Get-ActiveLanes -Lines @('# header', '', '  backend/fetcher/**  ', '   ', 'backend/shared/**')
        $lanes | Should -Be @('backend/fetcher/**', 'backend/shared/**')
    }

    It 'returns empty array for all-comment input' {
        (Get-ActiveLanes -Lines @('# a', '# b')).Count | Should -Be 0
    }
}

# ============================================================
Describe 'Test-PathInLanes' {

    It 'true when path matches one of several lanes' {
        $lanes = @('backend/fetcher/**', 'backend/fetcher-github/**')
        Test-PathInLanes -RelPath 'backend/fetcher-github/GithubClient.cs' -Lanes $lanes | Should -BeTrue
    }

    It 'false when path matches no lane' {
        $lanes = @('backend/fetcher/**')
        Test-PathInLanes -RelPath 'backend/control-api/X.cs' -Lanes $lanes | Should -BeFalse
    }

    It 'normalizes backslashes' {
        Test-PathInLanes -RelPath 'backend\fetcher\PollLoop.cs' -Lanes @('backend/fetcher/**') | Should -BeTrue
    }
}

# ============================================================
Describe 'Get-RelativePath' {

    It 'strips the worktree root prefix' {
        Get-RelativePath -FullPath '/repo/backend/fetcher/X.cs' -Root '/repo' | Should -Be 'backend/fetcher/X.cs'
    }

    It 'handles Windows-style paths case-insensitively' {
        Get-RelativePath -FullPath 'C:\Repo\Backend\X.cs' -Root 'c:/repo' | Should -Be 'Backend/X.cs'
    }

    It 'returns the absolute path when outside the root' {
        Get-RelativePath -FullPath '/elsewhere/Y.cs' -Root '/repo' | Should -Be '/elsewhere/Y.cs'
    }
}

# ============================================================
Describe 'Get-LaneGuardDecision' {

    It 'allows everything when no active lanes' {
        (Get-LaneGuardDecision -RelPath 'anything/at/all.cs' -Lanes @('# only comments')).Block | Should -BeFalse
    }

    It 'allows an in-lane path' {
        (Get-LaneGuardDecision -RelPath 'backend/fetcher/X.cs' -Lanes @('backend/fetcher/**')).Block | Should -BeFalse
    }

    It 'blocks an out-of-lane path with a helpful reason' {
        $d = Get-LaneGuardDecision -RelPath 'backend/control-api/X.cs' -Lanes @('backend/fetcher/**')
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'Out of lane'
        $d.Reason | Should -Match 'backend/fetcher/\*\*'
    }

    It 'blocks an out-of-worktree absolute path' {
        (Get-LaneGuardDecision -RelPath '/elsewhere/Y.cs' -Lanes @('backend/fetcher/**')).Block | Should -BeTrue
    }

    It 'allows a write to the session outbox even when out of code lane' {
        (Get-LaneGuardDecision -RelPath '.team-process/sessions/feat-1/outbox/backend.RESULT.json' -Lanes @('backend/fetcher/**')).Block | Should -BeFalse
    }

    It 'allows an absolute-path outbox write (cross-worktree hand-back)' {
        (Get-LaneGuardDecision -RelPath '/tmp/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json' -Lanes @('backend/fetcher/**')).Block | Should -BeFalse
    }

    It 'still blocks a non-outbox .team-process write out of lane' {
        (Get-LaneGuardDecision -RelPath '.team-process/sessions/feat-1/session.json' -Lanes @('backend/fetcher/**')).Block | Should -BeTrue
    }

    It 'blocks a .. traversal that escapes the outbox exemption' {
        $d = Get-LaneGuardDecision -RelPath '.team-process/sessions/feat-1/outbox/../../../../backend/Program.cs' -Lanes @('backend/fetcher/**')
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'traversal'
    }

    It 'blocks a .. traversal that escapes the lane glob' {
        $d = Get-LaneGuardDecision -RelPath 'backend/fetcher/../control-api/X.cs' -Lanes @('backend/fetcher/**')
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'traversal'
    }
}

# ============================================================
Describe 'Test-PathHasDotDot' {
    It 'detects a .. segment' {
        Test-PathHasDotDot -RelPath 'a/../b.cs' | Should -BeTrue
    }
    It 'detects a leading ..' {
        Test-PathHasDotDot -RelPath '../escape.cs' | Should -BeTrue
    }
    It 'does not flag a filename that merely contains dots' {
        Test-PathHasDotDot -RelPath 'backend/My..Weird..Name.cs' | Should -BeFalse
    }
    It 'does not flag an ordinary path' {
        Test-PathHasDotDot -RelPath 'backend/fetcher/X.cs' | Should -BeFalse
    }
}

# ============================================================
Describe 'Test-PathIsOutbox' {
    It 'matches a relative outbox path' {
        Test-PathIsOutbox -RelPath '.team-process/sessions/feat-1/outbox/x.json' | Should -BeTrue
    }
    It 'matches an absolute outbox path' {
        Test-PathIsOutbox -RelPath '/wt/.team-process/sessions/feat-1/outbox/x.json' | Should -BeTrue
    }
    It 'does not match the session record itself' {
        Test-PathIsOutbox -RelPath '.team-process/sessions/feat-1/session.json' | Should -BeFalse
    }
    It 'does not match an ordinary product path' {
        Test-PathIsOutbox -RelPath 'backend/fetcher/X.cs' | Should -BeFalse
    }
}
