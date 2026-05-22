#!/usr/bin/env bash
# Install + start a released Deployment Dashboard stack on the current host.
# Image-only -- no git clone, no source tree, no .NET SDK required.
#
# Release-install primary entrypoint (Option A per GitHub issue #7).
# Per CR-0013 the no-flag default is the *demo stack* -- a self-contained
# stack with the baked demo-gha mock GitHub Actions upstream + fetcher
# pointing at it. Zero-PAT, zero external network, populated dashboard
# within ~60s. The companion contributor flow is dev_env/start.ps1, which
# depends on a cloned repo.
#
# Flag matrix (CR-0013):
#   (no flag)            Demo stack -- demo-gha + fetcher pointing at
#                        http://demo-gha:80; no GHA_TOKEN required.
#   --real-gha           Real GitHub Actions upstream -- requires
#                        $GHA_TOKEN. Renamed from --fetcher; semantics
#                        identical to the historical --fetcher flag.
#   --empty              Bare-minimum stack -- db + api + gateway +
#                        dashboard only; no fetcher, no demo-gha.
#                        Direct-POST integrators only.
#   --demo               Back-compat alias for the no-flag default.
#                        Silently routes + logs one INFO line. Drop the
#                        flag from your install command after this
#                        release cycle.
#
# Bash sibling of install.ps1 -- CLI parity, identical step order:
#   1.  GHA_TOKEN precondition (issue #5 verbatim, ANSI-coloured on tty).
#       Fires only when --real-gha is set. The no-flag / --demo / --empty
#       paths never touch real GitHub and do not require a PAT.
#   2.  gh CLI precondition: gh on PATH, authenticated for github.com, and the
#       active token carries the read:packages scope. Exits 1 before any side
#       effect when any check fails.
#   3.  Install dir.
#   4.  Secret handling (API_TOKEN + POSTGRES_PASSWORD; refuses the dev-literals).
#       When the demo path is active (default or --demo), also bakes in the
#       demo-profile env-var contract (GHA_API_BASE_URL=http://demo-gha:80,
#       FETCHER_POLL_INTERVAL_SECONDS=5,
#       GHA_REPOSITORIES=[{"owner":"demo-org","repo":"demo-repo"}]).
#   5+6. Download docker-compose.release.yml via `gh release download` (repo is
#       private; anonymous HTTPS fetch 404s).
#   7.  docker login ghcr.io using `gh auth token` (GHCR images are private).
#   8.  docker compose pull.
#   9.  docker compose up -d --wait with the resolved profile set:
#         (no flag) / --demo  -> --profile demo --profile fetcher
#         --real-gha          -> --profile fetcher
#         --empty             -> no extra profiles
#   10. Health-poll http://localhost:$PORT/health.
#   11. URL panel.
#
# Per ADR-0009: the API self-migrates on start; the installer does not actuate migrations.
#
# Prerequisite -- gh CLI:
#   The repo and GHCR component images are private. Install the GitHub CLI
#   (https://cli.github.com/) and then:
#       gh auth login --hostname github.com
#       gh auth refresh --hostname github.com --scopes read:packages
#   The installer fails fast (exit 1) if gh is missing, not logged in to
#   github.com, or the active token lacks read:packages.
#
# Soft prereq: openssl for `openssl rand -hex`. Falls back to /dev/urandom + xxd.

set -euo pipefail

# ---- Defaults ----
VERSION='latest'
REAL_GHA=false
EMPTY=false
DEMO=false
RESET_DEMO_DEFAULTS=false
PORT=8080
HEALTH_TIMEOUT_SECONDS=60
INSTALL_DIR="$HOME/.dashboard-release"

# ---- ANSI colours (tty only) ----
if [ -t 1 ]; then
    RED=$'\033[31m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; NC=$'\033[0m'
else
    RED=''; YELLOW=''; CYAN=''; NC=''
fi

usage() {
    cat <<EOF
Usage: install.sh [OPTIONS]

Install + start a released Deployment Dashboard stack from GHCR-hosted images.
Per CR-0013 the no-flag default is the demo stack (offline, zero-PAT, populated
dashboard within ~60s). Pick --real-gha for the real-GitHub upstream or --empty
for the bare-minimum direct-POST stack.

Options:
  -v, --version <tag>                  Release tag (default: latest).
      --real-gha                       Real GitHub Actions upstream -- requires
                                       \$GHA_TOKEN to be set. Renamed from
                                       --fetcher per CR-0013; semantics are
                                       identical.
      --empty                          Bare-minimum stack -- db + api + gateway
                                       + dashboard only. No fetcher, no demo-gha.
                                       Direct-POST integrators only.
      --demo                           Back-compat alias for the no-flag
                                       default. Silently routes + logs one INFO
                                       line. Drop after this release cycle.
      --reset-demo-defaults            Force-overwrite demo keys
                                       (GHA_API_BASE_URL, GHA_REPOSITORIES,
                                       FETCHER_POLL_INTERVAL_SECONDS, GHA_TOKEN)
                                       even when a prior dashboard.env already
                                       carries them. Without this, an upgrade
                                       re-run on the demo path preserves operator
                                       customisation.
  -p, --port <int>                     Host port for the gateway (default: 8080).
      --health-timeout-seconds <int>   /health poll timeout (default: 60).
      --install-dir <path>             Install directory (default: \$HOME/.dashboard-release;
                                       CWD-independent so an upgrade re-run from
                                       a different shell still finds the prior
                                       install).
  -h, --help                           Show this help.

Upgrade flow (v0.3.0 -> v0.4.0 worked example):
  Pass --install-dir pointing at the prior install dir to preserve the
  generated secrets + DB volume. The installer detects the pre-existing
  dashboard.env, reuses API_TOKEN + POSTGRES_PASSWORD, and only rewrites
  DASHBOARD_VERSION / DASHBOARD_PORT. Demo-mode defaults are preserved
  unless --reset-demo-defaults is passed.

  If a stray deployment-dashboard_pg-data Docker volume is detected but no
  dashboard.env exists at --install-dir, the installer red-errors and exits
  1 BEFORE writing any state -- otherwise a fresh POSTGRES_PASSWORD would
  be generated against a DB seeded by the historical install, locking the
  api container out.

Examples:
  # No-flag default per CR-0013: brings up the demo stack (offline, zero-PAT).
  ./install.sh
  ./install.sh --version v1.2.3
  # Real GitHub upstream -- requires \$GHA_TOKEN.
  GHA_TOKEN=<PAT> ./install.sh --real-gha
  # Bare-minimum stack for direct-POST integrators.
  ./install.sh --empty
  ./install.sh --port 9090 --install-dir /opt/dashboard
  # v0.3.0 -> v0.4.0 upgrade: preserve the prior install dir + secrets + DB volume.
  ./install.sh --version v0.4.0 --install-dir /opt/dashboard
  # Demo re-run, force-refresh the demo defaults to the new installer's baked-in values.
  ./install.sh --reset-demo-defaults
EOF
}

# ---- Arg parsing (case-based for portability) ----
while [ $# -gt 0 ]; do
    case "$1" in
        -v|--version) VERSION="$2"; shift 2 ;;
        --real-gha) REAL_GHA=true; shift ;;
        --empty) EMPTY=true; shift ;;
        --demo) DEMO=true; shift ;;
        --reset-demo-defaults) RESET_DEMO_DEFAULTS=true; shift ;;
        -p|--port) PORT="$2"; shift 2 ;;
        --health-timeout-seconds) HEALTH_TIMEOUT_SECONDS="$2"; shift 2 ;;
        --install-dir) INSTALL_DIR="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "${RED}ERROR: unknown argument '$1'${NC}" >&2; usage >&2; exit 2 ;;
    esac
done

# ---- 0. Resolve the install mode from the flag matrix (CR-0013) ----
# Mutually exclusive triple: MODE_DEMO (default), MODE_REAL_GHA, MODE_EMPTY.
# Exactly one is true after this block. The historical --demo flag becomes a
# silent alias for the default with a one-line INFO log.
CONFLICT_COUNT=0
if [ "$REAL_GHA" = true ]; then CONFLICT_COUNT=$((CONFLICT_COUNT + 1)); fi
if [ "$EMPTY" = true ];    then CONFLICT_COUNT=$((CONFLICT_COUNT + 1)); fi
if [ "$DEMO" = true ];     then CONFLICT_COUNT=$((CONFLICT_COUNT + 1)); fi
if [ "$CONFLICT_COUNT" -gt 1 ]; then
    echo "${RED}ERROR: --real-gha, --empty, and --demo are mutually exclusive. Pick at most one.${NC}" >&2
    exit 1
fi

MODE_REAL_GHA="$REAL_GHA"
MODE_EMPTY="$EMPTY"
# Default = demo. --demo (back-compat) also lands here.
MODE_DEMO=true
if [ "$MODE_REAL_GHA" = true ] || [ "$MODE_EMPTY" = true ]; then MODE_DEMO=false; fi

if [ "$DEMO" = true ]; then
    echo "${YELLOW}INFO: demo is now the default; --demo flag is redundant -- drop it from your install command after this release cycle.${NC}"
fi

# ---- 1. GHA_TOKEN precondition (issue #5 verbatim, scoped to --real-gha) ----
# Contract (CR-0013):
#   --real-gha + token set    -> proceed, write token to dashboard.env (authed, 5000/h)
#   --real-gha + token unset  -> red error, exit 1 (mirrors today's --fetcher precondition)
#   default / --demo          -> demo-gha upstream, no PAT, no GitHub API calls
#   --empty                   -> no fetcher at all
if [ "$MODE_REAL_GHA" = true ]; then
    if [ -z "${GHA_TOKEN:-}" ]; then
        echo "${RED}ERROR: --real-gha requires \$GHA_TOKEN to be set. Set GHA_TOKEN=<PAT> or re-run with the no-flag default for a zero-PAT demo install against the baked demo-gha upstream.${NC}" >&2
        exit 1
    fi
fi

# ---- 2. gh CLI precondition ----
# The repo + GHCR component images are private. Anonymous HTTPS asset fetch 404s,
# anonymous docker pulls 401. All three failure modes MUST exit 1 BEFORE we
# create the install dir, write any asset, or invoke docker.
if ! command -v gh >/dev/null 2>&1 || ! gh --version >/dev/null 2>&1; then
    echo "${RED}ERROR: gh CLI not found on PATH. The repo and GHCR images are private, so the installer needs gh to fetch release assets and authenticate to ghcr.io.${NC}" >&2
    echo "${RED}       Install it from https://cli.github.com/ and then run:${NC}" >&2
    echo "${RED}         gh auth login --hostname github.com${NC}" >&2
    echo "${RED}         gh auth refresh --hostname github.com --scopes read:packages${NC}" >&2
    exit 1
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
    echo "${RED}ERROR: gh is not authenticated for github.com. Run:${NC}" >&2
    echo "${RED}         gh auth login --hostname github.com${NC}" >&2
    echo "${RED}         gh auth refresh --hostname github.com --scopes read:packages${NC}" >&2
    exit 1
fi

# `gh auth status --show-token` writes "Token scopes: 'a', 'b', ..." on stderr.
# Capture both streams + match the *:packages hierarchy. GitHub's OAuth scope
# model is hierarchical -- write:packages includes read:packages, and
# admin:packages includes both -- and `gh auth status` only lists the highest
# granted scope, never the redundant subset. A regex on the union accepts any
# token that can pull from GHCR.
GH_SCOPE_OUTPUT="$(gh auth status --hostname github.com --show-token 2>&1 || true)"
if ! printf '%s' "$GH_SCOPE_OUTPUT" | grep -qE '(read|write|admin):packages'; then
    echo "${RED}ERROR: gh token for github.com lacks GHCR read access. Need one of: 'read:packages', 'write:packages', or 'admin:packages'. Run:${NC}" >&2
    echo "${RED}         gh auth refresh --hostname github.com --scopes read:packages${NC}" >&2
    exit 1
fi

# ---- 3. Install dir ----
mkdir -p "$INSTALL_DIR"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
echo "${CYAN}==> Install directory: $INSTALL_DIR${NC}"

# ---- 4. Secret handling ----
ENV_FILE="$INSTALL_DIR/dashboard.env"

# ---- 4a. Volume-detection safety net ----
# If a previous installer run left a `deployment-dashboard_pg-data` volume but
# the env-file we'd be writing into does NOT exist, refusing here prevents the
# silent failure mode where a fresh POSTGRES_PASSWORD gets generated against a
# DB seeded by the historical install (api container then 28P01s on connect).
# Run BEFORE any secret read / generation / env-file write.
if docker volume inspect deployment-dashboard_pg-data >/dev/null 2>&1 && [ ! -f "$ENV_FILE" ]; then
    echo "${RED}ERROR: Pre-existing Postgres volume detected (deployment-dashboard_pg-data) but no dashboard.env at $ENV_FILE.${NC}" >&2
    echo "" >&2
    echo "${RED}The volume holds DB state seeded by an earlier installer run. Re-using a fresh dashboard.env here would generate a new POSTGRES_PASSWORD that does not match the running cluster -- the api container would fail to connect.${NC}" >&2
    echo "" >&2
    echo "${RED}Either:${NC}" >&2
    echo "${RED}  - Pass --install-dir <path-to-prior-install> (the historical default was ./dashboard-release relative to where you first ran the installer).${NC}" >&2
    echo "${RED}  - Run uninstall.sh --volumes (or uninstall.ps1 -Volumes) to drop the pg-data volume and start fresh.${NC}" >&2
    exit 1
fi

LOCAL_DEV_API_LITERAL='local-dev-token-not-for-production'
LOCAL_DEV_PW_LITERAL='local-dev-password'

read_env_value() {
    local path="$1" key="$2"
    if [ ! -f "$path" ]; then return 0; fi
    # POSIX sed: emit first matching value after the '='. Empty stdout on no match.
    # Single-stage sed avoids the grep|head|sed pipeline's pipefail trap -- grep
    # exits 1 on no-match, which under `set -euo pipefail` propagates out of the
    # $(read_env_value ...) caller and terminates the script.
    sed -nE "s/^${key}=(.*)$/\1/p" "$path" | head -n 1
}

new_random_hex() {
    local bytes="$1"
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex "$bytes"
    else
        # /dev/urandom fall-back. `head -c` is POSIX; xxd is in vim-common.
        # On systems without xxd, `od -An -tx1` works as a last resort.
        if command -v xxd >/dev/null 2>&1; then
            head -c "$bytes" /dev/urandom | xxd -p -c "$bytes"
        else
            head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
        fi
    fi
}

# API_TOKEN
API_TOKEN="$(read_env_value "$ENV_FILE" 'API_TOKEN')"
if [ -z "${API_TOKEN}" ] || [ "$API_TOKEN" = "$LOCAL_DEV_API_LITERAL" ]; then
    if [ -n "${DASHBOARD_API_TOKEN:-}" ] && [ "$DASHBOARD_API_TOKEN" != "$LOCAL_DEV_API_LITERAL" ]; then
        API_TOKEN="$DASHBOARD_API_TOKEN"
        echo "${CYAN}==> Using API_TOKEN from \$DASHBOARD_API_TOKEN${NC}"
    else
        API_TOKEN="$(new_random_hex 32)"
        echo "${CYAN}==> Generated random API_TOKEN (64 hex chars)${NC}"
    fi
else
    echo "${CYAN}==> Reusing API_TOKEN from $ENV_FILE${NC}"
fi

# POSTGRES_PASSWORD
PG_PASSWORD="$(read_env_value "$ENV_FILE" 'POSTGRES_PASSWORD')"
if [ -z "${PG_PASSWORD}" ] || [ "$PG_PASSWORD" = "$LOCAL_DEV_PW_LITERAL" ]; then
    PG_PASSWORD="$(new_random_hex 16)"
    echo "${CYAN}==> Generated random POSTGRES_PASSWORD (32 hex chars)${NC}"
else
    echo "${CYAN}==> Reusing POSTGRES_PASSWORD from $ENV_FILE${NC}"
fi

# Capture historical demo-mode values BEFORE the secret block truncates $ENV_FILE.
# These are read here (not inside the `if [ "$MODE_DEMO" = true ]` block below)
# because the `cat > "$ENV_FILE"` write a few lines down destroys the prior
# contents. CR-0013 added GHA_API_BASE_URL to this set so the demo upstream
# retarget is also preservation-aware.
EXISTING_GHA_API_BASE_URL="$(read_env_value "$ENV_FILE" 'GHA_API_BASE_URL')"
EXISTING_GHA_REPOS="$(read_env_value "$ENV_FILE" 'GHA_REPOSITORIES')"
EXISTING_POLL="$(read_env_value "$ENV_FILE" 'FETCHER_POLL_INTERVAL_SECONDS')"
EXISTING_GHA_TOKEN="$(read_env_value "$ENV_FILE" 'GHA_TOKEN')"

# Persist env-file.
cat > "$ENV_FILE" <<EOF
# Generated by install.sh -- do not commit. Regenerated on install when secrets are missing or hold dev-literals.
POSTGRES_DB=dashboard
POSTGRES_USER=dashboard
POSTGRES_PASSWORD=$PG_PASSWORD
API_TOKEN=$API_TOKEN
DASHBOARD_VERSION=$VERSION
DASHBOARD_PORT=$PORT
ConnectionStrings__DefaultConnection=Host=db;Database=dashboard;Username=dashboard;Password=$PG_PASSWORD
EOF

# Demo mode (CR-0013): retarget the fetcher at the baked demo-gha mock
# GitHub upstream so a fresh install renders deployments with zero caller
# configuration AND zero external GitHub API calls. The fetcher's env-var
# indirection (GHA_API_BASE_URL substitution in the release compose file)
# was added by CR-0012 for the integration profile and is reused verbatim
# here -- the demo profile points the fetcher at http://demo-gha:80, the
# internal Docker DNS name of the profile-gated demo-gha service.
#
# Upgrade-flow semantics: when a prior dashboard.env already carried any of
# these keys, preserve the operator's customisation unless --reset-demo-defaults
# is set. GHA_TOKEN is intentionally NOT seeded here (the demo upstream
# never sees an Authorization header) but is preserved on upgrade-re-run so
# a later switch back to --real-gha keeps the operator's PAT. Historical
# values were captured above before the secret block truncated $ENV_FILE.
if [ "$MODE_DEMO" = true ]; then
    DEMO_GHA_API_BASE_URL_DEFAULT='http://demo-gha:80'
    DEMO_POLL_DEFAULT='5'
    DEMO_GHA_REPOS_DEFAULT='[{"owner":"demo-org","repo":"demo-repo"}]'

    printf '\n# Demo-mode defaults (CR-0013; written by install.sh)\n' >> "$ENV_FILE"

    # GHA_API_BASE_URL -- the indirection seam CR-0012 introduced; CR-0013
    # repoints it at the in-network demo-gha service. EXISTING_GHA_API_BASE_URL
    # was captured BEFORE the env-file truncate above.
    if [ "$RESET_DEMO_DEFAULTS" = true ] || [ -z "$EXISTING_GHA_API_BASE_URL" ]; then
        printf 'GHA_API_BASE_URL=%s\n' "$DEMO_GHA_API_BASE_URL_DEFAULT" >> "$ENV_FILE"
    else
        printf 'GHA_API_BASE_URL=%s\n' "$EXISTING_GHA_API_BASE_URL" >> "$ENV_FILE"
        echo "${CYAN}==> Preserving GHA_API_BASE_URL from $ENV_FILE (pass --reset-demo-defaults to overwrite)${NC}"
    fi

    if [ "$RESET_DEMO_DEFAULTS" = true ] || [ -z "$EXISTING_POLL" ]; then
        printf 'FETCHER_POLL_INTERVAL_SECONDS=%s\n' "$DEMO_POLL_DEFAULT" >> "$ENV_FILE"
    else
        printf 'FETCHER_POLL_INTERVAL_SECONDS=%s\n' "$EXISTING_POLL" >> "$ENV_FILE"
        echo "${CYAN}==> Preserving FETCHER_POLL_INTERVAL_SECONDS from $ENV_FILE (pass --reset-demo-defaults to overwrite)${NC}"
    fi

    if [ "$RESET_DEMO_DEFAULTS" = true ] || [ -z "$EXISTING_GHA_REPOS" ]; then
        printf 'GHA_REPOSITORIES=%s\n' "$DEMO_GHA_REPOS_DEFAULT" >> "$ENV_FILE"
    else
        printf 'GHA_REPOSITORIES=%s\n' "$EXISTING_GHA_REPOS" >> "$ENV_FILE"
        echo "${CYAN}==> Preserving GHA_REPOSITORIES from $ENV_FILE (pass --reset-demo-defaults to overwrite)${NC}"
    fi

    # GHA_TOKEN: not seeded for the demo profile (demo-gha is offline-mocked,
    # no Authorization header sent), but preserved on upgrade-re-run so a later
    # switch back to --real-gha keeps the operator's PAT.
    if [ "$RESET_DEMO_DEFAULTS" = false ] && [ -n "$EXISTING_GHA_TOKEN" ]; then
        printf 'GHA_TOKEN=%s\n' "$EXISTING_GHA_TOKEN" >> "$ENV_FILE"
        echo "${CYAN}==> Preserving GHA_TOKEN from $ENV_FILE (pass --reset-demo-defaults to drop)${NC}"
    fi
fi

echo "${CYAN}==> Wrote $ENV_FILE${NC}"

# ---- 5 + 6. Download release assets via gh ----
# The repo is private -- anonymous HTTPS asset fetch 404s. `gh release download`
# uses the auth context vetted by step 2. The two URL shapes (`latest` vs pinned
# tag) collapse into a single CLI: omit the positional tag for `latest`, supply
# it otherwise. `--clobber` keeps re-install idempotent against a stale install
# dir.
REPO='kostiantyn-matsebora/deployment-dashboard'

download_asset() {
    local asset="$1" dest="$2"
    echo "${CYAN}==> gh release download ($VERSION) $asset -> $dest${NC}"
    if [ "$VERSION" = "latest" ]; then
        if ! gh release download --repo "$REPO" --pattern "$asset" --output "$dest" --clobber; then
            echo "${RED}ERROR: failed to download $asset from release '$VERSION' via gh release download.${NC}" >&2
            echo "${RED}       Confirm that release '$VERSION' exists and advertises a '$asset' asset, and that the active gh account can read this repo.${NC}" >&2
            exit 1
        fi
    else
        if ! gh release download "$VERSION" --repo "$REPO" --pattern "$asset" --output "$dest" --clobber; then
            echo "${RED}ERROR: failed to download $asset from release '$VERSION' via gh release download.${NC}" >&2
            echo "${RED}       Confirm that release '$VERSION' exists and advertises a '$asset' asset, and that the active gh account can read this repo.${NC}" >&2
            exit 1
        fi
    fi
}

COMPOSE_FILE="$INSTALL_DIR/docker-compose.release.yml"
download_asset 'docker-compose.release.yml' "$COMPOSE_FILE"

# ---- 7. GHCR docker login ----
# The four component images live in private GHCR packages. Mint an ephemeral
# docker-login session using the same gh token we just validated.
# --password-stdin keeps the token off the process-args list; the username field
# is informational for ghcr (a valid GH login or the `oauth2` sentinel both work).
GH_LOGIN="$(gh api user --jq .login 2>/dev/null || true)"
if [ -z "${GH_LOGIN}" ]; then GH_LOGIN='oauth2'; fi
if ! GH_TOKEN_VALUE="$(gh auth token 2>/dev/null)" || [ -z "${GH_TOKEN_VALUE}" ]; then
    echo "${RED}ERROR: docker login ghcr.io failed -- could not obtain a token from gh auth token.${NC}" >&2
    exit 1
fi
echo "${CYAN}==> docker login ghcr.io --username $GH_LOGIN --password-stdin${NC}"
if ! printf '%s' "$GH_TOKEN_VALUE" | docker login ghcr.io --username "$GH_LOGIN" --password-stdin; then
    echo "${RED}ERROR: docker login ghcr.io failed. Verify the gh account has 'read:packages' and access to the deployment-dashboard packages.${NC}" >&2
    exit 1
fi
unset GH_TOKEN_VALUE

# ---- 8. Pull images ----
echo "${CYAN}==> docker compose -f $COMPOSE_FILE --env-file $ENV_FILE pull${NC}"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull

# ---- 9. Bring up ----
# Profile resolution per CR-0013 flag matrix:
#   default / --demo  -> --profile demo --profile fetcher
#                        (demo-gha + fetcher-pointing-at-demo-gha)
#   --real-gha        -> --profile fetcher
#                        (fetcher-pointing-at-api.github.com; demo-gha inert)
#   --empty           -> no extra profiles
#                        (db + api + gateway + dashboard only)
COMPOSE_ARGS=(-f "$COMPOSE_FILE" --env-file "$ENV_FILE")
if [ "$MODE_DEMO" = true ]; then
    COMPOSE_ARGS+=(--profile demo --profile fetcher)
elif [ "$MODE_REAL_GHA" = true ]; then
    COMPOSE_ARGS+=(--profile fetcher)
fi
# MODE_EMPTY -- intentionally no profiles appended.

echo "${CYAN}==> docker compose ${COMPOSE_ARGS[*]} up -d --wait${NC}"
if ! docker compose "${COMPOSE_ARGS[@]}" up -d --wait; then
    docker compose "${COMPOSE_ARGS[@]}" logs --tail=50 || true
    echo "${RED}docker compose up failed${NC}" >&2
    exit 1
fi

# ---- 10. Health-poll ----
HEALTH_URL="http://localhost:$PORT/health"
echo "${CYAN}==> Waiting up to ${HEALTH_TIMEOUT_SECONDS}s for $HEALTH_URL${NC}"
DEADLINE=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
OK=false
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    if curl -fsS -o /dev/null --max-time 3 "$HEALTH_URL"; then OK=true; break; fi
    sleep 2
done
if [ "$OK" = false ]; then
    docker compose "${COMPOSE_ARGS[@]}" logs --tail=50 || true
    echo "${RED}Gateway-fronted /health did not return 200 at $HEALTH_URL within ${HEALTH_TIMEOUT_SECONDS}s.${NC}" >&2
    exit 1
fi

# ---- 11. URL panel ----
echo ""
echo "  Dashboard / Gateway: http://localhost:$PORT/"
echo "  API_TOKEN:           $API_TOKEN (saved to $ENV_FILE)"
echo "  Postgres (dev):      localhost:5432 (user: dashboard / password in $ENV_FILE)"
if [ "$MODE_DEMO" = true ]; then
    CURRENT_POLL="$(read_env_value "$ENV_FILE" 'FETCHER_POLL_INTERVAL_SECONDS')"
    echo "${CYAN}  Mode:                Demo (default) -- demo-gha + fetcher; offline, zero-PAT${NC}"
    echo "${CYAN}  Demo upstream:       http://demo-gha:80 (internal; baked WireMock.Net bundle)${NC}"
    echo "${CYAN}  Poll cadence:        ${CURRENT_POLL} s${NC}"
elif [ "$MODE_REAL_GHA" = true ]; then
    echo "${CYAN}  Mode:                RealGha -- fetcher pointed at https://api.github.com (authed, 5000 req/h)${NC}"
elif [ "$MODE_EMPTY" = true ]; then
    echo "${CYAN}  Mode:                Empty -- no fetcher, no demo-gha. Direct-POST integrators only.${NC}"
fi
echo ""
echo "  curl -X POST http://localhost:$PORT/api/deployments -H 'Content-Type: application/json' -H 'X-Api-Key: $API_TOKEN' -d '{\"service\":\"adminportal\",\"environment\":\"dev\",\"version\":\"v2.3.1\",\"status\":\"success\",\"run_url\":\"https://example.test/run/1\",\"run_number\":1,\"actor\":\"local\"}'"
