# Tests for install/_bringup-core.ps1 -- six-function helper contract + guard helper.
#
# CR-0014 § 3b — frozen signature table. QA asserts the surface; devops authors the impl.
# Parity coverage against _bringup-core.bats enforces O-2 pwsh/bash drift detection.
#
# Strategy: dot-source the helper into an isolated scope; mock external calls via
# PowerShell function overrides; assert observable outputs (file content, return value,
# exit behaviour). No subprocess spawn needed -- the helper exposes pure functions.
#
# Helper-existence guard: every Describe block skips if the helper is not yet present
# on the branch (devops delivers in parallel). Surface as [skip] rows in the CI log.

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

    # Helper: create a writable temp directory, return its path.
    function New-TempDir {
        $d = Join-Path ([System.IO.Path]::GetTempPath()) "bringup-core-tests-$(New-Guid)"
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        return (Resolve-Path $d).Path
    }

    # Helper: dot-source the helper in the caller's scope so its functions become available.
    function Import-BringupCore {
        . $script:HelperPath
    }
}

# ---------------------------------------------------------------------------
# Function 1 -- Write-DashboardEnvFile
# CR-0014 § 3b row 1: writes env file from named inputs.
# ---------------------------------------------------------------------------
Describe 'Write-DashboardEnvFile -- env-file generation' -Skip:(-not $script:HelperExists) {
    BeforeAll { Import-BringupCore }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'writes VERSION, PORT, API_TOKEN, POSTGRES_PASSWORD lines' {
        $envFile = Join-Path $tmp 'dashboard.env'
        Write-DashboardEnvFile `
            -EnvFilePath  $envFile `
            -Version      'v1.2.3' `
            -Port         8080 `
            -ApiToken     'test-token-abc' `
            -PgPassword   'test-pg-password'
        $content = Get-Content $envFile -Raw
        $content | Should -Match '(?m)^DASHBOARD_VERSION=v1\.2\.3$'
        $content | Should -Match '(?m)^DASHBOARD_PORT=8080$'
        $content | Should -Match '(?m)^API_TOKEN=test-token-abc$'
        $content | Should -Match '(?m)^POSTGRES_PASSWORD=test-pg-password$'
    }

    It 'writes ConnectionStrings with the same POSTGRES_PASSWORD value' {
        $envFile = Join-Path $tmp 'dashboard.env'
        Write-DashboardEnvFile `
            -EnvFilePath  $envFile `
            -Version      'v9.9.9' `
            -Port         8080 `
            -ApiToken     'tok' `
            -PgPassword   'pg-secret-42'
        $content = Get-Content $envFile -Raw
        $content | Should -Match '(?m)^ConnectionStrings__DefaultConnection=.*Password=pg-secret-42'
    }

    It 'appends DemoLines[] when supplied' {
        $envFile = Join-Path $tmp 'dashboard.env'
        Write-DashboardEnvFile `
            -EnvFilePath  $envFile `
            -Version      'v1.0.0' `
            -Port         8080 `
            -ApiToken     'tok' `
            -PgPassword   'pg' `
            -DemoLines    @('GHA_API_BASE_URL=http://demo-gha:80', 'FETCHER_POLL_INTERVAL_SECONDS=5')
        $content = Get-Content $envFile -Raw
        $content | Should -Match '(?m)^GHA_API_BASE_URL=http://demo-gha:80$'
        $content | Should -Match '(?m)^FETCHER_POLL_INTERVAL_SECONDS=5$'
    }
}

# ---------------------------------------------------------------------------
# Function 2 -- Resolve-DashboardSecrets
# CR-0014 § 3b row 2 + § 3c: demo path returns fixed literals; non-demo generates random.
# ---------------------------------------------------------------------------
Describe 'Resolve-DashboardSecrets -- secret handling' -Skip:(-not $script:HelperExists) {
    BeforeAll { Import-BringupCore }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'demo path -- returns POSTGRES_PASSWORD=local-dev-password (CR-0014 § 3c)' {
        $result = Resolve-DashboardSecrets `
            -EnvFilePath     (Join-Path $tmp 'dashboard.env') `
            -ModeDemo        $true `
            -ResetDemoDefaults $false
        $result.PgPassword | Should -Be 'local-dev-password'
    }

    It 'demo path -- returns API_TOKEN=demo-api-token (CR-0014 § 3c)' {
        $result = Resolve-DashboardSecrets `
            -EnvFilePath     (Join-Path $tmp 'dashboard.env') `
            -ModeDemo        $true `
            -ResetDemoDefaults $false
        $result.ApiToken | Should -Be 'demo-api-token'
    }

    It 'non-demo path (ModeDemo=$false) -- generates random hex POSTGRES_PASSWORD' {
        $result = Resolve-DashboardSecrets `
            -EnvFilePath     (Join-Path $tmp 'dashboard.env') `
            -ModeDemo        $false `
            -ResetDemoDefaults $false
        $result.PgPassword | Should -Match '^[0-9a-f]+'
        $result.PgPassword | Should -Not -Be 'local-dev-password'
    }

    It 'non-demo path -- generates random hex API_TOKEN of >=32 chars' {
        $result = Resolve-DashboardSecrets `
            -EnvFilePath     (Join-Path $tmp 'dashboard.env') `
            -ModeDemo        $false `
            -ResetDemoDefaults $false
        $result.ApiToken.Length | Should -BeGreaterOrEqual 32
        $result.ApiToken | Should -Not -Be 'demo-api-token'
    }
}

# ---------------------------------------------------------------------------
# Function 3 -- Resolve-DemoEnvDefaults
# CR-0014 § 3b row 3: returns 4-key env-line array on the demo path.
# ---------------------------------------------------------------------------
Describe 'Resolve-DemoEnvDefaults -- demo env-var seeding' -Skip:(-not $script:HelperExists) {
    BeforeAll { Import-BringupCore }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'returns exactly 4 env lines' {
        $lines = Resolve-DemoEnvDefaults `
            -EnvFilePath       (Join-Path $tmp 'dashboard.env') `
            -ResetDemoDefaults $false
        $lines.Count | Should -Be 4
    }

    It 'includes GHA_API_BASE_URL=http://demo-gha:80' {
        $lines = Resolve-DemoEnvDefaults `
            -EnvFilePath       (Join-Path $tmp 'dashboard.env') `
            -ResetDemoDefaults $false
        $lines | Should -Contain 'GHA_API_BASE_URL=http://demo-gha:80'
    }

    It 'includes FETCHER_POLL_INTERVAL_SECONDS=5' {
        $lines = Resolve-DemoEnvDefaults `
            -EnvFilePath       (Join-Path $tmp 'dashboard.env') `
            -ResetDemoDefaults $false
        $lines | Should -Contain 'FETCHER_POLL_INTERVAL_SECONDS=5'
    }

    It '-ResetDemoDefaults=$true forces demo defaults even when pre-existing env-file has custom values' {
        $envFile = Join-Path $tmp 'dashboard.env'
        Set-Content $envFile -Value "GHA_REPOSITORIES=custom`nFETCHER_POLL_INTERVAL_SECONDS=120" -Encoding utf8
        $lines = Resolve-DemoEnvDefaults `
            -EnvFilePath       $envFile `
            -ResetDemoDefaults $true
        $lines | Should -Contain 'FETCHER_POLL_INTERVAL_SECONDS=5'
        # Custom value must NOT appear in the reset output
        $lines | Should -Not -Contain 'FETCHER_POLL_INTERVAL_SECONDS=120'
    }
}

# ---------------------------------------------------------------------------
# Function 4 -- Resolve-ComposeArgs
# CR-0014 § 3b row 4: returns token array with -f / --profile / --env-file in correct order.
# ---------------------------------------------------------------------------
Describe 'Resolve-ComposeArgs -- compose args resolution' -Skip:(-not $script:HelperExists) {
    BeforeAll { Import-BringupCore }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'demo mode -- tokens contain --profile demo AND --profile fetcher' {
        $tokens = Resolve-ComposeArgs `
            -ModeDemo     $true `
            -ModeRealGha  $false `
            -ModeEmpty    $false `
            -BuildLocally $false `
            -ComposeFile  'docker-compose.release.yml' `
            -EnvFile      (Join-Path $tmp 'dashboard.env')
        $tokens | Should -Contain '--profile'
        $tokens | Should -Contain 'demo'
        $tokens | Should -Contain 'fetcher'
    }

    It 'real-gha mode -- tokens contain --profile fetcher but NOT demo' {
        $tokens = Resolve-ComposeArgs `
            -ModeDemo     $false `
            -ModeRealGha  $true `
            -ModeEmpty    $false `
            -BuildLocally $false `
            -ComposeFile  'docker-compose.release.yml' `
            -EnvFile      (Join-Path $tmp 'dashboard.env')
        $tokens | Should -Contain 'fetcher'
        $tokens | Should -Not -Contain 'demo'
    }

    It 'empty mode -- tokens contain neither demo nor fetcher profile' {
        $tokens = Resolve-ComposeArgs `
            -ModeDemo     $false `
            -ModeRealGha  $false `
            -ModeEmpty    $true `
            -BuildLocally $false `
            -ComposeFile  'docker-compose.release.yml' `
            -EnvFile      (Join-Path $tmp 'dashboard.env')
        $tokens | Should -Not -Contain 'demo'
        $tokens | Should -Not -Contain 'fetcher'
    }

    It 'tokens contain -f <ComposeFile> and --env-file <EnvFile>' {
        $envFile    = Join-Path $tmp 'dashboard.env'
        $composeFile = 'docker-compose.release.yml'
        $tokens = Resolve-ComposeArgs `
            -ModeDemo     $true `
            -ModeRealGha  $false `
            -ModeEmpty    $false `
            -BuildLocally $false `
            -ComposeFile  $composeFile `
            -EnvFile      $envFile
        $tokens | Should -Contain '-f'
        $tokens | Should -Contain $composeFile
        $tokens | Should -Contain '--env-file'
        $tokens | Should -Contain $envFile
    }
}

# ---------------------------------------------------------------------------
# Function 5 -- Wait-DashboardHealth
# CR-0014 § 3b row 5: exits 0 on synthetic 200; exits 1 on timeout.
# ---------------------------------------------------------------------------
Describe 'Wait-DashboardHealth -- health-poll' -Skip:(-not $script:HelperExists) {
    BeforeAll {
        Import-BringupCore
        # Suppress the real Start-Sleep so health-poll loops complete immediately.
        function Start-Sleep { param([int]$Seconds, [int]$Milliseconds) }
    }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'exits 0 when IWR returns StatusCode 200' {
        # Override Invoke-WebRequest to return synthetic 200.
        function Invoke-WebRequest {
            [CmdletBinding()]
            param([string]$Uri, [switch]$UseBasicParsing, [int]$TimeoutSec)
            return [pscustomobject]@{ StatusCode = 200 }
        }
        $exit = Wait-DashboardHealth `
            -HealthUrl      'http://localhost:8080/health' `
            -TimeoutSeconds 5 `
            -ComposeArgs    @()
        $exit | Should -Be 0
    }

    It 'exits 1 when health URL is unreachable within TimeoutSeconds' {
        # Override Invoke-WebRequest to always throw (simulates no-response).
        function Invoke-WebRequest {
            [CmdletBinding()]
            param([string]$Uri, [switch]$UseBasicParsing, [int]$TimeoutSec)
            throw 'stub: health unreachable'
        }
        function docker { $global:LASTEXITCODE = 0 }
        $exit = Wait-DashboardHealth `
            -HealthUrl      'http://localhost:8080/health' `
            -TimeoutSeconds 1 `
            -ComposeArgs    @()
        $exit | Should -Be 1
    }
}

# ---------------------------------------------------------------------------
# Function 6 -- Write-DashboardUrlPanel
# CR-0014 § 3b row 6: stdout layout varies by mode.
# ---------------------------------------------------------------------------
Describe 'Write-DashboardUrlPanel -- URL panel stdout' -Skip:(-not $script:HelperExists) {
    BeforeAll { Import-BringupCore }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'demo mode -- stdout contains the gateway port URL' {
        $out = Write-DashboardUrlPanel `
            -Port        8080 `
            -ApiToken    'demo-api-token' `
            -EnvFile     (Join-Path $tmp 'dashboard.env') `
            -ModeDemo    $true `
            -ModeRealGha $false `
            -ModeEmpty   $false
        $out | Should -Match '8080'
    }

    It 'real-gha mode -- stdout contains the gateway port URL' {
        $out = Write-DashboardUrlPanel `
            -Port        9090 `
            -ApiToken    'abcdef' `
            -EnvFile     (Join-Path $tmp 'dashboard.env') `
            -ModeDemo    $false `
            -ModeRealGha $true `
            -ModeEmpty   $false
        $out | Should -Match '9090'
    }

    It 'empty mode -- stdout contains the gateway port URL' {
        $out = Write-DashboardUrlPanel `
            -Port        8080 `
            -ApiToken    'tok' `
            -EnvFile     (Join-Path $tmp 'dashboard.env') `
            -ModeDemo    $false `
            -ModeRealGha $false `
            -ModeEmpty   $true
        $out | Should -Match '8080'
    }
}

# ---------------------------------------------------------------------------
# Guard helper -- Test-PgVolumeConflict
# CR-0014 § 3b row 7: exits 0/1; relaxed on demo path (CR-0014 § 3c).
# ---------------------------------------------------------------------------
Describe 'Test-PgVolumeConflict -- volume-detection guard' -Skip:(-not $script:HelperExists) {
    BeforeAll {
        Import-BringupCore
        $script:VolumeName = 'deployment-dashboard_postgres-data'
    }
    BeforeEach { $script:tmp = New-TempDir }
    AfterEach  { if (Test-Path $tmp) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp } }

    It 'volume absent -- exits 0 (no conflict)' {
        function docker {
            $a = @($args)
            if ($a[0] -eq 'volume' -and $a[1] -eq 'inspect') { $global:LASTEXITCODE = 1; return }
            $global:LASTEXITCODE = 0
        }
        $exit = Test-PgVolumeConflict -VolumeNameOrDefault $script:VolumeName
        $exit | Should -Be 0
    }

    It 'volume present + no env-file -- exits 1 (non-demo: conflict)' {
        function docker {
            $a = @($args)
            if ($a[0] -eq 'volume' -and $a[1] -eq 'inspect') {
                Write-Output '[{"Name":"deployment-dashboard_postgres-data"}]'
                $global:LASTEXITCODE = 0
                return
            }
            $global:LASTEXITCODE = 0
        }
        $exit = Test-PgVolumeConflict -VolumeNameOrDefault $script:VolumeName
        $exit | Should -Be 1
    }
}
