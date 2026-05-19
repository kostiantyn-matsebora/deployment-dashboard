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
        $dir = Join-Path ([System.IO.Path]::GetTempPath()) "stop-tests-$(New-Guid)"
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        return (Resolve-Path $dir).Path
    }

    # Create the shimmed script in $tmp. SeedScaled controls whether
    # docker-compose.scaled.yml exists in $tmp (used to exercise the "skip" branch).
    function New-ShimmedScript {
        param([string]$TmpDir, [switch]$NoScaled, [switch]$NoLocal)
        $shimmed = Join-Path $TmpDir 'stop.shimmed.ps1'
        $match = [regex]::Match($script:OriginalContent, '(?ms)^\)\s*$')
        if (-not $match.Success) { throw 'Could not locate param block end in stop.ps1' }
        $insertAt = $match.Index + $match.Length
        $injected = $script:OriginalContent.Substring(0, $insertAt) + "`n" + $script:ShimHeader + "`n" + $script:OriginalContent.Substring($insertAt)
        Set-Content -LiteralPath $shimmed -Value $injected -Encoding utf8
        if (-not $NoLocal)  { Set-Content -LiteralPath (Join-Path $TmpDir 'docker-compose.local.yml')  -Value 'services: {}' -Encoding utf8 }
        if (-not $NoScaled) { Set-Content -LiteralPath (Join-Path $TmpDir 'docker-compose.scaled.yml') -Value 'services: {}' -Encoding utf8 }
        return $shimmed
    }

    function Invoke-Stop {
        param(
            [Parameter(Mandatory)] [string] $TmpDir,
            [string[]] $Args = @(),
            [hashtable] $EnvOverrides = @{},
            [switch] $NoScaled,
            [switch] $NoLocal
        )
        $shimParams = @{ TmpDir = $TmpDir }
        if ($NoScaled) { $shimParams.NoScaled = $true }
        if ($NoLocal)  { $shimParams.NoLocal  = $true }
        $shimmed = New-ShimmedScript @shimParams
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

Describe 'dev_env/stop.ps1 -- default teardown (both compose files present)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'invokes docker compose -f local down --remove-orphans' {
        $r = Invoke-Stop -TmpDir $tmp
        $r.ExitCode | Should -Be 0
        $downs = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') }
        $downs.Count | Should -Be 2
        $localCall = $downs | Where-Object {
            $a = [object[]]$_.args
            $fIdx = [Array]::IndexOf($a, '-f')
            ($fIdx -ge 0) -and ($a[$fIdx + 1] -like '*docker-compose.local.yml')
        } | Select-Object -First 1
        $localCall | Should -Not -BeNullOrEmpty
        ([object[]]$localCall.args) | Should -Contain '--remove-orphans'
    }

    It 'invokes docker compose -f scaled down --remove-orphans too' {
        $r = Invoke-Stop -TmpDir $tmp
        $r.ExitCode | Should -Be 0
        $downs = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') }
        $scaledCall = $downs | Where-Object {
            $a = [object[]]$_.args
            $fIdx = [Array]::IndexOf($a, '-f')
            ($fIdx -ge 0) -and ($a[$fIdx + 1] -like '*docker-compose.scaled.yml')
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
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

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

Describe 'dev_env/stop.ps1 -- missing scaled compose file' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'docker-compose.scaled.yml missing -- yellow [skip] line; local teardown still runs' {
        $r = Invoke-Stop -TmpDir $tmp -NoScaled
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Match '\[skip\].*docker-compose\.scaled\.yml'
        $downs = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'down') }
        $downs.Count | Should -Be 1
        $a = [object[]]$downs[0].args
        $fIdx = [Array]::IndexOf($a, '-f')
        $a[$fIdx + 1] | Should -BeLike '*docker-compose.local.yml'
    }

    It 'both compose files missing -- two skip lines; no docker invocations' {
        $r = Invoke-Stop -TmpDir $tmp -NoScaled -NoLocal
        $r.ExitCode | Should -Be 0
        ($r.Stdout -split '\r?\n' | Where-Object { $_ -match '\[skip\]' }).Count | Should -BeGreaterOrEqual 2
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
    }
}

Describe 'dev_env/stop.ps1 -- non-zero docker exit is non-fatal (warn-and-continue)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'docker compose down exits non-zero -- script still completes 0 with warning' {
        $r = Invoke-Stop -TmpDir $tmp -EnvOverrides @{ DD_DOWN_EXIT = '1' }
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Match '\[warn\] docker compose exited with code 1'
    }
}
