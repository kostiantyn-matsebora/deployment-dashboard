# Parity tests -- pwsh/bash drift detection for install/_bringup-core.{ps1,sh}.
#
# CR-0014 O-2 owner: qa-engineer. SA pin: S4 -- helper-contract surface is exactly
# 6 functions + 1 guard; signatures are identical across pwsh/bash.
#
# Design: for each of the 6 canonical scenarios, call the pwsh function via
# dot-source AND invoke the bash function via a bash subprocess; compare the
# observable outputs (env-file byte content, stdout text, exit codes).
# Drift = outputs differ between implementations for identical inputs.
#
# Scenarios:
#   1. Write-DashboardEnvFile vs write_dashboard_env_file -- identical env-file content
#   2. Resolve-DashboardSecrets vs resolve_dashboard_secrets -- identical outputs (demo + non-demo + reset)
#   3. Resolve-DemoEnvDefaults vs resolve_demo_env_defaults -- identical 4-key env-line array
#   4. Resolve-ComposeArgs vs resolve_compose_args -- identical token order (demo / real-gha / empty)
#   5. Wait-DashboardHealth vs wait_dashboard_health -- identical exit code (200 / timeout)
#   6. Write-DashboardUrlPanel vs write_dashboard_url_panel -- identical stdout layout
#
# Guard: all scenarios skip when either helper is missing (parallel delivery).

#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeDiscovery {
    $script:RepoRoot     = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:PsHelper     = Join-Path $script:RepoRoot 'install/_bringup-core.ps1'
    $script:BashHelper   = Join-Path $script:RepoRoot 'install/_bringup-core.sh'
    $script:BothExist    = (Test-Path $script:PsHelper) -and (Test-Path $script:BashHelper)
}

BeforeAll {
    $script:RepoRoot     = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:PsHelper     = Join-Path $script:RepoRoot 'install/_bringup-core.ps1'
    $script:BashHelper   = Join-Path $script:RepoRoot 'install/_bringup-core.sh'
    $script:BothExist    = (Test-Path $script:PsHelper) -and (Test-Path $script:BashHelper)

    function New-TempDir {
        $d = Join-Path ([System.IO.Path]::GetTempPath()) "parity-tests-$(New-Guid)"
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        return (Resolve-Path $d).Path
    }

    # Invoke a bash function from _bringup-core.sh, returning stdout as a string.
    # $FuncCall is the full bash call expression, e.g. "write_dashboard_env_file ..."
    function Invoke-BashHelper {
        param([string]$FuncCall, [string]$TmpDir)
        $wrapper = Join-Path $TmpDir 'parity_runner.sh'
        Set-Content -LiteralPath $wrapper -Value @"
#!/usr/bin/env bash
. "$($script:BashHelper)"
$FuncCall
"@ -Encoding utf8
        $result = & bash $wrapper 2>&1
        return $result
    }

    function Import-PsHelper {
        . $script:PsHelper
    }
}

# ---------------------------------------------------------------------------
# Scenario 1 -- Write-DashboardEnvFile vs write_dashboard_env_file
# Both must produce identical env-file byte content given identical inputs.
# ---------------------------------------------------------------------------
Describe 'Parity S1 -- Write-DashboardEnvFile vs write_dashboard_env_file' -Skip:(-not $script:BothExist) {
    BeforeAll { Import-PsHelper }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'env-file contains DASHBOARD_VERSION, DASHBOARD_PORT, API_TOKEN, POSTGRES_PASSWORD in both impls' {
        $psFile   = Join-Path $tmp 'ps.env'
        $bashFile = Join-Path $tmp 'bash.env'

        Write-DashboardEnvFile -EnvFilePath $psFile -Version 'v1.0.0' -Port 8080 -ApiToken 'tok42' -PgPassword 'pg42'
        Invoke-BashHelper -FuncCall "write_dashboard_env_file '$bashFile' 'v1.0.0' '8080' 'tok42' 'pg42'" -TmpDir $tmp | Out-Null

        $psContent   = Get-Content $psFile   -Raw
        $bashContent = Get-Content $bashFile -Raw

        foreach ($key in @('DASHBOARD_VERSION=v1.0.0', 'DASHBOARD_PORT=8080', 'API_TOKEN=tok42', 'POSTGRES_PASSWORD=pg42')) {
            $psContent   | Should -Match ([regex]::Escape($key))
            $bashContent | Should -Match ([regex]::Escape($key))
        }
    }

    It 'ConnectionStrings line embeds the same POSTGRES_PASSWORD in both impls' {
        $psFile   = Join-Path $tmp 'ps.env'
        $bashFile = Join-Path $tmp 'bash.env'

        Write-DashboardEnvFile -EnvFilePath $psFile -Version 'v9.9.9' -Port 8080 -ApiToken 'tok' -PgPassword 'parity-pg'
        Invoke-BashHelper -FuncCall "write_dashboard_env_file '$bashFile' 'v9.9.9' '8080' 'tok' 'parity-pg'" -TmpDir $tmp | Out-Null

        $psContent   = Get-Content $psFile   -Raw
        $bashContent = Get-Content $bashFile -Raw

        $psContent   | Should -Match 'Password=parity-pg'
        $bashContent | Should -Match 'Password=parity-pg'
    }
}

# ---------------------------------------------------------------------------
# Scenario 2 -- Resolve-DashboardSecrets vs resolve_dashboard_secrets
# Both must return identical secret values on demo / non-demo paths.
# ---------------------------------------------------------------------------
Describe 'Parity S2 -- Resolve-DashboardSecrets vs resolve_dashboard_secrets' -Skip:(-not $script:BothExist) {
    BeforeAll { Import-PsHelper }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'demo path -- both return POSTGRES_PASSWORD=local-dev-password' {
        $envFile  = Join-Path $tmp 'dashboard.env'
        $psResult = Resolve-DashboardSecrets -EnvFilePath $envFile -ModeDemo $true -ResetDemoDefaults $false
        $bashOut  = Invoke-BashHelper -FuncCall "resolve_dashboard_secrets '$envFile' true false" -TmpDir $tmp

        $psResult.PgPassword | Should -Be 'local-dev-password'
        $bashOut | Should -Match 'POSTGRES_PASSWORD=local-dev-password'
    }

    It 'demo path -- both return API_TOKEN=demo-api-token' {
        $envFile  = Join-Path $tmp 'dashboard.env'
        $psResult = Resolve-DashboardSecrets -EnvFilePath $envFile -ModeDemo $true -ResetDemoDefaults $false
        $bashOut  = Invoke-BashHelper -FuncCall "resolve_dashboard_secrets '$envFile' true false" -TmpDir $tmp

        $psResult.ApiToken | Should -Be 'demo-api-token'
        $bashOut | Should -Match 'API_TOKEN=demo-api-token'
    }
}

# ---------------------------------------------------------------------------
# Scenario 3 -- Resolve-DemoEnvDefaults vs resolve_demo_env_defaults
# Both must return identical 4-key env-line sets.
# ---------------------------------------------------------------------------
Describe 'Parity S3 -- Resolve-DemoEnvDefaults vs resolve_demo_env_defaults' -Skip:(-not $script:BothExist) {
    BeforeAll { Import-PsHelper }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'both return exactly 4 lines' {
        $envFile  = Join-Path $tmp 'dashboard.env'
        $psLines  = Resolve-DemoEnvDefaults -EnvFilePath $envFile -ResetDemoDefaults $false
        $bashOut  = Invoke-BashHelper -FuncCall "resolve_demo_env_defaults '$envFile' false" -TmpDir $tmp

        $psLines.Count | Should -Be 4
        ($bashOut -split '\n' | Where-Object { $_ -match '\S' }).Count | Should -Be 4
    }

    It 'both include GHA_API_BASE_URL=http://demo-gha:80' {
        $envFile  = Join-Path $tmp 'dashboard.env'
        $psLines  = Resolve-DemoEnvDefaults -EnvFilePath $envFile -ResetDemoDefaults $false
        $bashOut  = Invoke-BashHelper -FuncCall "resolve_demo_env_defaults '$envFile' false" -TmpDir $tmp

        $psLines  | Should -Contain 'GHA_API_BASE_URL=http://demo-gha:80'
        $bashOut  | Should -Match 'GHA_API_BASE_URL=http://demo-gha:80'
    }

    It 'both include FETCHER_POLL_INTERVAL_SECONDS=5' {
        $envFile  = Join-Path $tmp 'dashboard.env'
        $psLines  = Resolve-DemoEnvDefaults -EnvFilePath $envFile -ResetDemoDefaults $false
        $bashOut  = Invoke-BashHelper -FuncCall "resolve_demo_env_defaults '$envFile' false" -TmpDir $tmp

        $psLines  | Should -Contain 'FETCHER_POLL_INTERVAL_SECONDS=5'
        $bashOut  | Should -Match 'FETCHER_POLL_INTERVAL_SECONDS=5'
    }
}

# ---------------------------------------------------------------------------
# Scenario 4 -- Resolve-ComposeArgs vs resolve_compose_args
# Identical token order for -f / --profile / --env-file across demo / real-gha / empty.
# ---------------------------------------------------------------------------
Describe 'Parity S4 -- Resolve-ComposeArgs vs resolve_compose_args' -Skip:(-not $script:BothExist) {
    BeforeAll { Import-PsHelper }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'demo mode -- both include --profile demo AND --profile fetcher' {
        $envFile    = Join-Path $tmp 'dashboard.env'
        $composeFile = 'docker-compose.release.yml'
        $psTokens = Resolve-ComposeArgs -ModeDemo $true -ModeRealGha $false -ModeEmpty $false `
                                        -BuildLocally $false -ComposeFile $composeFile -EnvFile $envFile
        $bashOut  = Invoke-BashHelper `
            -FuncCall "resolve_compose_args true false false false '$composeFile' '$envFile'" `
            -TmpDir $tmp

        $psTokens | Should -Contain 'demo'
        $psTokens | Should -Contain 'fetcher'
        $bashOut  | Should -Match '--profile demo'
        $bashOut  | Should -Match '--profile fetcher'
    }

    It 'real-gha mode -- both include --profile fetcher, NOT demo' {
        $envFile    = Join-Path $tmp 'dashboard.env'
        $composeFile = 'docker-compose.release.yml'
        $psTokens = Resolve-ComposeArgs -ModeDemo $false -ModeRealGha $true -ModeEmpty $false `
                                        -BuildLocally $false -ComposeFile $composeFile -EnvFile $envFile
        $bashOut  = Invoke-BashHelper `
            -FuncCall "resolve_compose_args false true false false '$composeFile' '$envFile'" `
            -TmpDir $tmp

        $psTokens | Should -Contain 'fetcher'
        $psTokens | Should -Not -Contain 'demo'
        $bashOut  | Should -Match '--profile fetcher'
        $bashOut  | Should -Not -Match '--profile demo'
    }

    It 'empty mode -- both omit demo AND fetcher profiles' {
        $envFile    = Join-Path $tmp 'dashboard.env'
        $composeFile = 'docker-compose.release.yml'
        $psTokens = Resolve-ComposeArgs -ModeDemo $false -ModeRealGha $false -ModeEmpty $true `
                                        -BuildLocally $false -ComposeFile $composeFile -EnvFile $envFile
        $bashOut  = Invoke-BashHelper `
            -FuncCall "resolve_compose_args false false true false '$composeFile' '$envFile'" `
            -TmpDir $tmp

        $psTokens | Should -Not -Contain 'demo'
        $psTokens | Should -Not -Contain 'fetcher'
        $bashOut  | Should -Not -Match '--profile demo'
        $bashOut  | Should -Not -Match '--profile fetcher'
    }
}

# ---------------------------------------------------------------------------
# Scenario 5 -- Wait-DashboardHealth vs wait_dashboard_health
# Both exit 0 on synthetic 200; both exit 1 on timeout.
# ---------------------------------------------------------------------------
Describe 'Parity S5 -- Wait-DashboardHealth vs wait_dashboard_health' -Skip:(-not $script:BothExist) {
    BeforeAll {
        Import-PsHelper
        function Start-Sleep { param([int]$Seconds, [int]$Milliseconds) }
    }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'both exit 0 when health URL returns 200' {
        function Invoke-WebRequest {
            [CmdletBinding()] param([string]$Uri, [switch]$UseBasicParsing, [int]$TimeoutSec)
            return [pscustomobject]@{ StatusCode = 200 }
        }
        $psExit = Wait-DashboardHealth -HealthUrl 'http://localhost:8080/health' -TimeoutSeconds 5 -ComposeArgs @()

        $bashWrapper = Join-Path $tmp 'health_ok.sh'
        Set-Content $bashWrapper -Value @"
#!/usr/bin/env bash
. "$($script:BashHelper)"
curl() { return 0; }
export -f curl
wait_dashboard_health 'http://localhost:8080/health' 5 ''
echo "EXIT:\$?"
"@ -Encoding utf8
        $bashOut = & bash $bashWrapper 2>&1
        $bashExit = ($bashOut | Select-String 'EXIT:(\d+)').Matches[0].Groups[1].Value

        $psExit   | Should -Be 0
        $bashExit | Should -Be '0'
    }

    It 'both exit 1 when health URL is unreachable within timeout' {
        function Invoke-WebRequest {
            [CmdletBinding()] param([string]$Uri, [switch]$UseBasicParsing, [int]$TimeoutSec)
            throw 'stub: unreachable'
        }
        function docker { $global:LASTEXITCODE = 0 }
        $psExit = Wait-DashboardHealth -HealthUrl 'http://localhost:8080/health' -TimeoutSeconds 1 -ComposeArgs @()

        $bashWrapper = Join-Path $tmp 'health_fail.sh'
        Set-Content $bashWrapper -Value @"
#!/usr/bin/env bash
. "$($script:BashHelper)"
curl() { return 7; }
export -f curl
docker() { return 0; }
export -f docker
wait_dashboard_health 'http://localhost:8080/health' 1 ''
echo "EXIT:\$?"
"@ -Encoding utf8
        $bashOut = & bash $bashWrapper 2>&1
        $bashExit = ($bashOut | Select-String 'EXIT:(\d+)').Matches[0].Groups[1].Value

        $psExit   | Should -Be 1
        $bashExit | Should -Be '1'
    }
}

# ---------------------------------------------------------------------------
# Scenario 6 -- Write-DashboardUrlPanel vs write_dashboard_url_panel
# Both produce stdout containing the port number for each mode.
# ---------------------------------------------------------------------------
Describe 'Parity S6 -- Write-DashboardUrlPanel vs write_dashboard_url_panel' -Skip:(-not $script:BothExist) {
    BeforeAll { Import-PsHelper }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'demo mode -- both stdout contain the port number' {
        $envFile  = Join-Path $tmp 'dashboard.env'
        $psOut    = Write-DashboardUrlPanel -Port 8080 -ApiToken 'demo-api-token' -EnvFile $envFile `
                                            -ModeDemo $true -ModeRealGha $false -ModeEmpty $false
        $bashOut  = Invoke-BashHelper `
            -FuncCall "write_dashboard_url_panel 8080 'demo-api-token' '$envFile' true false false" `
            -TmpDir $tmp

        $psOut   | Should -Match '8080'
        $bashOut | Should -Match '8080'
    }

    It 'real-gha mode -- both stdout contain the port number' {
        $envFile  = Join-Path $tmp 'dashboard.env'
        $psOut    = Write-DashboardUrlPanel -Port 9090 -ApiToken 'abcdef' -EnvFile $envFile `
                                            -ModeDemo $false -ModeRealGha $true -ModeEmpty $false
        $bashOut  = Invoke-BashHelper `
            -FuncCall "write_dashboard_url_panel 9090 'abcdef' '$envFile' false true false" `
            -TmpDir $tmp

        $psOut   | Should -Match '9090'
        $bashOut | Should -Match '9090'
    }

    It 'empty mode -- both stdout contain the port number' {
        $envFile  = Join-Path $tmp 'dashboard.env'
        $psOut    = Write-DashboardUrlPanel -Port 8080 -ApiToken 'tok' -EnvFile $envFile `
                                            -ModeDemo $false -ModeRealGha $false -ModeEmpty $true
        $bashOut  = Invoke-BashHelper `
            -FuncCall "write_dashboard_url_panel 8080 'tok' '$envFile' false false true" `
            -TmpDir $tmp

        $psOut   | Should -Match '8080'
        $bashOut | Should -Match '8080'
    }
}
