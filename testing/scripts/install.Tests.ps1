# Tests for ../../install/install.ps1 -- release-install primary entrypoint (issue #7).
#
# Strategy: subprocess invocation against a shimmed copy of install.ps1 in a
# per-test tmpdir. The shim prepends function-form overrides of `docker`,
# `Invoke-WebRequest` and `gh` that capture their args to a per-invocation log
# file (`$env:DD_SCRIPT_LOG`) and return canned exit codes / fake bytes. The
# original install.ps1 is never modified -- see local/bindings.md (qa-engineer
# must NOT edit installer scripts; report bugs, don't fix).
#
# Coverage matrix is dictated by the qa-engineer dispatch prompt for issue #7
# (post-gh-CLI contract):
#   - Param defaults + persistence
#   - GHA_TOKEN precondition (-Fetcher path)
#   - gh CLI precondition (gh missing / unauthed / missing read:packages scope)
#   - API_TOKEN defence-in-depth (literal refusal + env override + reuse)
#   - POSTGRES_PASSWORD defence-in-depth (same shape)
#   - gh release download tag branching (latest vs pinned tag)
#   - Env-file output shape
#   - Compose args (--profile migrate / --profile fetcher / --env-file)
#   - Error paths (gh asset download failure; docker login failure; compose pull failure)

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
    # Overrides docker, Invoke-WebRequest, and gh as functions in the script's own
    # scope, so the script's calls dispatch to them rather than the real binaries.
    # Each call appends one JSON line to $env:DD_SCRIPT_LOG.
    #
    # Exit-code behaviour is controlled via env vars set by the test:
    #   DD_PULL_EXIT          -- exit code for `docker compose ... pull`     (default 0)
    #   DD_UP_EXIT            -- exit code for `docker compose ... up ...`   (default 0)
    #   DD_LOGIN_EXIT         -- exit code for `docker login ...`            (default 0)
    #   DD_IWR_HEALTH_OK      -- if 'true', the /health IWR returns a 200 stub object
    #   DD_GH_MISSING         -- if 'true', `gh --version` exits 1 (gh not on PATH)
    #   DD_GH_NOT_AUTHED      -- if 'true', `gh auth status ...` exits 1
    #   DD_GH_NO_SCOPE        -- if 'true', `gh auth status --show-token` omits all of read/write/admin:packages
    #   DD_GH_SCOPE_LITERAL   -- if set, overrides the default 'read:packages' scope in the
    #                            stub output (use to assert write:packages / admin:packages pass too)
    #   DD_GH_DOWNLOAD_FAIL   -- if set to a substring, `gh release download` exits 1
    #                            when the requested asset matches the substring
    #
    # Default: gh precondition passes, downloads succeed, docker login succeeds,
    # pull + up succeed, /health succeeds.
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
    # `docker login ...` -- install.ps1 pipes the gh token in (`$ghToken | & docker login ...`).
    # When `docker` is a function override (not a native binary), the upstream
    # pipeline value arrives via $input and is silently discarded if unread --
    # no drain needed. (Reading [Console]::In.ReadToEnd() would HANG because
    # that reads the PS process's actual stdin handle, which is connected to
    # the parent process and never sees EOF.)
    if ($argv[0] -eq 'login') {
        $global:LASTEXITCODE = if ($env:DD_LOGIN_EXIT) { [int]$env:DD_LOGIN_EXIT } else { 0 }
        return
    }
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
    # Only the /health poll routes through IWR post-gh-CLI; asset fetch is via `gh release download`.
    [CmdletBinding()]
    param(
        [Parameter(ValueFromRemainingArguments=$true)]
        $Rest,
        [string]$Uri,
        [switch]$UseBasicParsing,
        [int]$TimeoutSec
    )
    __dd-log 'iwr' @{ uri = $Uri }
    if ($Uri -like '*/health') {
        if ($env:DD_IWR_HEALTH_OK -eq 'true') {
            return [pscustomobject]@{ StatusCode = 200; Content = 'OK' }
        }
        throw "stub IWR /health unreachable"
    }
    return [pscustomobject]@{ StatusCode = 200 }
}
function gh {
    $argv = @($args)
    __dd-log 'gh' @{ args = $argv }
    if ($argv[0] -eq '--version') {
        if ($env:DD_GH_MISSING -eq 'true') {
            $global:LASTEXITCODE = 1
            return
        }
        Write-Output 'gh version 2.0.0 (stub)'
        $global:LASTEXITCODE = 0
        return
    }
    if ($argv[0] -eq 'auth' -and $argv[1] -eq 'status') {
        if ($env:DD_GH_NOT_AUTHED -eq 'true') {
            Write-Output 'You are not logged into any GitHub hosts. Run gh auth login to authenticate.'
            $global:LASTEXITCODE = 1
            return
        }
        # When --show-token is present, emit a fake scope list line. By default
        # include read:packages; DD_GH_NO_SCOPE='true' omits all of read/write/admin:packages;
        # DD_GH_SCOPE_LITERAL overrides the granted scope explicitly (used to assert
        # write:packages / admin:packages alone also pass the precondition since
        # GitHub's OAuth scope model is hierarchical).
        if ($argv -contains '--show-token') {
            if ($env:DD_GH_NO_SCOPE -eq 'true') {
                Write-Output 'Token scopes: repo, workflow, gist'
            } elseif (-not [string]::IsNullOrEmpty($env:DD_GH_SCOPE_LITERAL)) {
                Write-Output "Token scopes: repo, $($env:DD_GH_SCOPE_LITERAL), workflow"
            } else {
                Write-Output 'Token scopes: repo, read:packages, workflow'
            }
        }
        Write-Output 'Logged in to github.com as testuser (stub)'
        $global:LASTEXITCODE = 0
        return
    }
    if ($argv[0] -eq 'auth' -and $argv[1] -eq 'token') {
        Write-Output 'gho_stub_token_for_tests'
        $global:LASTEXITCODE = 0
        return
    }
    if ($argv[0] -eq 'api') {
        # `gh api user --jq .login` -- emit a stub login.
        Write-Output 'testuser'
        $global:LASTEXITCODE = 0
        return
    }
    if ($argv[0] -eq 'release' -and $argv[1] -eq 'download') {
        # Walk argv for --pattern <asset> and --output <dest>.
        $asset = $null
        $dest  = $null
        for ($i = 2; $i -lt $argv.Count; $i++) {
            if ($argv[$i] -eq '--pattern' -and ($i + 1) -lt $argv.Count) {
                $asset = $argv[$i + 1]
            }
            if ($argv[$i] -eq '--output' -and ($i + 1) -lt $argv.Count) {
                $dest = $argv[$i + 1]
            }
        }
        if ($env:DD_GH_DOWNLOAD_FAIL -and $asset -and ($asset -like "*$($env:DD_GH_DOWNLOAD_FAIL)*")) {
            Write-Error "stub gh release download forced failure for $asset"
            $global:LASTEXITCODE = 1
            return
        }
        if ($dest) {
            New-Item -ItemType File -Path $dest -Force | Out-Null
            Set-Content -LiteralPath $dest -Value "# stub asset for $asset" -Encoding utf8
        }
        $global:LASTEXITCODE = 0
        return
    }
    # Default: succeed for any unhandled subcommand.
    $global:LASTEXITCODE = 0
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
        $envKeys = @(
            'GHA_TOKEN','DASHBOARD_API_TOKEN','DD_SCRIPT_LOG',
            'DD_PULL_EXIT','DD_UP_EXIT','DD_LOGIN_EXIT','DD_IWR_HEALTH_OK',
            'DD_GH_MISSING','DD_GH_NOT_AUTHED','DD_GH_NO_SCOPE','DD_GH_SCOPE_LITERAL','DD_GH_DOWNLOAD_FAIL'
        )
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

    It 'exits BEFORE any docker compose / Invoke-WebRequest / gh release call (no install-dir artefacts)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Fetcher','-InstallDir',$tmp)
        $r.ExitCode | Should -Be 1
        # Strongest assertion -- no docker + no gh-release + no iwr events were logged.
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
        ($r.Events | Where-Object event -eq 'iwr').Count    | Should -Be 0
        ($r.Events | Where-Object {
            $_.event -eq 'gh' -and ([object[]]$_.args)[0] -eq 'release'
        }).Count | Should -Be 0
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

Describe 'install.ps1 -- gh CLI precondition' {
    BeforeEach {
        $script:tmp = New-TempTestDir
    }
    AfterEach {
        if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp }
    }

    It 'gh missing on PATH -- exits 1, output mentions "gh CLI not found", no side effects' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_GH_MISSING = 'true' }
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'gh CLI not found'
        # Strongest precondition signal -- no docker + no gh-release + no env-file artefacts.
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
        ($r.Events | Where-Object {
            $_.event -eq 'gh' -and ([object[]]$_.args)[0] -eq 'release'
        }).Count | Should -Be 0
        Test-Path (Join-Path $tmp 'dashboard.env')              | Should -BeFalse
        Test-Path (Join-Path $tmp 'docker-compose.release.yml') | Should -BeFalse
    }

    It 'gh not authenticated -- exits 1, output mentions "not authenticated", no side effects' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_GH_NOT_AUTHED = 'true' }
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'not authenticated'
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
        ($r.Events | Where-Object {
            $_.event -eq 'gh' -and ([object[]]$_.args)[0] -eq 'release'
        }).Count | Should -Be 0
        Test-Path (Join-Path $tmp 'dashboard.env')              | Should -BeFalse
        Test-Path (Join-Path $tmp 'docker-compose.release.yml') | Should -BeFalse
    }

    It 'gh token lacks read:packages -- exits 1, output mentions "read:packages", no side effects' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_GH_NO_SCOPE = 'true' }
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'read:packages'
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
        ($r.Events | Where-Object {
            $_.event -eq 'gh' -and ([object[]]$_.args)[0] -eq 'release'
        }).Count | Should -Be 0
        Test-Path (Join-Path $tmp 'dashboard.env')              | Should -BeFalse
        Test-Path (Join-Path $tmp 'docker-compose.release.yml') | Should -BeFalse
    }

    It 'gh token has write:packages (no explicit read:packages) -- precondition passes (regression guard: GitHub OAuth scope hierarchy)' {
        # `gh auth status --show-token` only lists the *highest* granted scope --
        # write:packages includes read:packages, so the redundant read:packages
        # is not separately listed. The script must accept any of
        # read|write|admin:packages, otherwise tokens granted via
        # `gh auth refresh --scopes write:packages` get rejected even though
        # they can pull from GHCR.
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_GH_SCOPE_LITERAL = 'write:packages' }
        $r.ExitCode | Should -Be 0
    }

    It 'gh token has admin:packages -- precondition passes (regression guard: same hierarchy reason)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_GH_SCOPE_LITERAL = 'admin:packages' }
        $r.ExitCode | Should -Be 0
    }

    It 'happy path -- docker login ghcr.io runs BEFORE docker compose pull (ordering invariant)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $dockerEvents = @($r.Events | Where-Object event -eq 'docker')
        $loginIdx = -1
        $pullIdx  = -1
        for ($i = 0; $i -lt $dockerEvents.Count; $i++) {
            $a = [object[]]$dockerEvents[$i].args
            if ($loginIdx -lt 0 -and $a.Count -ge 2 -and $a[0] -eq 'login' -and ($a -contains 'ghcr.io')) {
                $loginIdx = $i
            }
            if ($pullIdx -lt 0 -and $a.Count -ge 2 -and $a[0] -eq 'compose' -and ($a -contains 'pull')) {
                $pullIdx = $i
            }
        }
        $loginIdx | Should -BeGreaterThan -1
        $pullIdx  | Should -BeGreaterThan -1
        $loginIdx | Should -BeLessThan $pullIdx
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

Describe 'install.ps1 -- gh release download tag branching' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It '-Version latest -> gh release download invoked WITHOUT a positional tag (argv[2] is a flag)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','latest')
        $r.ExitCode | Should -Be 0
        $assetCalls = @($r.Events | Where-Object {
            $_.event -eq 'gh' -and
            ([object[]]$_.args)[0] -eq 'release' -and
            ([object[]]$_.args)[1] -eq 'download' -and
            (([object[]]$_.args) -contains '--pattern')
        })
        $assetCalls.Count | Should -BeGreaterThan 0
        $composeCall = $assetCalls | Where-Object {
            $a = [object[]]$_.args
            $patternIdx = [Array]::IndexOf($a, '--pattern')
            $patternIdx -ge 0 -and ($patternIdx + 1) -lt $a.Count -and $a[$patternIdx + 1] -eq 'docker-compose.release.yml'
        } | Select-Object -First 1
        $composeCall | Should -Not -BeNullOrEmpty
        $argv = [object[]]$composeCall.args
        # argv[2] must be a flag (--repo / --pattern / ...), NOT a positional tag.
        $argv[2] | Should -Match '^--'
        # --repo + repo literal present.
        $repoIdx = [Array]::IndexOf($argv, '--repo')
        $repoIdx | Should -BeGreaterThan -1
        $argv[$repoIdx + 1] | Should -Be 'kostiantyn-matsebora/deployment-dashboard'
        # --pattern docker-compose.release.yml present.
        $patternIdx = [Array]::IndexOf($argv, '--pattern')
        $patternIdx | Should -BeGreaterThan -1
        $argv[$patternIdx + 1] | Should -Be 'docker-compose.release.yml'
        # --clobber present.
        $argv | Should -Contain '--clobber'
    }

    It '-Version v1.2.3 -> gh release download invoked WITH the literal tag at argv[2]' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v1.2.3')
        $r.ExitCode | Should -Be 0
        $assetCalls = @($r.Events | Where-Object {
            $_.event -eq 'gh' -and
            ([object[]]$_.args)[0] -eq 'release' -and
            ([object[]]$_.args)[1] -eq 'download'
        })
        $composeCall = $assetCalls | Where-Object {
            $a = [object[]]$_.args
            $patternIdx = [Array]::IndexOf($a, '--pattern')
            $patternIdx -ge 0 -and ($patternIdx + 1) -lt $a.Count -and $a[$patternIdx + 1] -eq 'docker-compose.release.yml'
        } | Select-Object -First 1
        $composeCall | Should -Not -BeNullOrEmpty
        $argv = [object[]]$composeCall.args
        # argv[2] must be the literal tag, not a flag.
        $argv[2] | Should -Be 'v1.2.3'
        # --pattern docker-compose.release.yml still present.
        $patternIdx = [Array]::IndexOf($argv, '--pattern')
        $patternIdx | Should -BeGreaterThan -1
        $argv[$patternIdx + 1] | Should -Be 'docker-compose.release.yml'
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

    It 'gh release download failure -- script exits 1 with red error mentioning the asset + version' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v0.0.0-doesnotexist') `
                            -EnvOverrides @{ DD_GH_DOWNLOAD_FAIL = 'docker-compose.release.yml' }
        $r.ExitCode | Should -Be 1
        $combined = "$($r.Stdout)`n$($r.Stderr)"
        $combined | Should -Match 'docker-compose.release.yml'
        $combined | Should -Match 'v0\.0\.0-doesnotexist'
    }

    It 'docker login ghcr.io failure (non-zero exit) -- script exits 1 and NEVER calls docker compose pull' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_LOGIN_EXIT = '1' }
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'docker login ghcr\.io failed'
        # Critically -- compose pull was never reached.
        ($r.Events | Where-Object {
            $_.event -eq 'docker' -and ([object[]]$_.args)[0] -eq 'compose' -and (([object[]]$_.args) -contains 'pull')
        }).Count | Should -Be 0
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
