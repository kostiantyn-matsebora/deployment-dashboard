#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:HookPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-PreCommitDocsHook.ps1')).Path
    # Dot-source in library mode — defines functions, skips entry block.
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

    # Consistent docs/ tree matching the live repo layout.
    function Get-ConsistentTree {
        return @{
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
            'CLAUDE.md'                   = "# Project`n`n## Sources of truth`n`n- [docs/](docs/) — root.`n`n## Other`n"
        }
    }
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

Describe 'Test-IsDocsPath' {
    It 'matches docs/ subpath' { Test-IsDocsPath -Path 'docs/api/README.md' | Should -BeTrue }
    It 'matches docs/ deep subpath' { Test-IsDocsPath -Path 'docs/design/mockup/index.html' | Should -BeTrue }
    It 'matches CLAUDE.md exactly' { Test-IsDocsPath -Path 'CLAUDE.md' | Should -BeTrue }
    It 'rejects src/ path' { Test-IsDocsPath -Path 'src/Program.cs' | Should -BeFalse }
    It 'rejects mockup/ path' { Test-IsDocsPath -Path 'mockup/variant-c/index.html' | Should -BeFalse }
    It 'rejects empty string' { Test-IsDocsPath -Path '' | Should -BeFalse }
    It 'rejects null' { Test-IsDocsPath -Path $null | Should -BeFalse }
    It 'rejects "doc/" (singular) lookalike' { Test-IsDocsPath -Path 'doc/foo.md' | Should -BeFalse }
}

Describe 'Test-TouchesDocs' {
    It 'true when a Path is under docs/' {
        Test-TouchesDocs -Changes @(@{ Status = 'M'; Path = 'docs/SAD.md'; OldPath = $null }) | Should -BeTrue
    }
    It 'true when CLAUDE.md changed' {
        Test-TouchesDocs -Changes @(@{ Status = 'M'; Path = 'CLAUDE.md'; OldPath = $null }) | Should -BeTrue
    }
    It 'true when only an OldPath (rename source) is under docs/' {
        Test-TouchesDocs -Changes @(@{ Status = 'R'; Path = 'mockup/x.html'; OldPath = 'docs/design/mockup/x.html' }) | Should -BeTrue
    }
    It 'false when no change touches docs' {
        Test-TouchesDocs -Changes @(@{ Status = 'M'; Path = 'src/foo.cs'; OldPath = $null }) | Should -BeFalse
    }
    It 'false on empty change set' { Test-TouchesDocs -Changes @() | Should -BeFalse }
}

Describe 'Test-IsHiddenName' {
    It 'flags dot-prefixed' { Test-IsHiddenName -Name '.git' | Should -BeTrue }
    It 'flags underscore-prefixed (Jekyll)' { Test-IsHiddenName -Name '_drafts' | Should -BeTrue }
    It 'passes a normal name' { Test-IsHiddenName -Name 'api' | Should -BeFalse }
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
            'docs'       = @(@{ Name = 'index.md'; IsDir = $false }, @{ Name = 'guides'; IsDir = $true })
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
    It 'finds every directory holding an index.md' {
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $result = Get-IndexDirs -Dir 'docs' -DirLister $lister
        $result | Should -Contain 'docs'
        $result | Should -Contain 'docs/api'
        $result | Should -Contain 'docs/design'
        $result | Should -Contain 'docs/design/mockup'
        @($result).Count | Should -Be 4
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
        # design/index.md uses a non-alphabetical order; set comparison must pass.
        $lister = New-DirLister -Tree (Get-ConsistentTree)
        $reader = New-FileReader -Files (Get-ConsistentFiles)
        $queue = Get-DocsDriftQueue -DirLister $lister -FileReader $reader
        ($queue | Where-Object { $_.Args -eq 'docs/design/' }).Count | Should -Be 0
    }
    It 'queues /docs-index when an index omits a present file' {
        $files = Get-ConsistentFiles
        $files['docs/api/index.md'] = New-IndexMd @('/openapi.yaml')   # dropped /api-guidelines
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
    It 'returns empty when nothing under docs is indexed' {
        $lister = New-DirLister -Tree @{ 'docs' = @(@{ Name = 'loose.md'; IsDir = $false }) }
        $reader = New-FileReader -Files @{}
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
    }

    It 'exits 0 with reason no-payload when stdin empty' {
        $result = Invoke-PreCommitDocsHook -HookInputJson '' -RepoRoot '.' -GitCommandRunner { @() } -DirLister $script:lister -FileReader $script:reader
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'no-payload'
    }
    It 'exits 0 with reason not-git-commit when bash is unrelated' {
        $json = '{"tool_input":{"command":"npm test"}}'
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner { @() } -DirLister $script:lister -FileReader $script:reader
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'not-git-commit'
    }
    It 'exits 0 with reason no-docs-change when commit avoids docs' {
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tsrc/Program.cs" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $script:reader
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'no-docs-change'
    }
    It 'exits 0 (no-docs-drift) on a docs commit when the tree is consistent' {
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tdocs/SAD.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $script:reader
        $result.ExitCode | Should -Be 0
        $result.Reason | Should -Be 'no-docs-drift'
    }
    It 'exits 2 with a queue when an index is drifted' {
        $files = Get-ConsistentFiles
        $files['docs/api/index.md'] = New-IndexMd @('/openapi.yaml')
        $reader = New-FileReader -Files $files
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "M`tdocs/api/openapi.yaml" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $reader
        $result.ExitCode | Should -Be 2
        $result.Reason | Should -Be 'docs-drift-detected'
        $result.Queue[0].Command | Should -Be '/docs-index'
        $result.Queue[0].Args | Should -Be 'docs/api/'
    }
    It 'exits 2 with registry-sync when CLAUDE.md omits the ROOT' {
        $files = Get-ConsistentFiles
        $files['CLAUDE.md'] = "## Sources of truth`n`n- none`n"
        $reader = New-FileReader -Files $files
        $json = '{"tool_input":{"command":"git commit -am wip"}}'
        $runner = { param($Argv) "M`tCLAUDE.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $reader
        $result.ExitCode | Should -Be 2
        @($result.Queue | Where-Object { $_.Command -eq '/docs-registry-sync' }).Count | Should -Be 1
    }
    It 'message surfaces the queue contents' {
        $files = Get-ConsistentFiles
        $files['docs/design/index.md'] = New-IndexMd @('/README')   # drifted
        $reader = New-FileReader -Files $files
        $json = '{"tool_input":{"command":"git commit -m foo"}}'
        $runner = { param($Argv) "A`tdocs/design/components.md" }
        $result = Invoke-PreCommitDocsHook -HookInputJson $json -RepoRoot '.' -GitCommandRunner $runner -DirLister $script:lister -FileReader $reader
        $result.Message | Should -Match '/docs-index docs/design/'
    }
}
