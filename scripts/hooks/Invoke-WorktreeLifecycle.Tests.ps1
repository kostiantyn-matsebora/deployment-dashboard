#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-WorktreeLifecycle.ps1')).Path
    . $script:ScriptPath -AsLibrary

    # ----- Stub builders -----

    function New-GitRunner {
        param([hashtable]$Responses)
        return {
            param([string[]]$Argv)
            $key = $Argv -join ' '
            foreach ($k in $Responses.Keys) {
                if ($key -match [regex]::Escape($k) -or $key -eq $k) {
                    return $Responses[$k]
                }
            }
            return @()
        }.GetNewClosure()
    }

    function New-DirLister {
        # Keys are absolute-style paths (forward or back slashes — normalized on
        # lookup). Value $null means "does not exist". Use `,` (comma operator) so
        # an empty @() is preserved as an array and not unwrapped to $null by
        # PowerShell's pipeline.
        param([hashtable]$Tree)
        $normalized = @{}
        foreach ($k in $Tree.Keys) {
            $nk = $k -replace '[/\\]', [IO.Path]::DirectorySeparatorChar
            $normalized[$nk] = $Tree[$k]
        }
        return {
            param([string]$AbsDir)
            $key = $AbsDir -replace '[/\\]', [IO.Path]::DirectorySeparatorChar
            if ($normalized.ContainsKey($key)) {
                $val = $normalized[$key]
                if ($null -eq $val) { return $null }
                return ,$val
            }
            return $null
        }.GetNewClosure()
    }

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

    function New-SpyWriter {
        # Capture the list object directly — $script: scope is not reliably
        # reachable inside GetNewClosure() when invoked from a dot-sourced function.
        $list = [System.Collections.Generic.List[hashtable]]::new()
        $script:WriterCalls = $list
        return {
            param([string]$Path, [hashtable]$Marker)
            $list.Add(@{ Path = $Path; Marker = $Marker })
        }.GetNewClosure()
    }

    function New-SpyDeleter {
        $script:DeleterCalls = [System.Collections.Generic.List[string]]::new()
        return {
            param([string]$Path)
            $script:DeleterCalls.Add($Path)
        }.GetNewClosure()
    }

    function New-SpyCreator {
        # Capture the list object directly — $script: scope is not reliably
        # reachable inside GetNewClosure() when invoked from a dot-sourced function.
        $list = [System.Collections.Generic.List[hashtable]]::new()
        $script:CreatorCalls = $list
        return {
            param([string]$Path)
            $list.Add(@{ Path = $Path })
        }.GetNewClosure()
    }

    function New-MarkerJson {
        param(
            [string]$SessionId    = 'sid-1',
            [string]$WorktreePath = '/repo/.claude/worktrees/feature-x',
            [string]$Branch       = 'feature-x',
            [string]$Status       = 'ended-dirty'
        )
        return (@{
            sessionId    = $SessionId
            worktreePath = $WorktreePath
            branch       = $Branch
            status       = $Status
        } | ConvertTo-Json -Compress)
    }

    # Helpers for SnapshotSession tests — avoids repeating Console.SetOut boilerplate.
    function Invoke-SnapshotSession {
        param([hashtable]$Params)
        $sb = [System.Text.StringBuilder]::new()
        $sw = [System.IO.StringWriter]::new($sb)
        [Console]::SetOut($sw)
        try {
            $result = Invoke-WorktreeLifecycle @Params -SnapshotSession
        }
        finally {
            [Console]::SetOut([System.IO.StreamWriter]::new([Console]::OpenStandardOutput()))
        }
        return @{ Result = $result; Stdout = $sb.ToString().Trim() }
    }

    # GitRunner stubs for topology scenarios.
    function New-MainCheckoutGit {
        return New-GitRunner @{
            'rev-parse --show-toplevel'   = '/repo'
            'worktree list --porcelain'   = @('worktree /repo', 'HEAD abc123', 'branch refs/heads/main')
            'rev-parse --abbrev-ref HEAD' = 'main'
        }
    }

    function New-LinkedWorktreeGit {
        return New-GitRunner @{
            'rev-parse --show-toplevel'   = '/repo/wt/feat'
            'worktree list --porcelain'   = @('worktree /repo')
            'rev-parse --abbrev-ref HEAD' = 'feat'
        }
    }
}

# ============================================================
Describe 'Get-WorktreeStateFilePath' {

    It 'no sid -> global path ending in .worktree-state.json' {
        $path = Get-WorktreeStateFilePath -RepoRoot '/repo' -SessionId ''
        $path | Should -Match '\.worktree-state\.json$'
        $path | Should -Not -Match '\.worktree-state\.\.'
    }

    It 'with sid "abc" -> path ending in .worktree-state.abc.json' {
        $path = Get-WorktreeStateFilePath -RepoRoot '/repo' -SessionId 'abc'
        $path | Should -Match '\.worktree-state\.abc\.json$'
    }

    It 'unsafe chars in sid sanitized to _' {
        $path = Get-WorktreeStateFilePath -RepoRoot '/repo' -SessionId 'abc/def@123!'
        $path | Should -Match '\.worktree-state\.abc_def_123_\.json$'
    }

    It 'null sid treated as empty -> global path' {
        $path = Get-WorktreeStateFilePath -RepoRoot '/repo' -SessionId $null
        $path | Should -Match '\.worktree-state\.json$'
    }
}

# ============================================================
Describe 'Get-SessionBranchName' {

    It 'prefixes sanitized sid with session/' {
        Get-SessionBranchName -SessionId 'abc123' | Should -Be 'session/abc123'
    }

    It 'sanitizes unsafe chars' {
        Get-SessionBranchName -SessionId 'abc/def@123' | Should -Be 'session/abc_def_123'
    }

    It 'returns empty string for empty sid' {
        Get-SessionBranchName -SessionId '' | Should -Be ''
    }

    It 'returns empty string for null sid' {
        Get-SessionBranchName -SessionId $null | Should -Be ''
    }
}

# ============================================================
Describe 'Get-SessionWorktreePath' {

    It 'places worktree as sibling with -wt-<sid> suffix' {
        $path = Get-SessionWorktreePath -RepoRoot '/projects/myrepo' -SessionId 'abc123'
        $path | Should -Match 'myrepo-wt-abc123$'
    }

    It 'is a sibling of the repo (parent dir matches)' {
        $path = Get-SessionWorktreePath -RepoRoot '/projects/myrepo' -SessionId 'abc123'
        (Split-Path -Parent $path) | Should -Be (
            '/projects' -replace '[/\\]', [IO.Path]::DirectorySeparatorChar
        )
    }

    It 'handles single-component absolute path (e.g. /repo on Linux)' {
        $path = Get-SessionWorktreePath -RepoRoot '/repo' -SessionId 'abc123'
        $path | Should -Match 'repo-wt-abc123'
    }

    It 'returns empty for empty sid' {
        Get-SessionWorktreePath -RepoRoot '/repo' -SessionId '' | Should -Be ''
    }

    It 'returns empty for empty RepoRoot' {
        Get-SessionWorktreePath -RepoRoot '' -SessionId 'abc' | Should -Be ''
    }
}

# ============================================================
Describe 'Format-WorktreeCreatedContext' {

    BeforeAll {
        $script:Created = Format-WorktreeCreatedContext -Path '/projects/myrepo-wt-abc'
    }

    It 'contains path' {
        $script:Created | Should -Match ([regex]::Escape('/projects/myrepo-wt-abc'))
    }

    It 'mentions EnterWorktree' {
        $script:Created | Should -Match 'EnterWorktree'
    }
}

# ============================================================
Describe 'Get-WorktreeInfo' {

    It 'IsWorktree true when current != main' {
        $runner = New-GitRunner @{
            'rev-parse --show-toplevel'   = '/repo/.claude/worktrees/feature-x'
            'worktree list --porcelain'   = @(
                'worktree /repo',
                'HEAD abc123',
                'branch refs/heads/main',
                '',
                'worktree /repo/.claude/worktrees/feature-x',
                'HEAD def456',
                'branch refs/heads/feature-x'
            )
            'rev-parse --abbrev-ref HEAD' = 'feature-x'
        }
        $info = Get-WorktreeInfo -GitRunner $runner
        $info.IsWorktree | Should -BeTrue
        $info.Current    | Should -Be '/repo/.claude/worktrees/feature-x'
        $info.Main       | Should -Be '/repo'
    }

    It 'IsWorktree false when current = main' {
        $runner = New-GitRunner @{
            'rev-parse --show-toplevel'   = '/repo'
            'worktree list --porcelain'   = @('worktree /repo', 'HEAD abc123', 'branch refs/heads/main')
            'rev-parse --abbrev-ref HEAD' = 'main'
        }
        $info = Get-WorktreeInfo -GitRunner $runner
        $info.IsWorktree | Should -BeFalse
    }

    It 'Branch extracted from rev-parse output' {
        $runner = New-GitRunner @{
            'rev-parse --show-toplevel'   = '/repo/.claude/worktrees/feat'
            'worktree list --porcelain'   = @('worktree /repo')
            'rev-parse --abbrev-ref HEAD' = 'feat'
        }
        $info = Get-WorktreeInfo -GitRunner $runner
        $info.Branch | Should -Be 'feat'
    }

    It 'empty Branch when git returns empty' {
        $runner = New-GitRunner @{
            'rev-parse --show-toplevel'   = '/repo/.claude/worktrees/feat'
            'worktree list --porcelain'   = @('worktree /repo')
            'rev-parse --abbrev-ref HEAD' = ''
        }
        $info = Get-WorktreeInfo -GitRunner $runner
        $info.Branch | Should -Be ''
    }

    It 'empty Branch when HEAD is detached' {
        $runner = New-GitRunner @{
            'rev-parse --show-toplevel'   = '/repo/.claude/worktrees/feat'
            'worktree list --porcelain'   = @('worktree /repo')
            'rev-parse --abbrev-ref HEAD' = 'HEAD'
        }
        $info = Get-WorktreeInfo -GitRunner $runner
        $info.Branch | Should -Be ''
    }
}

# ============================================================
Describe 'Test-WorktreeClean' {

    It 'true when git status --porcelain returns empty' {
        $runner = New-GitRunner @{ 'status --porcelain' = '' }
        Test-WorktreeClean -GitRunner $runner | Should -BeTrue
    }

    It 'false when it returns output' {
        $runner = New-GitRunner @{ 'status --porcelain' = ' M src/file.ts' }
        Test-WorktreeClean -GitRunner $runner | Should -BeFalse
    }

    It 'false when output has multiple lines' {
        $runner = New-GitRunner @{ 'status --porcelain' = @(' M a.ts', '?? b.ts') }
        Test-WorktreeClean -GitRunner $runner | Should -BeFalse
    }
}

# ============================================================
Describe 'Test-WorktreeHasUnpushedCommits' {

    It 'false when rev-list count is 0 (all pushed)' {
        $runner = New-GitRunner @{
            'rev-parse --abbrev-ref HEAD'    = 'main'
            'rev-list --count @{u}..HEAD'    = '0'
        }
        Test-WorktreeHasUnpushedCommits -GitRunner $runner | Should -BeFalse
    }

    It 'true when rev-list count is non-zero' {
        $runner = New-GitRunner @{
            'rev-parse --abbrev-ref HEAD'    = 'feat'
            'rev-list --count @{u}..HEAD'    = '3'
        }
        Test-WorktreeHasUnpushedCommits -GitRunner $runner | Should -BeTrue
    }

    It 'true when git returns empty (no upstream configured)' {
        $runner = New-GitRunner @{ 'rev-parse --abbrev-ref HEAD' = 'feat' }
        Test-WorktreeHasUnpushedCommits -GitRunner $runner | Should -BeTrue
    }

    It 'true when git returns whitespace only' {
        $runner = New-GitRunner @{
            'rev-parse --abbrev-ref HEAD'    = 'feat'
            'rev-list --count @{u}..HEAD'    = '   '
        }
        Test-WorktreeHasUnpushedCommits -GitRunner $runner | Should -BeTrue
    }

    It 'true when detached HEAD and no MainGitRunner' {
        $runner = New-GitRunner @{ 'rev-parse --abbrev-ref HEAD' = 'HEAD' }
        Test-WorktreeHasUnpushedCommits -GitRunner $runner | Should -BeTrue
    }

    It 'false when detached HEAD and HEAD equals main HEAD (no new commits)' {
        $runner = New-GitRunner @{
            'rev-parse --abbrev-ref HEAD'   = 'HEAD'
            'rev-list --count abc123..HEAD' = '0'
        }
        $mainRunner = New-GitRunner @{ 'rev-parse HEAD' = 'abc123' }
        Test-WorktreeHasUnpushedCommits -GitRunner $runner -MainGitRunner $mainRunner | Should -BeFalse
    }

    It 'true when detached HEAD and commits exist beyond main HEAD' {
        $runner = New-GitRunner @{
            'rev-parse --abbrev-ref HEAD'   = 'HEAD'
            'rev-list --count abc123..HEAD' = '2'
        }
        $mainRunner = New-GitRunner @{ 'rev-parse HEAD' = 'abc123' }
        Test-WorktreeHasUnpushedCommits -GitRunner $runner -MainGitRunner $mainRunner | Should -BeTrue
    }
}

# ============================================================
Describe 'Find-EndedDirtyMarkers' {

    It 'returns markers with status ended-dirty whose path exists' {
        $markerJson = New-MarkerJson -SessionId 'sid-1' -WorktreePath '/repo/wt/feat' -Branch 'feat' -Status 'ended-dirty'
        $lister = New-DirLister @{
            '/repo/.claude' = @('.worktree-state.sid-1.json')
            '/repo/wt/feat' = @()
        }
        $reader = New-FileReader @{ '/repo/.claude/.worktree-state.sid-1.json' = $markerJson }

        $result = Find-EndedDirtyMarkers -RepoRoot '/repo' -DirLister $lister -FileReader $reader
        $result.Count | Should -Be 1
        $result[0].branch | Should -Be 'feat'
        $result[0].status | Should -Be 'ended-dirty'
    }

    It 'excludes markers with path that does not exist' {
        $markerJson = New-MarkerJson -SessionId 'sid-2' -WorktreePath '/repo/wt/gone' -Branch 'gone' -Status 'ended-dirty'
        $lister = New-DirLister @{
            '/repo/.claude' = @('.worktree-state.sid-2.json')
        }
        $reader = New-FileReader @{ '/repo/.claude/.worktree-state.sid-2.json' = $markerJson }

        $result = Find-EndedDirtyMarkers -RepoRoot '/repo' -DirLister $lister -FileReader $reader
        $result.Count | Should -Be 0
    }

    It 'excludes markers that are not ended-dirty' {
        $markerJson = New-MarkerJson -SessionId 'sid-3' -WorktreePath '/repo/wt/feat' -Branch 'feat' -Status 'active'
        $lister = New-DirLister @{
            '/repo/.claude' = @('.worktree-state.sid-3.json')
            '/repo/wt/feat' = @()
        }
        $reader = New-FileReader @{ '/repo/.claude/.worktree-state.sid-3.json' = $markerJson }

        $result = Find-EndedDirtyMarkers -RepoRoot '/repo' -DirLister $lister -FileReader $reader
        $result.Count | Should -Be 0
    }

    It 'returns empty when no marker files present' {
        $lister = New-DirLister @{ '/repo/.claude' = @('settings.json', 'CLAUDE.md') }
        $reader = New-FileReader @{}

        $result = Find-EndedDirtyMarkers -RepoRoot '/repo' -DirLister $lister -FileReader $reader
        $result.Count | Should -Be 0
    }

    It 'returns empty when .claude dir is absent' {
        $lister = New-DirLister @{}
        $reader = New-FileReader @{}

        $result = Find-EndedDirtyMarkers -RepoRoot '/repo' -DirLister $lister -FileReader $reader
        $result.Count | Should -Be 0
    }

    It 'returns only ended-dirty markers when mixed statuses present' {
        $dirtyJson  = New-MarkerJson -SessionId 'sid-d' -WorktreePath '/repo/wt/d' -Branch 'd' -Status 'ended-dirty'
        $activeJson = New-MarkerJson -SessionId 'sid-a' -WorktreePath '/repo/wt/a' -Branch 'a' -Status 'active'
        $lister = New-DirLister @{
            '/repo/.claude' = @('.worktree-state.sid-d.json', '.worktree-state.sid-a.json')
            '/repo/wt/d'    = @()
            '/repo/wt/a'    = @()
        }
        $reader = New-FileReader @{
            '/repo/.claude/.worktree-state.sid-d.json' = $dirtyJson
            '/repo/.claude/.worktree-state.sid-a.json' = $activeJson
        }

        $result = Find-EndedDirtyMarkers -RepoRoot '/repo' -DirLister $lister -FileReader $reader
        $result.Count     | Should -Be 1
        $result[0].branch | Should -Be 'd'
    }
}

# ============================================================
Describe 'Format-WorktreeProposal' {

    BeforeAll {
        $script:TestMarkers = @(
            [PSCustomObject]@{
                sessionId    = 'sid-1'
                worktreePath = '/repo/.claude/worktrees/feature-x'
                branch       = 'feature-x'
                status       = 'ended-dirty'
                markerPath   = '/repo/.claude/.worktree-state.sid-1.json'
            }
        )
        $script:Proposal = Format-WorktreeProposal -Markers $script:TestMarkers
    }

    It 'contains branch name' {
        $script:Proposal | Should -Match 'feature-x'
    }

    It 'contains worktreePath' {
        $script:Proposal | Should -Match ([regex]::Escape('/repo/.claude/worktrees/feature-x'))
    }

    It 'mentions continue option' {
        $script:Proposal | Should -Match '"continue <branch>"'
    }

    It 'mentions discard option' {
        $script:Proposal | Should -Match '"discard <branch>"'
    }

    It 'includes header about leftover worktrees' {
        $script:Proposal | Should -Match 'Leftover worktree'
    }
}

# ============================================================
Describe 'Invoke-WorktreeLifecycle -SessionEnd' {

    BeforeEach {
        $script:GitCalls     = [System.Collections.Generic.List[string]]::new()
        $script:WriterCalls  = [System.Collections.Generic.List[hashtable]]::new()
        $script:DeleterCalls = [System.Collections.Generic.List[string]]::new()
    }

    Context 'in worktree + clean working tree + all commits pushed' {
        It 'calls worktree remove and returns Action=removed' {
            $spyGit = {
                param([string[]]$Argv)
                $script:GitCalls.Add(($Argv -join ' '))
                switch ($Argv -join ' ') {
                    'rev-parse --show-toplevel'        { return '/repo/wt/feat' }
                    'worktree list --porcelain'        { return @('worktree /repo') }
                    'rev-parse --abbrev-ref HEAD'      { return 'feat' }
                    'status --porcelain'               { return '' }
                    'rev-list --count @{u}..HEAD'      { return '0' }
                    default                            { return @() }
                }
            }
            $lister  = New-DirLister @{ '/repo/.claude' = @() }
            $reader  = New-FileReader @{}
            $writer  = { param([string]$P, [hashtable]$M) $script:WriterCalls.Add(@{ Path = $P; Marker = $M }) }
            $deleter = { param([string]$P) $script:DeleterCalls.Add($P) }

            $result = Invoke-WorktreeLifecycle `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $spyGit -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SessionEnd

            $result.Action     | Should -Be 'removed'
            $result.IsWorktree | Should -BeTrue
            $result.WasClean   | Should -BeTrue

            ($script:GitCalls | Where-Object { $_ -match 'worktree remove' }) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'in worktree + clean working tree + unpushed commits' {
        It 'writes marker and returns Action=marked-dirty' {
            $spyGit = {
                param([string[]]$Argv)
                switch ($Argv -join ' ') {
                    'rev-parse --show-toplevel'   { return '/repo/wt/feat' }
                    'worktree list --porcelain'   { return @('worktree /repo') }
                    'rev-parse --abbrev-ref HEAD' { return 'feat' }
                    'status --porcelain'          { return '' }
                    'rev-list --count @{u}..HEAD' { return '2' }
                    default                       { return @() }
                }
            }
            $lister  = New-DirLister @{ '/repo/.claude' = @() }
            $reader  = New-FileReader @{}
            $writer  = { param([string]$P, [hashtable]$M) $script:WriterCalls.Add(@{ Path = $P; Marker = $M }) }
            $deleter = { param([string]$P) $script:DeleterCalls.Add($P) }

            $result = Invoke-WorktreeLifecycle `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $spyGit -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SessionEnd

            $result.Action   | Should -Be 'marked-dirty'
            $result.WasClean | Should -BeFalse
            $script:WriterCalls.Count | Should -Be 1
        }
    }

    Context 'in worktree + clean working tree + no upstream' {
        It 'writes marker and returns Action=marked-dirty' {
            $spyGit = {
                param([string[]]$Argv)
                switch ($Argv -join ' ') {
                    'rev-parse --show-toplevel'   { return '/repo/wt/feat' }
                    'worktree list --porcelain'   { return @('worktree /repo') }
                    'rev-parse --abbrev-ref HEAD' { return 'feat' }
                    'status --porcelain'          { return '' }
                    # rev-list returns empty — no upstream configured
                    default                       { return @() }
                }
            }
            $lister  = New-DirLister @{ '/repo/.claude' = @() }
            $reader  = New-FileReader @{}
            $writer  = { param([string]$P, [hashtable]$M) $script:WriterCalls.Add(@{ Path = $P; Marker = $M }) }
            $deleter = { param([string]$P) $script:DeleterCalls.Add($P) }

            $result = Invoke-WorktreeLifecycle `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $spyGit -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SessionEnd

            $result.Action   | Should -Be 'marked-dirty'
            $result.WasClean | Should -BeFalse
            $script:WriterCalls.Count | Should -Be 1
        }
    }

    Context 'in worktree + detached HEAD + clean + no new commits' {
        It 'removes worktree and returns Action=removed' {
            $spyGit = {
                param([string[]]$Argv)
                $script:GitCalls.Add(($Argv -join ' '))
                switch ($Argv -join ' ') {
                    'rev-parse --show-toplevel'        { return '/repo/wt/feat' }
                    'worktree list --porcelain'        { return @('worktree /repo') }
                    'rev-parse --abbrev-ref HEAD'      { return 'HEAD' }
                    'status --porcelain'               { return '' }
                    'rev-list --count abc123..HEAD'    { return '0' }
                    default                            { return @() }
                }
            }
            $mainGit = New-GitRunner @{ 'rev-parse HEAD' = 'abc123' }
            $lister  = New-DirLister @{ '/repo/.claude' = @() }
            $reader  = New-FileReader @{}
            $writer  = { param([string]$P, [hashtable]$M) $script:WriterCalls.Add(@{ Path = $P; Marker = $M }) }
            $deleter = { param([string]$P) $script:DeleterCalls.Add($P) }

            $result = Invoke-WorktreeLifecycle `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $spyGit -MainGitRunner $mainGit `
                -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SessionEnd

            $result.Action     | Should -Be 'removed'
            $result.IsWorktree | Should -BeTrue
            $result.WasClean   | Should -BeTrue
        }
    }

    Context 'in worktree + detached HEAD + clean + new commits exist' {
        It 'marks dirty and returns Action=marked-dirty' {
            $spyGit = {
                param([string[]]$Argv)
                switch ($Argv -join ' ') {
                    'rev-parse --show-toplevel'        { return '/repo/wt/feat' }
                    'worktree list --porcelain'        { return @('worktree /repo') }
                    'rev-parse --abbrev-ref HEAD'      { return 'HEAD' }
                    'status --porcelain'               { return '' }
                    'rev-list --count abc123..HEAD'    { return '1' }
                    default                            { return @() }
                }
            }
            $mainGit = New-GitRunner @{ 'rev-parse HEAD' = 'abc123' }
            $lister  = New-DirLister @{ '/repo/.claude' = @() }
            $reader  = New-FileReader @{}
            $writer  = { param([string]$P, [hashtable]$M) $script:WriterCalls.Add(@{ Path = $P; Marker = $M }) }
            $deleter = { param([string]$P) $script:DeleterCalls.Add($P) }

            $result = Invoke-WorktreeLifecycle `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $spyGit -MainGitRunner $mainGit `
                -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SessionEnd

            $result.Action   | Should -Be 'marked-dirty'
            $result.WasClean | Should -BeFalse
            $script:WriterCalls.Count | Should -Be 1
        }
    }

    Context 'in worktree + dirty' {
        BeforeEach {
            $script:DirtyGit = {
                param([string[]]$Argv)
                switch ($Argv -join ' ') {
                    'rev-parse --show-toplevel'   { return '/repo/wt/feat' }
                    'worktree list --porcelain'   { return @('worktree /repo') }
                    'rev-parse --abbrev-ref HEAD' { return 'feat' }
                    'status --porcelain'          { return ' M src/file.ts' }
                    default                       { return @() }
                }
            }
            $script:NoOpLister = New-DirLister @{ '/repo/.claude' = @() }
            $script:NoOpReader = New-FileReader @{}
            $script:SpyWriter  = { param([string]$P, [hashtable]$M) $script:WriterCalls.Add(@{ Path = $P; Marker = $M }) }
            $script:SpyDeleter = { param([string]$P) $script:DeleterCalls.Add($P) }
        }

        It 'writes marker file and returns Action=marked-dirty' {
            $result = Invoke-WorktreeLifecycle `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $script:DirtyGit `
                -DirLister $script:NoOpLister -FileReader $script:NoOpReader `
                -MarkerWriter $script:SpyWriter -MarkerDeleter $script:SpyDeleter `
                -SessionEnd

            $result.Action            | Should -Be 'marked-dirty'
            $script:WriterCalls.Count | Should -Be 1
        }

        It 'marker has status=ended-dirty and correct worktreePath' {
            Invoke-WorktreeLifecycle `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $script:DirtyGit `
                -DirLister $script:NoOpLister -FileReader $script:NoOpReader `
                -MarkerWriter $script:SpyWriter -MarkerDeleter $script:SpyDeleter `
                -SessionEnd | Out-Null

            $written = $script:WriterCalls[0].Marker
            $written.status       | Should -Be 'ended-dirty'
            $written.worktreePath | Should -Be '/repo/wt/feat'
            $written.branch       | Should -Be 'feat'
        }
    }

    Context 'not in worktree' {
        It 'calls worktree prune and returns Action=pruned' {
            $gitCalls = [System.Collections.Generic.List[string]]::new()
            $spyGit = {
                param([string[]]$Argv)
                $gitCalls.Add(($Argv -join ' '))
                switch ($Argv -join ' ') {
                    'rev-parse --show-toplevel'   { return '/repo' }
                    'worktree list --porcelain'   { return @('worktree /repo') }
                    'rev-parse --abbrev-ref HEAD' { return 'main' }
                    default                       { return @() }
                }
            }
            $lister  = New-DirLister @{ '/repo/.claude' = @() }
            $reader  = New-FileReader @{}
            $writer  = { param([string]$P, [hashtable]$M) }
            $deleter = { param([string]$P) }

            $result = Invoke-WorktreeLifecycle `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $spyGit -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SessionEnd

            $result.Action     | Should -Be 'pruned'
            $result.IsWorktree | Should -BeFalse

            ($gitCalls | Where-Object { $_ -match 'worktree prune' }) | Should -Not -BeNullOrEmpty
        }
    }
}

# ============================================================
Describe 'Invoke-WorktreeLifecycle -SnapshotSession (no auto-worktree)' {

    It 'no ended-dirty markers: ProposalEmitted=false, no stdout' {
        $out = Invoke-SnapshotSession @{
            RepoRoot      = '/repo'
            SessionId     = 'sid-1'
            GitRunner     = (New-GitRunner @{})
            DirLister     = (New-DirLister @{ '/repo/.claude' = @() })
            FileReader    = (New-FileReader @{})
            MarkerWriter  = { param([string]$P, [hashtable]$M) }
            MarkerDeleter = { param([string]$P) }
        }

        $out.Result.ProposalEmitted | Should -BeFalse
        $out.Stdout                 | Should -BeNullOrEmpty
    }

    It 'ended-dirty marker present: ProposalEmitted=true, stdout is valid JSON with additionalContext' {
        $markerJson = New-MarkerJson -SessionId 'sid-1' -WorktreePath '/repo/wt/feat' -Branch 'feat-branch' -Status 'ended-dirty'
        $out = Invoke-SnapshotSession @{
            RepoRoot      = '/repo'
            SessionId     = 'sid-2'
            GitRunner     = (New-GitRunner @{})
            DirLister     = (New-DirLister @{ '/repo/.claude' = @('.worktree-state.sid-1.json'); '/repo/wt/feat' = @() })
            FileReader    = (New-FileReader @{ '/repo/.claude/.worktree-state.sid-1.json' = $markerJson })
            MarkerWriter  = { param([string]$P, [hashtable]$M) }
            MarkerDeleter = { param([string]$P) }
        }

        $out.Result.ProposalEmitted | Should -BeTrue
        $out.Result.Count           | Should -Be 1
        $out.Stdout                 | Should -Not -BeNullOrEmpty

        $parsed = $out.Stdout | ConvertFrom-Json
        $parsed.additionalContext | Should -Not -BeNullOrEmpty
    }

    It 'additionalContext contains branch name from marker' {
        $markerJson = New-MarkerJson -SessionId 'sid-1' -WorktreePath '/repo/wt/my-feature' -Branch 'my-feature' -Status 'ended-dirty'
        $out = Invoke-SnapshotSession @{
            RepoRoot      = '/repo'
            SessionId     = 'sid-2'
            GitRunner     = (New-GitRunner @{})
            DirLister     = (New-DirLister @{ '/repo/.claude' = @('.worktree-state.sid-1.json'); '/repo/wt/my-feature' = @() })
            FileReader    = (New-FileReader @{ '/repo/.claude/.worktree-state.sid-1.json' = $markerJson })
            MarkerWriter  = { param([string]$P, [hashtable]$M) }
            MarkerDeleter = { param([string]$P) }
        }

        ($out.Stdout | ConvertFrom-Json).additionalContext | Should -Match 'my-feature'
    }
}

# ============================================================
Describe 'Invoke-WorktreeLifecycle -SnapshotSession -AutoWorktree' {

    BeforeEach {
        $script:CreatorCalls = [System.Collections.Generic.List[hashtable]]::new()
    }

    It 'calls WorktreeCreator when in main checkout' {
        $spy = New-SpyCreator
        $out = Invoke-SnapshotSession @{
            RepoRoot         = '/repo'
            SessionId        = 'abc123'
            GitRunner        = (New-MainCheckoutGit)
            DirLister        = (New-DirLister @{ '/repo/.claude' = @() })
            FileReader       = (New-FileReader @{})
            MarkerWriter     = { param([string]$P, [hashtable]$M) }
            MarkerDeleter    = { param([string]$P) }
            WorktreeCreator  = $spy
            AutoWorktree     = $true
        }

        $script:CreatorCalls.Count          | Should -Be 1
        $script:CreatorCalls[0].Path        | Should -Match 'abc123'
        $out.Result.ProposalEmitted         | Should -BeTrue
        $out.Result.AutoWorktree            | Should -BeTrue
    }

    It 'WorktreeCreator receives path containing repo name and session id' {
        $spy = New-SpyCreator
        $out = Invoke-SnapshotSession @{
            RepoRoot         = '/projects/myrepo'
            SessionId        = 'sid123'
            GitRunner        = (New-GitRunner @{
                'rev-parse --show-toplevel'   = '/projects/myrepo'
                'worktree list --porcelain'   = @('worktree /projects/myrepo')
                'rev-parse --abbrev-ref HEAD' = 'main'
            })
            DirLister        = (New-DirLister @{ '/projects/myrepo/.claude' = @() })
            FileReader       = (New-FileReader @{})
            MarkerWriter     = { param([string]$P, [hashtable]$M) }
            MarkerDeleter    = { param([string]$P) }
            WorktreeCreator  = $spy
            AutoWorktree     = $true
        }

        $script:CreatorCalls[0].Path | Should -Match 'myrepo-wt-sid123'
    }

    It 'does NOT call WorktreeCreator when AutoWorktree is false' {
        $spy = New-SpyCreator
        Invoke-WorktreeLifecycle `
            -RepoRoot '/repo' -SessionId 'abc123' `
            -GitRunner (New-MainCheckoutGit) `
            -DirLister (New-DirLister @{ '/repo/.claude' = @() }) `
            -FileReader (New-FileReader @{}) `
            -MarkerWriter { param([string]$P, [hashtable]$M) } `
            -MarkerDeleter { param([string]$P) } `
            -WorktreeCreator $spy `
            -SnapshotSession | Out-Null

        $script:CreatorCalls.Count | Should -Be 0
    }

    It 'does NOT call WorktreeCreator when already in a linked worktree' {
        $spy = New-SpyCreator
        $out = Invoke-SnapshotSession @{
            RepoRoot         = '/repo/wt/feat'
            SessionId        = 'abc123'
            GitRunner        = (New-LinkedWorktreeGit)
            DirLister        = (New-DirLister @{ '/repo/wt/feat/.claude' = @() })
            FileReader       = (New-FileReader @{})
            MarkerWriter     = { param([string]$P, [hashtable]$M) }
            MarkerDeleter    = { param([string]$P) }
            WorktreeCreator  = $spy
            AutoWorktree     = $true
        }

        $script:CreatorCalls.Count | Should -Be 0
    }

    It 'additionalContext includes EnterWorktree instruction' {
        $spy = New-SpyCreator
        $out = Invoke-SnapshotSession @{
            RepoRoot         = '/repo'
            SessionId        = 'abc123'
            GitRunner        = (New-MainCheckoutGit)
            DirLister        = (New-DirLister @{ '/repo/.claude' = @() })
            FileReader       = (New-FileReader @{})
            MarkerWriter     = { param([string]$P, [hashtable]$M) }
            MarkerDeleter    = { param([string]$P) }
            WorktreeCreator  = $spy
            AutoWorktree     = $true
        }

        ($out.Stdout | ConvertFrom-Json).additionalContext | Should -Match 'EnterWorktree'
    }

    It 'combines worktree-created context with dirty-marker proposal' {
        $spy        = New-SpyCreator
        $markerJson = New-MarkerJson -SessionId 'old-sid' -WorktreePath '/repo/wt/old' -Branch 'old-branch' -Status 'ended-dirty'
        $out = Invoke-SnapshotSession @{
            RepoRoot         = '/repo'
            SessionId        = 'new-sid'
            GitRunner        = (New-MainCheckoutGit)
            DirLister        = (New-DirLister @{
                '/repo/.claude'  = @('.worktree-state.old-sid.json')
                '/repo/wt/old'   = @()
            })
            FileReader       = (New-FileReader @{ '/repo/.claude/.worktree-state.old-sid.json' = $markerJson })
            MarkerWriter     = { param([string]$P, [hashtable]$M) }
            MarkerDeleter    = { param([string]$P) }
            WorktreeCreator  = $spy
            AutoWorktree     = $true
        }

        $ctx = ($out.Stdout | ConvertFrom-Json).additionalContext
        $ctx | Should -Match 'EnterWorktree'
        $ctx | Should -Match 'old-branch'
    }
}

# ============================================================
Describe 'Invoke-WorktreeLifecycle -SnapshotSession -AutoWorktree (pending marker)' {

    BeforeEach {
        $script:WriterCalls  = [System.Collections.Generic.List[hashtable]]::new()
        $script:CreatorCalls = [System.Collections.Generic.List[hashtable]]::new()
    }

    It 'writes pending-entry marker when worktree is created' {
        # Dedicated variable avoids contamination from $script:WriterCalls used by SessionEnd tests.
        $script:PendingMarkerCalls = [System.Collections.Generic.List[hashtable]]::new()
        Invoke-WorktreeLifecycle `
            -RepoRoot '/repo' -SessionId 'sid123' `
            -GitRunner (New-MainCheckoutGit) `
            -DirLister (New-DirLister @{ '/repo/.claude' = @() }) `
            -FileReader (New-FileReader @{}) `
            -MarkerWriter { param([string]$P, [hashtable]$M) $script:PendingMarkerCalls.Add(@{ Path = $P; Marker = $M }) } `
            -MarkerDeleter { param([string]$P) } `
            -WorktreeCreator { param([string]$P) } `
            -AutoWorktree `
            -SnapshotSession | Out-Null

        # @() forces array semantics — Where-Object returns a scalar when there is exactly one
        # match; the scalar's .Count would be the hashtable's key count (2), not 1.
        $pendingWrites = @($script:PendingMarkerCalls | Where-Object { $_.Path -match '\.worktree-pending\.' })
        $pendingWrites.Count | Should -Be 1
        $pendingWrites[0].Marker.worktreePath | Should -Match 'sid123'
        $pendingWrites[0].Marker.sessionId    | Should -Be 'sid123'
    }

    It 'does NOT write pending-entry marker when AutoWorktree is false' {
        Invoke-WorktreeLifecycle `
            -RepoRoot '/repo' -SessionId 'sid123' `
            -GitRunner (New-MainCheckoutGit) `
            -DirLister (New-DirLister @{ '/repo/.claude' = @() }) `
            -FileReader (New-FileReader @{}) `
            -MarkerWriter { param([string]$P, [hashtable]$M) $script:WriterCalls.Add(@{ Path = $P; Marker = $M }) } `
            -MarkerDeleter { param([string]$P) } `
            -SnapshotSession | Out-Null

        @($script:WriterCalls | Where-Object { $_.Path -match '\.worktree-pending\.' }).Count | Should -Be 0
    }

    It 'does NOT write pending-entry marker when already in a linked worktree' {
        $spy = New-SpyCreator
        Invoke-SnapshotSession @{
            RepoRoot        = '/repo/wt/feat'
            SessionId       = 'sid123'
            GitRunner       = (New-LinkedWorktreeGit)
            DirLister       = (New-DirLister @{ '/repo/wt/feat/.claude' = @() })
            FileReader      = (New-FileReader @{})
            MarkerWriter    = { param([string]$P, [hashtable]$M) $script:WriterCalls.Add(@{ Path = $P; Marker = $M }) }
            MarkerDeleter   = { param([string]$P) }
            WorktreeCreator = $spy
            AutoWorktree    = $true
        } | Out-Null

        @($script:WriterCalls | Where-Object { $_.Path -match '\.worktree-pending\.' }).Count | Should -Be 0
    }
}

# ============================================================
Describe 'Round-trip: Write-WorktreeMarker / Read-WorktreeMarker / Remove-WorktreeMarker' {

    BeforeAll {
        $script:TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "wt-test-$(New-Guid)"
        New-Item -ItemType Directory -Path $script:TmpDir -Force | Out-Null
    }

    AfterAll {
        Remove-Item -LiteralPath $script:TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'writes then reads back the marker correctly' {
        $path   = Join-Path $script:TmpDir '.worktree-state.rt.json'
        $marker = @{ sessionId = 'rt-1'; worktreePath = '/wt/x'; branch = 'x'; status = 'ended-dirty' }
        Write-WorktreeMarker -Path $path -Marker $marker

        $read = Read-WorktreeMarker -Path $path
        $read               | Should -Not -BeNull
        $read.sessionId     | Should -Be 'rt-1'
        $read.status        | Should -Be 'ended-dirty'
        $read.branch        | Should -Be 'x'
    }

    It 'Remove-WorktreeMarker deletes the file' {
        $path = Join-Path $script:TmpDir '.worktree-state.del.json'
        Write-WorktreeMarker -Path $path -Marker @{ sessionId = 'del'; worktreePath = '/wt/y'; branch = 'y'; status = 'ended-dirty' }
        Test-Path -LiteralPath $path | Should -BeTrue
        Remove-WorktreeMarker -Path $path
        Test-Path -LiteralPath $path | Should -BeFalse
    }

    It 'Read-WorktreeMarker returns null for missing file' {
        $result = Read-WorktreeMarker -Path (Join-Path $script:TmpDir 'nonexistent.json')
        $result | Should -BeNull
    }

    It 'Write-WorktreeMarker creates parent dir if absent' {
        $nested = Join-Path $script:TmpDir "subdir-$(New-Guid)" '.worktree-state.x.json'
        $dir    = Split-Path -Parent $nested
        Test-Path -LiteralPath $dir | Should -BeFalse
        Write-WorktreeMarker -Path $nested -Marker @{ sessionId = 'x'; worktreePath = '/wt/z'; branch = 'z'; status = 'ended-dirty' }
        Test-Path -LiteralPath $nested | Should -BeTrue
    }
}
