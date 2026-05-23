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
# (post-gh-CLI contract) + the flag inversion from CR-0013 (issue #44):
#   - Param defaults + persistence
#   - Flag matrix (CR-0013):
#       (no flag) -> demo stack (`--profile demo --profile fetcher`)
#       -RealGha  -> real GitHub Actions upstream; renamed from `-Fetcher`;
#                    requires `$env:GHA_TOKEN`.
#       -Empty    -> bare-minimum stack (no fetcher, no demo-gha)
#       -Demo     -> back-compat alias for the no-flag default + INFO log
#   - gh CLI precondition (gh missing / unauthed / missing read:packages scope)
#   - API_TOKEN defence-in-depth (literal refusal + env override + reuse)
#   - POSTGRES_PASSWORD defence-in-depth (same shape)
#   - gh release download tag branching (latest vs pinned tag)
#   - Env-file output shape (incl. demo-mode seeded keys per CR-0013)
#   - Compose args (--profile demo + --profile fetcher / --profile fetcher /
#     no profile, per the resolved install mode) -- per ADR-0009 the API
#     self-applies migrations on startup; the installer no longer passes
#     --profile migrate and no longer accepts -SkipMigrations.
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
    # When `docker` is a function override (not a native binary), the upstream
    # pipeline value arrives via $input and is silently discarded if unread --
    # no drain needed. (Reading [Console]::In.ReadToEnd() would HANG because
    # that reads the PS process's actual stdin handle, which is connected to
    # the parent process and never sees EOF.)
    if ($argv[0] -eq 'login') {
        $global:LASTEXITCODE = if ($env:DD_LOGIN_EXIT) { [int]$env:DD_LOGIN_EXIT } else { 0 }
        return
    }
    # `docker volume inspect <name>` -- issue #37 volume-detection safety net.
    # Exit 0 (volume present) when DD_VOLUME_EXISTS=true; exit 1 (absent) otherwise.
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
    # CR-0014: install.ps1 dot-sources _bringup-core.ps1 from $PSScriptRoot; the
    # shim runs in a temp dir, so we must copy the helper alongside the shimmed script.
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

        # Copy the dot-sourced helper into the temp dir so $PSScriptRoot-relative
        # dot-source in install.ps1 resolves correctly when the shim runs.
        $helperSrc = Join-Path $script:RepoRoot 'install/_bringup-core.ps1'
        if (Test-Path $helperSrc) {
            Copy-Item -LiteralPath $helperSrc -Destination (Join-Path $TmpDir '_bringup-core.ps1') -Force
        }

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
            'DD_GH_MISSING','DD_GH_NOT_AUTHED','DD_GH_NO_SCOPE','DD_GH_SCOPE_LITERAL','DD_GH_DOWNLOAD_FAIL',
            'DD_VOLUME_EXISTS'
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

Describe 'install.ps1 -- GHA_TOKEN precondition (inherited from issue #5; -RealGha path per CR-0013)' {
    # Post-CR-0013 contract: the GHA_TOKEN precondition fires ONLY when -RealGha
    # is set. The no-flag default routes to the demo stack (no PAT, no real
    # GitHub API calls); -Empty has no fetcher at all; the back-compat -Demo
    # alias also lands on the demo path. -Fetcher was renamed to -RealGha
    # (PowerShell's [CmdletBinding()] rejects the historical flag name).
    BeforeEach {
        $script:tmp = New-TempTestDir
    }
    AfterEach {
        if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp }
    }

    It 'exits 1 with red error when -RealGha is set without GHA_TOKEN' {
        # CR-0013 contract: -RealGha without $env:GHA_TOKEN red-errors and exits
        # 1 before any side effect. The error literal must steer users toward
        # both alternatives (set the PAT, or drop the flag to use the zero-PAT
        # demo default).
        $r = Invoke-Install -TmpDir $tmp -Args @('-RealGha','-InstallDir',$tmp)
        $r.ExitCode | Should -Be 1
        $combined = "$($r.Stdout)`n$($r.Stderr)"
        $combined | Should -Match 'ERROR'
        $combined | Should -Match 'GHA_TOKEN'
        $combined | Should -Match '-RealGha'
    }

    It '-RealGha without GHA_TOKEN exits BEFORE any docker compose / Invoke-WebRequest / gh release call (no install-dir artefacts)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-RealGha','-InstallDir',$tmp)
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

    It '-RealGha with GHA_TOKEN set: no GHA_TOKEN advisory line is emitted' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-RealGha','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_fake_pat_for_tests' }
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Not -Match 'GHA_TOKEN not set'
    }

    It 'no -RealGha: GHA_TOKEN precondition is bypassed regardless of whether the env var is set' {
        # No-flag default = demo stack; the demo upstream is offline-mocked, so
        # the GHA_TOKEN precondition never fires. Verify the script reaches the
        # happy path with and without $env:GHA_TOKEN.
        $r1 = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r1.ExitCode | Should -Be 0
        $r1.Stdout   | Should -Not -Match 'ERROR: -RealGha requires'

        $tmp2 = New-TempTestDir
        try {
            $r2 = Invoke-Install -TmpDir $tmp2 `
                                 -Args @('-InstallDir',$tmp2,'-Version','v9.9.9-test') `
                                 -EnvOverrides @{ GHA_TOKEN = 'ghp_fake' }
            $r2.ExitCode | Should -Be 0
            $r2.Stdout   | Should -Not -Match 'ERROR: -RealGha requires'
        } finally {
            if (Test-Path $tmp2) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp2 }
        }
    }

    It '-Empty does not require GHA_TOKEN (no fetcher in the resolved stack)' {
        # -Empty drops the fetcher entirely, so the GHA_TOKEN precondition is
        # bypassed regardless of whether $env:GHA_TOKEN is set.
        $r = Invoke-Install -TmpDir $tmp -Args @('-Empty','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Not -Match 'ERROR: -RealGha requires'
    }
}

Describe 'install.ps1 -- flag matrix (CR-0013: demo default + -RealGha / -Empty / -Demo back-compat)' {
    # Per CR-0013 the no-flag default routes to the *demo stack* (offline,
    # zero-PAT, populated dashboard within 60 s). The historical -Fetcher flag
    # was renamed to -RealGha; -Empty is new (bare-minimum direct-POST stack);
    # -Demo is a back-compat alias that silently maps to the new default and
    # logs one INFO line. Contract source: install/install.ps1 § 0 flag matrix
    # + § 4 demo-mode block + § 9 profile resolution.
    #
    # Demo-mode env-file seeding (CR-0013 § 3a flag matrix + § 3b profile-gating):
    #   GHA_API_BASE_URL              = http://demo-gha:80
    #   FETCHER_POLL_INTERVAL_SECONDS = 5
    #   GHA_REPOSITORIES              = 6 demo-org repos (web-portal,
    #                                    api-gateway, auth-service,
    #                                    billing-service, notification-worker,
    #                                    analytics-pipeline)
    #   GHA_TOKEN                     = OMITTED on fresh install (demo-gha
    #                                    never sees the Authorization header);
    #                                    preserved on upgrade-re-run.
    BeforeEach {
        $script:tmp = New-TempTestDir
    }
    AfterEach {
        if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp }
    }

    # ---- No-flag default = demo stack ----

    It 'no-flag default activates --profile demo + --profile fetcher in docker compose up' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $up | Should -Not -BeNullOrEmpty
        $upArgs = [object[]]$up.args
        # Both demo + fetcher profiles must be active for the default path.
        $upArgs | Should -Contain 'demo'
        $upArgs | Should -Contain 'fetcher'
    }

    It 'no-flag default seeds demo-mode env-file keys (6 demo-org repos at 5 s poll, base URL = demo-gha)' {
        # CR-0013 § 3a: the demo stack ships with a 6-service x 5-env populated
        # bundle. The repo list mirrors the bundle's service inventory.
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        Test-Path $r.EnvFile | Should -BeTrue
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^GHA_API_BASE_URL=http://demo-gha:80$'
        $envContent | Should -Match '(?m)^FETCHER_POLL_INTERVAL_SECONDS=5$'
        # All six demo-org repos are present in order in the JSON literal.
        $envContent | Should -Match '(?m)^GHA_REPOSITORIES=.*demo-org.*web-portal.*api-gateway.*auth-service.*billing-service.*notification-worker.*analytics-pipeline'
        # GHA_TOKEN is intentionally OMITTED on a fresh demo install -- the
        # demo upstream never sees an Authorization header.
        $envContent | Should -Not -Match '(?m)^GHA_TOKEN='
    }

    # ---- -Demo (back-compat alias) ----

    It '-Demo back-compat alias: logs INFO line + routes to the demo default' {
        # CR-0013 § 3a: -Demo silently routes to the no-flag default and emits
        # exactly one INFO line steering callers to drop the flag.
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Demo')
        $r.ExitCode | Should -Be 0
        # INFO line emitted (PowerShell writes Write-Host -ForegroundColor Yellow to stdout).
        $r.Stdout | Should -Match 'INFO: demo is now the default'
        $r.Stdout | Should -Match '-Demo flag is redundant'
        # Same compose profile set as the no-flag default.
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Contain 'demo'
        $upArgs | Should -Contain 'fetcher'
    }

    It '-Demo seeds the same demo-mode env-file keys as the no-flag default' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Demo')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^GHA_API_BASE_URL=http://demo-gha:80$'
        $envContent | Should -Match '(?m)^FETCHER_POLL_INTERVAL_SECONDS=5$'
        $envContent | Should -Match '(?m)^GHA_REPOSITORIES=.*demo-org.*web-portal.*api-gateway.*auth-service.*billing-service.*notification-worker.*analytics-pipeline'
        $envContent | Should -Not -Match '(?m)^GHA_TOKEN='
    }

    # ---- -RealGha ----

    It '-RealGha (with GHA_TOKEN) activates only --profile fetcher (NOT --profile demo)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-RealGha','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_real_pat' }
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Contain 'fetcher'
        $upArgs | Should -Not -Contain 'demo'
    }

    It '-RealGha does NOT seed demo-mode env-file keys (no GHA_API_BASE_URL retarget, no GHA_REPOSITORIES default)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-RealGha','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_real_pat' }
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        # The demo-mode block is skipped under -RealGha; none of the demo
        # defaults appear in the env-file. (The fetcher container falls back to
        # its compose-default GHA_API_BASE_URL = https://api.github.com.)
        $envContent | Should -Not -Match '(?m)^GHA_API_BASE_URL=http://demo-gha:80$'
        $envContent | Should -Not -Match '(?m)^FETCHER_POLL_INTERVAL_SECONDS=5$'
        $envContent | Should -Not -Match 'demo-org.*web-portal'
    }

    # ---- -Empty ----

    It '-Empty activates NO profiles (no demo, no fetcher) -- bare-minimum stack' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Empty','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Not -Contain 'demo'
        $upArgs | Should -Not -Contain 'fetcher'
        # Belt-and-suspenders -- the `--profile` flag itself should be absent.
        $upArgs | Should -Not -Contain '--profile'
    }

    It '-Empty does NOT seed demo-mode env-file keys' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Empty','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Not -Match '(?m)^GHA_API_BASE_URL=http://demo-gha:80$'
        $envContent | Should -Not -Match '(?m)^FETCHER_POLL_INTERVAL_SECONDS=5$'
        $envContent | Should -Not -Match 'demo-org.*web-portal'
    }

    # ---- Mutual exclusion ----

    It '-RealGha + -Empty together: rejected as mutually exclusive' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-RealGha','-Empty','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'mutually exclusive'
    }

    It '-RealGha + -Demo together: rejected as mutually exclusive' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-RealGha','-Demo','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'mutually exclusive'
    }

    It '-Empty + -Demo together: rejected as mutually exclusive' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Empty','-Demo','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 1
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'mutually exclusive'
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

    # CR-0014: demo is now the default mode. Random-secret tests use -Empty (no fetcher,
    # no demo-gha) to exercise the non-demo secret generation path without requiring GHA_TOKEN.

    It 'new install -- generates a 64-char hex API_TOKEN and persists it to dashboard.env' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty')
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
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty')
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
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match "(?m)^API_TOKEN=$preexisting$"
        $r.Stdout   | Should -Match 'Reusing API_TOKEN'
    }

    It '$env:DASHBOARD_API_TOKEN -- wins over generation when no env-file exists' {
        $custom = 'custom-api-token-from-env-' + ('x' * 32)
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty') `
                            -EnvOverrides @{ DASHBOARD_API_TOKEN = $custom }
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match "(?m)^API_TOKEN=$([regex]::Escape($custom))$"
        $r.Stdout   | Should -Match 'DASHBOARD_API_TOKEN'
    }

    It '$env:DASHBOARD_API_TOKEN = dev literal -- refused, random generation kicks in' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty') `
                            -EnvOverrides @{ DASHBOARD_API_TOKEN = 'local-dev-token-not-for-production' }
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Not -Match 'API_TOKEN=local-dev-token-not-for-production'
        $envContent | Should -Match '(?m)^API_TOKEN=([0-9a-f]{64})$'
        $r.Stdout   | Should -Match 'Generated random API_TOKEN'
    }

    It 'new install -- generates a 32-char hex POSTGRES_PASSWORD' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^POSTGRES_PASSWORD=([0-9a-f]{32})$'
        $r.Stdout   | Should -Match 'Generated random POSTGRES_PASSWORD'
    }

    It 'pre-existing dev-literal POSTGRES_PASSWORD -- regenerated' {
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "POSTGRES_PASSWORD=local-dev-password`nAPI_TOKEN=$('b' * 64)" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty')
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
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty')
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
        # Use -Empty to get random-secret generation (demo mode writes fixed literals not random hex).
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v1.2.3','-Port','9090','-Empty')
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
        # Use -Empty to get random-secret generation so we can assert the password is echoed verbatim.
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty')
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

    It 'default install -- --profile migrate is NEVER passed (API self-applies migrations per ADR-0009); demo + fetcher profiles ARE passed (CR-0013)' {
        # Post-#22 contract: migrations are applied in-process by the api
        # container on startup; there is no migrate profile in the compose
        # file and the installer never passes --profile migrate.
        # Post-CR-0013 contract: the no-flag default brings up the demo stack,
        # so --profile demo + --profile fetcher are BOTH present in the up
        # call.
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $up = $r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') }
        $up.Count | Should -BeGreaterThan 0
        $upArgs = [object[]]($up | Select-Object -First 1).args
        $upArgs | Should -Not -Contain 'migrate'
        # Demo default per CR-0013: both demo + fetcher profiles ride along.
        $upArgs | Should -Contain 'demo'
        $upArgs | Should -Contain 'fetcher'
    }

    It '-RealGha -- only --profile fetcher is passed (no --profile demo, no --profile migrate)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-RealGha') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_fake' }
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Contain 'fetcher'
        $upArgs | Should -Not -Contain 'demo'
        $upArgs | Should -Not -Contain 'migrate'
    }

    It '-Empty -- no --profile flag at all (no fetcher, no demo, no migrate)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty')
        $r.ExitCode | Should -Be 0
        $up = ($r.Events | Where-Object { $_.event -eq 'docker' -and ($_.args -contains 'up') } | Select-Object -First 1)
        $upArgs = [object[]]$up.args
        $upArgs | Should -Not -Contain 'fetcher'
        $upArgs | Should -Not -Contain 'demo'
        $upArgs | Should -Not -Contain 'migrate'
        $upArgs | Should -Not -Contain '--profile'
    }

    It '-Fetcher -- rejected as an unknown parameter (renamed to -RealGha per CR-0013)' {
        # PowerShell's [CmdletBinding()] surfaces the unknown switch as a
        # non-zero exit with a "parameter cannot be found" error on stderr;
        # the script MUST NOT proceed to any docker / gh side effect.
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Fetcher')
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'Fetcher'
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
    }

    It '-SkipMigrations -- rejected as an unknown parameter (the flag was retired per ADR-0009 / #22)' {
        # The installer no longer accepts -SkipMigrations because migrations
        # are now applied in-process by the api container. PowerShell's
        # [CmdletBinding()] surfaces the unknown switch as a non-zero exit
        # with a "parameter cannot be found" error on stderr; the script
        # MUST NOT proceed to any docker / gh side effect.
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-SkipMigrations')
        $r.ExitCode | Should -Not -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Match 'SkipMigrations'
        ($r.Events | Where-Object event -eq 'docker').Count | Should -Be 0
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

Describe 'install.ps1 -- smoke regression: health-poll + URL panel + exit code' {
    # CR-0014 batch 5 smoke additions. Verifies the end-to-end observable surface
    # (health 200 -> exit 0 + URL panel; health timeout -> exit non-zero + log dump).
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'happy path -- exits 0 and stdout contains the gateway port (URL panel smoke)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Port','8080')
        $r.ExitCode | Should -Be 0
        $r.Stdout   | Should -Match '8080'
    }

    It 'happy path -- /health poll IWR call is emitted exactly once (health-poll smoke)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        ($r.Events | Where-Object { $_.event -eq 'iwr' -and ($_.uri -like '*/health') }).Count `
            | Should -Be 1
    }

    It 'health timeout -- exit code is non-zero (exit-code regression guard)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-HealthTimeoutSeconds','1') `
                            -EnvOverrides @{ DD_IWR_HEALTH_OK = 'false' }
        $r.ExitCode | Should -Not -Be 0
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

Describe 'install.ps1 -- CR-0014 demo fixed credentials + helper delegation' {
    # CR-0014 § 3c: demo path writes POSTGRES_PASSWORD=local-dev-password
    # and API_TOKEN=demo-api-token (fixed literals). Non-demo paths generate random.
    # CR-0014 § 3a: install.ps1 dot-sources _bringup-core.ps1; entrypoint tests
    # assert delegation outcome (fixed creds), not helper internals.
    BeforeEach { $script:tmp = New-TempTestDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'demo path (no flag) -- writes POSTGRES_PASSWORD=local-dev-password to dashboard.env (CR-0014 § 3c)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^POSTGRES_PASSWORD=local-dev-password$'
    }

    It 'demo path (no flag) -- writes API_TOKEN=demo-api-token to dashboard.env (CR-0014 § 3c)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^API_TOKEN=demo-api-token$'
    }

    It '-Demo back-compat alias -- writes fixed demo credentials (same as no-flag default)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Demo')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^POSTGRES_PASSWORD=local-dev-password$'
        $envContent | Should -Match '(?m)^API_TOKEN=demo-api-token$'
    }

    It '-RealGha path -- does NOT write fixed demo POSTGRES_PASSWORD (still random) (CR-0014 § 3c non-demo)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-RealGha','-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_fake_pat' }
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Not -Match '(?m)^POSTGRES_PASSWORD=local-dev-password$'
        $envContent | Should -Match '(?m)^POSTGRES_PASSWORD=[0-9a-f]'
    }

    It '-Empty path -- does NOT write fixed demo credentials (still random) (CR-0014 § 3c non-demo)' {
        $r = Invoke-Install -TmpDir $tmp -Args @('-Empty','-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Not -Match '(?m)^POSTGRES_PASSWORD=local-dev-password$'
        $envContent | Should -Not -Match '(?m)^API_TOKEN=demo-api-token$'
    }

    It 'demo re-run against existing pg-data volume -- succeeds without volume drop (CR-0014 § 3c re-run safety)' {
        # With fixed demo credentials, pg cluster initialised on first install
        # accepts the same password on subsequent re-runs.
        # Seed an env-file with the fixed demo creds (post-CR-0014 state).
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "API_TOKEN=demo-api-token`nPOSTGRES_PASSWORD=local-dev-password" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_VOLUME_EXISTS = 'true' }
        # Guard must not red-error (fixed creds make collision impossible).
        $r.ExitCode | Should -Be 0
        "$($r.Stdout)`n$($r.Stderr)" | Should -Not -Match 'Pre-existing Postgres volume detected'
    }
}

Describe 'install.ps1 -- upgrade flow (issue #37)' {
    # Phase 4 contract additions:
    #   1. CWD-independent default -InstallDir (= $HOME/.dashboard-release).
    #   2. -Demo defaults preservation on re-run (GHA_REPOSITORIES / FETCHER_POLL_INTERVAL_SECONDS / GHA_TOKEN).
    #   3. Volume-detection safety net: docker volume inspect deployment-dashboard_pg-data exits 0
    #      AND $envFile does NOT exist -> red-error + exit 1 BEFORE any side effect.
    #   4. .DESCRIPTION upgrade-flow doc + .EXAMPLE blocks (verified by hand; not asserted here -- belongs in lint, not behavioural tests).
    #   5. -ResetDemoDefaults switch: opts back into the legacy "always overwrite demo defaults" behaviour.
    #
    # The default-$InstallDir scenario writes into the REAL $HOME -- we capture
    # the path before, snapshot any pre-existing file there, and restore it in
    # AfterEach so a parallel `pwsh` session doing real work is not disturbed.
    BeforeEach {
        $script:tmp = New-TempTestDir
        $script:userHome = [Environment]::GetFolderPath('UserProfile')
        $script:defaultDir = Join-Path $script:userHome '.dashboard-release'
        $script:defaultEnvFile = Join-Path $script:defaultDir 'dashboard.env'
        # Snapshot any pre-existing dashboard.env at the real default so we can
        # restore it after a test that uses the default $InstallDir.
        $script:preExistedDefaultEnv = Test-Path -LiteralPath $script:defaultEnvFile
        $script:preExistedDefaultEnvContent = if ($script:preExistedDefaultEnv) {
            Get-Content -LiteralPath $script:defaultEnvFile -Raw
        } else { $null }
        $script:preExistedDefaultDir = Test-Path -LiteralPath $script:defaultDir
    }
    AfterEach {
        if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp }
        # If the default dir did NOT pre-exist, drop everything we created.
        # If it did pre-exist, restore the env-file content (or remove it if
        # there was none originally) so we don't pollute the operator's machine.
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
        # Probe: invoke install.ps1 from a fake CWD ($tmp) WITHOUT -InstallDir.
        # The shim's `Start-Process` does not override -WorkingDirectory, which
        # would inherit the test process's CWD; pin it to $tmp so any CWD-anchored
        # default (the old `Join-Path $PWD 'dashboard-release'` shape) would land
        # under $tmp\dashboard-release, NOT under $HOME\.dashboard-release.
        # Assertions: dashboard.env was written under $HOME\.dashboard-release;
        # NOT written under $tmp\dashboard-release.
        $shimmed = New-ShimmedScript -TmpDir $tmp
        $log = Join-Path $tmp 'script.log'
        $stdoutPath = Join-Path $tmp 'stdout.txt'
        $stderrPath = Join-Path $tmp 'stderr.txt'
        $envBackup = @{}
        $envKeys = @('GHA_TOKEN','DASHBOARD_API_TOKEN','DD_SCRIPT_LOG','DD_IWR_HEALTH_OK','DD_VOLUME_EXISTS')
        foreach ($k in $envKeys) { $envBackup[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
        try {
            foreach ($k in $envKeys) { [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
            [Environment]::SetEnvironmentVariable('DD_SCRIPT_LOG', $log, 'Process')
            [Environment]::SetEnvironmentVariable('DD_IWR_HEALTH_OK', 'true', 'Process')
            $proc = Start-Process -FilePath 'pwsh' `
                                  -ArgumentList @('-NoProfile','-NonInteractive','-File',$shimmed,'-Version','v9.9.9-test') `
                                  -WorkingDirectory $tmp `
                                  -NoNewWindow -Wait -PassThru `
                                  -RedirectStandardOutput $stdoutPath `
                                  -RedirectStandardError  $stderrPath
            $proc.ExitCode | Should -Be 0
        } finally {
            foreach ($k in $envKeys) {
                [Environment]::SetEnvironmentVariable($k, $envBackup[$k], 'Process')
            }
        }
        # Default-path assertion: dashboard.env written at $HOME\.dashboard-release.
        Test-Path -LiteralPath $script:defaultEnvFile | Should -BeTrue
        # CWD-anchored anti-assertion: nothing landed at $tmp\dashboard-release.
        Test-Path -LiteralPath (Join-Path $tmp 'dashboard-release') | Should -BeFalse
        # Belt-and-suspenders: compose calls reference the default env-file path.
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

    It 'volume present + no env-file -> fail-fast with red error, no side effects' {
        # Default install path (no -InstallDir). Force the volume probe to "exists".
        # Pre-condition: defaultEnvFile must NOT exist; if a previous run on the
        # real machine left one, the safety net is moot. The BeforeEach snapshot
        # handles restoration; here we ensure the file is absent before the call.
        if (Test-Path -LiteralPath $script:defaultEnvFile) {
            Remove-Item -LiteralPath $script:defaultEnvFile -Force
        }
        $shimmed = New-ShimmedScript -TmpDir $tmp
        $log = Join-Path $tmp 'script.log'
        $stdoutPath = Join-Path $tmp 'stdout.txt'
        $stderrPath = Join-Path $tmp 'stderr.txt'
        $envBackup = @{}
        $envKeys = @('GHA_TOKEN','DASHBOARD_API_TOKEN','DD_SCRIPT_LOG','DD_IWR_HEALTH_OK','DD_VOLUME_EXISTS')
        foreach ($k in $envKeys) { $envBackup[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
        try {
            foreach ($k in $envKeys) { [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
            [Environment]::SetEnvironmentVariable('DD_SCRIPT_LOG', $log, 'Process')
            [Environment]::SetEnvironmentVariable('DD_IWR_HEALTH_OK', 'true', 'Process')
            [Environment]::SetEnvironmentVariable('DD_VOLUME_EXISTS', 'true', 'Process')
            # -Empty: volume guard only fires in non-demo mode (SA pin S8 skips guard in demo).
            $proc = Start-Process -FilePath 'pwsh' `
                                  -ArgumentList @('-NoProfile','-NonInteractive','-File',$shimmed,'-Version','v9.9.9-test','-Empty') `
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
        $stdout = if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Raw } else { '' }
        $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
        $combined = "$stdout`n$stderr"
        $exit | Should -Be 1
        $combined | Should -Match 'Pre-existing Postgres volume detected'
        # No side effects: no env-file written, no compose pull, no gh release download.
        Test-Path -LiteralPath $script:defaultEnvFile | Should -BeFalse
        $events = @()
        if (Test-Path $log) {
            foreach ($l in Get-Content $log) {
                if ($l -match '\S') { $events += ($l | ConvertFrom-Json) }
            }
        }
        ($events | Where-Object {
            $_.event -eq 'docker' -and ([object[]]$_.args)[0] -eq 'compose' -and (([object[]]$_.args) -contains 'pull')
        }).Count | Should -Be 0
        ($events | Where-Object {
            $_.event -eq 'gh' -and ([object[]]$_.args)[0] -eq 'release'
        }).Count | Should -Be 0
    }

    It 'volume absent + no env-file -> happy path (guard not triggered)' {
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ DD_VOLUME_EXISTS = 'false' }
        $r.ExitCode | Should -Be 0
        Test-Path $r.EnvFile | Should -BeTrue
        "$($r.Stdout)`n$($r.Stderr)" | Should -Not -Match 'Pre-existing Postgres volume detected'
    }

    It 'volume present + env-file present -> happy path (guard not triggered, secrets reused)' {
        # Seed a valid env-file so the safety-net precondition is bypassed.
        # Use -Empty so the volume guard runs (SA pin S8: guard skipped in demo mode).
        $apiTok = 'a' * 64
        $pgPw   = 'c' * 32
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "API_TOKEN=$apiTok`nPOSTGRES_PASSWORD=$pgPw" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-Empty') `
                            -EnvOverrides @{ DD_VOLUME_EXISTS = 'true' }
        $r.ExitCode | Should -Be 0
        # Secrets reused (no regeneration log line for these two).
        $r.Stdout | Should -Match 'Reusing API_TOKEN'
        $r.Stdout | Should -Match 'Reusing POSTGRES_PASSWORD'
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match "(?m)^API_TOKEN=$apiTok$"
        $envContent | Should -Match "(?m)^POSTGRES_PASSWORD=$pgPw$"
    }

    It 'demo re-run (no flag) preserves existing GHA_REPOSITORIES' {
        # Seed env-file with operator-customised repo list + valid secrets so
        # the secret block reuses them and doesn't shift our attention.
        # No -Demo on the re-run -- the no-flag default IS the demo path now.
        $apiTok = 'a' * 64
        $pgPw   = 'c' * 32
        $customRepos = '[{"owner":"custom","repo":"thing"}]'
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "API_TOKEN=$apiTok`nPOSTGRES_PASSWORD=$pgPw`nGHA_REPOSITORIES=$customRepos" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^GHA_REPOSITORIES=\[\{"owner":"custom","repo":"thing"\}\]$'
        $envContent | Should -Not -Match 'demo-org.*web-portal'
        $r.Stdout | Should -Match 'Preserving GHA_REPOSITORIES'
    }

    It 'demo re-run (no flag) preserves existing FETCHER_POLL_INTERVAL_SECONDS' {
        $apiTok = 'a' * 64
        $pgPw   = 'c' * 32
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "API_TOKEN=$apiTok`nPOSTGRES_PASSWORD=$pgPw`nFETCHER_POLL_INTERVAL_SECONDS=120" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^FETCHER_POLL_INTERVAL_SECONDS=120$'
        # The new demo default is 5 s; the preserved operator value (120) must win.
        $envContent | Should -Not -Match '(?m)^FETCHER_POLL_INTERVAL_SECONDS=5$'
        $r.Stdout | Should -Match 'Preserving FETCHER_POLL_INTERVAL_SECONDS'
    }

    It 'demo re-run (no flag) preserves existing GHA_TOKEN when $env:GHA_TOKEN unset' {
        $apiTok = 'a' * 64
        $pgPw   = 'c' * 32
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "API_TOKEN=$apiTok`nPOSTGRES_PASSWORD=$pgPw`nGHA_TOKEN=ghp_existing" `
                    -Encoding utf8
        # No $env:GHA_TOKEN override -- Invoke-Install zeroes the env list, so
        # GHA_TOKEN is unset in the subprocess.
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^GHA_TOKEN=ghp_existing$'
        $r.Stdout | Should -Match 'Preserving GHA_TOKEN'
    }

    It '-ResetDemoDefaults re-applies hard-coded demo defaults (6 demo-org repos at 5 s poll)' {
        $apiTok = 'a' * 64
        $pgPw   = 'c' * 32
        $customRepos = '[{"owner":"custom","repo":"thing"}]'
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "API_TOKEN=$apiTok`nPOSTGRES_PASSWORD=$pgPw`nGHA_REPOSITORIES=$customRepos`nFETCHER_POLL_INTERVAL_SECONDS=120" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-ResetDemoDefaults')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Match '(?m)^GHA_REPOSITORIES=.*demo-org.*web-portal.*api-gateway.*auth-service.*billing-service.*notification-worker.*analytics-pipeline'
        $envContent | Should -Match '(?m)^FETCHER_POLL_INTERVAL_SECONDS=5$'
        $envContent | Should -Not -Match 'custom.*thing'
        $r.Stdout | Should -Not -Match 'Preserving GHA_REPOSITORIES'
        $r.Stdout | Should -Not -Match 'Preserving FETCHER_POLL_INTERVAL_SECONDS'
    }

    It 'demo re-run preserves persisted GHA_TOKEN even when $env:GHA_TOKEN differs (demo upstream ignores Authorization header)' {
        # Per CR-0013 + install.ps1 § 4 demo-mode block: GHA_TOKEN is preserved
        # on demo upgrade-re-run so a later switch back to -RealGha keeps the
        # operator's PAT. The demo-gha upstream never sees the Authorization
        # header, so $env:GHA_TOKEN does NOT rotate the persisted value on the
        # demo path. (Caller wanting to drop the persisted token uses
        # -ResetDemoDefaults; caller wanting to use the env value points at
        # -RealGha instead.)
        $apiTok = 'a' * 64
        $pgPw   = 'c' * 32
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "API_TOKEN=$apiTok`nPOSTGRES_PASSWORD=$pgPw`nGHA_TOKEN=ghp_old" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test') `
                            -EnvOverrides @{ GHA_TOKEN = 'ghp_new' }
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        # Persisted token wins on the demo path.
        $envContent | Should -Match '(?m)^GHA_TOKEN=ghp_old$'
        $envContent | Should -Not -Match '(?m)^GHA_TOKEN=ghp_new$'
        $r.Stdout | Should -Match 'Preserving GHA_TOKEN'
    }

    It '-ResetDemoDefaults drops the persisted GHA_TOKEN on demo re-run' {
        # The escape hatch -- pass -ResetDemoDefaults to clear out the
        # persisted GHA_TOKEN (e.g. when migrating from a stale RealGha install
        # to the demo default and the operator wants the token off-disk).
        $apiTok = 'a' * 64
        $pgPw   = 'c' * 32
        Set-Content -Path (Join-Path $tmp 'dashboard.env') `
                    -Value "API_TOKEN=$apiTok`nPOSTGRES_PASSWORD=$pgPw`nGHA_TOKEN=ghp_existing" `
                    -Encoding utf8
        $r = Invoke-Install -TmpDir $tmp `
                            -Args @('-InstallDir',$tmp,'-Version','v9.9.9-test','-ResetDemoDefaults')
        $r.ExitCode | Should -Be 0
        $envContent = Get-Content $r.EnvFile -Raw
        $envContent | Should -Not -Match '(?m)^GHA_TOKEN='
    }
}
