<#
.SYNOPSIS
    Install + start a released Deployment Dashboard stack on the current host.
    Image-only -- no git clone, no source tree, no .NET SDK required.
.DESCRIPTION
    Release-install primary entrypoint (Option A per GitHub issue #7).
    Per CR-0013 the no-flag default is the *demo stack* -- a self-contained
    stack with the baked `demo-gha` mock GitHub Actions upstream + fetcher
    pointing at it. Zero-PAT, zero external network, populated dashboard
    within ~60s. The companion contributor flow is `dev_env/start.ps1`,
    which depends on a cloned repo and bind-mounts the source tree for
    hot-reload / migration generation.

    Flag matrix (CR-0013):
      (no flag)            Demo stack -- demo-gha + fetcher pointing at
                           http://demo-gha:80; no GHA_TOKEN required.
      -RealGha             Real GitHub Actions upstream -- requires
                           $env:GHA_TOKEN. Renamed from `-Fetcher`; semantics
                           identical to the historical `-Fetcher` flag.
      -Empty               Bare-minimum stack -- db + api + gateway +
                           dashboard only; no fetcher, no demo-gha.
                           Direct-POST integrators only.
      -Demo                Back-compat alias for the no-flag default.
                           Silently routes + logs one INFO line. Drop the
                           flag from your install command after this
                           release cycle.

    What this script does, in order:
      1.  `GHA_TOKEN` precondition (issue #5 verbatim) -- fires only when
          `-RealGha` is set. The no-flag / `-Demo` / `-Empty` paths never
          touch real GitHub and do not require a PAT.
      2.  `gh` CLI precondition -- gh present on PATH, authenticated for github.com,
          and the active token carries the `read:packages` scope. All three failure
          modes exit 1 BEFORE any side effect (no install dir, no asset writes, no
          docker calls).
      3.  Ensures the install directory exists.
      4.  Generates / preserves `API_TOKEN` + `POSTGRES_PASSWORD` random secrets;
          persists them to `<InstallDir>/dashboard.env`. Refuses the dev-literal.
          When the demo path is active (default or `-Demo`), also bakes in the
          demo-profile env-var contract (`GHA_API_BASE_URL=http://demo-gha:80`,
          `FETCHER_POLL_INTERVAL_SECONDS=5`,
          `GHA_REPOSITORIES=[{"owner":"demo-org","repo":"demo-repo"}]`).
      5+6. Downloads `docker-compose.release.yml` via `gh release download` -- the
          repo + GHCR images are private, so anonymous HTTPS asset fetch 404s.
      7.  `docker login ghcr.io` using `gh auth token` -- required because the
          component images are private GHCR packages and anonymous pulls 401.
      8.  `docker compose pull` -- pulls the GHCR-hosted component images
          (api / fetcher / frontend / gateway, plus demo-gha when the demo
          profile is active).
      9.  `docker compose up -d --wait` with the resolved profile set:
            (no flag) / -Demo  -> `--profile demo --profile fetcher`
            -RealGha           -> `--profile fetcher`
            -Empty             -> no extra profiles
          `--wait` blocks until each service's healthcheck reports healthy.
      10. Polls the gateway-fronted `/health` for up to `-HealthTimeoutSeconds`.
      11. Prints the URL panel + the generated `API_TOKEN` + a sample `curl`.

    Per ADR-0009: the API self-migrates on start; the installer does not actuate migrations.

    Prerequisite -- gh CLI:
      The repo and GHCR component images are private. Install the GitHub CLI from
      https://cli.github.com/, then:
          gh auth login --hostname github.com
          gh auth refresh --hostname github.com --scopes read:packages
      The installer fails fast (exit 1) if gh is missing, not logged in to
      github.com, or the active token lacks `read:packages`.

    Upgrade flow (v0.3.0 -> v0.4.0 worked example):
      Pass `-InstallDir` pointing at the prior install dir to preserve the
      generated secrets + DB volume. The installer detects the pre-existing
      `dashboard.env`, reuses `API_TOKEN` + `POSTGRES_PASSWORD`, and only
      rewrites `DASHBOARD_VERSION` / `DASHBOARD_PORT`. Demo-mode defaults
      (GHA_REPOSITORIES, FETCHER_POLL_INTERVAL_SECONDS, GHA_API_BASE_URL,
      GHA_TOKEN) are preserved unless `-ResetDemoDefaults` is passed.

      If a stray `deployment-dashboard_pg-data` Docker volume is detected but
      no `dashboard.env` exists at `-InstallDir`, the installer red-errors
      and exits 1 BEFORE writing any state -- otherwise a fresh
      `POSTGRES_PASSWORD` would be generated against a DB seeded by the
      historical install, locking the api container out.

.PARAMETER Version
    Release tag to install (e.g. `v1.2.3`) or `latest`. The installer fetches the
    tag-pinned release assets via `gh release download` (the repo is private) and
    writes `DASHBOARD_VERSION=<tag>` into the env-file so the compose file resolves
    GHCR image refs to the same tag.
.PARAMETER RealGha
    Real GitHub Actions upstream. Activates the `fetcher` Compose profile (only --
    not `demo`) and requires `$env:GHA_TOKEN` to be non-empty; the script
    red-errors and exits 1 before any side effect when the token is missing.
    Renamed from `-Fetcher` per CR-0013; semantics are identical.
.PARAMETER Empty
    Bare-minimum stack -- db + api + gateway + dashboard only. No fetcher, no
    demo-gha, no mock-gha. For direct-POST integrators that thread deployment
    events into `POST /api/deployments` themselves.
.PARAMETER Demo
    Back-compat alias for the no-flag default. Silently routes to the demo stack
    bring-up + logs one informational line. Drop the flag from your install
    command after this release cycle (one-cycle deprecation per CR-0013).
.PARAMETER Port
    Host port to publish the gateway on. Default 8080. Becomes `DASHBOARD_PORT` in
    the env-file; compose substitutes it into the `gateway` service's `ports:`.
.PARAMETER HealthTimeoutSeconds
    How long to wait for the gateway-fronted /health endpoint. Default 60. On
    failure, logs are dumped and the script exits 1.
.PARAMETER InstallDir
    Install directory. Created if absent. Defaults to `.dashboard-release` under
    the current user's profile directory (cross-platform: `$HOME` on POSIX,
    `%USERPROFILE%` on Windows). See the "Upgrade flow" sub-section above for
    upgrade-re-run semantics.
.PARAMETER ResetDemoDefaults
    Force-overwrite the demo-mode keys (`GHA_REPOSITORIES`,
    `FETCHER_POLL_INTERVAL_SECONDS`, `GHA_API_BASE_URL`, `GHA_TOKEN`) even
    when a prior `dashboard.env` already contains them. Without this switch,
    an upgrade re-run on the demo path preserves whatever the operator
    customised. `GHA_TOKEN` additionally rotates when `$env:GHA_TOKEN` is set
    AND differs from the persisted value (caller is explicitly threading a
    new token through).

.EXAMPLE
    # No-flag default per CR-0013: brings up the demo stack with the baked
    # demo-gha mock GitHub upstream + fetcher pointing at it.
    pwsh -NoProfile -File install.ps1
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Version v1.2.3
.EXAMPLE
    # Real GitHub upstream -- requires $env:GHA_TOKEN. Renamed from -Fetcher.
    $env:GHA_TOKEN = '<PAT>'
    pwsh -NoProfile -File install.ps1 -RealGha
.EXAMPLE
    # Bare-minimum stack for direct-POST integrators.
    pwsh -NoProfile -File install.ps1 -Empty
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Port 9090 -InstallDir 'C:\dashboards\demo'
.EXAMPLE
    # v0.3.0 -> v0.4.0 upgrade: preserve the prior install dir + secrets + DB volume.
    pwsh -NoProfile -File install.ps1 -Version v0.4.0 -InstallDir 'C:\dashboards\prod'
.EXAMPLE
    # Demo re-run, force-refresh the demo defaults to the new installer's baked-in values.
    pwsh -NoProfile -File install.ps1 -ResetDemoDefaults
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [switch]$RealGha,
    [switch]$Empty,
    [switch]$Demo,
    [switch]$ResetDemoDefaults,
    [int]$Port = 8080,
    [int]$HealthTimeoutSeconds = 60,
    [string]$InstallDir = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dashboard-release')
)
$ErrorActionPreference = 'Stop'

# ---- 0. Resolve the install mode from the flag matrix (CR-0013) ----
# Mutually exclusive triple: $modeDemo (default), $modeRealGha, $modeEmpty.
# Exactly one is true after this block. The historical `-Demo` flag becomes
# a silent alias for the default with a one-line INFO log.
$conflict = @(@(
    [bool]$RealGha,
    [bool]$Empty,
    [bool]$Demo
) | Where-Object { $_ })
if ($conflict.Count -gt 1) {
    Write-Host "ERROR: -RealGha, -Empty, and -Demo are mutually exclusive. Pick at most one." -ForegroundColor Red
    exit 1
}

$modeRealGha = [bool]$RealGha
$modeEmpty   = [bool]$Empty
# Default = demo. -Demo (back-compat) also lands here.
$modeDemo    = -not ($modeRealGha -or $modeEmpty)

if ($Demo) {
    Write-Host "INFO: demo is now the default; -Demo flag is redundant -- drop it from your install command after this release cycle." -ForegroundColor Yellow
}

# ---- 1. GHA_TOKEN precondition (issue #5 verbatim, scoped to -RealGha) ----
# Contract (CR-0013):
#   -RealGha + token set    -> proceed, write token to dashboard.env (authed, 5000/h)
#   -RealGha + token unset  -> red error, exit 1 (mirrors today's -Fetcher precondition)
#   default / -Demo         -> demo-gha upstream, no PAT, no GitHub API calls
#   -Empty                  -> no fetcher at all
if ($modeRealGha) {
    $tokenSet = -not [string]::IsNullOrWhiteSpace($env:GHA_TOKEN)
    if (-not $tokenSet) {
        Write-Host "ERROR: -RealGha requires `$env:GHA_TOKEN to be set. Set `$env:GHA_TOKEN = '<PAT>' or re-run with the no-flag default for a zero-PAT demo install against the baked demo-gha upstream." -ForegroundColor Red
        exit 1
    }
}

# ---- 2. gh CLI precondition ----
# The repo + GHCR component images are private. Anonymous HTTPS asset fetch 404s,
# anonymous docker pulls 401. All three failure modes below MUST exit 1 BEFORE we
# create the install dir, write any asset, or invoke docker.
#
# Note: $ErrorActionPreference = 'Stop' turns a missing-command into a TERMINATING
# exception, which would crash before our friendly red-error fires. Wrap the
# version probe in try/catch so we can surface the install-the-CLI hint.
$ghAvailable = $false
try {
    & gh --version *> $null
    $ghAvailable = ($LASTEXITCODE -eq 0)
} catch {
    $ghAvailable = $false
}
if (-not $ghAvailable) {
    Write-Host "ERROR: gh CLI not found on PATH. The repo and GHCR images are private, so the installer needs gh to fetch release assets and authenticate to ghcr.io." -ForegroundColor Red
    Write-Host "       Install it from https://cli.github.com/ and then run:" -ForegroundColor Red
    Write-Host "         gh auth login --hostname github.com" -ForegroundColor Red
    Write-Host "         gh auth refresh --hostname github.com --scopes read:packages" -ForegroundColor Red
    exit 1
}

& gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: gh is not authenticated for github.com. Run:" -ForegroundColor Red
    Write-Host "         gh auth login --hostname github.com" -ForegroundColor Red
    Write-Host "         gh auth refresh --hostname github.com --scopes read:packages" -ForegroundColor Red
    exit 1
}

# Scope check: `gh auth status --show-token` prints "Token scopes: 'a', 'b', ..."
# on stderr. Capture both streams + match the *:packages hierarchy. GitHub's
# OAuth scope model is hierarchical -- write:packages includes read:packages,
# and admin:packages includes both -- and `gh auth status` only lists the
# highest granted scope, never the redundant subset. A regex on the union
# accepts any token that can pull from GHCR.
$ghScopeOutput = (& gh auth status --hostname github.com --show-token 2>&1 | Out-String)
if ($ghScopeOutput -notmatch '(read|write|admin):packages') {
    Write-Host "ERROR: gh token for github.com lacks GHCR read access. Need one of: 'read:packages', 'write:packages', or 'admin:packages'. Run:" -ForegroundColor Red
    Write-Host "         gh auth refresh --hostname github.com --scopes read:packages" -ForegroundColor Red
    exit 1
}

# ---- 3. Install dir ----
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}
$InstallDir = (Resolve-Path $InstallDir).Path
Write-Host "==> Install directory: $InstallDir" -ForegroundColor Cyan

# ---- 4. Secret handling (API_TOKEN + POSTGRES_PASSWORD) ----
# Defence-in-depth: refuse the local-dev literals. If a pre-existing dashboard.env
# carries them, regenerate. This applies to:
#   - API_TOKEN   == 'local-dev-token-not-for-production'
#   - POSTGRES_PASSWORD == 'local-dev-password'
$envFile = Join-Path $InstallDir 'dashboard.env'

# ---- 4a. Volume-detection safety net ----
# If a previous installer run left a `deployment-dashboard_pg-data` volume but
# the env-file we'd be writing into does NOT exist, refusing here prevents the
# silent failure mode where a fresh POSTGRES_PASSWORD gets generated against a
# DB seeded by the historical install (api container then 28P01s on connect).
# Run BEFORE any secret read / generation / env-file write.
& docker volume inspect deployment-dashboard_pg-data *> $null
$volumeExists = ($LASTEXITCODE -eq 0)
if ($volumeExists -and -not (Test-Path -LiteralPath $envFile)) {
    Write-Host "ERROR: Pre-existing Postgres volume detected (deployment-dashboard_pg-data) but no dashboard.env at $envFile." -ForegroundColor Red
    Write-Host "" -ForegroundColor Red
    Write-Host "The volume holds DB state seeded by an earlier installer run. Re-using a fresh dashboard.env here would generate a new POSTGRES_PASSWORD that does not match the running cluster -- the api container would fail to connect." -ForegroundColor Red
    Write-Host "" -ForegroundColor Red
    Write-Host "Either:" -ForegroundColor Red
    Write-Host "  - Pass -InstallDir <path-to-prior-install> (the historical default was ./dashboard-release relative to where you first ran the installer)." -ForegroundColor Red
    Write-Host "  - Run uninstall.ps1 -Volumes (or uninstall.sh --volumes) to drop the pg-data volume and start fresh." -ForegroundColor Red
    exit 1
}

$localDevApiLiteral = 'local-dev-token-not-for-production'
$localDevPwLiteral  = 'local-dev-password'

function Read-EnvValue {
    param([string]$Path, [string]$Key)
    if (-not (Test-Path $Path)) { return $null }
    $line = Select-String -Path $Path -Pattern "^$Key=" -SimpleMatch:$false | Select-Object -First 1
    if (-not $line) { return $null }
    return $line.ToString().Split('=', 2)[1].Trim()
}

function New-RandomHex {
    param([int]$ByteCount)
    $bytes = New-Object byte[] $ByteCount
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return (-join ($bytes | ForEach-Object { '{0:x2}' -f $_ }))
}

# API_TOKEN
$apiToken = Read-EnvValue -Path $envFile -Key 'API_TOKEN'
if ([string]::IsNullOrWhiteSpace($apiToken) -or $apiToken -eq $localDevApiLiteral) {
    if (-not [string]::IsNullOrWhiteSpace($env:DASHBOARD_API_TOKEN) -and $env:DASHBOARD_API_TOKEN -ne $localDevApiLiteral) {
        $apiToken = $env:DASHBOARD_API_TOKEN
        Write-Host "==> Using API_TOKEN from `$env:DASHBOARD_API_TOKEN" -ForegroundColor Cyan
    } else {
        $apiToken = New-RandomHex -ByteCount 32
        Write-Host "==> Generated random API_TOKEN (64 hex chars)" -ForegroundColor Cyan
    }
} else {
    Write-Host "==> Reusing API_TOKEN from $envFile" -ForegroundColor Cyan
}

# POSTGRES_PASSWORD (random per install; refuse the dev literal too).
$pgPassword = Read-EnvValue -Path $envFile -Key 'POSTGRES_PASSWORD'
if ([string]::IsNullOrWhiteSpace($pgPassword) -or $pgPassword -eq $localDevPwLiteral) {
    $pgPassword = New-RandomHex -ByteCount 16
    Write-Host "==> Generated random POSTGRES_PASSWORD (32 hex chars)" -ForegroundColor Cyan
} else {
    Write-Host "==> Reusing POSTGRES_PASSWORD from $envFile" -ForegroundColor Cyan
}

# Persist the env-file. NOTE the docker-compose value-substitution rules:
#   - Values are read literally (no shell expansion).
#   - `${VAR}` inside another value would need that var to be defined too.
# So we write the connection-string with the password VALUE inlined, not a `${}` ref.
$envFileContent = @"
# Generated by install.ps1 -- do not commit. Regenerated on install when secrets are missing or hold dev-literals.
POSTGRES_DB=dashboard
POSTGRES_USER=dashboard
POSTGRES_PASSWORD=$pgPassword
API_TOKEN=$apiToken
DASHBOARD_VERSION=$Version
DASHBOARD_PORT=$Port
ConnectionStrings__DefaultConnection=Host=db;Database=dashboard;Username=dashboard;Password=$pgPassword
"@

# Demo mode (CR-0013): retarget the fetcher at the baked demo-gha mock
# GitHub upstream so a fresh install renders deployments with zero caller
# configuration AND zero external GitHub API calls. The fetcher's env-var
# indirection (GHA_API_BASE_URL substitution in the release compose file)
# was added by CR-0012 for the integration profile and is reused verbatim
# here -- the demo profile points the fetcher at `http://demo-gha:80`,
# the internal Docker DNS name of the profile-gated demo-gha service.
#
# Upgrade-flow semantics: when a prior `dashboard.env` already carries any
# of these keys, preserve the operator's customisation unless
# `-ResetDemoDefaults` is set. `GHA_TOKEN` is intentionally NOT seeded here
# (the demo upstream never sees an Authorization header) but is preserved
# on upgrade-re-run so that switching from `-RealGha` to the default and
# back keeps the operator's PAT.
if ($modeDemo) {
    $demoDefaults = [ordered]@{
        'GHA_API_BASE_URL'              = 'http://demo-gha:80'
        'FETCHER_POLL_INTERVAL_SECONDS' = '5'
        'GHA_REPOSITORIES'              = '[{"owner":"demo-org","repo":"demo-repo"}]'
    }

    $demoLines = @('', '# Demo-mode defaults (CR-0013; written by install.ps1)')
    foreach ($key in $demoDefaults.Keys) {
        $existing = Read-EnvValue -Path $envFile -Key $key
        if ($ResetDemoDefaults -or [string]::IsNullOrWhiteSpace($existing)) {
            $demoLines += "$key=$($demoDefaults[$key])"
        } else {
            $demoLines += "$key=$existing"
            Write-Host "==> Preserving $key from $envFile (pass -ResetDemoDefaults to overwrite)" -ForegroundColor Cyan
        }
    }

    # GHA_TOKEN: not seeded for the demo profile (demo-gha is offline-mocked,
    # no Authorization header sent), but preserved on upgrade-re-run so a
    # later switch back to -RealGha keeps the operator's PAT.
    $persistedGhaToken = Read-EnvValue -Path $envFile -Key 'GHA_TOKEN'
    if (-not $ResetDemoDefaults -and -not [string]::IsNullOrWhiteSpace($persistedGhaToken)) {
        $demoLines += "GHA_TOKEN=$persistedGhaToken"
        Write-Host "==> Preserving GHA_TOKEN from $envFile (pass -ResetDemoDefaults to drop)" -ForegroundColor Cyan
    }

    $envFileContent = $envFileContent + "`n" + ($demoLines -join "`n")
}

Set-Content -Path $envFile -Value $envFileContent -Encoding utf8 -NoNewline
Write-Host "==> Wrote $envFile" -ForegroundColor Cyan

# ---- 5 + 6. Download release assets via gh ----
# The repo is private -- anonymous HTTPS asset fetch 404s. `gh release download`
# uses the auth context vetted by step 2. The two URL shapes (`latest` vs pinned
# tag) collapse into a single CLI: omit the positional tag for `latest`, supply it
# otherwise. `--clobber` keeps re-install idempotent against a stale install dir.
$repo = 'kostiantyn-matsebora/deployment-dashboard'

function Invoke-AssetDownload {
    param([string]$AssetName, [string]$DestPath)
    Write-Host "==> gh release download ($Version) $AssetName -> $DestPath" -ForegroundColor Cyan
    if ($Version -eq 'latest') {
        & gh release download --repo $repo --pattern $AssetName --output $DestPath --clobber
    } else {
        & gh release download $Version --repo $repo --pattern $AssetName --output $DestPath --clobber
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: failed to download $AssetName from release '$Version' via gh release download (exit $LASTEXITCODE)." -ForegroundColor Red
        Write-Host "       Confirm that release '$Version' exists and advertises a '$AssetName' asset, and that the active gh account can read this repo." -ForegroundColor Red
        exit 1
    }
}

$composeFile = Join-Path $InstallDir 'docker-compose.release.yml'
Invoke-AssetDownload -AssetName 'docker-compose.release.yml' -DestPath $composeFile

# ---- 7. GHCR docker login ----
# The four component images live in private GHCR packages. We mint an ephemeral
# docker-login session using the same gh token we just validated. `--password-stdin`
# keeps the token off the process-args list; the username field is informational
# for ghcr (a valid GH login or the `oauth2` sentinel both work).
$ghLogin = (& gh api user --jq .login 2>$null)
if ([string]::IsNullOrWhiteSpace($ghLogin)) { $ghLogin = 'oauth2' }
$ghToken = & gh auth token
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ghToken)) {
    Write-Host "ERROR: docker login ghcr.io failed -- could not obtain a token from gh auth token (exit $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}
Write-Host "==> docker login ghcr.io --username $ghLogin --password-stdin" -ForegroundColor Cyan
$ghToken | & docker login ghcr.io --username $ghLogin --password-stdin
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker login ghcr.io failed (exit $LASTEXITCODE). Verify the gh account has 'read:packages' and access to the deployment-dashboard packages." -ForegroundColor Red
    exit 1
}

# ---- 8. Pull images ----
$composeBase = @('-f', $composeFile, '--env-file', $envFile)
Write-Host "==> docker compose $($composeBase -join ' ') pull" -ForegroundColor Cyan
& docker compose @composeBase pull
if ($LASTEXITCODE -ne 0) { throw "docker compose pull failed with exit code $LASTEXITCODE" }

# ---- 9. Bring up ----
# Profile resolution per CR-0013 flag matrix:
#   default / -Demo  -> --profile demo --profile fetcher
#                       (demo-gha + fetcher-pointing-at-demo-gha)
#   -RealGha         -> --profile fetcher
#                       (fetcher-pointing-at-api.github.com; demo-gha inert)
#   -Empty           -> no extra profiles
#                       (db + api + gateway + dashboard only)
$composeArgs = @() + $composeBase
if ($modeDemo) {
    $composeArgs += @('--profile', 'demo', '--profile', 'fetcher')
} elseif ($modeRealGha) {
    $composeArgs += @('--profile', 'fetcher')
}
# $modeEmpty -- intentionally no profiles appended.

Write-Host "==> docker compose $($composeArgs -join ' ') up -d --wait" -ForegroundColor Cyan
& docker compose @composeArgs up -d --wait
if ($LASTEXITCODE -ne 0) {
    & docker compose @composeArgs logs --tail=50
    throw "docker compose up failed with exit code $LASTEXITCODE"
}

# ---- 10. Health-poll ----
$healthUrl = "http://localhost:$Port/health"
Write-Host "==> Waiting up to $HealthTimeoutSeconds s for $healthUrl" -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try { if ((Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch { }
    Start-Sleep -Seconds 2
}
if (-not $ok) {
    & docker compose @composeArgs logs --tail=50
    throw "Gateway-fronted /health did not return 200 at $healthUrl within $HealthTimeoutSeconds s."
}

# ---- 11. URL panel ----
Write-Host ""
Write-Host "  Dashboard / Gateway: http://localhost:$Port/"
Write-Host "  API_TOKEN:           $apiToken (saved to $envFile)"
Write-Host "  Postgres (dev):      localhost:5432 (user: dashboard / password in $envFile)"
if ($modeDemo) {
    Write-Host "  Mode:                Demo (default) -- demo-gha + fetcher; offline, zero-PAT" -ForegroundColor Cyan
    Write-Host "  Demo upstream:       http://demo-gha:80 (internal; baked WireMock.Net bundle)" -ForegroundColor Cyan
    Write-Host "  Poll cadence:        $((Read-EnvValue -Path $envFile -Key 'FETCHER_POLL_INTERVAL_SECONDS')) s" -ForegroundColor Cyan
} elseif ($modeRealGha) {
    Write-Host "  Mode:                RealGha -- fetcher pointed at https://api.github.com (authed, 5000 req/h)" -ForegroundColor Cyan
} elseif ($modeEmpty) {
    Write-Host "  Mode:                Empty -- no fetcher, no demo-gha. Direct-POST integrators only." -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  curl -X POST http://localhost:$Port/api/deployments -H 'Content-Type: application/json' -H 'X-Api-Key: $apiToken' -d '{`"service`":`"adminportal`",`"environment`":`"dev`",`"version`":`"v2.3.1`",`"status`":`"success`",`"run_url`":`"https://example.test/run/1`",`"run_number`":1,`"actor`":`"local`"}'"
