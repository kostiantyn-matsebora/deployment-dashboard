#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'New-Release.ps1')).Path
    . $script:ScriptPath -AsLibrary
}

# ============================================================
Describe 'Test-SemVer' {

    It 'true for valid version <Version>' -ForEach @(
        @{ Version = '1.2.3' }
        @{ Version = '0.1.0' }
        @{ Version = '0.0.0' }
        @{ Version = '10.20.30' }
        @{ Version = '1.0.0-rc.1' }
        @{ Version = '2.3.4-alpha.0' }
        @{ Version = '0.10.0' }
    ) {
        Test-SemVer -Version $Version | Should -BeTrue
    }

    It 'false for invalid version <Version>' -ForEach @(
        @{ Version = '' }
        @{ Version = '   ' }
        @{ Version = 'v1.2.3' }
        @{ Version = '1.2' }
        @{ Version = '1' }
        @{ Version = '1.2.3.4' }
        @{ Version = 'a.b.c' }
        @{ Version = '1.2.x' }
        @{ Version = '01.2.3' }
        @{ Version = 'release' }
    ) {
        Test-SemVer -Version $Version | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-CurrentVersion' {

    It 'returns 0.0.0 for an empty list' {
        Get-CurrentVersion -Tags @() | Should -Be '0.0.0'
    }

    It 'returns 0.0.0 when no tag is valid semver' {
        Get-CurrentVersion -Tags @('latest', 'release-candidate', 'foo') | Should -Be '0.0.0'
    }

    It 'strips a leading v and returns the bare version' {
        Get-CurrentVersion -Tags @('v1.2.3') | Should -Be '1.2.3'
    }

    It 'picks the highest among mixed v-prefixed and bare tags' {
        Get-CurrentVersion -Tags @('v1.0.0', '0.9.0', 'v1.2.0') | Should -Be '1.2.0'
    }

    It 'orders numerically: 0.10.0 is higher than 0.9.0' {
        Get-CurrentVersion -Tags @('v0.9.0', 'v0.10.0') | Should -Be '0.10.0'
    }

    It 'treats a pre-release as lower than its release' {
        Get-CurrentVersion -Tags @('v1.0.0-rc.1', 'v1.0.0') | Should -Be '1.0.0'
    }

    It 'returns the pre-release when it is the highest available' {
        Get-CurrentVersion -Tags @('v0.9.0', 'v1.0.0-rc.1') | Should -Be '1.0.0-rc.1'
    }

    It 'ignores junk tags interleaved with valid ones' {
        Get-CurrentVersion -Tags @('nightly', 'v1.4.2', 'wip', 'v1.4.0', 'latest') | Should -Be '1.4.2'
    }

    It 'tolerates null entries in the list' {
        Get-CurrentVersion -Tags @($null, 'v2.0.0', $null) | Should -Be '2.0.0'
    }
}

# ============================================================
Describe 'Get-NextVersion' {

    It 'bumps <Bump> of <Current> to <Expected>' -ForEach @(
        @{ Current = '0.3.5'; Bump = 'patch'; Expected = '0.3.6' }
        @{ Current = '0.3.5'; Bump = 'minor'; Expected = '0.4.0' }
        @{ Current = '0.3.5'; Bump = 'major'; Expected = '1.0.0' }
        @{ Current = '1.0.0'; Bump = 'patch'; Expected = '1.0.1' }
        @{ Current = '1.9.9'; Bump = 'minor'; Expected = '1.10.0' }
        @{ Current = '0.0.0'; Bump = 'major'; Expected = '1.0.0' }
        @{ Current = '2.5.7'; Bump = 'major'; Expected = '3.0.0' }
    ) {
        Get-NextVersion -Current $Current -Bump $Bump | Should -Be $Expected
    }

    It 'throws on invalid bump keyword' {
        { Get-NextVersion -Current '1.0.0' -Bump 'huge' } | Should -Throw
    }

    It 'throws on invalid current version' {
        { Get-NextVersion -Current 'v1.0.0' -Bump 'patch' } | Should -Throw
    }

    It 'throws on empty current version' {
        { Get-NextVersion -Current '' -Bump 'patch' } | Should -Throw
    }
}

# ============================================================
Describe 'Update-Changelog' {

    BeforeAll {
        $script:SampleChangelog = @"
# Changelog

All notable changes to this project will be documented here.

## [Unreleased]

### Added
- New release-preparation script.

### Fixed
- Off-by-one in the changelog parser.

## [0.1.0] - 2026-01-01

### Added
- Initial public release.
"@
        $script:Result = Update-Changelog -Content $script:SampleChangelog -Version '0.2.0' -Date '2026-06-01'
    }

    It 'renames the old Unreleased header to the versioned + dated header' {
        $script:Result | Should -Match '(?m)^## \[0\.2\.0\] - 2026-06-01$'
    }

    It 'leaves a fresh empty [Unreleased] section in place' {
        $script:Result | Should -Match '(?m)^## \[Unreleased\]$'
    }

    It 'places the new [Unreleased] above the versioned header' {
        $unreleasedIdx = $script:Result.IndexOf('## [Unreleased]')
        $versionedIdx = $script:Result.IndexOf('## [0.2.0] - 2026-06-01')
        $unreleasedIdx | Should -BeGreaterThan -1
        $versionedIdx | Should -BeGreaterThan $unreleasedIdx
    }

    It 'retains the prior Unreleased entries under the new versioned header' {
        $script:Result | Should -Match 'New release-preparation script\.'
        $script:Result | Should -Match 'Off-by-one in the changelog parser\.'
    }

    It 'preserves the pre-existing 0.1.0 section' {
        $script:Result | Should -Match '(?m)^## \[0\.1\.0\] - 2026-01-01$'
        $script:Result | Should -Match 'Initial public release\.'
    }

    It 'keeps the document preamble intact' {
        $script:Result | Should -Match '# Changelog'
        $script:Result | Should -Match 'All notable changes to this project'
    }

    It 'produces exactly one versioned 0.2.0 header (no duplication)' {
        ([regex]::Matches($script:Result, '(?m)^## \[0\.2\.0\]')).Count | Should -Be 1
    }

    It 'works with the placeholder-only Unreleased body (real CHANGELOG shape)' {
        $minimal = "# Changelog`n`n## [Unreleased]`n`n(No tagged releases yet — see commit history.)`n"
        $out = Update-Changelog -Content $minimal -Version '0.1.0' -Date '2026-06-01'
        $out | Should -Match '(?m)^## \[0\.1\.0\] - 2026-06-01$'
        $out | Should -Match '(?m)^## \[Unreleased\]$'
        $out | Should -Match 'No tagged releases yet'
    }

    It 'throws when there is no Unreleased section' {
        { Update-Changelog -Content "# Changelog`n`n## [1.0.0] - 2026-01-01`n" -Version '1.1.0' -Date '2026-06-01' } |
            Should -Throw
    }
}
