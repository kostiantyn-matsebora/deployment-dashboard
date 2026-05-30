#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:HookPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-PreCommitDocsHook.ps1')).Path
    . $script:HookPath -AsLibrary

    # ----- Fake filesystem helpers -----

    function New-IndexMd {
        param([string[]]$Children)
        $lines = @('---', 'title: X', "intro: 'x'", 'children:')
        foreach ($c in $Children) { $lines += "  - $c" }
        $lines += '---'
        $lines += ''
        return ($lines -join "`n")
    }

    function New-DirLister {
        param([hashtable]$Tree)
        return {
            param([string]$Dir)
            if ($Tree.ContainsKey($Dir)) { return $Tree[$Dir] }
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

    # Consistent tree rooted at '.' — mirrors a real repo layout.
    # node_modules is listed under '.' to verify ExcludeDirs skips it.
    function Get-ConsistentTree {
        return @{
            '.'                  = @(
                @{ Name = 'docs'; IsDir = $true },
                @{ Name = 'backend'; IsDir = $true },
                @{ Name = 'scripts'; IsDir = $true },
                @{ Name = 'node_modules'; IsDir = $true }
            )
            'backend'            = @()
            'scripts'            = @()
            # node_modules excluded by default ExcludeDirs — not traversed, not in tree
            'docs'               = @(
                @{ Name = 'SAD.md'; IsDir = $false },
                @{ Name = 'FRONTEND_REQUIREMENTS.md'; IsDir = $false },
                @{ Name = 'index.md'; IsDir = $false },
                @{ Name = 'api'; IsDir = $true },
                @{ Name = 'design'; IsDir = $true }
            )
            'docs/api'           = @(
                @{ Name = 'api-guidelines.md'; IsDir = $false },
                @{ Name = 'openapi.yaml'; IsDir = $false },
                @{ Name = 'index.md'; IsDir = $false }
            )
            'docs/design'        = @(
                @{ Name = 'behavior.md'; IsDir = $false },
                @{ Name = 'components.md'; IsDir = $false },
                @{ Name = 'data-model.md'; IsDir = $false },
                @{ Name = 'design-tokens.md'; IsDir = $false },
                @{ Name = 'libraries.md'; IsDir = $false },
                @{ Name = 'views.md'; IsDir = $false },
                @{ Name = 'README.md'; IsDir = $false },
                @{ Name = 'index.md'; IsDir = $false },
                @{ Name = 'mockup'; IsDir = $true }
            )
            'docs/design/mockup' = @(
                @{ Name = 'index.html'; IsDir = $false },
                @{ Name = 'index.md'; IsDir = $false }
            )
        }
    }

    function Get-ConsistentFiles {
        return @{
            'docs/index.md'               = New-IndexMd @('/SAD', '/FRONTEND_REQUIREMENTS', '/api', '/design')
            'docs/api/index.md'           = New-IndexMd @('/openapi.yaml', '/api-guidelines')
            # Hand-curated (non-alphabetical) order — set comparison must not flag this.
            'docs/design/index.md'        = New-IndexMd @('/README', '/design-tokens', '/components', '/views', '/behavior', '/data-model', '/libraries', '/mockup')
            'docs/design/mockup/index.md' = New-IndexMd @('/index.html')
            # Role text contains the ROOT index intro ('x' from New-IndexMd) so
            # Test-RegistryRoleInSync sees it as in sync.
            'CLAUDE.md'                   = "# Project`n`n## Sources of truth`n`n- [docs/](docs/) — x.`n`n## Other`n"
        }
    }

    # No-op session/seen-state injections — keep integration tests off the real
    # filesystem and force every staged/edited .md to count as a fresh revise
    # candidate (empty seen-state).
    $script:EmptySeenReader = { @{} }
    $script:NoopSeenWriter = { param($State) }
    $script:NullSnapshotReader = { $null }
    $script:EmptyAttemptsReader = { @{} }
    $script:NoopAttemptsWriter = { param($A) }
}

Describe 'Test-IsGitCommit' {
    It 'matches plain "git commit"' { Test-IsGitCommit -Command 'git commit' | Should -BeTrue }
    It 'matches "git commit -m" with message' { Test-IsGitCommit -Command 'git commit -m "foo"' | Should -BeTrue }
    It 'matches "git -C <path> commit"' { Test-IsGitCommit -Command 'git -C /repo commit -m foo' | Should -BeTrue }
    It 'matches commit after && chain' { Test-IsGitCommit -Command 'git add . && git commit -m foo' | Should -BeTrue }
    It 'matches commit after semicolon chain' { Test-IsGitCommit -Command 'git add . ; git commit -m foo' | Should -BeTrue }
    It 'rejects "git status"' { Test-IsGitCommit -Command 'git status' | Should -BeFalse }
    It 'rejects "git commit-tree" substring trap' { Test-IsGitCommit -Command 'git commit-tree abc' | Should -BeFalse }
    It 'rejects "git commit-graph"' { Test-IsGitCommit -Command 'git commit-graph write' | Should -BeFalse }
    It 'rejects empty string' { Test-IsGitCommit -Command '' | Should -BeFalse }
    It 'rejects null' { Test-IsGitCommit -Command $null | Should -BeFalse }
}

Describe 'ConvertFrom-GitNameStatus' {
    It 'parses an added file' {
        $result = ConvertFrom-GitNameStatus -NameStatus "A`tdocs/api/README.md"
        $result.Count | Should -Be 1
        $result[0].Status | Should -Be 'A'
        $result[0].Path | Should -Be 'docs/api/README.md'
        $result[0].OldPath | Should -BeNullOrEmpty
    }
    It 'parses a modified file' {
        $result = ConvertFrom-GitNameStatus -NameStatus "M`tdocs/api/openapi.yaml"
        $result[0].Status | Should -Be 'M'
        $result[0].Path | Should -Be 'docs/api/openapi.yaml'
    }
    It 'parses a deleted file' {
        $result = ConvertFrom-GitNameStatus -NameStatus "D`tdocs/api/legacy.md"
        $result[0].Status | Should -Be 'D'
        $result[0].Path | Should -Be 'docs/api/legacy.md'
    }
    It 'parses a renamed file with similarity score' {
        $result = ConvertFrom-GitNameStatus -NameStatus "R100`tdocs/api/old.md`tdocs/api/new.md"
        $result[0].Status | Should -Be 'R'
        $result[0].OldPath | Should -Be 'docs/api/old.md'
        $result[0].Path | Should -Be 'docs/api/new.md'
    }
    It 'parses a copied file with similarity score' {
        $result = ConvertFrom-GitNameStatus -NameStatus "C75`tdocs/api/a.md`tdocs/api/b.md"
        $result[0].Status | Should -Be 'C'
        $result[0].OldPath | Should -Be 'docs/api/a.md'
        $result[0].Path | Should -Be 'docs/api/b.md'
    }
    It 'parses multiple lines' {
        $in = "A`tdocs/api/x.md`nM`tdocs/design/y.md`nD`tdocs/api/z.md"
        (ConvertFrom-GitNameStatus -NameStatus $in).Count | Should -Be 3
    }
    It 'handles CRLF line endings' {
        $in = "A`tdocs/api/x.md`r`nM`tdocs/design/y.md"
        (ConvertFrom-GitNameStatus -NameStatus $in).Count | Should -Be 2
    }
    It 'returns empty array on empty input' { @(ConvertFrom-GitNameStatus -NameStatus '').Count | Should -Be 0 }
    It 'returns empty array on whitespace-only input' { @(ConvertFrom-GitNameStatus -NameStatus "   `n`n  ").Count | Should -Be 0 }
}

Describe 'Test-IsMarkdownPath' {
    It 'matches any .md file in docs/' { Test-IsMarkdownPath -Path 'docs/api/README.md' | Should -BeTrue }
    It 'matches CLAUDE.md' { Test-IsMarkdownPath -Path 'CLAUDE.md' | Should -BeTrue }
    It 'matches AGENTS.md' { Test-IsMarkdownPath -Path 'AGENTS.md' | Should -BeTrue }
    It 'matches .md file in any directory' { Test-IsMarkdownPath -Path 'src/notes.md' | Should -BeTrue }
    It 'matches nested .md path' { Test-IsMarkdownPath -Path 'a/b/c/file.md' | Should -BeTrue }
    It 'rejects .cs file' { Test-IsMarkdownPath -Path 'src/Program.cs' | Should -BeFalse }
    It 'rejects .html file' { Test-IsMarkdownPath -Path 'docs/design/mockup/index.html' | Should -BeFalse }
    It 'rejects .yaml file' { Test-IsMarkdownPath -Path 'docs/api/openapi.yaml' | Should -BeFalse }
    It 'rejects empty string' { Test-IsMarkdownPath -Path '' | Should -BeFalse }
    It 'rejects null' { Test-IsMarkdownPath -Path $null | Should -BeFalse }
}

Describe 'Test-TouchesIndexedContent' {
    It 'true when a Path is a .md file' {
        Test-TouchesIndexedContent -Changes @(@{ Status = 'M'; Path = 'docs/SAD.md'; OldPath = $null }) | Should -BeTrue
    }
    It 'true when CLAUDE.md changed' {
        Test-TouchesIndexedContent -Changes @(@{ Status = 'M'; Path = 'CLAUDE.md'; OldPath = $null }) | Should -BeTrue
    }
    It 'true when .md file in any directory added' {
        Test-TouchesIndexedContent -Changes @(@{ Status = 'A'; Path = 'notes/meeting.md'; OldPath = $null }) | Should -BeTrue
    }
    It 'true when OldPath is a .md file (rename source)' {
        Test-TouchesIndexedContent -Changes @(@{ Status = 'R'; Path = 'docs/api/new.md'; OldPath = 'docs/api/old.md' }) | Should -BeTrue
    }
    It 'false when no .md file touched' {
        Test-TouchesIndexedContent -Changes @(@{ Status = 'M'; Path = 'src/foo.cs'; OldPath = $null }) | Should -BeFalse
    }
    It 'false when only a non-markdown file in docs/ touched' {
        Test-TouchesIndexedContent -Changes @(@{ Status = 'M'; Path = 'docs/api/openapi.yaml'; OldPath = $null }) | Should -BeFalse
    }
    It 'false on empty change set' { Test-TouchesIndexedContent -Changes @() | Should -BeFalse }
}

Describe 'Test-IsHiddenName' {
    It 'flags dot-prefixed' { Test-IsHiddenName -Name '.git' | Should -BeTrue }
    It 'flags underscore-prefixed (Jekyll)' { Test-IsHiddenName -Name '_drafts' | Should -BeTrue }
    It 'passes a normal name' { Test-IsHiddenName -Name 'api' | Should -BeFalse }
}

Describe 'Find-HostRootPromptFile' {
    It 'returns CLAUDE.md when present' {
        $reader = New-FileReader -Files @{ 'CLAUDE.md' = '## Sources of truth' }
        Find-HostRootPromptFile -FileReader $reader | Should -Be 'CLAUDE.md'
    }
    It 'falls back to AGENTS.md when CLAUDE.md absent' {
        $reader = New-FileReader -Files @{ 'AGENTS.md' = '## Sources of truth' }
        Find-HostRootPromptFile -FileReader $reader | Should -Be 'AGENTS.md'
    }
    It 'falls back to .agent/INDEX.md when both absent' {
        $reader = New-FileReader -Files @{ '.agent/INDEX.md' = '## Sources of truth' }
        Find-HostRootPromptFile -FileReader $reader | Should -Be '.agent/INDEX.md'
    }
    It 'returns empty string when none found' {
        $reader = New-FileReader -Files @{}
        Find-HostRootPromptFile -FileReader $reader | Should -Be ''
    }
    It 'prefers CLAUDE.md over AGENTS.md when both present' {
        $reader = New-FileReader -Files @{ 'CLAUDE.md' = 'x'; 'AGENTS.md' = 'y' }
        Find-HostRootPromptFile -FileReader $reader | Should -Be 'CLAUDE.md'
    }
    It 'skips whitespace-only files' {
        $reader = New-FileReader -Files @{ 'CLAUDE.md' = "   `n`t  "; 'AGENTS.md' = 'content' }
        Find-HostRootPromptFile -FileReader $reader | Should -Be 'AGENTS.md'
    }
}

Describe 'Get-DeclaredChildren' {
    It 'parses a block list of children' {
        $content = New-IndexMd @('/openapi.yaml', '/api-guidelines')
        $result = Get-DeclaredChildren -Content $content
        $result | Should -Contain '/openapi.yaml'
        $result | Should -Contain '/api-guidelines'
        @($result).Count | Should -Be 2
    }
    It 'returns empty when no children key' {
        $content = "---`ntitle: X`nintro: 'x'`n---`n`nbody"
        @(Get-DeclaredChildren -Content $content).Count | Should -Be 0
    }
    It 'stops at the closing front-matter delimiter' {
        $content = "---`nchildren:`n  - /a`n---`n  - /not-a-child`n"
        $result = Get-DeclaredChildren -Content $content
        @($result).Count | Should -Be 1
        $result | Should -Contain '/a'
    }
    It 'stops at the next top-level key' {
        $content = "---`nchildren:`n  - /a`ntitle: X`n---`n"
        @(Get-DeclaredChildren -Content $content).Count | Should -Be 1
    }
    It 'returns empty on empty content' { @(Get-DeclaredChildren -Content '').Count | Should -Be 0 }
}

Describe 'Test-SetsEqual' {
    It 'true for same members different order' {
        Test-SetsEqual -A @('/a', '/b', '/c') -B @('/c', '/a', '/b') | Should -BeTrue
    }
    It 'false when a member is missing' {
        Test-SetsEqual -A @('/a', '/b') -B @('/a') | Should -BeFalse
    }
    It 'false when an extra member is present' {
        Test-SetsEqual -A @('/a') -B @('/a', '/b') | Should -BeFalse
    }
    It 'true for two empty sets' { Test-SetsEqual -A @() -B @() | Should -BeTrue }
}

Describe 'Get-ExpectedChildren' {
    It 'enumerates direct markdown without extension and yaml with extension' {
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $result = Get-ExpectedChildren -Dir 'docs/api' -DirLister $lister
        $result | Should -Contain '/api-guidelines'
        $result | Should -Contain '/openapi.yaml'
        $result | Should -Not -Contain '/index'
        @($result).Count | Should -Be 2
    }
    It 'treats a sub-dir holding index.md as a boundary entry' {
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $result = Get-ExpectedChildren -Dir 'docs/design' -DirLister $lister
        $result | Should -Contain '/mockup'
        $result | Should -Contain '/README'
    }
    It 'surfaces top-level docs files and sub-dir boundaries from the root' {
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $result = Get-ExpectedChildren -Dir 'docs' -DirLister $lister
        $result | Should -Contain '/SAD'
        $result | Should -Contain '/FRONTEND_REQUIREMENTS'
        $result | Should -Contain '/api'
        $result | Should -Contain '/design'
        @($result).Count | Should -Be 4
    }
    It 'descends into a sub-dir WITHOUT index.md and nests the entries' {
        $tree = @{
            'docs'        = @(@{ Name = 'index.md'; IsDir = $false }, @{ Name = 'guides'; IsDir = $true })
            'docs/guides' = @(@{ Name = 'intro.md'; IsDir = $false })
        }
        $lister = New-DirLister -Tree $tree
        $result = Get-ExpectedChildren -Dir 'docs' -DirLister $lister
        $result | Should -Contain '/guides/intro'
    }
    It 'skips hidden and underscore entries' {
        $tree = @{ 'docs' = @(@{ Name = '.hidden.md'; IsDir = $false }, @{ Name = '_draft.md'; IsDir = $false }, @{ Name = 'real.md'; IsDir = $false }) }
        $lister = New-DirLister -Tree $tree
        $result = Get-ExpectedChildren -Dir 'docs' -DirLister $lister
        @($result).Count | Should -Be 1
        $result | Should -Contain '/real'
    }
}

Describe 'Get-IndexDirs' {
    It 'finds every directory holding an index.md under docs/' {
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $result = Get-IndexDirs -Dir 'docs' -DirLister $lister
        $result | Should -Contain 'docs'
        $result | Should -Contain 'docs/api'
        $result | Should -Contain 'docs/design'
        $result | Should -Contain 'docs/design/mockup'
        @($result).Count | Should -Be 4
    }
    It 'finds index dirs when scanning from repo root' {
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $result = Get-IndexDirs -Dir '.' -DirLister $lister -ExcludeDirs @('node_modules')
        $result | Should -Contain 'docs'
        $result | Should -Contain 'docs/api'
        $result | Should -Contain 'docs/design'
        $result | Should -Contain 'docs/design/mockup'
        $result | Should -Not -Contain 'backend'
        $result | Should -Not -Contain 'scripts'
        @($result).Count | Should -Be 4
    }
    It 'does not recurse into excluded directories' {
        $tree = @{
            '.'              = @(
                @{ Name = 'docs'; IsDir = $true },
                @{ Name = 'node_modules'; IsDir = $true }
            )
            'docs'           = @(@{ Name = 'index.md'; IsDir = $false })
            'node_modules'   = @(@{ Name = 'index.md'; IsDir = $false })
        }
        $lister = New-DirLister -Tree $tree
        $result = Get-IndexDirs -Dir '.' -DirLister $lister -ExcludeDirs @('node_modules')
        $result | Should -Contain 'docs'
        $result | Should -Not -Contain 'node_modules'
        $result | Should -Not -Contain './node_modules'
    }
    It 'returns empty when root has no index.md anywhere' {
        $lister = New-DirLister -Tree @{ 'docs' = @(@{ Name = 'loose.md'; IsDir = $false }) }
        @(Get-IndexDirs -Dir 'docs' -DirLister $lister).Count | Should -Be 0
    }
}

Describe 'Get-RootIndexDirs' {
    It 'returns only dirs whose parent has no index.md' {
        $roots = Get-RootIndexDirs -IndexDirs @('docs', 'docs/api', 'docs/design', 'docs/design/mockup')
        @($roots).Count | Should -Be 1
        $roots | Should -Contain 'docs'
    }
    It 'treats two independent roots as both root' {
        $roots = Get-RootIndexDirs -IndexDirs @('docs', 'spec')
        @($roots).Count | Should -Be 2
    }
}

Describe 'Test-RegistryHasEntry' {
    It 'true when the dir is referenced in the Sources of truth section' {
        $content = "## Sources of truth`n`n- [docs/](docs/) — root.`n"
        Test-RegistryHasEntry -Content $content -DirPath 'docs' | Should -BeTrue
    }
    It 'false when the section omits the dir' {
        $content = "## Sources of truth`n`n- [other/](other/) — x.`n"
        Test-RegistryHasEntry -Content $content -DirPath 'docs' | Should -BeFalse
    }
    It 'ignores matches outside the Sources of truth section' {
        $content = "## Intro`n`ndocs/ mentioned here only`n`n## Sources of truth`n`n- nothing relevant`n"
        Test-RegistryHasEntry -Content $content -DirPath 'docs' | Should -BeFalse
    }
    It 'accepts a dir passed with a trailing slash' {
        $content = "## Sources of truth`n`n- [docs/](docs/) — root.`n"
        Test-RegistryHasEntry -Content $content -DirPath 'docs/' | Should -BeTrue
    }
    It 'false on empty content' { Test-RegistryHasEntry -Content '' -DirPath 'docs' | Should -BeFalse }
}

Describe 'Resolve-CommandQueue' {
    It 'returns empty queue with no drift' {
        @(Resolve-CommandQueue -DriftedIndexDirs @() -RegistryDrift $false).Count | Should -Be 0
    }
    It 'queues /docs-index per drifted dir, trailing-slashed' {
        $queue = Resolve-CommandQueue -DriftedIndexDirs @('docs/api') -RegistryDrift $false
        $queue[0].Command | Should -Be '/docs-index'
        $queue[0].Args | Should -Be 'docs/api/'
    }
    It 'orders drifted dirs lexically' {
        $queue = Resolve-CommandQueue -DriftedIndexDirs @('docs/design', 'docs/api') -RegistryDrift $false
        $queue[0].Args | Should -Be 'docs/api/'
        $queue[1].Args | Should -Be 'docs/design/'
    }
    It 'appends a single /docs-registry-sync last on registry drift' {
        $queue = Resolve-CommandQueue -DriftedIndexDirs @('docs/api') -RegistryDrift $true
        $queue[-1].Command | Should -Be '/docs-registry-sync'
        @($queue | Where-Object { $_.Command -eq '/docs-registry-sync' }).Count | Should -Be 1
    }
    It 'can queue registry-sync alone' {
        $queue = Resolve-CommandQueue -DriftedIndexDirs @() -RegistryDrift $true
        @($queue).Count | Should -Be 1
        $queue[0].Command | Should -Be '/docs-registry-sync'
    }
}

Describe 'Get-DocsDriftQueue' {
    It 'returns an empty queue for a fully consistent tree' {
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $reader = New-FileReader -Files (Get-ConsistentFiles)
        @(Get-DocsDriftQueue -DirLister $lister -FileReader $reader).Count | Should -Be 0
    }
    It 'does not flag drift for hand-curated children ordering' {
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $reader = New-FileReader -Files (Get-ConsistentFiles)
        $queue = Get-DocsDriftQueue -DirLister $lister -FileReader $reader
        ($queue | Where-Object { $_.Args -eq 'docs/design/' }).Count | Should -Be 0
    }
    It 'queues /docs-index when an index omits a present file' {
        $files = Get-ConsistentFiles
        $files['docs/api/index.md'] = New-IndexMd @('/openapi.yaml')
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $reader = New-FileReader -Files $files
        $queue = Get-DocsDriftQueue -DirLister $lister -FileReader $reader
        @($queue | Where-Object { $_.Command -eq '/docs-index' -and $_.Args -eq 'docs/api/' }).Count | Should -Be 1
    }
    It 'queues /docs-index when an index lists a now-absent file' {
        $files = Get-ConsistentFiles
        $files['docs/api/index.md'] = New-IndexMd @('/openapi.yaml', '/api-guidelines', '/ghost')
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $reader = New-FileReader -Files $files
        $queue = Get-DocsDriftQueue -DirLister $lister -FileReader $reader
        @($queue | Where-Object { $_.Args -eq 'docs/api/' }).Count | Should -Be 1
    }
    It 'queues /docs-registry-sync when CLAUDE.md omits a ROOT' {
        $files = Get-ConsistentFiles
        $files['CLAUDE.md'] = "## Sources of truth`n`n- nothing here`n"
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $reader = New-FileReader -Files $files
        $queue = Get-DocsDriftQueue -DirLister $lister -FileReader $reader
        @($queue | Where-Object { $_.Command -eq '/docs-registry-sync' }).Count | Should -Be 1
    }
    It 'queues /docs-registry-sync when AGENTS.md is the host file and omits a ROOT' {
        $files = Get-ConsistentFiles
        $files.Remove('CLAUDE.md')
        $files['AGENTS.md'] = "## Sources of truth`n`n- nothing here`n"
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $reader = New-FileReader -Files $files
        $queue = Get-DocsDriftQueue -DirLister $lister -FileReader $reader
        @($queue | Where-Object { $_.Command -eq '/docs-registry-sync' }).Count | Should -Be 1
    }
    It 'returns empty when nothing under the scan root is indexed' {
        $lister = New-DirLister -Tree @{ '.' = @(@{ Name = 'docs'; IsDir = $true }); 'docs' = @(@{ Name = 'loose.md'; IsDir = $false }) }
        $reader = New-FileReader -Files @{}
        @(Get-DocsDriftQueue -DirLister $lister -FileReader $reader).Count | Should -Be 0
    }
    It 'does not recurse into excluded dirs even when scanning from root' {
        $tree = @{
            '.'            = @(
                @{ Name = 'docs'; IsDir = $true },
                @{ Name = 'node_modules'; IsDir = $true }
            )
            'docs'         = @(@{ Name = 'index.md'; IsDir = $false }, @{ Name = 'page.md'; IsDir = $false })
            'node_modules' = @(@{ Name = 'index.md'; IsDir = $false })
        }
        $files = @{
            'docs/index.md'         = New-IndexMd @('/page')
            'CLAUDE.md'             = "## Sources of truth`n`n- [docs/](docs/) — x.`n"
        }
        $lister = New-DirLister -Tree $tree
        $reader = New-FileReader -Files $files
        @(Get-DocsDriftQueue -DirLister $lister -FileReader $reader).Count | Should -Be 0
    }
}

Describe 'Format-BlockMessage' {
    It 'returns empty string for empty queue' { Format-BlockMessage -Queue @() | Should -Be '' }
    It 'returns empty string for null queue' { Format-BlockMessage -Queue $null | Should -Be '' }
    It 'formats single command with args' {
        $msg = Format-BlockMessage -Queue @(@{ Command = '/docs-index'; Args = 'docs/api/' })
        $msg | Should -Match '1\. /docs-index docs/api/'
    }
    It 'formats single command without args' {
        $msg = Format-BlockMessage -Queue @(@{ Command = '/docs-registry-sync'; Args = '' })
        $msg | Should -Match '1\. /docs-registry-sync'
        $msg | Should -Not -Match '/docs-registry-sync '
    }
    It 'numbers queue items 1-based' {
        $msg = Format-BlockMessage -Queue @(
            @{ Command = '/docs-index'; Args = 'docs/api/' },
            @{ Command = '/docs-registry-sync'; Args = '' }
        )
        $msg | Should -Match '1\. /docs-index docs/api/'
        $msg | Should -Match '2\. /docs-registry-sync'
    }
    It 'references the binding-gates source' {
        $msg = Format-BlockMessage -Queue @(@{ Command = '/docs-registry-sync'; Args = '' })
        $msg | Should -Match 'docs-keeper\.md'
    }
    It 'uses re-commit language in pre-commit mode' {
        $msg = Format-BlockMessage -Queue @(@{ Command = '/docs-index'; Args = 'docs/' }) -Standalone $false
        $msg | Should -Match 're-commit'
    }
    It 'uses fix language in standalone mode, no re-commit mention' {
        $msg = Format-BlockMessage -Queue @(@{ Command = '/docs-index'; Args = 'docs/' }) -Standalone $true
        $msg | Should -Match 'Run the following commands to fix'
        $msg | Should -Not -Match 're-commit'
    }
}

Describe 'Read-HookPayload' {
    It 'parses a valid payload' {
        (Read-HookPayload -Json '{"tool_input":{"command":"git status"}}').tool_input.command | Should -Be 'git status'
    }
    It 'returns $null on empty input' { Read-HookPayload -Json '' | Should -BeNullOrEmpty }
    It 'returns $null on invalid JSON' { Read-HookPayload -Json 'not-json' | Should -BeNullOrEmpty }
}

Describe 'Invoke-PreCommitDocsHook integration' {
    BeforeEach {
        $script:lister = New-DirLister -Tree (Get-ConsistentTree)
        $script:reader = New-FileReader -Files (Get-ConsistentFiles)
        # Common state-I/O injections: empty seen-state (every staged/edited .md
        # is a fresh revise candidate), no-op writer (stays off disk), and no
        # session snapshot (Standalone degrades to git status).
        $script:io = @{
            SeenStateReader = $script:EmptySeenReader
            SeenStateWriter = $script:NoopSeenWriter
            SnapshotReader  = $script:NullSnapshotReader
            AttemptsReader  = $script:EmptyAttemptsReader
            AttemptsWriter  = $script:NoopAttemptsWriter
        }
    }

    It 'exits 0 with reason no-payload when stdin empty' {
        $result = Invoke-PreCommitDocsHook -HookInputJson '' -RepoRoot '.' -GitCommandRunner { @() } -DirLister $script:lister -FileReader $script:reader @script:io
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'no-payload'
    }
    It 'exits 0 with reason not-git-commit when bash is unrelated' {
        $json = '{"tool_input":{"command":"npm test"}}'
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner { @() } -DirLister $script:lister -FileReader $script:reader @script:io
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'not-git-commit'
    }
    It 'exits 0 with reason no-docs-change when commit avoids .md files' {
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tsrc/Program.cs" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $script:reader @script:io
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'no-docs-change'
    }
    It 'exits 0 with reason no-docs-change when only non-markdown docs file staged' {
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tdocs/api/openapi.yaml" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $script:reader @script:io
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'no-docs-change'
    }
    It 'queues /docs-revise on a docs commit even when index + registry are consistent' {
        # Mode B: a staged .md is always a revise candidate (ask-once), so the
        # commit gate fires with a revise-only queue.
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tdocs/SAD.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $script:reader @script:io
        $result.ExitCode | Should -Be 2
        $result.Reason | Should -Be 'docs-drift-detected'
        $result.Queue[0].Command | Should -Be '/docs-revise'
        $result.Queue[0].Args | Should -Match 'docs/SAD.md'
    }
    It 'queues /docs-revise for a staged .md outside docs/ when tree is consistent' {
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tREADME.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $script:reader @script:io
        $result.ExitCode | Should -Be 2
        @($result.Queue | Where-Object { $_.Command -eq '/docs-revise' }).Count | Should -Be 1
    }
    It 'suppresses the revise candidate when its content hash was already seen (ask-once)' {
        $files = Get-ConsistentFiles
        $files['docs/SAD.md'] = "# SAD`nbody`n"
        $reader = New-FileReader -Files $files
        $seenSha = Get-ContentSha -Content $files['docs/SAD.md']
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tdocs/SAD.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner `
            -DirLister $script:lister -FileReader $reader `
            -SeenStateReader ([scriptblock]::Create("@{ 'docs/SAD.md' = '$seenSha' }")) `
            -SeenStateWriter $script:NoopSeenWriter -SnapshotReader $script:NullSnapshotReader
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'no-docs-drift'
    }
    It 'warn mode exits 0 but still surfaces the queue' {
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tdocs/SAD.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $script:reader -EnforcementMode 'warn' @script:io
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'docs-action-suggested'
        @($result.Queue).Count | Should -BeGreaterThan 0
    }
    It 'exits 2 with both revise and index entries when an index is drifted' {
        $files = Get-ConsistentFiles
        $files['docs/api/index.md'] = New-IndexMd @('/openapi.yaml')
        $reader = New-FileReader -Files $files
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tdocs/api/api-guidelines.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $reader @script:io
        $result.ExitCode | Should -Be 2
        $result.Reason | Should -Be 'docs-drift-detected'
        $result.Queue[0].Command | Should -Be '/docs-revise'
        @($result.Queue | Where-Object { $_.Command -eq '/docs-index' -and $_.Args -eq 'docs/api/' }).Count | Should -Be 1
    }
    It 'exits 2 with registry-sync when CLAUDE.md omits the ROOT' {
        $files = Get-ConsistentFiles
        $files['CLAUDE.md'] = "## Sources of truth`n`n- none`n"
        $reader = New-FileReader -Files $files
        $json = '{"tool_input":{"command":"git commit -am wip"}}'
        $runner = { param($Argv) "M`tCLAUDE.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $reader @script:io
        $result.ExitCode | Should -Be 2
        @($result.Queue | Where-Object { $_.Command -eq '/docs-registry-sync' }).Count | Should -Be 1
    }
    It 'message surfaces the queue contents' {
        $files = Get-ConsistentFiles
        $files['docs/design/index.md'] = New-IndexMd @('/README')
        $reader = New-FileReader -Files $files
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "A`tdocs/design/components.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $reader @script:io
        $result.Message | Should -Match '/docs-index docs/design/'
    }
    It 'exits 0 in standalone mode when tree is consistent and no session edits' {
        $result = Invoke-PreCommitDocsHook -Standalone -RepoRoot '.' -GitCommandRunner { @() } -DirLister $script:lister -FileReader $script:reader @script:io
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'no-docs-drift'
    }
    It 'exits 2 in standalone mode when drift detected' {
        $files = Get-ConsistentFiles
        $files['docs/api/index.md'] = New-IndexMd @('/openapi.yaml')
        $reader = New-FileReader -Files $files
        $result = Invoke-PreCommitDocsHook -Standalone -RepoRoot '.' -GitCommandRunner { @() } -DirLister $script:lister -FileReader $reader @script:io
        $result.ExitCode | Should -Be 2
        $result.Reason | Should -Be 'docs-drift-detected'
        @($result.Queue | Where-Object { $_.Args -eq 'docs/api/' }).Count | Should -Be 1
    }
    It 'standalone mode queues /docs-revise for session-edited markdown' {
        # Snapshot at an old HEAD; SAD.md committed since then -> session edit.
        $snapReader = { @{ Head = 'OLDSHA'; Dirty = @() } }
        $runner = {
            param($Argv)
            if ($Argv -contains 'diff' -and $Argv -contains '--name-only') { return @('docs/SAD.md') }
            return @()   # git status --porcelain -> clean
        }
        $result = Invoke-PreCommitDocsHook -Standalone -RepoRoot '.' -GitCommandRunner $runner `
            -DirLister $script:lister -FileReader $script:reader `
            -SnapshotReader $snapReader -SeenStateReader $script:EmptySeenReader -SeenStateWriter $script:NoopSeenWriter `
            -AttemptsReader $script:EmptyAttemptsReader -AttemptsWriter $script:NoopAttemptsWriter
        $result.ExitCode | Should -Be 2
        @($result.Queue | Where-Object { $_.Command -eq '/docs-revise' }).Count | Should -Be 1
    }
    It 'standalone mode does not throw when optional injections are omitted' {
        { Invoke-PreCommitDocsHook -Standalone -RepoRoot '.' -GitCommandRunner { @() } -DirLister $script:lister -FileReader $script:reader -SnapshotReader $script:NullSnapshotReader -SeenStateReader $script:EmptySeenReader -SeenStateWriter $script:NoopSeenWriter -AttemptsReader $script:EmptyAttemptsReader -AttemptsWriter $script:NoopAttemptsWriter } | Should -Not -Throw
    }

    It 'auto-revise toggle returns an AutoInvoke directive instead of blocking' {
        $snapReader = { @{ Head = 'OLD'; Dirty = @() } }
        $runner = {
            param($Argv)
            if ($Argv -contains 'diff' -and $Argv -contains '--name-only') { return @('docs/SAD.md') }
            return @()
        }
        $result = Invoke-PreCommitDocsHook -Standalone -RepoRoot '.' -GitCommandRunner $runner `
            -DirLister $script:lister -FileReader $script:reader -AutoReviseMode 'on' `
            -SnapshotReader $snapReader -SeenStateReader $script:EmptySeenReader -SeenStateWriter $script:NoopSeenWriter `
            -AttemptsReader $script:EmptyAttemptsReader -AttemptsWriter $script:NoopAttemptsWriter
        $result.ExitCode | Should -Be 0
        $result.AutoInvoke | Should -BeTrue
        $result.Directive | Should -Match '/docs-revise'
        $result.Reason | Should -Be 'docs-auto-revise'
    }
    It 'auto-revise OFF (default) blocks passively per EnforcementMode' {
        $snapReader = { @{ Head = 'OLD'; Dirty = @() } }
        $runner = {
            param($Argv)
            if ($Argv -contains 'diff' -and $Argv -contains '--name-only') { return @('docs/SAD.md') }
            return @()
        }
        $result = Invoke-PreCommitDocsHook -Standalone -RepoRoot '.' -GitCommandRunner $runner `
            -DirLister $script:lister -FileReader $script:reader -EnforcementMode 'block' `
            -SnapshotReader $snapReader -SeenStateReader $script:EmptySeenReader -SeenStateWriter $script:NoopSeenWriter `
            -AttemptsReader $script:EmptyAttemptsReader -AttemptsWriter $script:NoopAttemptsWriter
        $result.ExitCode | Should -Be 2
        $result.AutoInvoke | Should -Not -BeTrue
        $result.Reason | Should -Be 'docs-drift-detected'
    }

    It 'increments the attempt counter on each Standalone revise flag' {
        $captured = $null
        $writer = { param($A) $script:capturedAtt = $A }
        $snapReader = { @{ Head = 'OLD'; Dirty = @() } }
        $runner = {
            param($Argv)
            if ($Argv -contains 'diff' -and $Argv -contains '--name-only') { return @('docs/SAD.md') }
            return @()
        }
        $script:capturedAtt = $null
        Invoke-PreCommitDocsHook -Standalone -RepoRoot '.' -GitCommandRunner $runner `
            -DirLister $script:lister -FileReader $script:reader `
            -SnapshotReader $snapReader -SeenStateReader $script:EmptySeenReader -SeenStateWriter $script:NoopSeenWriter `
            -AttemptsReader { @{ 'docs/SAD.md' = 1 } } -AttemptsWriter $writer | Out-Null
        $script:capturedAtt['docs/SAD.md'] | Should -Be 2
    }

    It 'breaks the loop: a revise candidate at the cap is dropped and the session may stop' {
        $snapReader = { @{ Head = 'OLD'; Dirty = @() } }
        $runner = {
            param($Argv)
            if ($Argv -contains 'diff' -and $Argv -contains '--name-only') { return @('docs/SAD.md') }
            return @()
        }
        # docs/SAD.md already at the cap (3); only it is a candidate, tree otherwise consistent.
        $result = Invoke-PreCommitDocsHook -Standalone -RepoRoot '.' -GitCommandRunner $runner `
            -DirLister $script:lister -FileReader $script:reader -EnforcementMode 'block' `
            -SnapshotReader $snapReader -SeenStateReader $script:EmptySeenReader -SeenStateWriter $script:NoopSeenWriter `
            -AttemptsReader { @{ 'docs/SAD.md' = 3 } } -AttemptsWriter $script:NoopAttemptsWriter
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'revise-cap-reached'
        @($result.Queue).Count | Should -Be 0
        $result.Exhausted | Should -Contain 'docs/SAD.md'
    }

    It 'PreToolUse commit path ignores the attempt cap (no loop there)' {
        # Even with a maxed attempt count, a staged-commit revise still queues.
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tdocs/SAD.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner `
            -DirLister $script:lister -FileReader $script:reader `
            -SeenStateReader $script:EmptySeenReader -SeenStateWriter $script:NoopSeenWriter `
            -SnapshotReader $script:NullSnapshotReader `
            -AttemptsReader { @{ 'docs/SAD.md' = 99 } } -AttemptsWriter $script:NoopAttemptsWriter
        $result.ExitCode | Should -Be 2
        @($result.Queue | Where-Object { $_.Command -eq '/docs-revise' }).Count | Should -Be 1
    }
}

# ---------- Mode B (docs-revise) + registry role drift ----------

Describe 'Get-ContentSha' {
    It 'is deterministic for identical content' {
        (Get-ContentSha -Content 'abc') | Should -Be (Get-ContentSha -Content 'abc')
    }
    It 'differs when content differs' {
        (Get-ContentSha -Content 'abc') | Should -Not -Be (Get-ContentSha -Content 'abd')
    }
    It 'returns a 64-char lowercase hex string' {
        (Get-ContentSha -Content 'abc') | Should -Match '^[0-9a-f]{64}$'
    }
    It 'hashes empty and null identically and not as empty-string sentinel' {
        (Get-ContentSha -Content '') | Should -Be (Get-ContentSha -Content $null)
        (Get-ContentSha -Content '') | Should -Not -Be ''
    }
}

Describe 'Get-IntroFromFrontMatter' {
    It 'extracts a single-quoted intro' {
        Get-IntroFromFrontMatter -Content "---`ntitle: T`nintro: 'Hello world'`n---`n" | Should -Be 'Hello world'
    }
    It 'extracts a double-quoted intro' {
        Get-IntroFromFrontMatter -Content "---`nintro: `"Hi there`"`n---`n" | Should -Be 'Hi there'
    }
    It 'extracts an unquoted intro' {
        Get-IntroFromFrontMatter -Content "---`nintro: bare text`n---`n" | Should -Be 'bare text'
    }
    It 'returns empty when no intro key' {
        Get-IntroFromFrontMatter -Content "---`ntitle: T`n---`n" | Should -Be ''
    }
    It 'ignores an intro outside the front-matter block' {
        Get-IntroFromFrontMatter -Content "---`ntitle: T`n---`nintro: not-this`n" | Should -Be ''
    }
    It 'returns empty on empty content' { Get-IntroFromFrontMatter -Content '' | Should -Be '' }
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

Describe 'Resolve-ReviseCandidates' {
    It 'keeps a doc whose hash is unseen' {
        $reader = New-FileReader -Files @{ 'docs/a.md' = 'new' }
        $r = Resolve-ReviseCandidates -MdPaths @('docs/a.md') -SeenState @{} -FileReader $reader
        $r | Should -Contain 'docs/a.md'
    }
    It 'drops a doc whose current hash equals the seen hash' {
        $reader = New-FileReader -Files @{ 'docs/a.md' = 'same' }
        $seen = @{ 'docs/a.md' = (Get-ContentSha -Content 'same') }
        @(Resolve-ReviseCandidates -MdPaths @('docs/a.md') -SeenState $seen -FileReader $reader).Count | Should -Be 0
    }
    It 're-flags a doc whose content changed since last seen' {
        $reader = New-FileReader -Files @{ 'docs/a.md' = 'changed' }
        $seen = @{ 'docs/a.md' = (Get-ContentSha -Content 'old') }
        @(Resolve-ReviseCandidates -MdPaths @('docs/a.md') -SeenState $seen -FileReader $reader).Count | Should -Be 1
    }
    It 'returns empty for an empty path set' {
        $reader = New-FileReader -Files @{}
        @(Resolve-ReviseCandidates -MdPaths @() -SeenState @{} -FileReader $reader).Count | Should -Be 0
    }
}

Describe 'Resolve-ReviseQueue' {
    It 'emits one /docs-revise entry carrying all paths, sorted' {
        $q = @(Resolve-ReviseQueue -Paths @('docs/b.md', 'docs/a.md'))
        @($q).Count | Should -Be 1
        $q[0].Command | Should -Be '/docs-revise'
        $q[0].Args | Should -Be 'docs/a.md docs/b.md'
    }
    It 'returns empty for no paths' { @(Resolve-ReviseQueue -Paths @()).Count | Should -Be 0 }
}

Describe 'Resolve-EnforcementMode' {
    It 'defaults to block when unset' { Resolve-EnforcementMode -EnvValue '' | Should -Be 'block' }
    It 'defaults to block on unknown values' { Resolve-EnforcementMode -EnvValue 'loud' | Should -Be 'block' }
    It 'returns warn for "warn"' { Resolve-EnforcementMode -EnvValue 'warn' | Should -Be 'warn' }
    It 'is case-insensitive for warn' { Resolve-EnforcementMode -EnvValue 'WARN' | Should -Be 'warn' }
    It 'returns block for explicit "block"' { Resolve-EnforcementMode -EnvValue 'block' | Should -Be 'block' }
    It 'maps the retired "auto" value to block (auto is now a separate toggle)' { Resolve-EnforcementMode -EnvValue 'auto' | Should -Be 'block' }
}

Describe 'Resolve-AutoReviseMode' {
    It 'is off when unset' { Resolve-AutoReviseMode -EnvValue '' | Should -BeFalse }
    It 'is off for falsey/unknown values' {
        Resolve-AutoReviseMode -EnvValue '0' | Should -BeFalse
        Resolve-AutoReviseMode -EnvValue 'off' | Should -BeFalse
        Resolve-AutoReviseMode -EnvValue 'nope' | Should -BeFalse
    }
    It 'is on for 1/true/on/yes (case-insensitive)' {
        Resolve-AutoReviseMode -EnvValue '1' | Should -BeTrue
        Resolve-AutoReviseMode -EnvValue 'true' | Should -BeTrue
        Resolve-AutoReviseMode -EnvValue 'ON' | Should -BeTrue
        Resolve-AutoReviseMode -EnvValue 'Yes' | Should -BeTrue
    }
}

Describe 'Resolve-MaxReviseAttempts' {
    It 'defaults to 3 when unset' { Resolve-MaxReviseAttempts -EnvValue '' | Should -Be 3 }
    It 'parses a numeric value' { Resolve-MaxReviseAttempts -EnvValue '5' | Should -Be 5 }
    It 'clamps to a minimum of 1' { Resolve-MaxReviseAttempts -EnvValue '0' | Should -Be 1 }
    It 'clamps negatives to 1' { Resolve-MaxReviseAttempts -EnvValue '-4' | Should -Be 1 }
    It 'falls back to default on non-numeric' { Resolve-MaxReviseAttempts -EnvValue 'lots' | Should -Be 3 }
}

Describe 'Split-ByAttemptCap' {
    It 'includes a fresh path and increments its count to 1' {
        $r = Split-ByAttemptCap -Paths @('docs/a.md') -Attempts @{} -Max 3
        $r.ToInvoke | Should -Contain 'docs/a.md'
        $r.Exhausted.Count | Should -Be 0
        $r.NextAttempts['docs/a.md'] | Should -Be 1
    }
    It 'increments an existing under-cap count' {
        $r = Split-ByAttemptCap -Paths @('docs/a.md') -Attempts @{ 'docs/a.md' = 2 } -Max 3
        $r.ToInvoke | Should -Contain 'docs/a.md'
        $r.NextAttempts['docs/a.md'] | Should -Be 3
    }
    It 'exhausts a path at the cap and does not increment past it' {
        $r = Split-ByAttemptCap -Paths @('docs/a.md') -Attempts @{ 'docs/a.md' = 3 } -Max 3
        $r.ToInvoke.Count | Should -Be 0
        $r.Exhausted | Should -Contain 'docs/a.md'
        $r.NextAttempts['docs/a.md'] | Should -Be 3
    }
    It 'does not mutate the input attempts hashtable' {
        $att = @{ 'docs/a.md' = 1 }
        $null = Split-ByAttemptCap -Paths @('docs/a.md') -Attempts $att -Max 3
        $att['docs/a.md'] | Should -Be 1
    }
}

Describe 'Format-AutoReviseDirective' {
    It 'lists the chain commands in order' {
        $q = @(@{ Command = '/docs-revise'; Args = 'docs/a.md' }, @{ Command = '/docs-registry-sync'; Args = '' })
        $msg = Format-AutoReviseDirective -Queue $q -Max 3
        $msg | Should -Match '1\. /docs-revise docs/a.md'
        $msg | Should -Match '2\. /docs-registry-sync'
        $msg | Should -Match 'capped at 3'
    }
    It 'notes exhausted files' {
        $q = @(@{ Command = '/docs-registry-sync'; Args = '' })
        $msg = Format-AutoReviseDirective -Queue $q -Exhausted @('docs/stuck.md') -Max 2
        $msg | Should -Match 'docs/stuck.md'
    }
    It 'returns empty for an empty queue' { Format-AutoReviseDirective -Queue @() | Should -Be '' }
}

Describe 'ConvertTo-StopBlockJson' {
    It 'produces a decision:block payload carrying the reason' {
        $json = ConvertTo-StopBlockJson -Reason 'do the thing'
        $o = $json | ConvertFrom-Json
        $o.decision | Should -Be 'block'
        $o.reason | Should -Be 'do the thing'
    }
}

Describe 'Test-RegistryRoleInSync' {
    It 'true when the entry line contains the intro' {
        $c = "## Sources of truth`n`n- [docs/](docs/) — Fresh role text.`n"
        Test-RegistryRoleInSync -Content $c -DirPath 'docs' -Intro 'Fresh role text' | Should -BeTrue
    }
    It 'false when the entry line is missing the intro' {
        $c = "## Sources of truth`n`n- [docs/](docs/) — Stale outdated.`n"
        Test-RegistryRoleInSync -Content $c -DirPath 'docs' -Intro 'Fresh role text' | Should -BeFalse
    }
    It 'true (nothing to compare) when intro is empty' {
        $c = "## Sources of truth`n`n- [docs/](docs/) — anything.`n"
        Test-RegistryRoleInSync -Content $c -DirPath 'docs' -Intro '' | Should -BeTrue
    }
    It 'false when the entry is outside the Sources of truth section' {
        $c = "## Intro`n`n- [docs/](docs/) — Fresh role text.`n`n## Sources of truth`n`n- other`n"
        Test-RegistryRoleInSync -Content $c -DirPath 'docs' -Intro 'Fresh role text' | Should -BeFalse
    }
}

Describe 'Get-DocsDriftQueue registry role drift' {
    It 'queues /docs-registry-sync when a present ROOT entry has stale role text' {
        $tree = @{
            '.'    = @(@{ Name = 'docs'; IsDir = $true })
            'docs' = @(@{ Name = 'page.md'; IsDir = $false }, @{ Name = 'index.md'; IsDir = $false })
        }
        $files = @{
            'docs/index.md' = "---`ntitle: T`nintro: 'Fresh role text'`nchildren:`n  - /page`n---`n"
            'CLAUDE.md'     = "## Sources of truth`n`n- [docs/](docs/) — Stale outdated role.`n"
        }
        $lister = New-DirLister -Tree $tree
        $reader = New-FileReader -Files $files
        $queue = Get-DocsDriftQueue -DirLister $lister -FileReader $reader
        @($queue | Where-Object { $_.Command -eq '/docs-registry-sync' }).Count | Should -Be 1
        @($queue | Where-Object { $_.Command -eq '/docs-index' }).Count | Should -Be 0
    }
    It 'no drift when the ROOT entry role text contains the intro' {
        $tree = @{
            '.'    = @(@{ Name = 'docs'; IsDir = $true })
            'docs' = @(@{ Name = 'page.md'; IsDir = $false }, @{ Name = 'index.md'; IsDir = $false })
        }
        $files = @{
            'docs/index.md' = "---`ntitle: T`nintro: 'Fresh role text'`nchildren:`n  - /page`n---`n"
            'CLAUDE.md'     = "## Sources of truth`n`n- [docs/](docs/) — Fresh role text.`n"
        }
        $lister = New-DirLister -Tree $tree
        $reader = New-FileReader -Files $files
        @(Get-DocsDriftQueue -DirLister $lister -FileReader $reader).Count | Should -Be 0
    }
}

Describe 'Format-BlockMessage warn mode' {
    It 'uses non-blocking language in warn mode' {
        $msg = Format-BlockMessage -Queue @(@{ Command = '/docs-revise'; Args = 'docs/a.md' }) -Mode 'warn'
        $msg | Should -Match 'non-blocking'
        $msg | Should -Not -Match 'drift detected'
    }
    It 'uses drift language in block mode' {
        $msg = Format-BlockMessage -Queue @(@{ Command = '/docs-revise'; Args = 'docs/a.md' }) -Mode 'block'
        $msg | Should -Match 'drift detected'
    }
}

Describe 'Get-SessionIdFromPayload' {
    It 'extracts session_id from a payload' {
        Get-SessionIdFromPayload -Payload (Read-HookPayload -Json '{"session_id":"abc-123"}') | Should -Be 'abc-123'
    }
    It 'returns empty when absent' {
        Get-SessionIdFromPayload -Payload (Read-HookPayload -Json '{"tool_name":"Bash"}') | Should -Be ''
    }
    It 'returns empty for null payload' { Get-SessionIdFromPayload -Payload $null | Should -Be '' }
}

Describe 'Get-SafeSessionId' {
    It 'passes through a uuid-shaped id' {
        Get-SafeSessionId -SessionId 'a1b2-c3d4.e5' | Should -Be 'a1b2-c3d4.e5'
    }
    It 'collapses unsafe characters to underscore' {
        Get-SafeSessionId -SessionId 'a/b\c:d e' | Should -Be 'a_b_c_d_e'
    }
    It 'returns empty for empty / whitespace' {
        Get-SafeSessionId -SessionId '' | Should -Be ''
        Get-SafeSessionId -SessionId '   ' | Should -Be ''
    }
}

Describe 'Per-session state path namespacing' {
    It 'uses the global path when no session id' {
        (Get-DocsSessionPath -RepoRoot '/repo') | Should -Match '\.docs-session\.json$'
        (Get-DocsReviseAttemptsPath -RepoRoot '/repo') | Should -Match '\.docs-keeper-attempts\.json$'
    }
    It 'namespaces by session id when provided' {
        (Get-DocsSessionPath -RepoRoot '/repo' -SessionId 'sess9') | Should -Match '\.docs-session\.sess9\.json$'
        (Get-DocsReviseAttemptsPath -RepoRoot '/repo' -SessionId 'sess9') | Should -Match '\.docs-keeper-attempts\.sess9\.json$'
    }
    It 'two sessions resolve to different attempt files' {
        $a = Get-DocsReviseAttemptsPath -RepoRoot '/repo' -SessionId 'A'
        $b = Get-DocsReviseAttemptsPath -RepoRoot '/repo' -SessionId 'B'
        $a | Should -Not -Be $b
    }
}

Describe 'Per-session attempt counters are isolated (real round-trip)' {
    It 'session A and session B keep independent counts' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dk-" + [System.IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory -Path (Join-Path $tmp '.claude') -Force | Out-Null
        try {
            Write-DocsReviseAttempts -RepoRoot $tmp -SessionId 'A' -Attempts @{ 'docs/x.md' = 2 }
            Write-DocsReviseAttempts -RepoRoot $tmp -SessionId 'B' -Attempts @{ 'docs/x.md' = 99 }
            (Read-DocsReviseAttempts -RepoRoot $tmp -SessionId 'A')['docs/x.md'] | Should -Be 2
            (Read-DocsReviseAttempts -RepoRoot $tmp -SessionId 'B')['docs/x.md'] | Should -Be 99
        }
        finally { Remove-Item -LiteralPath $tmp -Recurse -Force }
    }
}

Describe 'Remove-DocsSessionState' {
    It 'deletes the session snapshot and attempt files, leaves seen-state' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dk-" + [System.IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory -Path (Join-Path $tmp '.claude') -Force | Out-Null
        $sid = 'sx'
        $snap = Get-DocsSessionPath -RepoRoot $tmp -SessionId $sid
        $att = Get-DocsReviseAttemptsPath -RepoRoot $tmp -SessionId $sid
        $seen = Get-DocsSeenStatePath -RepoRoot $tmp
        Set-Content -LiteralPath $snap -Value '{}' -Encoding utf8
        Set-Content -LiteralPath $att -Value '{}' -Encoding utf8
        Set-Content -LiteralPath $seen -Value '{}' -Encoding utf8
        Remove-DocsSessionState -RepoRoot $tmp -SessionId $sid
        Test-Path -LiteralPath $snap | Should -BeFalse
        Test-Path -LiteralPath $att | Should -BeFalse
        Test-Path -LiteralPath $seen | Should -BeTrue
        Remove-Item -LiteralPath $tmp -Recurse -Force
    }
}

Describe 'Invoke-SessionSnapshot' {
    It 'writes a snapshot with HEAD and the dirty set, and resets attempts' {
        $script:captured = $null
        $script:attemptsReset = $null
        $writer = { param($Snap) $script:captured = $Snap }
        $attWriter = { param($A) $script:attemptsReset = $A }
        $runner = {
            param($Argv)
            if ($Argv -contains 'rev-parse') { return 'abc123' }
            return ' M docs/pre.md'   # porcelain
        }
        Invoke-SessionSnapshot -RepoRoot '.' -GitCommandRunner $runner -SnapshotWriter $writer -AttemptsWriter $attWriter
        $script:captured.Head | Should -Be 'abc123'
        $script:captured.Dirty | Should -Contain 'docs/pre.md'
        @($script:attemptsReset.Keys).Count | Should -Be 0
    }
}
