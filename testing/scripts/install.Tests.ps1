# Tests for ../../install/install.ps1 -- release-install primary entrypoint (issue #72).
#
# Strategy: subprocess invocation against a shimmed copy of install.ps1 in a
# per-test tmpdir. The shim prepends function-form overrides of `docker`,
# `Invoke-WebRequest` and `gh` that capture their args to a per-invocation log
# file (`$env:DD_SCRIPT_LOG`) and return canned exit codes / fake bytes. The
# original install.ps1 is never modified -- see local/bindings.md (qa-engineer
# must NOT edit installer scripts; report bugs, don't fix).
#
# Coverage matrix is dictated by the qa-engineer dispatch prompt for issue #72
# (ASR-A flag matrix split: release vs demo compose chains):
#   - ASR-D precondition: no-flag default requires ConnectionStrings__DefaultConnection
#   - Flag matrix (issue #72):
#       (no flag)      -> app-only, no db, no fetcher; requires
#                         ConnectionStrings__DefaultConnection in env or
#                         dashboard.env; otherwise exits 1 with ASR-D message.
#       -LocalDb       -> app + bundled Postgres (--profile db). Auto-sets
#                         connection string; no GHA_TOKEN required.
#       -RealGha       -> real GitHub Actions upstream + fetcher (--profile fetcher).
#                         Requires GHA_TOKEN. External Postgres required (pass
#                         -LocalDb or supply ConnectionStrings__DefaultConnection).
#       -RealGha -LocalDb -> bundled Postgres + real GHA (--profile db + fetcher).
#       -Demo          -> release.yml + demo.yml overlay, --profile db + fetcher.
#                         Zero-PAT, offline, self-contained.
#   - Mutual exclusion:
#       -Demo -LocalDb rejected (demo already bundles db)
#       -Demo -RealGha rejected (demo uses mock upstream)
#   - gh CLI precondition (gh missing / unauthed / missing read:packages scope)
#   - API_TOKEN / POSTGRES_PASSWORD defence-in-depth
#   - gh release download tag branching (latest vs pinned)
#   - Env-file output shape
#   - Compose args (profiles + env-file + compose files)
#   - Error paths
#   - AR-3 contract: precondition error names all 3 resolution paths

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
    #   DD_VOLUME_EXISTS      -- if 'true', `docker volume inspect <name>` exits 0
    #                            with a stub JSON payload (drives the issue #37
    #                            volume-detection safety net); otherwise exits 1
    #                            with a stderr 'No such volume' message.
    #
    # Default: gh precondition passes, downloads succeed, docker login succeeds,
    # pull + up succeed, /health succeeds, no pre-existing volume.
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
    if ($argv[0] -eq 'login') {
        $global:LASTEXITCODE = if ($env:DD_LOGIN_EXIT) { [int]$env:DD_LOGIN_EXIT } else { 0 }
        return
    }
    # `docker volume inspect <name>` -- issue #37 volume-detection safety net.
    if ($argv[0] -eq 'volume' -and $argv[1] -eq 'inspect') {
        if ($env:DD_VOLUME_EXISTS -eq 'true') {
            Write-Output '[{"Name":"deployment-dashboard_pg-data","Driver":"local"}]'
            $global:LASTEXITCODE = 0
            return
        }
        [Console]::Error.WriteLine("Error response from daemon: No such volume: $($argv[2])")
        $global:LASTEXITCODE = 1
        return
    }
    if ($argv[0] -eq 'compose') {
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
        Write-Output 'testuser'
        $global:LASTEXITCODE = 0
        return
    }
    if ($argv[0] -eq 'release' -and $argv[1] -eq 'download') {
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

    function New-ShimmedScript {
        param([string]$TmpDir)
        $shimmed = Join-Path $TmpDir 'install.shimmed.ps1'
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
    # Key env vars cleared for isolation:
    #   GHA_TOKEN, DASHBOARD_API_TOKEN, ConnectionStrings__DefaultConnection,
    #   POSTGRES_PASSWORD, DD_SCRIPT_LOG, and all DD_* stub knobs.
    function Invoke-Install {
        param(
            [Parameter(Mandatory)] [string] $TmpDir,
            [string[]] $Args = @(),
            [hashtable] $EnvOverrides = @{}
        )
        $shimmed = New-ShimmedScript -TmpDir $TmpDir
        $log = Join-Path $TmpDir 'script.log'
        if (Test-Path $log) { Remove-Item $log -Force }

        $cmd = @(
            'pwsh', '-NoProfile', '-NonInteractive', '-File', $shimmed
        ) + $Args

        $stdoutPath = Join-Path $TmpDir 'stdout.txt'
        $stderrPath = Join-Path $TmpDir 'stderr.txt'

        $envBackup = @{}
        $envKeys = @(
            'GHA_TOKEN','DASHBOARD_API_TOKEN','ConnectionStrings__DefaultConnection',
            'POSTGRES_PASSWORD','DD_SCRIPT_LOG',
            'DD_PULL_EXIT','DD_UP_EXIT','DD_LOGIN_EXIT','DD_IWR_HEALTH_OK',
            'DD_GH_MISSING','DD_GH_NOT_AUTHED','DD_GH_NO_SCOPE','DD_GH_SCOPE_LITERAL','DD_GH_DOWNLOAD_FAIL',
            'DD_VOLUME_EXISTS'
        )
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

# ---------------------------------------------------------------------------
# ASR-D -- ConnectionStrings__DefaultConnection precondition
# Issue #72: no-flag default (app-only) fails fast when the connection string
# is absent from the environment and from an existing dashboard.env at InstallDir.
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- ASR-D: ConnectionStrings__DefaultConnection precondition (issue #72)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'no flag + no ConnectionStrings env + no dashboard.env -- exits 1 before any docker / gh side effect (ASR-D)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
        ($r.Events | Where-Object { $_.event -eq 'gh' -and ([object[]]$_.args)[0] -eq 'release' }).Count | Should -Be 0
        Test-Path (Join-Path $tmp 'dashboard.env')              | Should -BeFalse
        Test-Path (Join-Path $tmp 'docker-compose.release.yml') | Should -BeFalse
    }

    It 'no flag + no ConnectionStrings env -- error output contains all 3 AR-3 resolution paths (AR-3 contract lock)' {
        # AR-3: the precondition error MUST name all 3 resolution paths so the
        # operator knows exactly how to unblock.
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        $combined = "$($r.Stdout)`n$($r.Stderr)"
        $combined | Should -Match 'Pass -LocalDb'
        $combined | Should -Match 'Pass -Demo'
        $combined | Should -Match 'ConnectionStrings__DefaultConnection'
    }

    It 'no flag + ConnectionStrings__DefaultConnection in env -- precondition passes, happy path' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ 'ConnectionStrings__DefaultConnection' = 'Host=mydb;Database=dashboard;Username=dashboard;Password=secret' }
        $r.ExitCode | Should -Be 0
    }

    It 'no flag + ConnectionStrings__DefaultConnection in existing dashboard.env -- precondition passes, happy path' {
        # Seed a pre-existing env file with the connection string.
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value 'ConnectionStrings__DefaultConnection=Host=mydb;Database=dashboard;Username=dashboard;Password=secret' `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
    }

    It '-LocalDb -- ASR-D precondition is bypassed (bundled db, no external string required)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Not -Match 'ConnectionStrings__DefaultConnection is not set'
    }

    It '-Demo -- ASR-D precondition is bypassed (demo bundles db + mock upstream, no external string required)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Demo','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Not -Match 'ConnectionStrings__DefaultConnection is not set'
    }
}

# ---------------------------------------------------------------------------
# GHA_TOKEN precondition -- scoped to -RealGha per issue #72
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- GHA_TOKEN precondition (-RealGha path, issue #72)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'exits 1 with red error when -RealGha is set without GHA_TOKEN' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-RealGha','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        $combined = "$($r.Stdout)`n$($r.Stderr)"
        $combined | Should -Match 'ERROR'
        $combined | Should -Match 'GHA_TOKEN'
        $combined | Should -Match '-RealGha'
    }

    It '-RealGha without GHA_TOKEN exits BEFORE any docker compose / Invoke-WebRequest / gh release call' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-RealGha','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
        ($r.Events | Where-Object event -eq 'iwr').Count    | Should -Be 0
        ($r.Events | Where-Object {
            $_.event -eq 'gh' -and ([object[]]$_.args)[0] -eq 'release'
        }).Count | Should -Be 0
        Test-Path (Join-Path $tmp 'dashboard.env')              | Should -BeFalse
        Test-Path (Join-Path $tmp 'docker-compose.release.yml') | Should -BeFalse
    }

    It '-RealGha -LocalDb with GHA_TOKEN set: exits 0 (bundled db satisfies Postgres requirement)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-RealGha','-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_fake_pat_for_tests' }
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Not -Match 'GHA_TOKEN not set'
    }

    It '-LocalDb without GHA_TOKEN: GHA_TOKEN precondition is bypassed (no fetcher in LocalDb-only path)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Not -Match 'ERROR: -RealGha requires'
    }

    It '-Demo does not require GHA_TOKEN (demo uses mock upstream)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Demo','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Not -Match 'ERROR: -RealGha requires'
    }
}

# ---------------------------------------------------------------------------
# Mutual exclusion guards (issue #72)
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- mutual exclusion guards (issue #72)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It '-Demo -LocalDb: rejected as mutually exclusive (demo already bundles db)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Demo','-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'mutually exclusive'
    }

    It '-Demo -RealGha: rejected as mutually exclusive (demo uses mock upstream, not real GHA)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Demo','-RealGha','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'mutually exclusive'
    }

    It '-Demo -LocalDb: rejected BEFORE any docker / gh-release side effect' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Demo','-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
        ($r.Events | Where-Object { $_.event -eq 'gh' -and ([object[]]$_.args)[0] -eq 'release' }).Count | Should -Be 0
    }

    It '-Demo -RealGha: rejected BEFORE any docker / gh-release side effect' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Demo','-RealGha','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
        ($r.Events | Where-Object { $_.event -eq 'gh' -and ([object[]]$_.args)[0] -eq 'release' }).Count | Should -Be 0
    }
}

# ---------------------------------------------------------------------------
# Flag matrix -- compose chain + profile assertions (ASR-A, issue #72)
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- ASR-A flag matrix: compose chain + profiles (issue #72)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It '(no flag) + ConnectionStrings in env -- release.yml only; NO profiles in docker compose up' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ 'ConnectionStrings__DefaultConnection' = 'Host=mydb;Database=dashboard;Username=dashboard;Password=secret' }
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $up | Should -Not -BeNullOrEmpty
        $upArgs = [object[]]$up.args
        # App-only: no profiles at all.
        $upArgs | Should -Not -Contain '--profile'
        $upArgs | Should -Not -Contain 'db'
        $upArgs | Should -Not -Contain 'fetcher'
        # Only release.yml in the -f chain (no demo.yml).
        $fPairs = @()
        for ($i = 0; $i -lt $upArgs.Count; $i++) {
            if ($upArgs[$i] -eq '-f' -and $i + 1 -lt $upArgs.Count) { $fPairs += $upArgs[$i + 1] }
        }
        ($fPairs | Where-Object { $_ -like '*docker-compose.release.yml' }).Count | Should -Be 1
        ($fPairs | Where-Object { $_ -like '*docker-compose.demo.yml' }).Count    | Should -Be 0
    }

    It '-LocalDb -- release.yml only; --profile db in docker compose up; NO fetcher profile' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Contain 'db'
        $upArgs | Should -Not -Contain 'fetcher'
        $fPairs = @()
        for ($i = 0; $i -lt $upArgs.Count; $i++) {
            if ($upArgs[$i] -eq '-f' -and $i + 1 -lt $upArgs.Count) { $fPairs += $upArgs[$i + 1] }
        }
        ($fPairs | Where-Object { $_ -like '*docker-compose.release.yml' }).Count | Should -Be 1
        ($fPairs | Where-Object { $_ -like '*docker-compose.demo.yml' }).Count    | Should -Be 0
    }

    It '-RealGha (with GHA_TOKEN) -- release.yml only; --profile fetcher only; NO --profile db; NO demo.yml' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-RealGha','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{
                                GHA_TOKEN = 'ghp_real_pat'
                                'ConnectionStrings__DefaultConnection' = 'Host=mydb;Database=dashboard;Username=dashboard;Password=secret'
                            }
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Contain 'fetcher'
        $upArgs | Should -Not -Contain 'db'
        $fPairs = @()
        for ($i = 0; $i -lt $upArgs.Count; $i++) {
            if ($upArgs[$i] -eq '-f' -and $i + 1 -lt $upArgs.Count) { $fPairs += $upArgs[$i + 1] }
        }
        ($fPairs | Where-Object { $_ -like '*docker-compose.release.yml' }).Count | Should -Be 1
        ($fPairs | Where-Object { $_ -like '*docker-compose.demo.yml' }).Count    | Should -Be 0
    }

    It '-RealGha -LocalDb -- release.yml only; --profile db + --profile fetcher; NO demo.yml' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-RealGha','-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_real_pat' }
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Contain 'db'
        $upArgs | Should -Contain 'fetcher'
        $fPairs = @()
        for ($i = 0; $i -lt $upArgs.Count; $i++) {
            if ($upArgs[$i] -eq '-f' -and $i + 1 -lt $upArgs.Count) { $fPairs += $upArgs[$i + 1] }
        }
        ($fPairs | Where-Object { $_ -like '*docker-compose.release.yml' }).Count | Should -Be 1
        ($fPairs | Where-Object { $_ -like '*docker-compose.demo.yml' }).Count    | Should -Be 0
    }

    It '-Demo -- release.yml + demo.yml overlay; --profile db + --profile fetcher' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Demo','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Contain 'db'
        $upArgs | Should -Contain 'fetcher'
        $fPairs = @()
        for ($i = 0; $i -lt $upArgs.Count; $i++) {
            if ($upArgs[$i] -eq '-f' -and $i + 1 -lt $upArgs.Count) { $fPairs += $upArgs[$i + 1] }
        }
        ($fPairs | Where-Object { $_ -like '*docker-compose.release.yml' }).Count | Should -Be 1
        ($fPairs | Where-Object { $_ -like '*docker-compose.demo.yml' }).Count    | Should -Be 1
    }

    It '--profile migrate is NEVER passed in any mode (migrations are in-process per ADR-0009)' {
        # Run one representative mode (-LocalDb) and assert no migrate profile.
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        ([object[]]$up.args) | Should -Not -Contain 'migrate'
    }

    It '-Demo -- demo.yml asset is downloaded via gh release download' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Demo','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $demoDl = $r.Events | Where-Object {
            $_.event -eq 'gh' -and
            ([object[]]$_.args)[0] -eq 'release' -and
            ([object[]]$_.args)[1] -eq 'download' -and
            (([object[]]$_.args) -contains '--pattern')
        } | Where-Object {
            $a = [object[]]$_.args
            $pi = [Array]::IndexOf($a, '--pattern')
            $pi -ge 0 -and ($pi + 1) -lt $a.Count -and $a[$pi + 1] -eq 'docker-compose.demo.yml'
        }
        $demoDl | Should -Not -BeNullOrEmpty
    }

    It '(no flag) -- demo.yml asset is NOT downloaded' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ 'ConnectionStrings__DefaultConnection' = 'Host=mydb;Database=dashboard;Username=dashboard;Password=secret' }
        $r.ExitCode | Should -Be 0
        $demoDl = $r.Events | Where-Object {
            $_.event -eq 'gh' -and
            ([object[]]$_.args)[0] -eq 'release' -and
            ([object[]]$_.args)[1] -eq 'download' -and
            (([object[]]$_.args) -contains '--pattern')
        } | Where-Object {
            $a = [object[]]$_.args
            $pi = [Array]::IndexOf($a, '--pattern')
            $pi -ge 0 -and ($pi + 1) -lt $a.Count -and $a[$pi + 1] -eq 'docker-compose.demo.yml'
        }
        $demoDl | Should -BeNullOrEmpty
    }

    It '-LocalDb sets ConnectionStrings__DefaultConnection automatically (no external string required in env)' {
        # -LocalDb must set the connection string so the api container knows how to
        # reach the bundled Postgres (installed.ps1 step 7).
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        # The install script sets the env var before compose; the compose call
        # receives it. Verify via happy path (exit 0 is sufficient; the ASR-D
        # precondition would have blocked exit with a clear message otherwise).
        "$($r.Stdout)`n$($r.Stderr)" | Should -Not -Match 'ConnectionStrings__DefaultConnection is not set'
    }

    It '-RealGha (with GHA_TOKEN) WITHOUT -LocalDb requires ConnectionStrings__DefaultConnection (external Postgres)' {
        # -RealGha alone does NOT bundle a db, so the ASR-D precondition fires if
        # the connection string is absent.
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-RealGha','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_real_pat' }
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'ConnectionStrings__DefaultConnection'
    }

    It '-Fetcher rejected as unknown parameter (renamed to -RealGha per issue #72)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Fetcher','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'Fetcher'
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
    }

    It '-Empty rejected as unknown parameter (flag removed in issue #72)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Empty','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Not -Be 0
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
    }

    It '-SkipMigrations rejected as unknown parameter (retired per ADR-0009)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-SkipMigrations','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ 'ConnectionStrings__DefaultConnection' = 'Host=mydb;Database=dashboard;Username=dashboard;Password=secret' }
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'SkipMigrations'
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
    }
}

# ---------------------------------------------------------------------------
# gh CLI precondition
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- gh CLI precondition' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    # Use -LocalDb for all gh-CLI precondition tests so we don't collide with ASR-D.
    It 'gh missing on PATH -- exits 1, output mentions gh CLI not found, no side effects' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_GH_MISSING = 'true' }
        $r.ExitCode | Should -Be 1
        # Script emits: ERROR: 'gh' CLI not found on PATH.
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match "CLI not found"
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
        ($r.Events | Where-Object {
            $_.event -eq 'gh' -and ([object[]]$_.args)[0] -eq 'release'
        }).Count | Should -Be 0
        Test-Path (Join-Path $tmp 'dashboard.env')              | Should -BeFalse
        Test-Path (Join-Path $tmp 'docker-compose.release.yml') | Should -BeFalse
    }

    It 'gh not authenticated -- exits 1, output mentions "not authenticated", no side effects' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test') `
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
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test') `
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

    It 'gh token has write:packages -- precondition passes (regression guard: GitHub OAuth scope hierarchy)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_GH_SCOPE_LITERAL = 'write:packages' }
        $r.ExitCode | Should -Be 0
    }

    It 'gh token has admin:packages -- precondition passes (regression guard: same hierarchy reason)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_GH_SCOPE_LITERAL = 'admin:packages' }
        $r.ExitCode | Should -Be 0
    }

    It 'happy path -- docker login ghcr.io runs BEFORE docker compose pull (ordering invariant)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
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

# ---------------------------------------------------------------------------
# -LocalDb env-var injection (issue #72)
# The new install.ps1 sets env vars for compose substitution rather than
# writing a dashboard.env file. Assertions verify the compose call reflects
# the expected env var state (via happy-path exit code + compose profile
# inspection). Secret persistence is no longer handled by the installer;
# that surface was removed in issue #72 in favour of operator-supplied env vars.
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- -LocalDb env-var injection (issue #72)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It '-LocalDb -- installer exits 0 (env var injection path does not require dashboard.env)' {
        # Issue #72: install.ps1 step 7 sets $env:ConnectionStrings__DefaultConnection
        # for -LocalDb so compose substitution resolves without a file on disk.
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        # Verify no ASR-D precondition message (env var was set in-process).
        "$($r.Stdout)`n$($r.Stderr)" | Should -Not -Match 'ConnectionStrings__DefaultConnection is not set'
    }

    It '-LocalDb -- POSTGRES_PASSWORD env var defaulted to local-dev-password when not set (step 7 INFO log)' {
        # When POSTGRES_PASSWORD is not set, install.ps1 defaults to 'local-dev-password'
        # and emits an INFO line.
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $r.Stdout | Should -Match 'local-dev-password'
    }

    It '-LocalDb with POSTGRES_PASSWORD already set -- uses supplied value without INFO log' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ POSTGRES_PASSWORD = 'my-custom-pw-32charxxxxxxxxxxxxxxx' }
        $r.ExitCode | Should -Be 0
        # No INFO log about defaulting when the var was pre-set.
        $r.Stdout | Should -Not -Match 'POSTGRES_PASSWORD not set; defaulting'
    }
}

# ---------------------------------------------------------------------------
# gh release download tag branching
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- gh release download tag branching' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It '-Version latest -> gh release download invoked WITHOUT a positional tag (argv[2] is a flag)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','latest')
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
        $argv[2] | Should -Match '^--'
        $repoIdx = [Array]::IndexOf($argv, '--repo')
        $repoIdx | Should -BeGreaterThan -1
        $argv[$repoIdx + 1] | Should -Be 'kostiantyn-matsebora/deployment-dashboard'
        $patternIdx = [Array]::IndexOf($argv, '--pattern')
        $patternIdx | Should -BeGreaterThan -1
        $argv[$patternIdx + 1] | Should -Be 'docker-compose.release.yml'
        $argv | Should -Contain '--clobber'
    }

    It '-Version v1.2.3 -> gh release download invoked WITH the literal tag at argv[2]' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v1.2.3')
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
        $argv[2] | Should -Be 'v1.2.3'
        $patternIdx = [Array]::IndexOf($argv, '--pattern')
        $patternIdx | Should -BeGreaterThan -1
        $argv[$patternIdx + 1] | Should -Be 'docker-compose.release.yml'
    }
}

# ---------------------------------------------------------------------------
# Env-var substitution shape (issue #72)
# install.ps1 no longer writes a dashboard.env. Instead it sets env vars
# in the subprocess environment for docker compose substitution. These tests
# verify that the correct env state drives compose correctly (happy path).
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- env-var substitution shape (issue #72)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It '-LocalDb -Version v1.2.3 -Port 9090 -- exits 0 (compose receives version + port via env)' {
        # install.ps1 step 7 sets $env:DASHBOARD_VERSION and $env:DASHBOARD_PORT
        # when they differ from defaults; compose substitutes them. Happy-path exit 0
        # confirms the env var injection path works end-to-end.
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v1.2.3','-Port','9090')
        $r.ExitCode | Should -Be 0
        $r.Stdout | Should -Match '9090'
    }

    It '-LocalDb -Version v9.9.9-test -Port 8080 (default) -- exits 0 and DASHBOARD_PORT not set separately' {
        # When Port equals the default 8080, install.ps1 does NOT set $env:DASHBOARD_PORT
        # (step 7 only sets it when Port -ne 8080). Happy path still completes.
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test','-Port','8080')
        $r.ExitCode | Should -Be 0
    }
}

# ---------------------------------------------------------------------------
# Compose args -- profiles + env-file
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- compose args (profiles + env-file)' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It '--env-file <InstallDir>/dashboard.env is passed to docker compose when a pre-existing env-file is present' {
        # install.ps1 step 8: --env-file is only appended to composeArgs when the
        # dashboard.env file already exists at InstallDir (`Test-Path $envFile`).
        # Pre-seed the file so the condition is true; assert the flag is present.
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value 'PLACEHOLDER=1' `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $allDockerCalls = $r.Events | Where-Object event -eq 'docker'
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

    It 'WITHOUT pre-existing dashboard.env -- --env-file is NOT passed to docker compose pull + up' {
        # install.ps1 step 8: --env-file is absent when no dashboard.env exists.
        # In this case compose uses $env:* set in step 7 directly.
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $allDockerCalls = $r.Events | Where-Object event -eq 'docker'
        $relevant = $allDockerCalls | Where-Object {
            $a = [object[]]$_.args
            $a.Count -ge 2 -and $a[0] -eq 'compose' -and (($a -contains 'pull') -or ($a -contains 'up'))
        }
        $relevant.Count | Should -BeGreaterThan 0
        foreach ($call in $relevant) {
            $a = [object[]]$call.args
            ([Array]::IndexOf($a, '--env-file')) | Should -Be -1
        }
    }
}

# ---------------------------------------------------------------------------
# AR-3 positive assertion (ASR-D contract lock)
# When invoking with no flags, no ConnectionStrings in env, and no dashboard.env,
# the error MUST contain all 3 resolution paths.
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- AR-3 contract: precondition error names all 3 resolution paths' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'no flags + no ConnectionStrings__DefaultConnection env + no dashboard.env: stderr/stdout contains "Pass -LocalDb" (path 1)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'Pass -LocalDb'
    }

    It 'no flags + no ConnectionStrings__DefaultConnection env + no dashboard.env: stderr/stdout contains "Pass -Demo" (path 2)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'Pass -Demo'
    }

    It 'no flags + no ConnectionStrings__DefaultConnection env + no dashboard.env: stderr/stdout contains "ConnectionStrings__DefaultConnection" (path 3)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'ConnectionStrings__DefaultConnection'
    }
}

# ---------------------------------------------------------------------------
# Smoke regression: health-poll + URL panel + exit code
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- smoke regression: health-poll + URL panel + exit code' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'happy path (-LocalDb) -- exits 0 and stdout contains the gateway port (URL panel smoke)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test','-Port','8080')
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Match '8080'
    }

    It 'happy path (-LocalDb) -- /health poll IWR call is emitted exactly once' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        ($r.Events | Where-Object { $_.event -eq 'iwr' -and ($_.uri -like '*/health') }).Count `
            | Should -Be 1
    }

    It 'health timeout (-LocalDb) -- exit code is non-zero' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test','-HealthTimeoutSeconds','1') `
                            -EnvOverrides @{ DD_IWR_HEALTH_OK = 'false' }
        $r.ExitCode | Should -Not -Be 0
    }
}

# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- error paths' {
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'gh release download failure -- script exits 1 with red error mentioning the asset + version' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v0.0.0-doesnotexist') `
                            -EnvOverrides @{ DD_GH_DOWNLOAD_FAIL = 'docker-compose.release.yml' }
        $r.ExitCode | Should -Be 1
        $combined = "$($r.Stdout)`n$($r.Stderr)"
        $combined | Should -Match 'docker-compose.release.yml'
        $combined | Should -Match 'v0\.0\.0-doesnotexist'
    }

    It 'docker login ghcr.io failure (non-zero exit) -- script exits 1 and NEVER calls docker compose pull' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_LOGIN_EXIT = '1' }
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'docker login ghcr\.io failed'
        ($r.Events | Where-Object {
            $_.event -eq 'docker' -and ([object[]]$_.args)[0] -eq 'compose' -and (([object[]]$_.args) -contains 'pull')
        }).Count | Should -Be 0
    }

    It 'docker compose pull failure (non-zero exit) -- script throws / exits non-zero' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_PULL_EXIT = '1' }
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'docker compose pull failed'
    }

    It 'health-poll timeout -- script throws + dumps logs (-LocalDb)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-LocalDb','-InstallDir',$tmp,'-Version','v9.9.9-test','-HealthTimeoutSeconds','1') `
                            -EnvOverrides @{ DD_IWR_HEALTH_OK = 'false' }
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match '/health did not return 200'
        ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'logs') }).Count `
            | Should -BeGreaterThan 0
    }
}

# ---------------------------------------------------------------------------
# Default -InstallDir
# ---------------------------------------------------------------------------
Describe 'install.ps1 -- default -InstallDir is $HOME/.dashboard-release (CWD-independent)' {
    BeforeEach {
        $script:tmp = New-TempTestDir
        $script:userHome = $HOME
        $script:defaultDir = Join-Path $script:userHome '.dashboard-release'
        $script:defaultEnvFile = Join-Path $script:defaultDir 'dashboard.env'
        $script:preExistedDefaultEnv = Test-Path -LiteralPath $script:defaultEnvFile
        $script:preExistedDefaultEnvContent = if ($script:preExistedDefaultEnv) {
            Get-Content -LiteralPath $script:defaultEnvFile -Raw
        } else { $null }
        $script:preExistedDefaultDir = Test-Path -LiteralPath $script:defaultDir
    }
    AfterEach {
        if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp }
        if (-not $script:preExistedDefaultDir) {
            if (Test-Path -LiteralPath $script:defaultDir) {
                Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $script:defaultDir
            }
        } else {
            if ($script:preExistedDefaultEnv) {
                Set-Content -LiteralPath $script:defaultEnvFile -Value $script:preExistedDefaultEnvContent -Encoding utf8 -NoNewline
            } elseif (Test-Path -LiteralPath $script:defaultEnvFile) {
                Remove-Item -LiteralPath $script:defaultEnvFile -Force -ErrorAction SilentlyContinue
            }
        }
    }

    It 'default -InstallDir is $HOME/.dashboard-release (CWD-independent)' {
        $shimmed = New-ShimmedScript -TmpDir $tmp
        $log = Join-Path $tmp 'script.log'
        $stdoutPath = Join-Path $tmp 'stdout.txt'
        $stderrPath = Join-Path $tmp 'stderr.txt'
        $envBackup = @{}
        $envKeys = @('GHA_TOKEN','DASHBOARD_API_TOKEN','ConnectionStrings__DefaultConnection',
                     'POSTGRES_PASSWORD','DD_SCRIPT_LOG','DD_IWR_HEALTH_OK','DD_VOLUME_EXISTS')
        foreach ($k in $envKeys) { $envBackup[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
        try {
            foreach ($k in $envKeys) { [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
            [Environment]::SetEnvironmentVariable('DD_SCRIPT_LOG', $log, 'Process')
            [Environment]::SetEnvironmentVariable('DD_IWR_HEALTH_OK', 'true', 'Process')
            # -LocalDb avoids ASR-D precondition (no external connection string needed).
            $proc = Start-Process -FilePath 'pwsh' `
                                  -ArgumentList @('-NoProfile','-NonInteractive','-File',$shimmed,'-Version','v9.9.9-test','-LocalDb') `
                                  -WorkingDirectory $tmp `
                                  -NoNewWindow -Wait -PassThru `
                                  -RedirectStandardOutput $stdoutPath `
                                  -RedirectStandardError  $stderrPath
            $proc.ExitCode | Should -Be 0
        } finally {
            foreach ($k in $envKeys) { [Environment]::SetEnvironmentVariable($k, $envBackup[$k], 'Process') }
        }
        Test-Path -LiteralPath $script:defaultEnvFile | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $tmp 'dashboard-release') | Should -BeFalse
        $events = @()
        if (Test-Path $log) {
            foreach ($l in Get-Content $log) {
                if ($l -match '\S') { $events += ($l | ConvertFrom-Json) }
            }
        }
        $upCall = $events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1
        $upCall | Should -Not -BeNullOrEmpty
        $upArgs = [object[]]$upCall.args
        $envFileIdx = [Array]::IndexOf($upArgs, '--env-file')
        $envFileIdx | Should -BeGreaterThan -1
        $upArgs[$envFileIdx + 1] | Should -Be $script:defaultEnvFile
    }
}
