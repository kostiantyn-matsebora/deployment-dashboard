#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:HookPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-DocsKeeperSession.ps1')).Path
    . $script:HookPath -AsLibrary

    function New-DirLister {
        param([hashtable]$Files)
        return {
            param([string]$Dir)
            if ($Files.ContainsKey($Dir)) { return $Files[$Dir] }
            return @()
        }.GetNewClosure()
    }

    function New-FileReader {
        param([hashtable]$Files)
        return {
            param([string]$Path)
            if ($Files.ContainsKey($Path)) { return $Files[$Path] }
            return ''
        }.GetNewClosure()
    }
}

Describe 'ConvertFrom-GitPorcelain' {
    It 'parses a modified path' {
        $r = ConvertFrom-GitPorcelain -Porcelain ' M docs/SAD.md'
        $r | Should -Contain 'docs/SAD.md'
    }
    It 'parses an untracked path' {
        $r = ConvertFrom-GitPorcelain -Porcelain '?? notes/new.md'
        $r | Should -Contain 'notes/new.md'
    }
    It 'resolves a rename to the new path' {
        $r = ConvertFrom-GitPorcelain -Porcelain 'R  docs/old.md -> docs/new.md'
        $r | Should -Contain 'docs/new.md'
        $r | Should -Not -Contain 'docs/old.md'
    }
    It 'parses multiple lines' {
        @(ConvertFrom-GitPorcelain -Porcelain " M a.md`n?? b.md").Count | Should -Be 2
    }
    It 'returns empty on empty input' { @(ConvertFrom-GitPorcelain -Porcelain '').Count | Should -Be 0 }
}

Describe 'Get-SessionEditedPaths' {
    It 'includes files committed since the snapshot' {
        $r = Get-SessionEditedPaths -CommittedPaths @('docs/a.md') -CurrentDirtyPaths @() -SnapshotDirtyPaths @()
        $r | Should -Contain 'docs/a.md'
    }
    It 'includes files newly dirtied during the session' {
        $r = Get-SessionEditedPaths -CommittedPaths @() -CurrentDirtyPaths @('docs/b.md') -SnapshotDirtyPaths @()
        $r | Should -Contain 'docs/b.md'
    }
    It 'excludes files already dirty at session start' {
        $r = Get-SessionEditedPaths -CommittedPaths @() -CurrentDirtyPaths @('docs/pre.md') -SnapshotDirtyPaths @('docs/pre.md')
        $r | Should -Not -Contain 'docs/pre.md'
    }
    It 'deduplicates a committed-and-dirty path' {
        $r = Get-SessionEditedPaths -CommittedPaths @('docs/a.md') -CurrentDirtyPaths @('docs/a.md') -SnapshotDirtyPaths @()
        @($r).Count | Should -Be 1
    }
    It 'returns empty when nothing changed' {
        @(Get-SessionEditedPaths -CommittedPaths @() -CurrentDirtyPaths @() -SnapshotDirtyPaths @()).Count | Should -Be 0
    }
}

Describe 'Select-MarkdownPaths' {
    It 'keeps only .md paths' {
        $r = Select-MarkdownPaths -Paths @('docs/a.md', 'docs/b.yaml', 'c.md')
        @($r).Count | Should -Be 2
        $r | Should -Contain 'docs/a.md'
        $r | Should -Not -Contain 'docs/b.yaml'
    }
    It 'returns empty when no markdown' {
        @(Select-MarkdownPaths -Paths @('a.cs', 'b.yaml')).Count | Should -Be 0
    }
}

Describe 'Add-TrackedMdFiles' {
    It 'adds new files with revised: false' {
        $session = @{ Head = ''; Dirty = @(); TrackedMd = @{} }
        $result = Add-TrackedMdFiles -Session $session -Paths @('docs/a.md')
        $result.TrackedMd['docs/a.md'].revised | Should -BeFalse
    }
    It 'does not overwrite an existing revised: true entry' {
        $session = @{ Head = ''; Dirty = @(); TrackedMd = @{ 'docs/a.md' = @{ revised = $true } } }
        $result = Add-TrackedMdFiles -Session $session -Paths @('docs/a.md')
        $result.TrackedMd['docs/a.md'].revised | Should -BeTrue
    }
    It 'does not overwrite an existing revised: false entry' {
        $session = @{ Head = ''; Dirty = @(); TrackedMd = @{ 'docs/a.md' = @{ revised = $false } } }
        $result = Add-TrackedMdFiles -Session $session -Paths @('docs/a.md')
        $result.TrackedMd['docs/a.md'].revised | Should -BeFalse
    }
    It 'handles empty paths gracefully' {
        $session = @{ Head = ''; Dirty = @(); TrackedMd = @{} }
        $result = Add-TrackedMdFiles -Session $session -Paths @()
        $result.TrackedMd.Count | Should -Be 0
    }
}

Describe 'Set-TrackedMdRevised' {
    It 'marks existing file revised: true' {
        $session = @{ Head = ''; Dirty = @(); TrackedMd = @{ 'docs/a.md' = @{ revised = $false } } }
        $result = Set-TrackedMdRevised -Session $session -Paths @('docs/a.md')
        $result.TrackedMd['docs/a.md'].revised | Should -BeTrue
    }
    It 'adds file with revised: true if not present' {
        $session = @{ Head = ''; Dirty = @(); TrackedMd = @{} }
        $result = Set-TrackedMdRevised -Session $session -Paths @('docs/new.md')
        $result.TrackedMd['docs/new.md'].revised | Should -BeTrue
    }
    It 'handles multiple paths' {
        $session = @{ Head = ''; Dirty = @(); TrackedMd = @{} }
        $result = Set-TrackedMdRevised -Session $session -Paths @('a.md', 'b.md')
        $result.TrackedMd['a.md'].revised | Should -BeTrue
        $result.TrackedMd['b.md'].revised | Should -BeTrue
    }
}

Describe 'Format-SessionStartProposal' {
    It 'lists tracker file and unrevised files' {
        $msg = Format-SessionStartProposal -UnrevisedByFile @(,@('.claude/.docs-keeper-session.abc.json', @('README.md', 'docs/foo.md')))
        $msg | Should -Match 'README.md'
        $msg | Should -Match 'docs/foo.md'
        $msg | Should -Match '.docs-keeper-session.abc.json'
    }
    It 'mentions revise, snooze, dismiss options' {
        $msg = Format-SessionStartProposal -UnrevisedByFile @(,@('.claude/.docs-keeper-session.abc.json', @('README.md')))
        $msg | Should -Match 'revise'
        $msg | Should -Match 'snooze'
        $msg | Should -Match 'dismiss'
    }
}

Describe 'Remove-DocsSessionState' {
    It 'keeps the session file when TrackedMd has revised: false entries' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dk-" + [System.IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory -Path (Join-Path $tmp '.claude') -Force | Out-Null
        try {
            $sid = 'sx'
            $f = Get-DocsKeeperSessionPath -RepoRoot $tmp -SessionId $sid
            @{ Head = 'H'; Dirty = @(); TrackedMd = @{ 'README.md' = @{ revised = $false } } } | ConvertTo-Json -Compress | Set-Content -LiteralPath $f -Encoding utf8
            Remove-DocsSessionState -RepoRoot $tmp -SessionId $sid
            Test-Path -LiteralPath $f | Should -BeTrue
        } finally { Remove-Item -LiteralPath $tmp -Recurse -Force }
    }
    It 'deletes the session file when all TrackedMd entries are revised: true' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dk-" + [System.IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory -Path (Join-Path $tmp '.claude') -Force | Out-Null
        try {
            $sid = 'sy'
            $f = Get-DocsKeeperSessionPath -RepoRoot $tmp -SessionId $sid
            @{ Head = 'H'; Dirty = @(); TrackedMd = @{ 'README.md' = @{ revised = $true } } } | ConvertTo-Json -Compress | Set-Content -LiteralPath $f -Encoding utf8
            Remove-DocsSessionState -RepoRoot $tmp -SessionId $sid
            Test-Path -LiteralPath $f | Should -BeFalse
        } finally { Remove-Item -LiteralPath $tmp -Recurse -Force }
    }
    It 'deletes the session file when TrackedMd is empty' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dk-" + [System.IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory -Path (Join-Path $tmp '.claude') -Force | Out-Null
        try {
            $sid = 'sz'
            $f = Get-DocsKeeperSessionPath -RepoRoot $tmp -SessionId $sid
            @{ Head = 'H'; Dirty = @(); TrackedMd = @{} } | ConvertTo-Json -Compress | Set-Content -LiteralPath $f -Encoding utf8
            Remove-DocsSessionState -RepoRoot $tmp -SessionId $sid
            Test-Path -LiteralPath $f | Should -BeFalse
        } finally { Remove-Item -LiteralPath $tmp -Recurse -Force }
    }
}

Describe 'Invoke-SessionSnapshot' {
    It 'writes a snapshot with HEAD, dirty set, and empty TrackedMd when no prior session' {
        $script:captured = $null
        $writer = { param($Snap) $script:captured = $Snap }
        $runner = {
            param($Argv)
            if ($Argv -contains 'rev-parse') { return 'abc123' }
            if ($Argv -contains 'diff') { return @() }
            return ' M docs/pre.md'   # porcelain
        }
        Invoke-SessionSnapshot -RepoRoot '.' -GitCommandRunner $runner -SnapshotWriter $writer
        $script:captured.Head | Should -Be 'abc123'
        $script:captured.Dirty | Should -Contain 'docs/pre.md'
        $script:captured.ContainsKey('TrackedMd') | Should -BeTrue -Because 'TrackedMd key must be present'
        $script:captured.TrackedMd.Count | Should -Be 0
    }
}

Describe 'Get-DocsCaptureFilePath' {
    It 'no sid -> path ends in .docs-capture.json' {
        $result = Get-DocsCaptureFilePath -RepoRoot '/repo' -SessionId ''
        $result | Should -Match '\.docs-capture\.json$'
        $result | Should -Not -Match '\.docs-capture\.\.'
    }
    It 'with sid "abc" -> path ends in .docs-capture.abc.json' {
        $result = Get-DocsCaptureFilePath -RepoRoot '/repo' -SessionId 'abc'
        $result | Should -Match '\.docs-capture\.abc\.json$'
    }
}

Describe 'Format-CaptureReport' {
    It 'empty captures key -> empty string' {
        $file = @{ sessionId = 's'; captures = @() }
        Format-CaptureReport -CaptureFile $file | Should -Be ''
    }
    It 'null/absent captures -> empty string' {
        $file = @{ sessionId = 's' }
        Format-CaptureReport -CaptureFile $file | Should -Be ''
    }
    It 'one manual entry with suggestedDoc -> contains [manual], ->, doc path' {
        $file = @{
            sessionId = 's'
            captures  = @(@{ content = 'Update the auth section.'; suggestedDoc = 'docs/SAD.md'; source = 'manual'; capturedAt = 'T' })
        }
        $result = Format-CaptureReport -CaptureFile $file
        $result | Should -Match '\[manual\]'
        $result | Should -Match '->'
        $result | Should -Match 'docs/SAD\.md'
    }
    It 'one compaction entry with no suggestedDoc -> contains [compaction], no ->' {
        $file = @{
            sessionId = 's'
            captures  = @(@{ content = 'Session summary text.'; suggestedDoc = ''; source = 'compaction'; capturedAt = 'T' })
        }
        $result = Format-CaptureReport -CaptureFile $file
        $result | Should -Match '\[compaction\]'
        $result | Should -Not -Match '->'
    }
    It 'content > 80 chars is truncated with ellipsis' {
        $longText = 'A' * 90
        $file = @{
            sessionId = 's'
            captures  = @(@{ content = $longText; suggestedDoc = ''; source = 'manual'; capturedAt = 'T' })
        }
        $result = Format-CaptureReport -CaptureFile $file
        $result | Should -Match ([char]0x2026)
        $result | Should -Not -Match ('A' * 90)
    }
    It 'N in header matches capture count' {
        $file = @{
            sessionId = 's'
            captures  = @(
                @{ content = 'One.'; suggestedDoc = ''; source = 'manual'; capturedAt = 'T' },
                @{ content = 'Two.'; suggestedDoc = ''; source = 'manual'; capturedAt = 'T' },
                @{ content = 'Three.'; suggestedDoc = ''; source = 'manual'; capturedAt = 'T' }
            )
        }
        $result = Format-CaptureReport -CaptureFile $file
        $result | Should -Match 'this session \(3\)'
    }
}

Describe 'Format-CaptureProposal' {
    It 'empty array -> empty string' {
        Format-CaptureProposal -CaptureFiles @() | Should -Be ''
    }
    It 'all files have empty captures -> empty string' {
        $files = @(@{ sessionId = 's1'; captures = @() }, @{ sessionId = 's2'; captures = @() })
        Format-CaptureProposal -CaptureFiles $files | Should -Be ''
    }
    It 'one file one entry -> contains entry details and reply instructions' {
        $files = @(@{
            sessionId = 's1'
            captures  = @(@{ content = 'Auth flow change.'; suggestedDoc = 'docs/SAD.md'; source = 'manual'; capturedAt = 'T' })
        })
        $result = Format-CaptureProposal -CaptureFiles $files
        $result | Should -Match '\[manual\]'
        $result | Should -Match 'docs/SAD\.md'
        $result | Should -Match 'apply'
        $result | Should -Match 'dismiss'
    }
    It 'multiple entries across files -> all listed, total count correct' {
        $files = @(
            @{ sessionId = 's1'; captures = @(
                @{ content = 'Entry A.'; suggestedDoc = ''; source = 'manual'; capturedAt = 'T' },
                @{ content = 'Entry B.'; suggestedDoc = ''; source = 'compaction'; capturedAt = 'T' }
            )},
            @{ sessionId = 's2'; captures = @(
                @{ content = 'Entry C.'; suggestedDoc = 'docs/X.md'; source = 'manual'; capturedAt = 'T' }
            )}
        )
        $result = Format-CaptureProposal -CaptureFiles $files
        $result | Should -Match 'total\) \(3 total\)|3 total'
        $result | Should -Match 'Entry A'
        $result | Should -Match 'Entry B'
        $result | Should -Match 'Entry C'
    }
    It 'content truncation same as report (> 80 chars)' {
        $longText = 'B' * 90
        $files = @(@{
            sessionId = 's1'
            captures  = @(@{ content = $longText; suggestedDoc = ''; source = 'manual'; capturedAt = 'T' })
        })
        $result = Format-CaptureProposal -CaptureFiles $files
        $result | Should -Match ([char]0x2026)
        $result | Should -Not -Match ('B' * 90)
    }
}

Describe 'Find-PendingCaptureFiles' {
    It 'skips file matching current session id' {
        $dl = {
            param([string]$Dir)
            @(@{ Name = '.docs-capture.abc.json'; IsDir = $false })
        }
        $fr = {
            param([string]$Path)
            '{"sessionId":"abc","captures":[{"content":"x","suggestedDoc":"","source":"manual","capturedAt":"T"}]}'
        }
        $result = @(Find-PendingCaptureFiles -RepoRoot '/repo' -CurrentSessionId 'abc' -DirLister $dl -FileReader $fr)
        $result.Count | Should -Be 0
    }
    It 'returns parsed files from other sessions that have captures' {
        $dl = {
            param([string]$Dir)
            @(@{ Name = '.docs-capture.xyz.json'; IsDir = $false })
        }
        $fr = {
            param([string]$Path)
            '{"sessionId":"xyz","captures":[{"content":"y","suggestedDoc":"docs/A.md","source":"manual","capturedAt":"T"}]}'
        }
        $result = @(Find-PendingCaptureFiles -RepoRoot '/repo' -CurrentSessionId 'abc' -DirLister $dl -FileReader $fr)
        $result.Count | Should -Be 1
        @($result[0].captures).Count | Should -Be 1
        @($result[0].captures)[0].content | Should -Be 'y'
    }
    It 'skips files with empty captures array' {
        $dl = {
            param([string]$Dir)
            @(@{ Name = '.docs-capture.xyz.json'; IsDir = $false })
        }
        $fr = {
            param([string]$Path)
            '{"sessionId":"xyz","captures":[]}'
        }
        $result = @(Find-PendingCaptureFiles -RepoRoot '/repo' -CurrentSessionId 'abc' -DirLister $dl -FileReader $fr)
        $result.Count | Should -Be 0
    }
    It 'returns empty when no matching files' {
        $dl = { param([string]$Dir) @() }
        $fr = { param([string]$Path) '' }
        $result = @(Find-PendingCaptureFiles -RepoRoot '/repo' -CurrentSessionId 'abc' -DirLister $dl -FileReader $fr)
        $result.Count | Should -Be 0
    }
}
