#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-BranchGuard.ps1')).Path
    . $script:ScriptPath -AsLibrary

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
}

# ============================================================
Describe 'Test-IsGitCommitCommand' {

    It 'true for git commit -m "msg"' {
        Test-IsGitCommitCommand -Command 'git commit -m "msg"' | Should -BeTrue
    }

    It 'true for git commit --amend' {
        Test-IsGitCommitCommand -Command 'git commit --amend' | Should -BeTrue
    }

    It 'true with extra whitespace between git and commit' {
        Test-IsGitCommitCommand -Command '  git   commit  ' | Should -BeTrue
    }

    It 'false for git push' {
        Test-IsGitCommitCommand -Command 'git push' | Should -BeFalse
    }

    It 'false for git status' {
        Test-IsGitCommitCommand -Command 'git status' | Should -BeFalse
    }

    It 'false for git log' {
        Test-IsGitCommitCommand -Command 'git log' | Should -BeFalse
    }
}

# ============================================================
Describe 'Test-IsDetachedHead' {

    It 'true when runner returns HEAD' {
        $runner = New-GitRunner @{ 'rev-parse --abbrev-ref HEAD' = 'HEAD' }
        Test-IsDetachedHead -GitRunner $runner | Should -BeTrue
    }

    It 'false when runner returns main' {
        $runner = New-GitRunner @{ 'rev-parse --abbrev-ref HEAD' = 'main' }
        Test-IsDetachedHead -GitRunner $runner | Should -BeFalse
    }

    It 'false when runner returns a feature branch name' {
        $runner = New-GitRunner @{ 'rev-parse --abbrev-ref HEAD' = 'feat/something' }
        Test-IsDetachedHead -GitRunner $runner | Should -BeFalse
    }

    It 'false when runner returns empty string' {
        $runner = New-GitRunner @{ 'rev-parse --abbrev-ref HEAD' = '' }
        Test-IsDetachedHead -GitRunner $runner | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-BranchGuardDecision' {

    It 'Block=false for non-commit command without checking HEAD' {
        $runner = New-GitRunner @{}
        $result = Get-BranchGuardDecision -Command 'git push' -GitRunner $runner
        $result.Block | Should -BeFalse
    }

    It 'Block=false for commit command when HEAD is not detached' {
        $runner = New-GitRunner @{ 'rev-parse --abbrev-ref HEAD' = 'main' }
        $result = Get-BranchGuardDecision -Command 'git commit -m "fix"' -GitRunner $runner
        $result.Block | Should -BeFalse
    }

    It 'Block=true for commit command when HEAD is detached' {
        $runner = New-GitRunner @{ 'rev-parse --abbrev-ref HEAD' = 'HEAD' }
        $result = Get-BranchGuardDecision -Command 'git commit -m "fix"' -GitRunner $runner
        $result.Block | Should -BeTrue
    }

    It 'reason mentions git checkout -b when blocking' {
        $runner = New-GitRunner @{ 'rev-parse --abbrev-ref HEAD' = 'HEAD' }
        $result = Get-BranchGuardDecision -Command 'git commit --amend' -GitRunner $runner
        $result.Reason | Should -Match 'git checkout -b'
    }
}
