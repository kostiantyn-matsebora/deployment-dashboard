# Tests for ../../dev_env/start.ps1 -- contributor flow local-stack bring-up.
#
# Strategy mirrors install.Tests.ps1: subprocess invocation of a shimmed copy
# of start.ps1 in a per-test tmpdir. The shim overrides `docker` and
# `Invoke-WebRequest` so we can capture compose-up args + bypass the health
# poll without a real Docker daemon.
#
# start.ps1 derives the compose file path from `$PSScriptRoot`. The shimmed
# copy lives in $tmp, so we seed fake `docker-compose.local.yml` +
# `docker-compose.scaled.yml` files in $tmp before each test.

#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeDiscovery {
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:OriginalScript = Join-Path $RepoRoot 'dev_env/start.ps1'
    if (-not (Test-Path $OriginalScript)) {
        throw "dev_env/start.ps1 not found at $OriginalScript"
    }
}

BeforeAll {
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:OriginalScript = Join-Path $RepoRoot 'dev_env/start.ps1'
    $script:OriginalContent = Get-Content -LiteralPath $OriginalScript -Raw

    # Shim header -- prepended after the param block.
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
    if ($argv[0] -eq 'compose') {
        $sub = $null
        for ($i = 1; $i -lt $argv.Count; $i++) {
            switch ($argv[$i]) {
                'up'   { $sub = 'up';   break }
                'logs' { $sub = 'logs'; break }
            }
            if ($sub) { break }
        }
        if ($sub -eq 'up')   { $global:LASTEXITCODE = if ($env:DD_UP_EXIT) { [int]$env:DD_UP_EXIT } else { 0 }; return }
        if ($sub -eq 'logs') { Write-Host '[stub docker compose logs]'; $global:LASTEXITCODE = 0; return }
        $global:LASTEXITCODE = 0
        return
    }
    $global:LASTEXITCODE = 0
}
function Invoke-WebRequest {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromRemainingArguments=$true)]
        $Rest,
        [string]$Uri,
        [string]$OutFile,
        [switch]$UseBasicParsing,
        [int]$TimeoutSec
    )
    __dd-log 'iwr' @{ uri = $Uri }
    if ($Uri -like '*/health') {
        if ($env:DD_IWR_HEALTH_OK -eq 'true') {
            return [pscustomobject]@{ StatusCode = 200; Content = 'OK' }
        }
        throw 'stub IWR /health unreachable'
    }
    return [pscustomobject]@{ StatusCode = 200 }
}
function Start-Sleep { param([int]$Seconds, [int]$Milliseconds) }
'@

    function New-TempTestDir {
        # Mimic the real repo layout (dev_env/ + install/ as siblings) so
        # start.ps1's `$PSScriptRoot/../install/docker-compose.release.yml`
        # lookup resolves under the per-test fake root (issue #21).
        $root   = Join-Path ([System.IO.Path]::GetTempPath()) "start-tests-$(New-Guid)"
        $devEnv  = Join-Path $root  'dev_env'
        $install = Join-Path $root  'install'
        New-Item -ItemType Directory -Path $devEnv  -Force | Out-Null
        New-Item -ItemType Directory -Path $install -Force | Out-Null
        return [pscustomobject]@{
            Root    = (Resolve-Path $root).Path
            DevEnv  = (Resolve-Path $devEnv).Path
            Install = (Resolve-Path $install).Path
        }
    }

    function New-ShimmedScript {
        param([object]$TmpDir)
        $shimmed = Join-Path $TmpDir.DevEnv 'start.shimmed.ps1'
        # Find the end of the param block. start.ps1 has its param(...) on a
        # single line, so we scan past the param( opener and count parens.
        $content = $script:OriginalContent
        $paramOpen = [regex]::Match($content, '(?ims)^\s*\[CmdletBinding\(\)\]\s*\r?\n\s*param\s*\(')
        if (-not $paramOpen.Success) {
            $paramOpen = [regex]::Match($content, '(?ims)^\s*param\s*\(')
        }
        if (-not $paramOpen.Success) {
            throw 'Could not locate param block start in start.ps1'
        }
        $i = $paramOpen.Index + $paramOpen.Length
        $depth = 1
        while ($i -lt $content.Length -and $depth -gt 0) {
            $ch = $content[$i]
            if     ($ch -eq '(') { $depth++ }
            elseif ($ch -eq ')') { $depth-- }
            $i++
        }
        if ($depth -ne 0) { throw 'Unbalanced parens in start.ps1 param block' }
        $insertAt = $i
        $injected = $script:OriginalContent.Substring(0, $insertAt) + "`n" + $script:ShimHeader + "`n" + $script:OriginalContent.Substring($insertAt)
        Set-Content -LiteralPath $shimmed -Value $injected -Encoding utf8
        # Seed both dev_env compose files + the install/release.yml sibling so
        # $PSScriptRoot resolution succeeds for the default (two-file) path.
        Set-Content -LiteralPath (Join-Path $TmpDir.DevEnv  'docker-compose.local.yml')   -Value 'services: {}' -Encoding utf8
        Set-Content -LiteralPath (Join-Path $TmpDir.DevEnv  'docker-compose.scaled.yml')  -Value 'services: {}' -Encoding utf8
        Set-Content -LiteralPath (Join-Path $TmpDir.Install 'docker-compose.release.yml') -Value 'services: {}' -Encoding utf8
        return $shimmed
    }

    function Invoke-Start {
        param(
            [Parameter(Mandatory)] [object] $TmpDir,
            [string[]] $Args = @(),
            [hashtable] $EnvOverrides = @{}
        )
        $shimmed = New-ShimmedScript -TmpDir $TmpDir
        $log = Join-Path $TmpDir.Root 'script.log'
        if (Test-Path $log) { Remove-Item $log -Force }
        $stdoutPath = Join-Path $TmpDir.Root 'stdout.txt'
        $stderrPath = Join-Path $TmpDir.Root 'stderr.txt'

        $envBackup = @{}
        $envKeys = @('GHA_TOKEN','DD_SCRIPT_LOG','DD_UP_EXIT','DD_IWR_HEALTH_OK')
        foreach ($k in $envKeys) { $envBackup[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
        try {
            foreach ($k in $envKeys) { [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
            [Environment]::SetEnvironmentVariable('DD_SCRIPT_LOG', $log, 'Process')
            if (-not $EnvOverrides.ContainsKey('DD_IWR_HEALTH_OK')) {
                [Environment]::SetEnvironmentVariable('DD_IWR_HEALTH_OK', 'true', 'Process')
            }
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
            TmpDir   = $TmpDir
        }
    }

    # Walks the docker-up arg array and returns the values that follow each
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

Describe 'dev_env/start.ps1 -- compose-file selection' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if ($tmp -and (Test-Path $tmp.Root)) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp.Root } }

    It 'default -- merges install/release.yml + dev_env/local.yml (issue #21)' {
        $r = Invoke-Start -TmpDir $tmp
        $r.ExitCode | Should -Be 0
        $up = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1
        $up | Should -Not -BeNullOrEmpty
        $files = Get-ComposeFiles -Argv ([object[]]$up.args)
        # Order matters: release.yml is the base, local.yml is the override.
        $files.Count       | Should -Be 2
        $files[0]          | Should -BeLike '*install*docker-compose.release.yml'
        $files[1]          | Should -BeLike '*dev_env*docker-compose.local.yml'
    }

    It '-Scaled -- selects docker-compose.scaled.yml (single -f, no release.yml layering)' {
        $r = Invoke-Start -TmpDir $tmp -Args @('-Scaled')
        $r.ExitCode | Should -Be 0
        $up = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1
        $files = Get-ComposeFiles -Argv ([object[]]$up.args)
        $files.Count | Should -Be 1
        $files[0]    | Should -BeLike '*docker-compose.scaled.yml'
    }

    It 'docker compose up call -- includes --build (dev contributor flow)' {
        $r = Invoke-Start -TmpDir $tmp
        $r.ExitCode | Should -Be 0
        $up = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1
        ([object[]]$up.args) | Should -Contain '--build'
        ([object[]]$up.args) | Should -Contain '-d'
    }
}

Describe 'dev_env/start.ps1 -- GHA_TOKEN precondition (issue #5)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if ($tmp -and (Test-Path $tmp.Root)) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp.Root } }

    It '-Fetcher without GHA_TOKEN + without -AllowMissingGhaToken -- exits 1 with red error before docker call' {
        $r = Invoke-Start -TmpDir $tmp -Args @('-Fetcher')
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'AllowMissingGhaToken'
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
    }

    It '-Fetcher + -AllowMissingGhaToken -- yellow notice + proceeds, --profile fetcher present' {
        $r = Invoke-Start -TmpDir $tmp -Args @('-Fetcher','-AllowMissingGhaToken')
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Match 'GHA_TOKEN not set'
        $r.Stdout   | Should -Match 'placeholder'
        $up = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1
        ([object[]]$up.args) | Should -Contain 'fetcher'
    }

    It '-Fetcher with GHA_TOKEN set -- no GHA_TOKEN advisory; --profile fetcher present' {
        $r = Invoke-Start -TmpDir $tmp -Args @('-Fetcher') -EnvOverrides @{ GHA_TOKEN = 'ghp_fake_pat' }
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Not -Match 'GHA_TOKEN not set'
        $up = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1
        ([object[]]$up.args) | Should -Contain 'fetcher'
    }

    It 'no -Fetcher -- GHA_TOKEN irrelevant; no fetcher profile in compose args' {
        $r = Invoke-Start -TmpDir $tmp
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Not -Match 'GHA_TOKEN'
        $up = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1
        ([object[]]$up.args) | Should -Not -Contain 'fetcher'
    }

    It '-Scaled + -Fetcher composable -- scaled compose AND --profile fetcher' {
        $r = Invoke-Start -TmpDir $tmp -Args @('-Scaled','-Fetcher') -EnvOverrides @{ GHA_TOKEN = 'ghp_fake' }
        $r.ExitCode | Should -Be 0
        $up = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1
        $a = [object[]]$up.args
        $files = Get-ComposeFiles -Argv $a
        $files.Count | Should -Be 1
        $files[0]    | Should -BeLike '*docker-compose.scaled.yml'
        $a | Should -Contain 'fetcher'
    }
}

Describe 'dev_env/start.ps1 -- error paths' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if ($tmp -and (Test-Path $tmp.Root)) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp.Root } }

    It 'docker compose up failure -- script throws non-zero' {
        $r = Invoke-Start -TmpDir $tmp -EnvOverrides @{ DD_UP_EXIT = '1' }
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'docker compose up failed'
    }

    It 'health-poll timeout -- script throws + dumps logs' {
        $r = Invoke-Start -TmpDir $tmp `
                          -Args @('-HealthTimeoutSeconds','1') `
                          -EnvOverrides @{ DD_IWR_HEALTH_OK = 'false' }
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match '/health did not return 200'
        ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'logs') }).Count `
            | Should -BeGreaterThan 0
    }
}
