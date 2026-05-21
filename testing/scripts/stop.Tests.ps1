# Tests for ../../dev_env/stop.ps1 -- contributor flow local-stack teardown.
#
# Strategy mirrors start.Tests.ps1: subprocess invocation of a shimmed copy
# of stop.ps1 in a per-test tmpdir. The shim overrides `docker` so we can
# capture compose-down args. stop.ps1 derives compose-file paths from
# `$PSScriptRoot`, so we seed (or omit) fake compose files in $tmp.

#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeDiscovery {
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:OriginalScript = Join-Path $RepoRoot 'dev_env/stop.ps1'
    if (-not (Test-Path $OriginalScript)) {
        throw "dev_env/stop.ps1 not found at $OriginalScript"
    }
}

BeforeAll {
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:OriginalScript = Join-Path $RepoRoot 'dev_env/stop.ps1'
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
        # Mimic the real repo layout (dev_env/ + install/ as siblings) so
        # stop.ps1's `$PSScriptRoot/../install/docker-compose.release.yml`
        # lookup resolves under the per-test fake root (issue #21).
        $root    = Join-Path ([System.IO.Path]::GetTempPath()) "stop-tests-$(New-Guid)"
        $devEnv  = Join-Path $root 'dev_env'
        $install = Join-Path $root 'install'
        New-Item -ItemType Directory -Path $devEnv  -Force | Out-Null
        New-Item -ItemType Directory -Path $install -Force | Out-Null
        return [pscustomobject]@{
            Root    = (Resolve-Path $root).Path
            DevEnv  = (Resolve-Path $devEnv).Path
            Install = (Resolve-Path $install).Path
        }
    }

    # Create the shimmed script in $TmpDir.DevEnv and seed compose files.
    # The NoLocal / NoScaled / NoRelease switches drive the "[skip]" branch.
    function New-ShimmedScript {
        param(
            [object]$TmpDir,
            [switch]$NoScaled,
            [switch]$NoLocal,
            [switch]$NoRelease
        )
        $shimmed = Join-Path $TmpDir.DevEnv 'stop.shimmed.ps1'
        $match = [regex]::Match($script:OriginalContent, '(?ms)^\)\s*$')
        if (-not $match.Success) { throw 'Could not locate param block end in stop.ps1' }
        $insertAt = $match.Index + $match.Length
        $injected = $script:OriginalContent.Substring(0, $insertAt) + "`n" + $script:ShimHeader + "`n" + $script:OriginalContent.Substring($insertAt)
        Set-Content -LiteralPath $shimmed -Value $injected -Encoding utf8
        if (-not $NoLocal)   { Set-Content -LiteralPath (Join-Path $TmpDir.DevEnv  'docker-compose.local.yml')   -Value 'services: {}' -Encoding utf8 }
        if (-not $NoScaled)  { Set-Content -LiteralPath (Join-Path $TmpDir.DevEnv  'docker-compose.scaled.yml')  -Value 'services: {}' -Encoding utf8 }
        if (-not $NoRelease) { Set-Content -LiteralPath (Join-Path $TmpDir.Install 'docker-compose.release.yml') -Value 'services: {}' -Encoding utf8 }
        return $shimmed
    }

    function Invoke-Stop {
        param(
            [Parameter(Mandatory)] [object] $TmpDir,
            [string[]] $Args = @(),
            [hashtable] $EnvOverrides = @{},
            [switch] $NoScaled,
            [switch] $NoLocal,
            [switch] $NoRelease
        )
        $shimParams = @{ TmpDir = $TmpDir }
        if ($NoScaled)  { $shimParams.NoScaled  = $true }
        if ($NoLocal)   { $shimParams.NoLocal   = $true }
        if ($NoRelease) { $shimParams.NoRelease = $true }
        $shimmed = New-ShimmedScript @shimParams
        $log = Join-Path $TmpDir.Root 'script.log'
        if (Test-Path $log) { Remove-Item $log -Force }
        $stdoutPath = Join-Path $TmpDir.Root 'stdout.txt'
        $stderrPath = Join-Path $TmpDir.Root 'stderr.txt'

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

    # Walks a docker-down arg array and returns the values that follow each
    # `-f` flag in order. Used by tests to assert both the dev_env override
    # and the install/release.yml base land in the merge invocation (#21).
    # Param is named $Argv (not $Args) to avoid shadowing PowerShell's
    # automatic-variable binding inside the function.
    function Get-ComposeFiles {
        param([object[]]$Argv)
        $files = @()
        for ($i = 0; $i -lt $Argv.Count; $i++) {
            if ($Argv[$i] -eq '-f' -and $i -lt $Argv.Count - 1) {
                $files += $Argv[$i + 1]
            }
        }
        return ,$files
    }
}

Describe 'dev_env/stop.ps1 -- default teardown (all compose files present)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if ($tmp -and (Test-Path $tmp.Root)) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp.Root } }

    It 'invokes docker compose -f release.yml -f local.yml down --remove-orphans (issue #21)' {
        $r = Invoke-Stop -TmpDir $tmp
        $r.ExitCode | Should -Be 0
        $downs = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') }
        $downs.Count | Should -Be 2
        $localCall = $downs | Where-Object {
            $files = Get-ComposeFiles -Argv ([object[]]$_.args)
            ($files.Count -eq 2) -and
            ($files[0] -like '*install*docker-compose.release.yml') -and
            ($files[1] -like '*dev_env*docker-compose.local.yml')
        } | Select-Object -First 1
        $localCall | Should -Not -BeNullOrEmpty
        ([object[]]$localCall.args) | Should -Contain '--remove-orphans'
    }

    It 'invokes docker compose -f scaled down --remove-orphans too (single -f)' {
        $r = Invoke-Stop -TmpDir $tmp
        $r.ExitCode | Should -Be 0
        $downs = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') }
        $scaledCall = $downs | Where-Object {
            $files = Get-ComposeFiles -Argv ([object[]]$_.args)
            ($files.Count -eq 1) -and ($files[0] -like '*docker-compose.scaled.yml')
        } | Select-Object -First 1
        $scaledCall | Should -Not -BeNullOrEmpty
        ([object[]]$scaledCall.args) | Should -Contain '--remove-orphans'
    }

    It 'WITHOUT -Volumes -- no --volumes flag in either down call' {
        $r = Invoke-Stop -TmpDir $tmp
        $r.ExitCode | Should -Be 0
        $downs = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') }
        foreach ($d in $downs) {
            ([object[]]$d.args) | Should -Not -Contain '--volumes'
        }
        $r.Stdout | Should -Match 'Preserved named volumes'
    }
}

Describe 'dev_env/stop.ps1 -- -Volumes flag' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if ($tmp -and (Test-Path $tmp.Root)) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp.Root } }

    It '-Volumes -- every down call carries --volumes' {
        $r = Invoke-Stop -TmpDir $tmp -Args @('-Volumes')
        $r.ExitCode | Should -Be 0
        $downs = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') }
        $downs.Count | Should -Be 2
        foreach ($d in $downs) {
            ([object[]]$d.args) | Should -Contain '--volumes'
        }
        $r.Stdout | Should -Match 'Removed named volumes'
    }
}

Describe 'dev_env/stop.ps1 -- missing compose files (skip branch)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if ($tmp -and (Test-Path $tmp.Root)) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp.Root } }

    It 'docker-compose.scaled.yml missing -- yellow [skip] line; local teardown still runs' {
        $r = Invoke-Stop -TmpDir $tmp -NoScaled
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Match '\[skip\].*docker-compose\.scaled\.yml'
        $downs = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') }
        $downs.Count | Should -Be 1
        $files = Get-ComposeFiles -Argv ([object[]]$downs[0].args)
        $files.Count | Should -Be 2
        $files[0]    | Should -BeLike '*install*docker-compose.release.yml'
        $files[1]    | Should -BeLike '*dev_env*docker-compose.local.yml'
    }

    It 'install/release.yml missing -- local flow skips; scaled teardown still runs' {
        $r = Invoke-Stop -TmpDir $tmp -NoRelease
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Match '\[skip\].*docker-compose\.release\.yml'
        $downs = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') }
        $downs.Count | Should -Be 1
        $files = Get-ComposeFiles -Argv ([object[]]$downs[0].args)
        $files.Count | Should -Be 1
        $files[0]    | Should -BeLike '*docker-compose.scaled.yml'
    }

    It 'all compose files missing -- two skip lines; no docker invocations' {
        $r = Invoke-Stop -TmpDir $tmp -NoScaled -NoLocal -NoRelease
        $r.ExitCode | Should -Be 0
        ($r.Stdout -split '\r?\n' | Where-Object { $_ -match '\[skip\]' }).Count | Should -BeGreaterOrEqual 2
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
    }
}

Describe 'dev_env/stop.ps1 -- non-zero docker exit is non-fatal (warn-and-continue)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if ($tmp -and (Test-Path $tmp.Root)) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp.Root } }

    It 'docker compose down exits non-zero -- script still completes 0 with warning' {
        $r = Invoke-Stop -TmpDir $tmp -EnvOverrides @{ DD_DOWN_EXIT = '1' }
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Match '\[warn\] docker compose exited with code 1'
    }
}
