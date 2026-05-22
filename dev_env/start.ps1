<#
.SYNOPSIS
    Bring up the Deployment Dashboard local stack. Thin wrapper: compose up -> poll /health -> print URLs.
.PARAMETER Scaled
    Use docker-compose.scaled.yml (3 Read API + 2 Write API replicas behind one gateway). NFR-05 validation only.
.PARAMETER Fetcher
    Activate the optional `fetcher` Compose profile (CR-0009 pull-mode fetcher). When set (and `-Demo` is NOT
    also set), requires `$env:GHA_TOKEN` to be non-empty unless `-AllowMissingGhaToken` is also supplied.
    Composable with `-Scaled`.
.PARAMETER Demo
    Zero-PAT demo run. Implies `-Fetcher` + `-AllowMissingGhaToken`. Sets `$env:GHA_REPOSITORIES` to a
    public-repo default (`[{"owner":"PostHog","repo":"posthog"}]`) and `$env:FETCHER_POLL_INTERVAL_SECONDS=60`
    so a fresh boot renders deployments without caller config. Mirrors `install.ps1 -Demo` for parity between
    the contributor flow and the release-install flow. When `$env:GHA_TOKEN` is set, the fetcher uses it
    (5000 req/h authed); otherwise it boots in anonymous mode (60 req/h) via the compose placeholder.
.PARAMETER AllowMissingGhaToken
    Permit `-Fetcher` to proceed when `$env:GHA_TOKEN` is unset/empty. The fetcher boots with the placeholder
    token from docker-compose.local.yml; GitHub API calls will 401. Use for boot-smoke / fetcher-code work
    that does not need real GH API access. `-Demo` implies this.
.PARAMETER Integration
    Activate the `integration` Compose profile (CR-0012). Brings up the `mock-gha` WireMock.Net container
    sibling-ing the existing stack, re-points the fetcher at `http://mock-gha:80` via `$env:GHA_API_BASE_URL`,
    tunes `$env:FETCHER_POLL_INTERVAL_SECONDS=1` so NFR-03's 5 s envelope is meaningfully oraclable, and
    seeds `$env:GHA_REPOSITORIES` to a mock-friendly default (`[{"owner":"integration-test-org","repo":"integration-test-repo"}]`). Implies
    `-Fetcher` + `-AllowMissingGhaToken` (the mock-gha service ignores Authorization headers, so a real
    PAT is irrelevant). Mutually exclusive with `-Scaled` and `-Demo`. The mock-gha admin API is host-mapped
    to localhost:18080 ONLY while this switch is active (`dev_env/docker-compose.local.yml` override) --
    NFR-04 production posture is preserved (the release-install path NEVER publishes the admin port).
.PARAMETER HealthTimeoutSeconds
    How long to wait for the gateway-fronted /health endpoint. Default 60. On failure, logs are dumped and the script exits 1.
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Fetcher
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Fetcher -AllowMissingGhaToken
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Demo
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Scaled -Fetcher
.EXAMPLE
    pwsh -NoProfile -File dev_env/start.ps1 -Integration
#>
#Requires -Version 7.0
[CmdletBinding()]
param([switch]$Scaled, [switch]$Fetcher, [switch]$Demo, [switch]$AllowMissingGhaToken, [switch]$Integration, [int]$HealthTimeoutSeconds = 60)
$ErrorActionPreference = 'Stop'
# -Integration canonicalisation (CR-0012). Block runs first so its mutual-
# exclusion guards fire before -Demo / -Fetcher precondition checks. The
# integration profile's substrate (mock-gha WireMock.Net + 1 s fetcher
# poll + http://mock-gha:80 redirect) is incompatible with the scaled
# stack (different compose file, no fetcher) and with the demo profile
# (different GHA_REPOSITORIES default + different poll cadence + real
# upstream); rather than try to reconcile the conflict at compose-merge
# time, surface the user error here.
if ($Integration) {
    if ($Scaled) {
        Write-Host "ERROR: -Integration and -Scaled are mutually exclusive. The scaled stack uses a standalone compose file (docker-compose.scaled.yml) that does not include the mock-gha integration substrate." -ForegroundColor Red
        exit 1
    }
    if ($Demo) {
        Write-Host "ERROR: -Integration and -Demo are mutually exclusive. -Demo points the fetcher at a public GitHub repo at a 60 s cadence; -Integration points it at the in-network mock-gha at a 1 s cadence. Pick one." -ForegroundColor Red
        exit 1
    }
    $Fetcher = $true
    $AllowMissingGhaToken = $true
    # Env-var seeding -- consumed by the release file's `${VAR:-default}`
    # substitutions at compose resolution time. Doing this here (rather than
    # baking literals into dev_env/docker-compose.local.yml's `mock-gha` /
    # `fetcher` blocks) keeps vanilla `start.ps1` runs unaffected by the
    # integration tuning: a contributor who omits -Integration still gets
    # the release defaults (30 s poll, https://api.github.com upstream).
    $env:GHA_API_BASE_URL = 'http://mock-gha:80'
    $env:FETCHER_POLL_INTERVAL_SECONDS = '1'
    if ([string]::IsNullOrWhiteSpace($env:GHA_REPOSITORIES)) {
        # Mock-friendly default -- mock-gha mappings under
        # testing/fixtures/gha/ key URLs by `owner=integration-test-org`,
        # `repo=integration-test-repo`. Must match testing/config/integration.json
        # `fetcherSourceIds` + qa-engineer's scenario WildcardMatcher patterns.
        $env:GHA_REPOSITORIES = '[{"owner":"integration-test-org","repo":"integration-test-repo"}]'
    }
}
if ($Demo) {
    $Fetcher = $true
    $AllowMissingGhaToken = $true
    if ([string]::IsNullOrWhiteSpace($env:GHA_REPOSITORIES)) {
        $env:GHA_REPOSITORIES = '[{"owner":"PostHog","repo":"posthog"}]'
    }
    if ([string]::IsNullOrWhiteSpace($env:FETCHER_POLL_INTERVAL_SECONDS)) {
        $env:FETCHER_POLL_INTERVAL_SECONDS = '60'
    }
}
if ($Fetcher) {
    $tokenSet = -not [string]::IsNullOrWhiteSpace($env:GHA_TOKEN)
    if (-not $tokenSet -and -not $AllowMissingGhaToken) {
        Write-Host "ERROR: -Fetcher requires `$env:GHA_TOKEN to be set. Set `$env:GHA_TOKEN = '<PAT>' or re-run with -AllowMissingGhaToken (or -Demo) to use the placeholder." -ForegroundColor Red
        exit 1
    }
    if (-not $tokenSet) {
        if ($Demo) {
            Write-Host "GHA_TOKEN not set - demo mode active, fetcher will use anonymous GitHub API (60 req/h)." -ForegroundColor Yellow
        } else {
            Write-Host "GHA_TOKEN not set - fetcher will boot with placeholder; GitHub API calls will 401." -ForegroundColor Yellow
        }
    }
}
if ($Scaled) {
    # Scaled stack (NFR-05 validation) is structurally distinct from the release
    # stack: different project name, container-name suffixes, 3-replica `api`,
    # no fetcher, no pgadmin. Kept as a standalone compose file -- NOT layered
    # on install/docker-compose.release.yml.
    $composeArgs = @('-f', (Join-Path $PSScriptRoot 'docker-compose.scaled.yml'))
} else {
    # Default contributor stack: layer dev_env deltas on the release compose so
    # installer features (env-var substitution, profile additions, image renames)
    # propagate automatically (issue #21). Order matters -- later `-f` files
    # override earlier ones.
    $releaseCompose = Join-Path $PSScriptRoot '..' 'install' 'docker-compose.release.yml'
    $localOverride  = Join-Path $PSScriptRoot 'docker-compose.local.yml'
    $composeArgs = @('-f', $releaseCompose, '-f', $localOverride)
}
if ($Fetcher) { $composeArgs += @('--profile', 'fetcher') }
if ($Integration) { $composeArgs += @('--profile', 'integration') }
Write-Host "==> docker compose $($composeArgs -join ' ') up -d --build" -ForegroundColor Cyan
& docker compose @composeArgs up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed with exit code $LASTEXITCODE" }
$healthUrl = "http://localhost:8080/health"
Write-Host "==> Waiting up to $HealthTimeoutSeconds s for $healthUrl" -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try { if ((Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch { }
    Start-Sleep -Seconds 2
}
if (-not $ok) { & docker compose @composeArgs logs --tail=50; throw "Gateway-fronted /health did not return 200 at $healthUrl within $HealthTimeoutSeconds s." }
Write-Host ""
Write-Host "  Dashboard / Gateway: http://localhost:8080/"
Write-Host "  Postgres (dev):      localhost:5432 (user: dashboard / password: local-dev-password)"
Write-Host "  pgAdmin:             http://localhost:5050/  (admin@example.com / admin)"
if ($Fetcher) {
    if ($Demo) {
        Write-Host "  Fetcher:             profile 'fetcher' active in DEMO mode - polling $env:GHA_REPOSITORIES every $env:FETCHER_POLL_INTERVAL_SECONDS s"
    } elseif ($Integration) {
        Write-Host "  Fetcher:             profile 'fetcher' active in INTEGRATION mode - polling mock-gha every $env:FETCHER_POLL_INTERVAL_SECONDS s"
    } else {
        Write-Host "  Fetcher:             profile 'fetcher' active - POSTs to gateway as dashboard-fetcher/github-actions"
    }
}
if ($Integration) {
    Write-Host "  mock-gha admin API:  http://localhost:18080/__admin/  (WireMock.Net admin -- integration profile only)"
}
Write-Host ""
Write-Host "  curl -X POST http://localhost:8080/api/deployments -H 'Content-Type: application/json' -H 'X-Api-Key: local-dev-token-not-for-production' -d '{`"service`":`"adminportal`",`"environment`":`"dev`",`"version`":`"v2.3.1`",`"status`":`"success`",`"run_url`":`"https://example.test/run/1`",`"run_number`":1,`"actor`":`"local`"}'"
