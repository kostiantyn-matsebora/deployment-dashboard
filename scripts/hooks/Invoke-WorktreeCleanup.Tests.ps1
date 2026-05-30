#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-WorktreeCleanup.ps1')).Path
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
        # Pre-normalize all keys so both slash conventions match.
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
        # Pre-normalize all keys.
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
        # Returns a scriptblock that records calls; captured in $script:WriterCalls.
        $script:WriterCalls = [System.Collections.Generic.List[hashtable]]::new()
        return {
            param([string]$Path, [hashtable]$Marker)
            $script:WriterCalls.Add(@{ Path = $Path; Marker = $Marker })
        }.GetNewClosure()
    }

    function New-SpyDeleter {
        $script:DeleterCalls = [System.Collections.Generic.List[string]]::new()
        return {
            param([string]$Path)
            $script:DeleterCalls.Add($Path)
        }.GetNewClosure()
    }

    # Marker JSON builder.
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
Describe 'Find-EndedDirtyMarkers' {

    It 'returns markers with status ended-dirty whose path exists' {
        $markerJson = New-MarkerJson -SessionId 'sid-1' -WorktreePath '/repo/wt/feat' -Branch 'feat' -Status 'ended-dirty'
        $lister = New-DirLister @{
            '/repo/.claude'  = @('.worktree-state.sid-1.json')
            '/repo/wt/feat'  = @()          # exists (empty dir)
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
            # '/repo/wt/gone' absent -> $null returned by lister
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
        $lister = New-DirLister @{}    # no key -> $null -> no entries
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
        $result.Count | Should -Be 1
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
        $escaped = [regex]::Escape('/repo/.claude/worktrees/feature-x')
        $script:Proposal | Should -Match $escaped
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
Describe 'Invoke-WorktreeCleanup -SessionEnd' {

    BeforeEach {
        $script:GitCalls      = [System.Collections.Generic.List[string]]::new()
        $script:WriterCalls   = [System.Collections.Generic.List[hashtable]]::new()
        $script:DeleterCalls  = [System.Collections.Generic.List[string]]::new()
    }

    Context 'in worktree + clean' {
        It 'calls worktree remove and returns Action=removed' {
            $spyGit = {
                param([string[]]$Argv)
                $script:GitCalls.Add(($Argv -join ' '))
                switch ($Argv -join ' ') {
                    'rev-parse --show-toplevel'   { return '/repo/wt/feat' }
                    'worktree list --porcelain'   { return @('worktree /repo') }
                    'rev-parse --abbrev-ref HEAD' { return 'feat' }
                    'status --porcelain'          { return '' }
                    default                       { return @() }
                }
            }
            $lister  = New-DirLister @{ '/repo/.claude' = @() }
            $reader  = New-FileReader @{}
            $writer  = { param([string]$P, [hashtable]$M) $script:WriterCalls.Add(@{ Path = $P; Marker = $M }) }
            $deleter = { param([string]$P) $script:DeleterCalls.Add($P) }

            $result = Invoke-WorktreeCleanup `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $spyGit -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SessionEnd

            $result.Action     | Should -Be 'removed'
            $result.IsWorktree | Should -BeTrue
            $result.WasClean   | Should -BeTrue

            $removeCall = $script:GitCalls | Where-Object { $_ -match 'worktree remove' }
            $removeCall | Should -Not -BeNullOrEmpty
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
            $script:NoOpLister  = New-DirLister @{ '/repo/.claude' = @() }
            $script:NoOpReader  = New-FileReader @{}
            $script:SpyWriter   = { param([string]$P, [hashtable]$M) $script:WriterCalls.Add(@{ Path = $P; Marker = $M }) }
            $script:SpyDeleter  = { param([string]$P) $script:DeleterCalls.Add($P) }
        }

        It 'writes marker file (captured via Write spy), returns Action=marked-dirty' {
            $result = Invoke-WorktreeCleanup `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $script:DirtyGit `
                -DirLister $script:NoOpLister `
                -FileReader $script:NoOpReader `
                -MarkerWriter $script:SpyWriter `
                -MarkerDeleter $script:SpyDeleter `
                -SessionEnd

            $result.Action   | Should -Be 'marked-dirty'
            $script:WriterCalls.Count | Should -Be 1
        }

        It 'marker has status=ended-dirty and correct worktreePath' {
            Invoke-WorktreeCleanup `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $script:DirtyGit `
                -DirLister $script:NoOpLister `
                -FileReader $script:NoOpReader `
                -MarkerWriter $script:SpyWriter `
                -MarkerDeleter $script:SpyDeleter `
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

            $result = Invoke-WorktreeCleanup `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $spyGit -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SessionEnd

            $result.Action     | Should -Be 'pruned'
            $result.IsWorktree | Should -BeFalse

            $pruneCall = $gitCalls | Where-Object { $_ -match 'worktree prune' }
            $pruneCall | Should -Not -BeNullOrEmpty
        }
    }
}

# ============================================================
Describe 'Invoke-WorktreeCleanup -SnapshotSession' {

    It 'no ended-dirty markers: ProposalEmitted=false, no stdout' {
        $gitRunner = New-GitRunner @{}
        $lister    = New-DirLister @{ '/repo/.claude' = @() }
        $reader    = New-FileReader @{}
        $writer    = { param([string]$P, [hashtable]$M) }
        $deleter   = { param([string]$P) }

        # Capture stdout by redirecting Console.Out.
        $sb = [System.Text.StringBuilder]::new()
        $sw = [System.IO.StringWriter]::new($sb)
        [Console]::SetOut($sw)

        try {
            $result = Invoke-WorktreeCleanup `
                -RepoRoot '/repo' -SessionId 'sid-1' `
                -GitRunner $gitRunner -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SnapshotSession
        }
        finally {
            [Console]::SetOut([System.IO.StreamWriter]::new([Console]::OpenStandardOutput()))
        }

        $result.ProposalEmitted | Should -BeFalse
        $sb.ToString().Trim()   | Should -BeNullOrEmpty
    }

    It 'ended-dirty marker present: ProposalEmitted=true, stdout is valid JSON with additionalContext' {
        $markerJson = New-MarkerJson -SessionId 'sid-1' -WorktreePath '/repo/wt/feat' -Branch 'feat-branch' -Status 'ended-dirty'
        $lister = New-DirLister @{
            '/repo/.claude' = @('.worktree-state.sid-1.json')
            '/repo/wt/feat' = @()
        }
        $reader  = New-FileReader @{ '/repo/.claude/.worktree-state.sid-1.json' = $markerJson }
        $writer  = { param([string]$P, [hashtable]$M) }
        $deleter = { param([string]$P) }

        $sb = [System.Text.StringBuilder]::new()
        $sw = [System.IO.StringWriter]::new($sb)
        [Console]::SetOut($sw)

        try {
            $result = Invoke-WorktreeCleanup `
                -RepoRoot '/repo' -SessionId 'sid-2' `
                -GitRunner (New-GitRunner @{}) `
                -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SnapshotSession
        }
        finally {
            [Console]::SetOut([System.IO.StreamWriter]::new([Console]::OpenStandardOutput()))
        }

        $result.ProposalEmitted | Should -BeTrue
        $result.Count           | Should -Be 1

        $stdout = $sb.ToString().Trim()
        $stdout | Should -Not -BeNullOrEmpty

        $parsed = $stdout | ConvertFrom-Json
        $parsed.additionalContext | Should -Not -BeNullOrEmpty
    }

    It 'additionalContext contains branch name from marker' {
        $markerJson = New-MarkerJson -SessionId 'sid-1' -WorktreePath '/repo/wt/my-feature' -Branch 'my-feature' -Status 'ended-dirty'
        $lister = New-DirLister @{
            '/repo/.claude'       = @('.worktree-state.sid-1.json')
            '/repo/wt/my-feature' = @()
        }
        $reader  = New-FileReader @{ '/repo/.claude/.worktree-state.sid-1.json' = $markerJson }
        $writer  = { param([string]$P, [hashtable]$M) }
        $deleter = { param([string]$P) }

        $sb = [System.Text.StringBuilder]::new()
        $sw = [System.IO.StringWriter]::new($sb)
        [Console]::SetOut($sw)

        try {
            Invoke-WorktreeCleanup `
                -RepoRoot '/repo' -SessionId 'sid-2' `
                -GitRunner (New-GitRunner @{}) `
                -DirLister $lister -FileReader $reader `
                -MarkerWriter $writer -MarkerDeleter $deleter `
                -SnapshotSession | Out-Null
        }
        finally {
            [Console]::SetOut([System.IO.StreamWriter]::new([Console]::OpenStandardOutput()))
        }

        $parsed = $sb.ToString().Trim() | ConvertFrom-Json
        $parsed.additionalContext | Should -Match 'my-feature'
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
        $read | Should -Not -BeNull
        $read.sessionId    | Should -Be 'rt-1'
        $read.status       | Should -Be 'ended-dirty'
        $read.branch       | Should -Be 'x'
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
        $nested = Join-Path $script:TmpDir 'subdir-$(New-Guid)' '.worktree-state.x.json'
        $dir    = Split-Path -Parent $nested
        Test-Path -LiteralPath $dir | Should -BeFalse
        Write-WorktreeMarker -Path $nested -Marker @{ sessionId = 'x'; worktreePath = '/wt/z'; branch = 'z'; status = 'ended-dirty' }
        Test-Path -LiteralPath $nested | Should -BeTrue
    }
}
