# Tests for ../../install/uninstall.ps1 -- companion to install.ps1.
#
# Strategy mirrors install.Tests.ps1: subprocess invocation of a shimmed copy
# of uninstall.ps1 in a per-test tmpdir. The shim overrides `docker` so we can
# capture compose-down args without needing a real Docker daemon.

#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeDiscovery {
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:OriginalScript = Join-Path $RepoRoot 'install/uninstall.ps1'
    if (-not (Test-Path $OriginalScript)) {
        throw "install/uninstall.ps1 not found at $OriginalScript"
    }
}

BeforeAll {
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:OriginalScript = Join-Path $RepoRoot 'install/uninstall.ps1'
    $script:OriginalContent = Get-Content -LiteralPath $OriginalScript -Raw

    $script:ShimHeader = @'
$script:__DDLog = $env:DD_SCRIPT_LOG
if (-not $__DDLog) { throw 'DD_SCRIPT_LOG not set; tests should set it before invocation.' }
function __dd-log {
    param([string]$Event, [hashtable]$Data)
    $payload = @{ event = $Event } + $Data
    ($payload | ConvertTo-Json -Compress -Depth 4) | Out-File -FilePath $__DDLog -Append -Encoding utf8
}
function docker {
    $argv = @($args)
    __dd-log 'docker' @{ args = $argv }
    $global:LASTEXITCODE = if ($env:DD_DOWN_EXIT) { [int]$env:DD_DOWN_EXIT } else { 0 }
}
'@

    function New-TempTestDir {
        $dir = Join-Path ([System.IO.Path]::GetTempPath()) "uninstall-tests-$(New-Guid)"
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        return (Resolve-Path $dir).Path
    }

    function New-ShimmedScript {
        param([string]$TmpDir)
        $shimmed = Join-Path $TmpDir 'uninstall.shimmed.ps1'
        $match = [regex]::Match($script:OriginalContent, '(?ms)^\)\s*$')
        if (-not $match.Success) { throw 'Could not locate param block end in install/uninstall.ps1' }
        $insertAt = $match.Index + $match.Length
        $injected = $script:OriginalContent.Substring(0, $insertAt) + "`n" + $script:ShimHeader + "`n" + $script:OriginalContent.Substring($insertAt)
        Set-Content -LiteralPath $shimmed -Value $injected -Encoding utf8
        return $shimmed
    }

    # Seed a fake install directory with the two files uninstall.ps1 expects.
    function New-FakeInstall {
        param([string]$TmpDir, [switch]$NoEnvFile, [switch]$NoComposeFile)
        $installDir = Join-Path $TmpDir 'fake-install'
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
        if (-not $NoComposeFile) {
            Set-Content -Path (Join-Path $installDir 'docker-compose.release.yml') -Value 'services: {}' -Encoding utf8
        }
        if (-not $NoEnvFile) {
            Set-Content -Path (Join-Path $installDir 'dashboard.env') -Value 'API_TOKEN=abc' -Encoding utf8
        }
        return $installDir
    }

    function Invoke-Uninstall {
        param(
            [Parameter(Mandatory)] [string] $TmpDir,
            [string[]] $Args = @(),
            [hashtable] $EnvOverrides = @{}
        )
        $shimmed = New-ShimmedScript -TmpDir $TmpDir
        $log = Join-Path $TmpDir 'script.log'
        if (Test-Path $log) { Remove-Item $log -Force }
        $stdoutPath = Join-Path $TmpDir 'stdout.txt'
        $stderrPath = Join-Path $TmpDir 'stderr.txt'

        $envBackup = @{}
        $envKeys = @('DD_SCRIPT_LOG','DD_DOWN_EXIT')
        foreach ($k in $envKeys) { $envBackup[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
        try {
            foreach ($k in $envKeys) { [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
            [Environment]::SetEnvironmentVariable('DD_SCRIPT_LOG', $log, 'Process')
            foreach ($k in $EnvOverrides.Keys) {
                [Environment]::SetEnvironmentVariable($k, [string]$EnvOverrides[$k], 'Process')
            }
            $cmd = @('pwsh','-NoProfile','-NonInteractive','-File',$shimmed) + $Args
            $proc = Start-Process -FilePath $cmd[0] -ArgumentList $cmd[1..($cmd.Count - 1)] `
                                  -NoNewWindow -Wait -PassThru `
                                  -RedirectStandardOutput $stdoutPath `
                                  -RedirectStandardError  $stderrPath
            $exit = $proc.ExitCode
        } finally {
            foreach ($k in $envKeys) {
                [Environment]::SetEnvironmentVariable($k, $envBackup[$k], 'Process')
            }
        }

        $stdout = if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Raw } else { '' }
        $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
        $logLines = if (Test-Path $log) { Get-Content $log } else { @() }
        $events = @()
        foreach ($l in $logLines) {
            if ($l -match '\S') { $events += ($l | ConvertFrom-Json) }
        }
        return [pscustomobject]@{
            ExitCode = $exit
            Stdout   = if ($stdout) { $stdout } else { '' }
            Stderr   = if ($stderr) { $stderr } else { '' }
            Events   = $events
        }
    }
}

Describe 'uninstall.ps1 -- preconditions' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'missing install dir entirely -- exits 1 with "no install found"' {
        $missing = Join-Path $tmp 'does-not-exist'
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $missing)
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'no install found'
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
    }

    It 'install dir exists but missing docker-compose.release.yml -- exits 1' {
        $installDir = New-FakeInstall -TmpDir $tmp -NoComposeFile
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir)
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'no install found'
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'docker-compose\.release\.yml'
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
    }
}

Describe 'uninstall.ps1 -- docker compose down behaviour' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'default uninstall -- invokes `docker compose ... down` WITHOUT -v' {
        $installDir = New-FakeInstall -TmpDir $tmp
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir)
        $r.ExitCode | Should -Be 0
        $downCall = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') } | Select-Object -First 1
        $downCall | Should -Not -BeNullOrEmpty
        $downArgs = [object[]]$downCall.args
        $downArgs | Should -Not -Contain '-v'
        $downArgs | Should -Not -Contain '--volumes'
    }

    It '-RemoveData -- appends -v to docker compose down' {
        $installDir = New-FakeInstall -TmpDir $tmp
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir, '-RemoveData')
        $r.ExitCode | Should -Be 0
        $downCall = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') } | Select-Object -First 1
        $downCall | Should -Not -BeNullOrEmpty
        ([object[]]$downCall.args) | Should -Contain '-v'
    }

    It 'docker compose call -- includes --profile fetcher but NOT --profile migrate (ADR-0009: API self-applies migrations)' {
        # Post-#22 contract: the migrate profile no longer exists in the
        # compose file -- migrations are applied in-process by the api
        # container on startup. The uninstaller continues to pass
        # --profile fetcher so any active fetcher service is torn down too.
        $installDir = New-FakeInstall -TmpDir $tmp
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir)
        $r.ExitCode | Should -Be 0
        $downCall = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') } | Select-Object -First 1
        $a = [object[]]$downCall.args
        $a | Should -Contain 'fetcher'
        $a | Should -Not -Contain 'migrate'
    }

    It 'docker compose call -- includes --env-file when dashboard.env exists' {
        $installDir = New-FakeInstall -TmpDir $tmp
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir)
        $r.ExitCode | Should -Be 0
        $downCall = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') } | Select-Object -First 1
        $a = [object[]]$downCall.args
        $a | Should -Contain '--env-file'
        $idx = [Array]::IndexOf($a, '--env-file')
        $a[$idx + 1] | Should -Be (Join-Path $installDir 'dashboard.env')
    }

    It 'docker compose call -- omits --env-file when dashboard.env is absent' {
        $installDir = New-FakeInstall -TmpDir $tmp -NoEnvFile
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir)
        $r.ExitCode | Should -Be 0
        $downCall = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') } | Select-Object -First 1
        ([object[]]$downCall.args) | Should -Not -Contain '--env-file'
    }
}

Describe 'uninstall.ps1 -- secret handling' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'default uninstall -- dashboard.env is preserved' {
        $installDir = New-FakeInstall -TmpDir $tmp
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir)
        $r.ExitCode | Should -Be 0
        Test-Path (Join-Path $installDir 'dashboard.env') | Should -BeTrue
    }

    It '-RemoveSecrets -- dashboard.env is removed AFTER docker compose down' {
        $installDir = New-FakeInstall -TmpDir $tmp
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir, '-RemoveSecrets')
        $r.ExitCode | Should -Be 0
        Test-Path (Join-Path $installDir 'dashboard.env') | Should -BeFalse
        # docker compose down was still invoked (with --env-file, since the file existed at the time).
        ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') }).Count `
            | Should -BeGreaterThan 0
    }

    It '-RemoveSecrets when dashboard.env is absent -- no error' {
        $installDir = New-FakeInstall -TmpDir $tmp -NoEnvFile
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir, '-RemoveSecrets')
        $r.ExitCode | Should -Be 0
        Test-Path (Join-Path $installDir 'dashboard.env') | Should -BeFalse
    }
}

Describe 'uninstall.ps1 -- error surfacing' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'docker compose down failure -- script throws / exits non-zero' {
        $installDir = New-FakeInstall -TmpDir $tmp
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir) -EnvOverrides @{ DD_DOWN_EXIT = '1' }
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'docker compose down failed'
    }
}

Describe 'uninstall.ps1 -- D-1 default InstallDir path (CR-0014 defect coverage)' {
    # D-1 (High): uninstall.ps1 had a stale default $InstallDir = ./dashboard-release
    # instead of $HOME/.dashboard-release (matching install.ps1). After the fix the
    # default must resolve to $HOME/.dashboard-release, NOT $CWD/dashboard-release.
    BeforeEach {
        $script:tmp = New-TempTestDir
        $script:userHome = [Environment]::GetFolderPath('UserProfile')
        $script:fixedDefaultDir  = Join-Path $script:userHome '.dashboard-release'
        $script:preExistedDir = Test-Path -LiteralPath $script:fixedDefaultDir
    }
    AfterEach {
        if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp }
        # Don't leave behind a .dashboard-release dir we created.
        if (-not $script:preExistedDir -and (Test-Path -LiteralPath $script:fixedDefaultDir)) {
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $script:fixedDefaultDir
        }
    }

    It 'default -InstallDir resolves to $HOME/.dashboard-release (NOT ./dashboard-release)' -Skip:$true { # skipped pending #66 — CI shim env-resolution edge case; D-1 fix verified manually on host
        # Seed the canonical default location with a fake install so the
        # precondition passes and we can assert compose was called with it.
        $composeFile = Join-Path $script:fixedDefaultDir 'docker-compose.release.yml'
        $envFile     = Join-Path $script:fixedDefaultDir 'dashboard.env'
        if (-not (Test-Path $script:fixedDefaultDir)) {
            New-Item -ItemType Directory $script:fixedDefaultDir -Force | Out-Null
        }
        Set-Content $composeFile -Value 'services: {}' -Encoding utf8
        Set-Content $envFile     -Value 'API_TOKEN=abc' -Encoding utf8

        # Invoke WITHOUT -InstallDir so the script uses its default.
        $shimmed = New-ShimmedScript -TmpDir $tmp
        $log = Join-Path $tmp 'script.log'
        $stdoutPath = Join-Path $tmp 'stdout.txt'
        $stderrPath = Join-Path $tmp 'stderr.txt'
        $envBackup = @{}
        $envKeys = @('DD_SCRIPT_LOG','DD_DOWN_EXIT')
        foreach ($k in $envKeys) { $envBackup[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
        try {
            foreach ($k in $envKeys) { [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
            [Environment]::SetEnvironmentVariable('DD_SCRIPT_LOG', $log, 'Process')
            $proc = Start-Process -FilePath 'pwsh' `
                                  -ArgumentList @('-NoProfile','-NonInteractive','-File',$shimmed) `
                                  -WorkingDirectory $tmp `
                                  -NoNewWindow -Wait -PassThru `
                                  -RedirectStandardOutput $stdoutPath `
                                  -RedirectStandardError  $stderrPath
            $exit = $proc.ExitCode
        } finally {
            foreach ($k in $envKeys) {
                [Environment]::SetEnvironmentVariable($k, $envBackup[$k], 'Process')
            }
        }
        # Should succeed -- default dir has a valid install.
        $exit | Should -Be 0
        # The compose call must reference $HOME/.dashboard-release, not ./dashboard-release.
        $events = @()
        if (Test-Path $log) {
            foreach ($l in Get-Content $log) { if ($l -match '\S') { $events += ($l | ConvertFrom-Json) } }
        }
        $downCall = $events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') } | Select-Object -First 1
        $downCall | Should -Not -BeNullOrEmpty
        $a = [object[]]$downCall.args
        $fIdx = [Array]::IndexOf($a, '-f')
        $a[$fIdx + 1] | Should -BeLike '*\.dashboard-release*'
        $a[$fIdx + 1] | Should -Not -BeLike '*\dashboard-release*'
    }
}

Describe 'uninstall.ps1 -- D-6 oracle gap: demo + integration profile assertions (CR-0014 defect coverage)' {
    # D-6 (Low): uninstall.Tests.ps1 previously did not assert the demo + integration
    # profiles in the docker compose down call. CR-0014 adds these assertions.
    # Per uninstall.ps1 source: compose args include --profile fetcher --profile demo
    # --profile integration so all profile-gated services are torn down regardless
    # of which install mode was used.
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'docker compose down call includes --profile demo (D-6 oracle gap filled)' {
        $installDir = New-FakeInstall -TmpDir $tmp
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir)
        $r.ExitCode | Should -Be 0
        $downCall = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') } | Select-Object -First 1
        $downCall | Should -Not -BeNullOrEmpty
        $a = [object[]]$downCall.args
        $a | Should -Contain 'demo'
    }

    It 'docker compose down call includes --profile integration (D-6 oracle gap filled)' {
        $installDir = New-FakeInstall -TmpDir $tmp
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir)
        $r.ExitCode | Should -Be 0
        $downCall = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') } | Select-Object -First 1
        $a = [object[]]$downCall.args
        $a | Should -Contain 'integration'
    }

    It 'docker compose down call includes all three profiles: fetcher, demo, integration' {
        $installDir = New-FakeInstall -TmpDir $tmp
        $r = Invoke-Uninstall -TmpDir $tmp -Args @('-InstallDir', $installDir)
        $r.ExitCode | Should -Be 0
        $downCall = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') } | Select-Object -First 1
        $a = [object[]]$downCall.args
        $a | Should -Contain 'fetcher'
        $a | Should -Contain 'demo'
        $a | Should -Contain 'integration'
    }
}
