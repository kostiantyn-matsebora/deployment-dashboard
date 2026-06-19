#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    . "$PSScriptRoot/Invoke-TokensaveGuard.ps1" -AsLibrary
}

Describe 'Get-TokensaveGuardDecision' {

    Context 'branch IS tokensave-tracked (tokensave can answer)' {

        It 'blocks Read on a <ext> source file' -ForEach @(
            @{ ext = '.cs' }, @{ ext = '.ts' }, @{ ext = '.tsx' }, @{ ext = '.js' }, @{ ext = '.jsx' }
        ) {
            $ti = [pscustomobject]@{ file_path = "backend/x/Foo$ext" }
            $d = Get-TokensaveGuardDecision -ToolName 'Read' -ToolInput $ti -BranchTracked $true
            $d.Block | Should -BeTrue
            $d.Reason | Should -Match 'tokensave'
        }

        It 'allows Read on a declarative <ext> file' -ForEach @(
            @{ ext = '.json' }, @{ ext = '.csproj' }, @{ ext = '.yaml' }, @{ ext = '.md' }, @{ ext = '.ps1' }
        ) {
            $ti = [pscustomobject]@{ file_path = "config/app$ext" }
            $d = Get-TokensaveGuardDecision -ToolName 'Read' -ToolInput $ti -BranchTracked $true
            $d.Block | Should -BeFalse
        }

        It 'blocks Grep with a code type' {
            $ti = [pscustomobject]@{ pattern = 'SplitRepo'; type = 'cs' }
            (Get-TokensaveGuardDecision -ToolName 'Grep' -ToolInput $ti -BranchTracked $true).Block | Should -BeTrue
        }

        It 'blocks Grep with a code glob' {
            $ti = [pscustomobject]@{ pattern = 'SplitRepo'; glob = 'backend/**/*.cs' }
            (Get-TokensaveGuardDecision -ToolName 'Grep' -ToolInput $ti -BranchTracked $true).Block | Should -BeTrue
        }

        It 'blocks Grep targeting a code file path' {
            $ti = [pscustomobject]@{ pattern = 'x'; path = 'backend/x/Foo.cs' }
            (Get-TokensaveGuardDecision -ToolName 'Grep' -ToolInput $ti -BranchTracked $true).Block | Should -BeTrue
        }

        It 'allows Grep with a non-code glob' {
            $ti = [pscustomobject]@{ pattern = 'foo'; glob = '**/*.md' }
            (Get-TokensaveGuardDecision -ToolName 'Grep' -ToolInput $ti -BranchTracked $true).Block | Should -BeFalse
        }

        It 'allows a broad Grep with no explicit code target' {
            $ti = [pscustomobject]@{ pattern = 'TODO' }
            (Get-TokensaveGuardDecision -ToolName 'Grep' -ToolInput $ti -BranchTracked $true).Block | Should -BeFalse
        }

        It 'ignores tools other than Read/Grep' {
            $ti = [pscustomobject]@{ file_path = 'backend/x/Foo.cs' }
            (Get-TokensaveGuardDecision -ToolName 'Edit' -ToolInput $ti -BranchTracked $true).Block | Should -BeFalse
        }
    }

    Context 'branch is NOT tracked (tokensave falls back — must not dead-end)' {

        It 'allows Read on a .cs file' {
            $ti = [pscustomobject]@{ file_path = 'backend/x/Foo.cs' }
            (Get-TokensaveGuardDecision -ToolName 'Read' -ToolInput $ti -BranchTracked $false).Block | Should -BeFalse
        }

        It 'allows Grep with a code type' {
            $ti = [pscustomobject]@{ pattern = 'x'; type = 'cs' }
            (Get-TokensaveGuardDecision -ToolName 'Grep' -ToolInput $ti -BranchTracked $false).Block | Should -BeFalse
        }
    }
}

Describe 'Test-BranchTracked' {

    It 'returns true when the branch is a key in branch-meta.json' {
        $meta = Join-Path $TestDrive 'branch-meta.json'
        '{"default_branch":"main","branches":{"main":{},"refactor/x":{}}}' | Set-Content -LiteralPath $meta
        Test-BranchTracked -Branch 'refactor/x' -MetaPath $meta | Should -BeTrue
    }

    It 'returns false when the branch is absent' {
        $meta = Join-Path $TestDrive 'branch-meta2.json'
        '{"default_branch":"main","branches":{"main":{}}}' | Set-Content -LiteralPath $meta
        Test-BranchTracked -Branch 'feature/missing' -MetaPath $meta | Should -BeFalse
    }

    It 'returns false when the meta file is missing' {
        Test-BranchTracked -Branch 'main' -MetaPath (Join-Path $TestDrive 'nope.json') | Should -BeFalse
    }

    It 'returns false on malformed meta json' {
        $meta = Join-Path $TestDrive 'bad.json'
        'not json {' | Set-Content -LiteralPath $meta
        Test-BranchTracked -Branch 'main' -MetaPath $meta | Should -BeFalse
    }
}

Describe 'Test-IsCodePath' {

    It 'detects a code extension' {
        Test-IsCodePath -Path 'a/B.cs' -CodeExtensions @('.cs', '.ts') | Should -BeTrue
    }

    It 'rejects a non-code extension' {
        Test-IsCodePath -Path 'a/b.json' -CodeExtensions @('.cs', '.ts') | Should -BeFalse
    }

    It 'returns false for an empty path' {
        Test-IsCodePath -Path '' -CodeExtensions @('.cs') | Should -BeFalse
    }
}
