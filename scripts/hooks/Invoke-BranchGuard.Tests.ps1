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

# ============================================================
Describe 'Test-IsGitPushCommand' {

    It 'true for git push' {
        Test-IsGitPushCommand -Command 'git push' | Should -BeTrue
    }

    It 'true for git push --force origin feat' {
        Test-IsGitPushCommand -Command 'git push --force origin feat' | Should -BeTrue
    }

    It 'false for git pull' {
        Test-IsGitPushCommand -Command 'git pull' | Should -BeFalse
    }

    It 'false for git commit' {
        Test-IsGitPushCommand -Command 'git commit -m x' | Should -BeFalse
    }
}

# ============================================================
Describe 'Test-IsPrCreateCommand' {

    It 'true for gh pr create' {
        Test-IsPrCreateCommand -Command 'gh pr create --base main --head feat' | Should -BeTrue
    }

    It 'false for gh pr view' {
        Test-IsPrCreateCommand -Command 'gh pr view 5' | Should -BeFalse
    }

    It 'false for gh run list' {
        Test-IsPrCreateCommand -Command 'gh run list' | Should -BeFalse
    }
}

# ============================================================
Describe 'Test-IsLinkedWorktree' {

    It 'true when git-dir differs from git-common-dir (linked worktree)' {
        $runner = New-GitRunner @{
            'rev-parse --git-dir'        = '/repo/.git/worktrees/member-1'
            'rev-parse --git-common-dir' = '/repo/.git'
        }
        Test-IsLinkedWorktree -GitRunner $runner | Should -BeTrue
    }

    It 'false when git-dir equals git-common-dir (main worktree)' {
        $runner = New-GitRunner @{
            'rev-parse --git-dir'        = '.git'
            'rev-parse --git-common-dir' = '.git'
        }
        Test-IsLinkedWorktree -GitRunner $runner | Should -BeFalse
    }

    It 'false when runner returns nothing' {
        $runner = New-GitRunner @{}
        Test-IsLinkedWorktree -GitRunner $runner | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-BranchGuardDecision (single-integrator / worktree)' {

    BeforeAll {
        $script:linked = @{
            'rev-parse --git-dir'        = '/repo/.git/worktrees/m1'
            'rev-parse --git-common-dir' = '/repo/.git'
        }
    }

    It 'blocks git commit from a linked worktree' {
        $runner = New-GitRunner $script:linked
        $r = Get-BranchGuardDecision -Command 'git commit -m x' -GitRunner $runner
        $r.Block | Should -BeTrue
        $r.Reason | Should -Match 'Single-integrator'
    }

    It 'blocks git push from a linked worktree' {
        $runner = New-GitRunner $script:linked
        $r = Get-BranchGuardDecision -Command 'git push origin feat' -GitRunner $runner
        $r.Block | Should -BeTrue
        $r.Reason | Should -Match 'Single-integrator'
    }

    It 'blocks gh pr create from a linked worktree' {
        $runner = New-GitRunner $script:linked
        $r = Get-BranchGuardDecision -Command 'gh pr create --base main' -GitRunner $runner
        $r.Block | Should -BeTrue
        $r.Reason | Should -Match 'Single-integrator'
    }

    It 'does not block git commit from the main worktree on a branch' {
        $runner = New-GitRunner @{
            'rev-parse --git-dir'        = '.git'
            'rev-parse --git-common-dir' = '.git'
            'rev-parse --abbrev-ref HEAD' = 'feat/x'
        }
        $r = Get-BranchGuardDecision -Command 'git commit -m x' -GitRunner $runner
        $r.Block | Should -BeFalse
    }

    It 'does not block a non-integration command from a linked worktree' {
        $runner = New-GitRunner $script:linked
        $r = Get-BranchGuardDecision -Command 'git status' -GitRunner $runner
        $r.Block | Should -BeFalse
    }
}
