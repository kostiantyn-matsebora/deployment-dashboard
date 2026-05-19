<#
.SYNOPSIS
    Install + start a released Deployment Dashboard stack on the current host.
    Image-only -- no git clone, no source tree, no .NET SDK required.
.DESCRIPTION
    Release-install primary entrypoint (Option A per GitHub issue #7). The companion
    contributor flow is `dev_env/start.ps1`, which depends on a cloned repo and
    bind-mounts the source tree for hot-reload / migration generation.

    What this script does, in order:
      1.  `GHA_TOKEN` precondition (issue #5 verbatim) -- fires only when `-Fetcher`.
      2.  `gh` CLI precondition -- gh present on PATH, authenticated for github.com,
          and the active token carries the `read:packages` scope. All three failure
          modes exit 1 BEFORE any side effect (no install dir, no asset writes, no
          docker calls).
      3.  Ensures the install directory exists.
      4.  Generates / preserves `API_TOKEN` + `POSTGRES_PASSWORD` random secrets;
          persists them to `<InstallDir>/dashboard.env`. Refuses the dev-literal.
      5+6. Downloads `docker-compose.release.yml` and (unless `-SkipMigrations`)
          `migration.sql` via `gh release download` -- the repo + GHCR images are
          private, so anonymous HTTPS asset fetch 404s.
      7.  `docker login ghcr.io` using `gh auth token` -- required because the
          component images are private GHCR packages and anonymous pulls 401.
      8.  `docker compose pull` -- pulls the four GHCR-hosted component images.
      9.  `docker compose up -d --wait` with the `migrate` profile (and `fetcher`
          when requested). `--wait` makes the one-shot `migrations` service's
          `service_completed_successfully` reflect in the compose exit code.
      10. Polls the gateway-fronted `/health` for up to `-HealthTimeoutSeconds`.
      11. Prints the URL panel + the generated `API_TOKEN` + a sample `curl`.

    Per ADR-0005: migrations apply via a one-shot `postgres:16-alpine` container
    running `psql -f /migration.sql`. The script is idempotent (re-applying against
    an already-migrated DB is a no-op per the EF Core `--idempotent` contract).

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
    set, requires `$env:GHA_TOKEN` to be non-empty unless `-AllowMissingGhaToken` is
    also supplied. Verbatim copy of `dev_env/start.ps1`'s precondition pattern.
.PARAMETER AllowMissingGhaToken
    Permit `-Fetcher` to proceed when `$env:GHA_TOKEN` is unset / empty. The fetcher
    boots with the placeholder token from `docker-compose.release.yml`; GitHub API
    calls will 401. Use for boot-smoke / fetcher-code work that does not need real
    GH API access.
.PARAMETER SkipMigrations
    Bring the stack up without applying schema migrations (no `--profile migrate`).
    Yellow notice in the URL panel; the API will fail to start cleanly against an
    unmigrated DB. Default-off; opt-out polarity per ADR-0005 Decision 3.
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
    pwsh -NoProfile -File install.ps1 -Port 9090 -InstallDir 'C:\dashboards\demo'
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [switch]$Fetcher,
    [switch]$AllowMissingGhaToken,
    [switch]$SkipMigrations,
    [int]$Port = 8080,
    [int]$HealthTimeoutSeconds = 60,
    [string]$InstallDir = (Join-Path $PWD 'dashboard-release')
)
$ErrorActionPreference = 'Stop'

# ---- 1. GHA_TOKEN precondition (issue #5 verbatim) ----
if ($Fetcher) {
    $tokenSet = -not [string]::IsNullOrWhiteSpace($env:GHA_TOKEN)
    if (-not $tokenSet -and -not $AllowMissingGhaToken) {
        Write-Host "ERROR: -Fetcher requires `$env:GHA_TOKEN to be set. Set `$env:GHA_TOKEN = '<PAT>' or re-run with -AllowMissingGhaToken to use the placeholder." -ForegroundColor Red
        exit 1
    }
    if (-not $tokenSet) {
        Write-Host "GHA_TOKEN not set - fetcher will boot with placeholder; GitHub API calls will 401." -ForegroundColor Yellow
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

if (-not $SkipMigrations) {
    $migrationFile = Join-Path $InstallDir 'migration.sql'
    Invoke-AssetDownload -AssetName 'migration.sql' -DestPath $migrationFile
}

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
if (-not $SkipMigrations) { $composeArgs += @('--profile', 'migrate') }
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
if ($SkipMigrations) {
    Write-Host "  Migrations skipped - API likely failing. Re-run without -SkipMigrations to apply." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  curl -X POST http://localhost:$Port/api/deployments -H 'Content-Type: application/json' -H 'X-Api-Key: $apiToken' -d '{`"service`":`"adminportal`",`"environment`":`"dev`",`"version`":`"v2.3.1`",`"status`":`"success`",`"run_url`":`"https://example.test/run/1`",`"run_number`":1,`"actor`":`"local`"}'"
