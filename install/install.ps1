<#
.SYNOPSIS
    Install + start a released Deployment Dashboard stack on the current host.
    Image-only -- no git clone, no source tree, no .NET SDK required.
.DESCRIPTION
    Release-install primary entrypoint (Option A per GitHub issue #7). The companion
    contributor flow is `dev_env/start.ps1`, which depends on a cloned repo and
    bind-mounts the source tree for hot-reload / migration generation.

    What this script does, in order:
      1.  `GHA_TOKEN` precondition (issue #5 verbatim) -- fires only when `-Fetcher`
          is set and `-Demo` is NOT set. `-Demo` permits a zero-PAT install that
          boots the fetcher in anonymous mode against a public-repo default.
      2.  `gh` CLI precondition -- gh present on PATH, authenticated for github.com,
          and the active token carries the `read:packages` scope. All three failure
          modes exit 1 BEFORE any side effect (no install dir, no asset writes, no
          docker calls).
      3.  Ensures the install directory exists.
      4.  Generates / preserves `API_TOKEN` + `POSTGRES_PASSWORD` random secrets;
          persists them to `<InstallDir>/dashboard.env`. Refuses the dev-literal.
          When `-Demo` is set, also bakes in the public-repo demo defaults
          (GHA_REPOSITORIES + FETCHER_POLL_INTERVAL_SECONDS, and GHA_TOKEN iff set).
      5+6. Downloads `docker-compose.release.yml` via `gh release download` -- the
          repo + GHCR images are private, so anonymous HTTPS asset fetch 404s.
      7.  `docker login ghcr.io` using `gh auth token` -- required because the
          component images are private GHCR packages and anonymous pulls 401.
      8.  `docker compose pull` -- pulls the four GHCR-hosted component images.
      9.  `docker compose up -d --wait` (with the `fetcher` profile when requested).
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

.PARAMETER Version
    Release tag to install (e.g. `v1.2.3`) or `latest`. The installer fetches the
    tag-pinned release assets via `gh release download` (the repo is private) and
    writes `DASHBOARD_VERSION=<tag>` into the env-file so the compose file resolves
    GHCR image refs to the same tag.
.PARAMETER Fetcher
    Activate the optional `fetcher` Compose profile (CR-0009 pull-mode fetcher). When
    set (and `-Demo` is NOT also set), requires `$env:GHA_TOKEN` to be non-empty;
    otherwise the script red-errors and exits 1 before any side effect.
.PARAMETER Demo
    Zero-PAT demo install. Implies `-Fetcher`. Bakes in a public-repo default
    (`GHA_REPOSITORIES=[{"owner":"PostHog","repo":"posthog"}]`) and a 60-second
    poll interval so a fresh install renders deployments without the caller
    needing to configure anything. If `$env:GHA_TOKEN` is set, it is threaded
    through to `dashboard.env` (5000 req/h authed). If unset, no `GHA_TOKEN=`
    line is written and the fetcher container falls back to the compose-level
    placeholder, which the fetcher detects and switches to anonymous-mode
    GitHub API calls (60 req/h).
.PARAMETER Port
    Host port to publish the gateway on. Default 8080. Becomes `DASHBOARD_PORT` in
    the env-file; compose substitutes it into the `gateway` service's `ports:`.
.PARAMETER HealthTimeoutSeconds
    How long to wait for the gateway-fronted /health endpoint. Default 60. On
    failure, logs are dumped and the script exits 1.
.PARAMETER InstallDir
    Install directory. Created if absent. Defaults to `./dashboard-release` under
    the current working directory.

.EXAMPLE
    pwsh -NoProfile -File install.ps1
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Version v1.2.3
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Fetcher
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Demo
.EXAMPLE
    pwsh -NoProfile -File install.ps1 -Port 9090 -InstallDir 'C:\dashboards\demo'
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [switch]$Fetcher,
    [switch]$Demo,
    [int]$Port = 8080,
    [int]$HealthTimeoutSeconds = 60,
    [string]$InstallDir = (Join-Path $PWD 'dashboard-release')
)
$ErrorActionPreference = 'Stop'

# -Demo implies -Fetcher. Set this before the precondition block so the
# downstream branches (token check, compose --profile fetcher) see the
# canonicalised state.
if ($Demo) { $Fetcher = $true }

# ---- 1. GHA_TOKEN precondition (issue #5 verbatim) ----
# Contract:
#   -Fetcher (no -Demo) + token set    -> proceed, write token to dashboard.env (authed, 5000/h)
#   -Fetcher (no -Demo) + token unset  -> red error, exit 1
#   -Demo               + token set    -> proceed, write token (authed, 5000/h)
#   -Demo               + token unset  -> proceed, OMIT GHA_TOKEN= line; fetcher
#                                         picks up compose's placeholder default
#                                         and switches to anonymous mode (60/h)
if ($Fetcher) {
    $tokenSet = -not [string]::IsNullOrWhiteSpace($env:GHA_TOKEN)
    if (-not $tokenSet -and -not $Demo) {
        Write-Host "ERROR: -Fetcher requires `$env:GHA_TOKEN to be set. Set `$env:GHA_TOKEN = '<PAT>' or re-run with -Demo for a zero-PAT demo install (anonymous-mode fetcher, 60 req/h)." -ForegroundColor Red
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

# Demo mode: bake in a public-repo default so a fresh install renders deployments
# with zero caller configuration. GHA_TOKEN is appended IFF set in the parent env;
# when unset, the fetcher container picks up the compose-level placeholder and
# detects it to switch into anonymous-mode (60 req/h). PostHog is a high-deploy-
# activity public repo; PR-ephemeral noise is accepted -- env-filter is a separate
# forthcoming feature.
if ($Demo) {
    $demoLines = @(
        '',
        '# Demo-mode defaults (written by install.ps1 -Demo)',
        'GHA_REPOSITORIES=[{"owner":"PostHog","repo":"posthog"},{"owner":"grafana","repo":"grafana"}]',
        'FETCHER_POLL_INTERVAL_SECONDS=60'
    )
    if (-not [string]::IsNullOrWhiteSpace($env:GHA_TOKEN)) {
        $demoLines += "GHA_TOKEN=$env:GHA_TOKEN"
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
$composeArgs = @() + $composeBase
if ($Fetcher) { $composeArgs += @('--profile', 'fetcher') }

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
if ($Fetcher) {
    Write-Host "  Fetcher:             profile 'fetcher' active - POSTs to gateway as dashboard-fetcher/github-actions"
}
if ($Demo) {
    if ([string]::IsNullOrWhiteSpace($env:GHA_TOKEN)) {
        Write-Host "  Demo mode:           PostHog/posthog, 60s poll, anonymous GitHub API (60 req/h)" -ForegroundColor Cyan
    } else {
        Write-Host "  Demo mode:           PostHog/posthog, 60s poll, authed GitHub API (5000 req/h)" -ForegroundColor Cyan
    }
}
Write-Host ""
Write-Host "  curl -X POST http://localhost:$Port/api/deployments -H 'Content-Type: application/json' -H 'X-Api-Key: $apiToken' -d '{`"service`":`"adminportal`",`"environment`":`"dev`",`"version`":`"v2.3.1`",`"status`":`"success`",`"run_url`":`"https://example.test/run/1`",`"run_number`":1,`"actor`":`"local`"}'"
