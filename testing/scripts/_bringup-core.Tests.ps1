# Tests for install/_bringup-core.ps1 -- six-function helper contract + guard helper.
#
# CR-0014 § 3b -- frozen signature table. QA asserts the surface; devops authors the impl.
# Parity coverage against _bringup-core.bats enforces O-2 pwsh/bash drift detection.
#
# Strategy: subprocess invocation of a thin pwsh wrapper that dot-sources the helper
# and calls each function, capturing stdout/exit code. This avoids scope-propagation
# issues with dot-source inside Pester's It blocks.
#
# Helper-existence guard: every Describe block skips if the helper is not yet present.

#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeDiscovery {
    $script:RepoRoot   = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:HelperPath = Join-Path $script:RepoRoot 'install/_bringup-core.ps1'
    $script:HelperExists = Test-Path $script:HelperPath
}

BeforeAll {
    $script:RepoRoot   = (Resolve-Path "$PSScriptRoot/../..").Path
    $script:HelperPath = Join-Path $script:RepoRoot 'install/_bringup-core.ps1'
    $script:HelperExists = Test-Path $script:HelperPath

    function New-TempDir {
        $d = Join-Path ([System.IO.Path]::GetTempPath()) "bringup-core-tests-$(New-Guid)"
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        return (Resolve-Path $d).Path
    }

    # Invoke a function from the helper by running a one-shot pwsh subprocess that
    # dot-sources the helper then executes $Expr. Returns @{ExitCode; Stdout; Stderr}.
    function Invoke-HelperFunc {
        param([string]$Expr, [string]$TmpDir)
        $wrapper = Join-Path $TmpDir 'runner.ps1'
        Set-Content -LiteralPath $wrapper -Value @"
`$ErrorActionPreference = 'Stop'
. `"$($script:HelperPath)`"
# Suppress Start-Sleep so health-poll ticks fast.
function Start-Sleep { param([int]`$Seconds,[int]`$Milliseconds) }
$Expr
"@ -Encoding utf8
        $stdoutPath = Join-Path $TmpDir 'stdout.txt'
        $stderrPath = Join-Path $TmpDir 'stderr.txt'
        $proc = Start-Process -FilePath 'pwsh' `
            -ArgumentList @('-NoProfile','-NonInteractive','-File',$wrapper) `
            -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError  $stderrPath
        return [pscustomobject]@{
            ExitCode = $proc.ExitCode
            Stdout   = if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Raw } else { '' }
            Stderr   = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
        }
    }
}

# ---------------------------------------------------------------------------
# Function 1 -- Write-DashboardEnvFile
# CR-0014 § 3b row 1.
# ---------------------------------------------------------------------------
Describe 'Write-DashboardEnvFile -- env-file generation' -Skip:(-not $script:HelperExists) {
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'writes VERSION, PORT, API_TOKEN, POSTGRES_PASSWORD lines' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "Write-DashboardEnvFile -EnvFilePath '$envFile' -Version 'v1.2.3' -Port 8080 -ApiToken 'test-token-abc' -PgPassword 'test-pg-password'"
        Invoke-HelperFunc -Expr $expr -TmpDir $tmp | Out-Null
        $content = Get-Content $envFile -Raw
        $content | Should -Match '(?m)^DASHBOARD_VERSION=v1\.2\.3$'
        $content | Should -Match '(?m)^DASHBOARD_PORT=8080$'
        $content | Should -Match '(?m)^API_TOKEN=test-token-abc$'
        $content | Should -Match '(?m)^POSTGRES_PASSWORD=test-pg-password$'
    }

    It 'writes ConnectionStrings with the same POSTGRES_PASSWORD value' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "Write-DashboardEnvFile -EnvFilePath '$envFile' -Version 'v9.9.9' -Port 8080 -ApiToken 'tok' -PgPassword 'pg-secret-42'"
        Invoke-HelperFunc -Expr $expr -TmpDir $tmp | Out-Null
        $content = Get-Content $envFile -Raw
        $content | Should -Match '(?m)^ConnectionStrings__DefaultConnection=.*Password=pg-secret-42'
    }

    It 'appends DemoLines[] when supplied' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "Write-DashboardEnvFile -EnvFilePath '$envFile' -Version 'v1.0.0' -Port 8080 -ApiToken 'tok' -PgPassword 'pg' -DemoLines @('GHA_API_BASE_URL=http://demo-gha:80','FETCHER_POLL_INTERVAL_SECONDS=5')"
        Invoke-HelperFunc -Expr $expr -TmpDir $tmp | Out-Null
        $content = Get-Content $envFile -Raw
        $content | Should -Match '(?m)^GHA_API_BASE_URL=http://demo-gha:80$'
        $content | Should -Match '(?m)^FETCHER_POLL_INTERVAL_SECONDS=5$'
    }
}

# ---------------------------------------------------------------------------
# Function 2 -- Resolve-DashboardSecrets
# CR-0014 § 3b row 2 + § 3c.
# ---------------------------------------------------------------------------
Describe 'Resolve-DashboardSecrets -- secret handling' -Skip:(-not $script:HelperExists) {
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'demo path -- returns PgPassword=local-dev-password (CR-0014 § 3c)' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "`$r = Resolve-DashboardSecrets -EnvFilePath '$envFile' -ModeDemo `$true -ResetDemoDefaults `$false; Write-Output `$r.PgPassword"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        # Write-Host status lines also land in stdout when redirected; extract last non-empty line.
        $lastLine = ($result.Stdout -split '\r?\n' | Where-Object { $_ -ne '' } | Select-Object -Last 1)
        $lastLine | Should -Be 'local-dev-password'
    }

    It 'demo path -- returns ApiToken=demo-api-token (CR-0014 § 3c)' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "`$r = Resolve-DashboardSecrets -EnvFilePath '$envFile' -ModeDemo `$true -ResetDemoDefaults `$false; Write-Output `$r.ApiToken"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        # Write-Host status lines also land in stdout when redirected; extract last non-empty line.
        $lastLine = ($result.Stdout -split '\r?\n' | Where-Object { $_ -ne '' } | Select-Object -Last 1)
        $lastLine | Should -Be 'demo-api-token'
    }

    It 'non-demo path -- generates random hex PgPassword (not fixed literal)' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "`$r = Resolve-DashboardSecrets -EnvFilePath '$envFile' -ModeDemo `$false -ResetDemoDefaults `$false; Write-Output `$r.PgPassword"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        # Write-Host status lines also land in stdout when redirected; extract last non-empty line.
        $pw = ($result.Stdout -split '\r?\n' | Where-Object { $_ -ne '' } | Select-Object -Last 1)
        $pw | Should -Match '^[0-9a-f]+'
        $pw | Should -Not -Be 'local-dev-password'
    }

    It 'non-demo path -- generates ApiToken of >=32 chars (not fixed demo literal)' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "`$r = Resolve-DashboardSecrets -EnvFilePath '$envFile' -ModeDemo `$false -ResetDemoDefaults `$false; Write-Output `$r.ApiToken"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $tok = $result.Stdout.Trim()
        $tok.Length | Should -BeGreaterOrEqual 32
        $tok | Should -Not -Be 'demo-api-token'
    }
}

# ---------------------------------------------------------------------------
# Function 3 -- Resolve-DemoEnvDefaults
# CR-0014 § 3b row 3: returns env-line array including 4 key-value lines.
# Note: helper emits comment + blank lines too; assert presence of required keys.
# ---------------------------------------------------------------------------
Describe 'Resolve-DemoEnvDefaults -- demo env-var seeding' -Skip:(-not $script:HelperExists) {
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'includes GHA_API_BASE_URL=http://demo-gha:80' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "(Resolve-DemoEnvDefaults -EnvFilePath '$envFile' -ResetDemoDefaults `$false) -join [char]10"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.Stdout | Should -Match 'GHA_API_BASE_URL=http://demo-gha:80'
    }

    It 'includes FETCHER_POLL_INTERVAL_SECONDS=5' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "(Resolve-DemoEnvDefaults -EnvFilePath '$envFile' -ResetDemoDefaults `$false) -join [char]10"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.Stdout | Should -Match 'FETCHER_POLL_INTERVAL_SECONDS=5'
    }

    It 'includes GHA_REPOSITORIES with demo-org repos' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "(Resolve-DemoEnvDefaults -EnvFilePath '$envFile' -ResetDemoDefaults `$false) -join [char]10"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.Stdout | Should -Match 'GHA_REPOSITORIES=.*demo-org.*web-portal'
    }

    It '-ResetDemoDefaults=$true forces demo defaults even when pre-existing env-file has custom values' {
        $envFile = Join-Path $tmp 'dashboard.env'
        Set-Content $envFile -Value "GHA_REPOSITORIES=custom`nFETCHER_POLL_INTERVAL_SECONDS=120" -Encoding utf8
        $expr = "(Resolve-DemoEnvDefaults -EnvFilePath '$envFile' -ResetDemoDefaults `$true) -join [char]10"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.Stdout | Should -Match 'FETCHER_POLL_INTERVAL_SECONDS=5'
        $result.Stdout | Should -Not -Match 'FETCHER_POLL_INTERVAL_SECONDS=120'
    }
}

# ---------------------------------------------------------------------------
# Function 4 -- Resolve-ComposeArgs
# CR-0014 § 3b row 4.
# ---------------------------------------------------------------------------
Describe 'Resolve-ComposeArgs -- compose args resolution' -Skip:(-not $script:HelperExists) {
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'demo mode -- tokens contain --profile demo AND --profile fetcher' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "(Resolve-ComposeArgs -ModeDemo `$true -ModeRealGha `$false -ModeEmpty `$false -BuildLocally `$false -ComposeFile 'docker-compose.release.yml' -EnvFile '$envFile') -join ' '"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.Stdout | Should -Match '--profile'
        $result.Stdout | Should -Match 'demo'
        $result.Stdout | Should -Match 'fetcher'
    }

    It 'real-gha mode -- tokens contain --profile fetcher but NOT demo' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "(Resolve-ComposeArgs -ModeDemo `$false -ModeRealGha `$true -ModeEmpty `$false -BuildLocally `$false -ComposeFile 'docker-compose.release.yml' -EnvFile '$envFile') -join ' '"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.Stdout | Should -Match 'fetcher'
        $result.Stdout | Should -Not -Match '\bdemo\b'
    }

    It 'empty mode -- tokens contain neither demo nor fetcher profile' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "(Resolve-ComposeArgs -ModeDemo `$false -ModeRealGha `$false -ModeEmpty `$true -BuildLocally `$false -ComposeFile 'docker-compose.release.yml' -EnvFile '$envFile') -join ' '"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.Stdout | Should -Not -Match '\bdemo\b'
        $result.Stdout | Should -Not -Match '\bfetcher\b'
    }

    It 'tokens contain -f <ComposeFile> and --env-file <EnvFile>' {
        $envFile    = Join-Path $tmp 'dashboard.env'
        $escapedEnv = $envFile.Replace('\','\\')
        $expr = "(Resolve-ComposeArgs -ModeDemo `$true -ModeRealGha `$false -ModeEmpty `$false -BuildLocally `$false -ComposeFile 'docker-compose.release.yml' -EnvFile '$envFile') -join ' '"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.Stdout | Should -Match '\-f'
        $result.Stdout | Should -Match 'docker-compose\.release\.yml'
        $result.Stdout | Should -Match '--env-file'
    }
}

# ---------------------------------------------------------------------------
# Function 5 -- Wait-DashboardHealth
# CR-0014 § 3b row 5: exits 0 on synthetic 200; non-zero (throws) on timeout.
# ---------------------------------------------------------------------------
Describe 'Wait-DashboardHealth -- health-poll' -Skip:(-not $script:HelperExists) {
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'exits 0 when IWR returns StatusCode 200' {
        $expr = @'
function Invoke-WebRequest {
    [CmdletBinding()] param([string]$Uri,[switch]$UseBasicParsing,[int]$TimeoutSec)
    return [pscustomobject]@{ StatusCode = 200 }
}
# ComposeArgs must be non-empty: [Parameter(Mandatory)][string[]] rejects @() as empty.
Wait-DashboardHealth -HealthUrl 'http://localhost:8080/health' -TimeoutSeconds 5 -ComposeArgs @('-f','docker-compose.release.yml')
'@
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.ExitCode | Should -Be 0
    }

    It 'exits non-zero when health URL is unreachable within TimeoutSeconds' {
        $expr = @'
function Invoke-WebRequest {
    [CmdletBinding()] param([string]$Uri,[switch]$UseBasicParsing,[int]$TimeoutSec)
    throw 'stub: health unreachable'
}
function docker { $global:LASTEXITCODE = 0 }
try {
    Wait-DashboardHealth -HealthUrl 'http://localhost:8080/health' -TimeoutSeconds 1 -ComposeArgs @('-f','docker-compose.release.yml')
} catch { exit 1 }
'@
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.ExitCode | Should -Be 1
    }
}

# ---------------------------------------------------------------------------
# Function 6 -- Write-DashboardUrlPanel
# CR-0014 § 3b row 6: stdout layout contains port number per mode.
# Uses Write-Host so capture via 6>&1 redirect in subprocess.
# ---------------------------------------------------------------------------
Describe 'Write-DashboardUrlPanel -- URL panel stdout' -Skip:(-not $script:HelperExists) {
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'demo mode -- stdout contains the gateway port' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "Write-DashboardUrlPanel -Port 8080 -ApiToken 'demo-api-token' -EnvFile '$envFile' -ModeDemo `$true -ModeRealGha `$false -ModeEmpty `$false"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        "$($result.Stdout)$($result.Stderr)" | Should -Match '8080'
    }

    It 'real-gha mode -- stdout contains the gateway port' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "Write-DashboardUrlPanel -Port 9090 -ApiToken 'abcdef' -EnvFile '$envFile' -ModeDemo `$false -ModeRealGha `$true -ModeEmpty `$false"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        "$($result.Stdout)$($result.Stderr)" | Should -Match '9090'
    }

    It 'empty mode -- stdout contains the gateway port' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = "Write-DashboardUrlPanel -Port 8080 -ApiToken 'tok' -EnvFile '$envFile' -ModeDemo `$false -ModeRealGha `$false -ModeEmpty `$true"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        "$($result.Stdout)$($result.Stderr)" | Should -Match '8080'
    }
}

# ---------------------------------------------------------------------------
# Guard helper -- Test-PgVolumeConflict
# CR-0014 § 3b row 7: exits 1 when volume present + no env-file; 0 otherwise.
# Note: function calls exit 1 internally (no return value); test captures process exit code.
# ---------------------------------------------------------------------------
Describe 'Test-PgVolumeConflict -- volume-detection guard' -Skip:(-not $script:HelperExists) {
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'volume absent -- process exits 0 (no conflict)' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = @'
function docker {
    $a = @($args)
    if ($a[0] -eq 'volume' -and $a[1] -eq 'inspect') { $global:LASTEXITCODE = 1; return }
    $global:LASTEXITCODE = 0
}
'@ + "`nTest-PgVolumeConflict -VolumeName 'deployment-dashboard_postgres-data' -EnvFilePath '$envFile' -InstallDir '$tmp'"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.ExitCode | Should -Be 0
    }

    It 'volume present + no env-file -- process exits 1 (conflict detected)' {
        $envFile = Join-Path $tmp 'dashboard.env'
        $expr = @'
function docker {
    $a = @($args)
    if ($a[0] -eq 'volume' -and $a[1] -eq 'inspect') {
        Write-Output '[{"Name":"deployment-dashboard_postgres-data"}]'
        $global:LASTEXITCODE = 0
        return
    }
    $global:LASTEXITCODE = 0
}
'@ + "`nTest-PgVolumeConflict -VolumeName 'deployment-dashboard_postgres-data' -EnvFilePath '$envFile' -InstallDir '$tmp'"
        $result = Invoke-HelperFunc -Expr $expr -TmpDir $tmp
        $result.ExitCode | Should -Be 1
    }
}
