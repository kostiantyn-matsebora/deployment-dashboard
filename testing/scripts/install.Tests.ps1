# Tests for ../../install/install.ps1 -- release-install primary entrypoint (issue #7).
#
# Strategy: subprocess invocation against a shimmed copy of install.ps1 in a
# per-test tmpdir. The shim prepends function-form overrides of `docker` and
# `Invoke-WebRequest` that capture their args to a per-invocation log file
# (`$env:DD_SCRIPT_LOG`) and return canned exit codes / fake bytes. The original
# install.ps1 is never modified -- see local/bindings.md (qa-engineer must NOT
# edit installer scripts; report bugs, don't fix).
#
# Coverage matrix is dictated by the qa-engineer dispatch prompt for issue #7:
#   - Param defaults + persistence
#   - GHA_TOKEN precondition (4 cases, must fire before any docker / IWR call)
#   - API_TOKEN defence-in-depth (literal refusal + env override + reuse)
#   - POSTGRES_PASSWORD defence-in-depth (same shape)
#   - URL shape branching (latest vs pinned tag)
#   - Env-file output shape
#   - Compose args (--profile migrate / --profile fetcher / --env-file)
#   - Error paths (download 404; compose pull failure)

#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeDiscovery {
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:OriginalScript = Join-Path $RepoRoot 'install/install.ps1'
    if (-not (Test-Path $OriginalScript)) {
        throw "install/install.ps1 not found at $OriginalScript"
    }
}

BeforeAll {
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:OriginalScript = Join-Path $RepoRoot 'install/install.ps1'
    $script:OriginalContent = Get-Content -LiteralPath $OriginalScript -Raw

    # Shim header -- prepended to a copy of install.ps1 in the per-test tmp.
    # Overrides docker + Invoke-WebRequest as functions in the script's own scope,
    # so the script's calls dispatch to them rather than the real cmdlets.
    # Each call appends one JSON line to $env:DD_SCRIPT_LOG.
    #
    # Exit-code behaviour is controlled via env vars set by the test:
    #   DD_PULL_EXIT    -- exit code for `docker compose ... pull`     (default 0)
    #   DD_UP_EXIT      -- exit code for `docker compose ... up ...`   (default 0)
    #   DD_IWR_FAIL     -- if set to a URL substring, IWR throws on URLs matching
    #   DD_IWR_HEALTH_OK -- if 'true', the /health IWR returns a 200 stub object
    #
    # Default: pull + up succeed, asset downloads write empty files, /health succeeds.
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
    # subcommand discriminator is argv[0] but `docker compose ...` makes argv[0] = 'compose'
    if ($argv[0] -eq 'compose') {
        # walk argv to find pull/up/logs/down (skipping flags + their values).
        $sub = $null
        for ($i = 1; $i -lt $argv.Count; $i++) {
            switch ($argv[$i]) {
                'pull' { $sub = 'pull'; break }
                'up'   { $sub = 'up';   break }
                'logs' { $sub = 'logs'; break }
                'down' { $sub = 'down'; break }
            }
            if ($sub) { break }
        }
        if ($sub -eq 'pull') {
            $global:LASTEXITCODE = if ($env:DD_PULL_EXIT) { [int]$env:DD_PULL_EXIT } else { 0 }
            return
        }
        if ($sub -eq 'up') {
            $global:LASTEXITCODE = if ($env:DD_UP_EXIT) { [int]$env:DD_UP_EXIT } else { 0 }
            return
        }
        if ($sub -eq 'logs') {
            Write-Host '[stub docker compose logs] (no real logs in test)'
            $global:LASTEXITCODE = 0
            return
        }
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
    __dd-log 'iwr' @{ uri = $Uri; outFile = $OutFile }
    if ($env:DD_IWR_FAIL -and $Uri -like "*$($env:DD_IWR_FAIL)*") {
        throw "stub IWR forced failure for $Uri"
    }
    if ($Uri -like '*/health') {
        if ($env:DD_IWR_HEALTH_OK -eq 'true') {
            return [pscustomobject]@{ StatusCode = 200; Content = 'OK' }
        }
        throw "stub IWR /health unreachable"
    }
    if ($OutFile) {
        # Write a tiny placeholder so Test-Path on the destination passes.
        New-Item -ItemType File -Path $OutFile -Force | Out-Null
        Set-Content -LiteralPath $OutFile -Value "# stub asset for $Uri" -Encoding utf8
    }
    return [pscustomobject]@{ StatusCode = 200 }
}
# Make Start-Sleep a no-op so the health-poll loop ticks fast.
function Start-Sleep { param([int]$Seconds, [int]$Milliseconds) }
'@

    function New-TempTestDir {
        $dir = Join-Path ([System.IO.Path]::GetTempPath()) "install-tests-$(New-Guid)"
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        return (Resolve-Path $dir).Path
    }

    # Build a shimmed copy of install.ps1 in $tmp and return its path.
    function New-ShimmedScript {
        param([string]$TmpDir)
        $shimmed = Join-Path $TmpDir 'install.shimmed.ps1'
        # The shim header injects after `param(...)` + `$ErrorActionPreference = 'Stop'` lines,
        # but it's simpler + correct to insert AFTER the param block. We split on the line that
        # follows the closing `)` of the param block.
        $content = $script:OriginalContent
        $paramEndPattern = '(?ms)^\)\s*$'
        $match = [regex]::Match($content, $paramEndPattern)
        if (-not $match.Success) {
            throw "Could not locate end of param block in install/install.ps1"
        }
        $insertAt = $match.Index + $match.Length
        $injected = $content.Substring(0, $insertAt) + "`n" + $script:ShimHeader + "`n" + $content.Substring($insertAt)
        Set-Content -LiteralPath $shimmed -Value $injected -Encoding utf8
        return $shimmed
    }

    # Helper -- invoke shimmed install.ps1 as a subprocess, return a structured result.
    function Invoke-Install {
        param(
            [Parameter(Mandatory)] [string] $TmpDir,
            [string[]] $Args = @(),
            [hashtable] $EnvOverrides = @{}
        )
        $shimmed = New-ShimmedScript -TmpDir $TmpDir
        $log = Join-Path $TmpDir 'script.log'
        if (Test-Path $log) { Remove-Item $log -Force }

        # Run in a clean env so DASHBOARD_API_TOKEN / GHA_TOKEN leakage from host can't pollute.
        $cmd = @(
            'pwsh', '-NoProfile', '-NonInteractive', '-File', $shimmed
        ) + $Args

        # We use Start-Process so we can isolate env vars.
        $stdoutPath = Join-Path $TmpDir 'stdout.txt'
        $stderrPath = Join-Path $TmpDir 'stderr.txt'

        $envBackup = @{}
        $envKeys = @('GHA_TOKEN','DASHBOARD_API_TOKEN','DD_SCRIPT_LOG','DD_PULL_EXIT','DD_UP_EXIT','DD_IWR_FAIL','DD_IWR_HEALTH_OK')
        foreach ($k in $envKeys) { $envBackup[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
        try {
            # Clear all baseline test-affecting env vars.
            foreach ($k in $envKeys) { [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
            # Then apply per-test overrides + the log path.
            [Environment]::SetEnvironmentVariable('DD_SCRIPT_LOG', $log, 'Process')
            # Default: health succeeds so we get past the poll.
            if (-not $EnvOverrides.ContainsKey('DD_IWR_HEALTH_OK')) {
                [Environment]::SetEnvironmentVariable('DD_IWR_HEALTH_OK', 'true', 'Process')
            }
            foreach ($k in $EnvOverrides.Keys) {
                [Environment]::SetEnvironmentVariable($k, [string]$EnvOverrides[$k], 'Process')
            }

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
            EnvFile  = Join-Path $TmpDir 'dashboard.env'
            TmpDir   = $TmpDir
        }
    }
}

Describe 'install.ps1 -- GHA_TOKEN precondition (inherited from issue #5)' {
    BeforeEach {
        $script:tmp = New-TempTestDir
    }
    AfterEach {
        if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp }
    }

    It 'exits 1 with red error when -Fetcher is set without GHA_TOKEN and without -AllowMissingGhaToken' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Fetcher','-InstallDir',$tmp)
        $r.ExitCode | Should -Be 1
        $combined = "$($r.Stdout)`n$($r.Stderr)"
        $combined | Should -Match 'AllowMissingGhaToken'
        $combined | Should -Match 'ERROR'
    }

    It 'exits BEFORE any docker compose / Invoke-WebRequest call (no install-dir artefacts)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Fetcher','-InstallDir',$tmp)
        $r.ExitCode | Should -Be 1
        # Strongest assertion -- no docker + no iwr events were logged.
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
        ($r.Events | Where-Object event -eq 'iwr').Count    | Should -Be 0
        Test-Path (Join-Path $tmp 'dashboard.env')                 | Should -BeFalse
        Test-Path (Join-Path $tmp 'docker-compose.release.yml')    | Should -BeFalse
    }

    It '-Fetcher + -AllowMissingGhaToken: yellow notice + proceeds past precondition' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Fetcher','-AllowMissingGhaToken','-InstallDir',$tmp,'-Version','v9.9.9-test')
        # We expect script to proceed past the precondition; downloads + compose are shimmed.
        $r.ExitCode | Should -Be 0
        "$($r.Stdout)" | Should -Match 'GHA_TOKEN not set'
        "$($r.Stdout)" | Should -Match 'placeholder'
    }

    It '-Fetcher with GHA_TOKEN set: no GHA_TOKEN advisory line is emitted' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-Fetcher','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_fake_pat_for_tests' }
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Not -Match 'GHA_TOKEN not set'
    }

    It 'no -Fetcher: GHA_TOKEN is irrelevant regardless of whether it is set' {
        $r1 = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r1.ExitCode | Should -Be 0
        $r1.Stdout   | Should -Not -Match 'GHA_TOKEN'

        $tmp2 = New-TempTestDir
        try {
            $r2 = Invoke-Install -TmpDir $tmp2 `
                                 -Args @('-InstallDir',$tmp2,'-Version','v9.9.9-test') `
                                 -EnvOverrides @{ GHA_TOKEN = 'ghp_fake' }
            $r2.ExitCode | Should -Be 0
            $r2.Stdout   | Should -Not -Match 'GHA_TOKEN'
        } finally {
            if (Test-Path $tmp2) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp2 }
        }
    }
}

Describe 'install.ps1 -- secret handling (API_TOKEN + POSTGRES_PASSWORD)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'new install -- generates a 64-char hex API_TOKEN and persists it to dashboard.env' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        Test-Path $r.EnvFile | Should -BeTrue
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^API_TOKEN=([0-9a-f]{64})$'
        $r.Stdout   | Should -Match 'Generated random API_TOKEN'
    }

    It 'pre-existing dev-literal API_TOKEN -- regenerates to fresh random hex' {
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "API_TOKEN=local-dev-token-not-for-production`nPOSTGRES_PASSWORD=preexisting-pg-pw" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Not -Match 'API_TOKEN=local-dev-token-not-for-production'
        $envContent | Should -Match '(?m)^API_TOKEN=([0-9a-f]{64})$'
        $r.Stdout   | Should -Match 'Generated random API_TOKEN'
    }

    It 'pre-existing valid API_TOKEN -- preserved (log says "Reusing")' {
        $preexisting = 'a' * 64
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "API_TOKEN=$preexisting`nPOSTGRES_PASSWORD=preexisting-pg-pw" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match "(?m)^API_TOKEN=$preexisting$"
        $r.Stdout   | Should -Match 'Reusing API_TOKEN'
    }

    It '$env:DASHBOARD_API_TOKEN -- wins over generation when no env-file exists' {
        $custom = 'custom-api-token-from-env-' + ('x' * 32)
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DASHBOARD_API_TOKEN = $custom }
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match "(?m)^API_TOKEN=$([regex]::Escape($custom))$"
        $r.Stdout   | Should -Match 'DASHBOARD_API_TOKEN'
    }

    It '$env:DASHBOARD_API_TOKEN = dev literal -- refused, random generation kicks in' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DASHBOARD_API_TOKEN = 'local-dev-token-not-for-production' }
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Not -Match 'API_TOKEN=local-dev-token-not-for-production'
        $envContent | Should -Match '(?m)^API_TOKEN=([0-9a-f]{64})$'
        $r.Stdout   | Should -Match 'Generated random API_TOKEN'
    }

    It 'new install -- generates a 32-char hex POSTGRES_PASSWORD' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^POSTGRES_PASSWORD=([0-9a-f]{32})$'
        $r.Stdout   | Should -Match 'Generated random POSTGRES_PASSWORD'
    }

    It 'pre-existing dev-literal POSTGRES_PASSWORD -- regenerated' {
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "POSTGRES_PASSWORD=local-dev-password`nAPI_TOKEN=$('b' * 64)" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Not -Match 'POSTGRES_PASSWORD=local-dev-password'
        $envContent | Should -Match '(?m)^POSTGRES_PASSWORD=([0-9a-f]{32})$'
        $r.Stdout   | Should -Match 'Generated random POSTGRES_PASSWORD'
    }

    It 'pre-existing valid POSTGRES_PASSWORD -- preserved' {
        $preexisting = 'c' * 32
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "POSTGRES_PASSWORD=$preexisting`nAPI_TOKEN=$('b' * 64)" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match "(?m)^POSTGRES_PASSWORD=$preexisting$"
        $r.Stdout   | Should -Match 'Reusing POSTGRES_PASSWORD'
    }
}

Describe 'install.ps1 -- release URL shape branching (post-Phase-6 fix)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It '-Version latest -> uses /releases/latest/download/ asset URL prefix' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','latest')
        $r.ExitCode | Should -Be 0
        $assetCalls = $r.Events | Where-Object { $_.event -eq 'iwr' -and $_.uri -like '*docker-compose.release.yml*' }
        $assetCalls.Count | Should -BeGreaterThan 0
        $assetCalls[0].uri | Should -BeLike 'https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/latest/download/*'
        $assetCalls[0].uri | Should -Not -BeLike '*releases/download/latest/*'
    }

    It '-Version v1.2.3 -> uses /releases/download/v1.2.3/ asset URL prefix' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v1.2.3')
        $r.ExitCode | Should -Be 0
        $assetCalls = $r.Events | Where-Object { $_.event -eq 'iwr' -and $_.uri -like '*docker-compose.release.yml*' }
        $assetCalls.Count | Should -BeGreaterThan 0
        $assetCalls[0].uri | Should -BeLike 'https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/*'
    }
}

Describe 'install.ps1 -- env-file output shape' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'writes every required key with the supplied -Version + -Port values' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v1.2.3','-Port','9090')
        $r.ExitCode | Should -Be 0
        $env = Get-Content $r.EnvFile -Raw
        $env | Should -Match '(?m)^POSTGRES_DB=dashboard$'
        $env | Should -Match '(?m)^POSTGRES_USER=dashboard$'
        $env | Should -Match '(?m)^POSTGRES_PASSWORD=([0-9a-f]{32})$'
        $env | Should -Match '(?m)^API_TOKEN=([0-9a-f]{64})$'
        $env | Should -Match '(?m)^DASHBOARD_VERSION=v1\.2\.3$'
        $env | Should -Match '(?m)^DASHBOARD_PORT=9090$'
        $env | Should -Match '(?m)^ConnectionStrings__DefaultConnection=Host=db;Database=dashboard;Username=dashboard;Password=[0-9a-f]{32}$'
    }

    It 'ConnectionStrings password matches POSTGRES_PASSWORD literally (not a $ref)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $env = Get-Content $r.EnvFile -Raw
        $pgMatch = [regex]::Match($env, '(?m)^POSTGRES_PASSWORD=([0-9a-f]{32})$')
        $pgMatch.Success | Should -BeTrue
        $pg = $pgMatch.Groups[1].Value
        $env | Should -Match "(?m)^ConnectionStrings__DefaultConnection=Host=db;Database=dashboard;Username=dashboard;Password=$pg$"
    }
}

Describe 'install.ps1 -- compose args (profiles + env-file)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'default install -- --profile migrate is present; --profile fetcher is not' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $up = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') }
        $up.Count | Should -BeGreaterThan 0
        $upArgs = ($up | Select-Object -First 1).args
        # --profile migrate present, --profile fetcher absent
        $migrateIdx = [Array]::IndexOf([object[]]$upArgs, 'migrate')
        $migrateIdx | Should -BeGreaterThan -1
        $fetcherIdx = [Array]::IndexOf([object[]]$upArgs, 'fetcher')
        $fetcherIdx | Should -Be -1
    }

    It '-Fetcher -- both --profile migrate and --profile fetcher are present' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Fetcher') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_fake' }
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Contain 'migrate'
        $upArgs | Should -Contain 'fetcher'
    }

    It '-SkipMigrations -- no --profile migrate; fetcher only if -Fetcher' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-SkipMigrations')
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Not -Contain 'migrate'
        $upArgs | Should -Not -Contain 'fetcher'
    }

    It '--env-file <InstallDir>/dashboard.env is always passed to docker compose' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $allDockerCalls = $r.Events | Where-Object event -eq 'docker'
        # Every `docker compose ... pull|up` call must include --env-file <envFile>.
        $relevant = $allDockerCalls | Where-Object {
            $a = [object[]]$_.args
            $a.Count -ge 2 -and $a[0] -eq 'compose' -and (($a -contains 'pull') -or ($a -contains 'up'))
        }
        $relevant.Count | Should -BeGreaterThan 0
        foreach ($call in $relevant) {
            $a = [object[]]$call.args
            $envFileIdx = [Array]::IndexOf($a, '--env-file')
            $envFileIdx | Should -BeGreaterThan -1
            $a[$envFileIdx + 1] | Should -Be (Join-Path $tmp 'dashboard.env')
        }
    }
}

Describe 'install.ps1 -- error paths' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'asset download failure (Invoke-WebRequest throws) -- script exits 1 with red error mentioning the asset + version' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v0.0.0-doesnotexist') `
                            -EnvOverrides @{ DD_IWR_FAIL = 'docker-compose.release.yml' }
        $r.ExitCode | Should -Be 1
        $combined = "$($r.Stdout)`n$($r.Stderr)"
        $combined | Should -Match 'docker-compose.release.yml'
        $combined | Should -Match 'v0\.0\.0-doesnotexist'
    }

    It 'docker compose pull failure (non-zero exit) -- script throws / exits non-zero' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_PULL_EXIT = '1' }
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'docker compose pull failed'
    }

    It 'health-poll timeout (IWR /health unreachable) -- script throws + dumps logs' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-HealthTimeoutSeconds','1') `
                            -EnvOverrides @{ DD_IWR_HEALTH_OK = 'false' }
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match '/health did not return 200'
        # `docker compose ... logs` was invoked on failure.
        ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'logs') }).Count `
            | Should -BeGreaterThan 0
    }
}
