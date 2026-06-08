#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-LeadEditGuard.ps1')).Path
    . $script:ScriptPath -AsLibrary
}

# ============================================================
Describe 'ConvertFrom-LaneGlob' {

    It '** matches across path segments' {
        $rx = ConvertFrom-LaneGlob -Glob '.claude/team-process/**'
        '.claude/team-process/process.md'              | Should -Match $rx
        '.claude/team-process/roles/backend.md'        | Should -Match $rx
    }

    It '** does not match a sibling directory' {
        $rx = ConvertFrom-LaneGlob -Glob '.claude/team-process/**'
        '.claude/bindings/backend.md'                  | Should -Not -Match $rx
    }

    It 'single * stays within a segment' {
        $rx = ConvertFrom-LaneGlob -Glob '.claude/*.md'
        '.claude/CLAUDE.md'                            | Should -Match $rx
        '.claude/sub/CLAUDE.md'                        | Should -Not -Match $rx
    }

    It 'exact file glob matches only that file' {
        $rx = ConvertFrom-LaneGlob -Glob '.claude/settings.json'
        '.claude/settings.json'                        | Should -Match $rx
        '.claude/settings.json.bak'                    | Should -Not -Match $rx
    }

    It 'escapes regex metacharacters in literal segments' {
        $rx = ConvertFrom-LaneGlob -Glob 'a.b/c.d'
        'a.b/c.d'   | Should -Match $rx
        'axb/cxd'   | Should -Not -Match $rx
    }
}

# ============================================================
Describe 'Test-PathInGlobs' {

    It 'true when path matches one of several globs' {
        $globs = @('.claude/team-process/**', '.claude/bindings/**')
        Test-PathInGlobs -RelPath '.claude/bindings/backend.md' -Globs $globs | Should -BeTrue
    }

    It 'false when path matches no glob' {
        $globs = @('.claude/team-process/**')
        Test-PathInGlobs -RelPath 'backend/Dashboard.Api/Program.cs' -Globs $globs | Should -BeFalse
    }

    It 'normalizes backslashes before matching' {
        $globs = @('.claude\team-process\**')
        Test-PathInGlobs -RelPath '.claude\team-process\process.md' -Globs $globs | Should -BeTrue
    }

    It 'skips blank lines and comments without error' {
        $globs = @('# comment', '', '.claude/run/**')
        Test-PathInGlobs -RelPath '.claude/run/ledger.md' -Globs $globs | Should -BeTrue
    }
}

# ============================================================
Describe 'Get-RelativePath' {

    It 'strips the repo root prefix' {
        Get-RelativePath -FullPath '/repo/backend/Dashboard.Api/X.cs' -Root '/repo' |
            Should -Be 'backend/Dashboard.Api/X.cs'
    }

    It 'handles Windows-style paths case-insensitively' {
        Get-RelativePath -FullPath 'C:\Repo\Backend\X.cs' -Root 'c:/repo' |
            Should -Be 'Backend/X.cs'
    }

    It 'returns normalized absolute path when outside root' {
        Get-RelativePath -FullPath '/tmp/scratch/typed-form.md' -Root '/repo' |
            Should -Be '/tmp/scratch/typed-form.md'
    }
}

# ============================================================
Describe 'Get-LeadLaneGlobs' {

    It 'returns default whitelist when no override file exists' {
        $globs = Get-LeadLaneGlobs -Root 'C:\nonexistent-path-xyz'
        $globs | Should -Contain '.claude/team-process/**'
        $globs | Should -Contain '.claude/settings.json'
        $globs | Should -Contain '.claude-lead-lane'
    }

    It 'returns override file content when .claude-lead-lane exists' {
        $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "llg-test-$(New-Guid)"
        New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
        try {
            $overrideContent = @(
                '# my custom whitelist',
                '',
                'custom/path/**',
                'another/path/*.md'
            )
            Set-Content -LiteralPath (Join-Path $tmpRoot '.claude-lead-lane') -Value $overrideContent -Encoding utf8NoBOM

            $globs = Get-LeadLaneGlobs -Root $tmpRoot
            $globs | Should -HaveCount 2
            $globs | Should -Contain 'custom/path/**'
            $globs | Should -Contain 'another/path/*.md'
            # Default entries must NOT appear when override is present
            $globs | Should -Not -Contain '.claude/team-process/**'
        }
        finally {
            Remove-Item -Recurse -Force -LiteralPath $tmpRoot -ErrorAction SilentlyContinue
        }
    }
}

# ============================================================
Describe 'Get-LeadEditDecision' {

    Context 'subagent caller' {
        It 'always allows even a product path' {
            $globs = @('.claude/team-process/**')
            $d = Get-LeadEditDecision -RelPath 'backend/Dashboard.Api/Foo.cs' `
                                      -IsSubagent $true -UnderRoot $true -Globs $globs
            $d.Block | Should -BeFalse
        }
    }

    Context 'lead caller' {
        BeforeAll {
            $script:DefaultGlobs = @(
                '.claude/team-process/**',
                '.claude/bindings/**',
                '.claude/agents/**',
                '.claude/commands/**',
                '.claude/skills/**',
                '.claude/*.md',
                '.claude/settings.json',
                '.claude/settings.local.json',
                '.claude/run/**',
                '.claude-team-active',
                '.claude-lane',
                '.claude-lead-lane'
            )
        }

        It 'blocks editing a product backend file' {
            $d = Get-LeadEditDecision -RelPath 'backend/Dashboard.Api/Foo.cs' `
                                      -IsSubagent $false -UnderRoot $true -Globs $script:DefaultGlobs
            $d.Block   | Should -BeTrue
            $d.Reason  | Should -Match 'Delegate'
            $d.Reason  | Should -Match 'backend/Dashboard.Api/Foo\.cs'
        }

        It 'allows editing .claude/team-process/process.md' {
            $d = Get-LeadEditDecision -RelPath '.claude/team-process/process.md' `
                                      -IsSubagent $false -UnderRoot $true -Globs $script:DefaultGlobs
            $d.Block | Should -BeFalse
        }

        It 'allows editing .claude/run/ledger.md' {
            $d = Get-LeadEditDecision -RelPath '.claude/run/ledger.md' `
                                      -IsSubagent $false -UnderRoot $true -Globs $script:DefaultGlobs
            $d.Block | Should -BeFalse
        }

        It 'allows editing .claude/settings.json' {
            $d = Get-LeadEditDecision -RelPath '.claude/settings.json' `
                                      -IsSubagent $false -UnderRoot $true -Globs $script:DefaultGlobs
            $d.Block | Should -BeFalse
        }

        It 'allows editing .claude-lead-lane itself' {
            $d = Get-LeadEditDecision -RelPath '.claude-lead-lane' `
                                      -IsSubagent $false -UnderRoot $true -Globs $script:DefaultGlobs
            $d.Block | Should -BeFalse
        }

        It 'allows a file outside the repo root (OS temp / typed-form)' {
            $d = Get-LeadEditDecision -RelPath '/tmp/scratch/typed-form.md' `
                                      -IsSubagent $false -UnderRoot $false -Globs $script:DefaultGlobs
            $d.Block | Should -BeFalse
        }

        It 'blocks editing frontend files' {
            $d = Get-LeadEditDecision -RelPath 'frontend/dashboard/src/app/app.component.ts' `
                                      -IsSubagent $false -UnderRoot $true -Globs $script:DefaultGlobs
            $d.Block | Should -BeTrue
        }

        It 'blocks editing docs files' {
            $d = Get-LeadEditDecision -RelPath 'docs/api/openapi.yaml' `
                                      -IsSubagent $false -UnderRoot $true -Globs $script:DefaultGlobs
            $d.Block | Should -BeTrue
        }
    }
}
