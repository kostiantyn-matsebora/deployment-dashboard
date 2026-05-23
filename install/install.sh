#!/usr/bin/env bash
# Install + start a released Deployment Dashboard stack on the current host.
# Image-only -- no git clone, no source tree, no .NET SDK required.
#
# Release-install primary entrypoint (Option A per GitHub issue #7).
# Per CR-0013 the no-flag default is the *demo stack* -- a self-contained
# stack with the baked demo-gha mock GitHub Actions upstream + fetcher
# pointing at it. Zero-PAT, zero external network, populated dashboard
# within ~60s.
#
# CR-0014: bring-up logic extracted to install/_bringup-core.sh (sourced below).
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
#   --build-locally      Passed by dev_env/start.ps1 subprocess delegation.
#                        No-op at helper boundary per S5.
#
# Bash sibling of install.ps1 -- CLI parity, identical step order.
#
# Per ADR-0009: the API self-migrates on start; the installer does not actuate migrations.
#
# Soft prereq: openssl for `openssl rand -hex`. Falls back to /dev/urandom + xxd.

set -euo pipefail

# CR-0014: source the shared helper (colocated under install/ per S1).
# shellcheck source=_bringup-core.sh
source "$(dirname "$0")/_bringup-core.sh"

# ---- Defaults ----
VERSION='latest'
REAL_GHA=false
EMPTY=false
DEMO=false
BUILD_LOCALLY=false
RESET_DEMO_DEFAULTS=false
PORT=8080
HEALTH_TIMEOUT_SECONDS=60
INSTALL_DIR="$HOME/.dashboard-release"

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
                                       FETCHER_POLL_INTERVAL_SECONDS, GHA_TOKEN,
                                       POSTGRES_PASSWORD, API_TOKEN) even when
                                       a prior dashboard.env already carries them.
                                       Without this, an upgrade re-run on the
                                       demo path preserves operator customisation.
      --build-locally                  No-op flag; accepted for compatibility
                                       with start.ps1 subprocess delegation (S5).
  -p, --port <int>                     Host port for the gateway (default: 8080).
      --health-timeout-seconds <int>   /health poll timeout (default: 60).
      --install-dir <path>             Install directory (default: \$HOME/.dashboard-release).
  -h, --help                           Show this help.

Upgrade flow (v0.3.0 -> v0.4.0 worked example):
  Pass --install-dir pointing at the prior install dir to preserve the
  generated secrets + DB volume.

Examples:
  ./install.sh
  ./install.sh --version v1.2.3
  GHA_TOKEN=<PAT> ./install.sh --real-gha
  ./install.sh --empty
  ./install.sh --port 9090 --install-dir /opt/dashboard
  ./install.sh --version v0.4.0 --install-dir /opt/dashboard
  ./install.sh --reset-demo-defaults
EOF
}

# ---- Arg parsing ----
while [ $# -gt 0 ]; do
    case "$1" in
        -v|--version) VERSION="$2"; shift 2 ;;
        --real-gha) REAL_GHA=true; shift ;;
        --empty) EMPTY=true; shift ;;
        --demo) DEMO=true; shift ;;
        --reset-demo-defaults) RESET_DEMO_DEFAULTS=true; shift ;;
        --build-locally) BUILD_LOCALLY=true; shift ;;
        -p|--port) PORT="$2"; shift 2 ;;
        --health-timeout-seconds) HEALTH_TIMEOUT_SECONDS="$2"; shift 2 ;;
        --install-dir) INSTALL_DIR="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "${_DD_RED}ERROR: unknown argument '$1'${_DD_NC}" >&2; usage >&2; exit 2 ;;
    esac
done

# ---- 0. Resolve the install mode from the flag matrix (CR-0013) ----
CONFLICT_COUNT=0
if [ "$REAL_GHA" = true ]; then CONFLICT_COUNT=$((CONFLICT_COUNT + 1)); fi
if [ "$EMPTY" = true ];    then CONFLICT_COUNT=$((CONFLICT_COUNT + 1)); fi
if [ "$DEMO" = true ];     then CONFLICT_COUNT=$((CONFLICT_COUNT + 1)); fi
if [ "$CONFLICT_COUNT" -gt 1 ]; then
    echo "${_DD_RED}ERROR: --real-gha, --empty, and --demo are mutually exclusive. Pick at most one.${_DD_NC}" >&2
    exit 1
fi

MODE_REAL_GHA="$REAL_GHA"
MODE_EMPTY="$EMPTY"
MODE_DEMO=true
if [ "$MODE_REAL_GHA" = true ] || [ "$MODE_EMPTY" = true ]; then MODE_DEMO=false; fi

if [ "$DEMO" = true ]; then
    echo "${_DD_YELLOW}INFO: demo is now the default; --demo flag is redundant -- drop it from your install command after this release cycle.${_DD_NC}"
fi

# ---- 1. GHA_TOKEN precondition (issue #5 verbatim, scoped to --real-gha) ----
if [ "$MODE_REAL_GHA" = true ]; then
    if [ -z "${GHA_TOKEN:-}" ]; then
        echo "${_DD_RED}ERROR: --real-gha requires \$GHA_TOKEN to be set. Set GHA_TOKEN=<PAT> or re-run with the no-flag default for a zero-PAT demo install against the baked demo-gha upstream.${_DD_NC}" >&2
        exit 1
    fi
fi

# ---- 2. gh CLI precondition ----
if ! command -v gh >/dev/null 2>&1 || ! gh --version >/dev/null 2>&1; then
    echo "${_DD_RED}ERROR: gh CLI not found on PATH. The repo and GHCR images are private, so the installer needs gh to fetch release assets and authenticate to ghcr.io.${_DD_NC}" >&2
    echo "${_DD_RED}       Install it from https://cli.github.com/ and then run:${_DD_NC}" >&2
    echo "${_DD_RED}         gh auth login --hostname github.com${_DD_NC}" >&2
    echo "${_DD_RED}         gh auth refresh --hostname github.com --scopes read:packages${_DD_NC}" >&2
    exit 1
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
    echo "${_DD_RED}ERROR: gh is not authenticated for github.com. Run:${_DD_NC}" >&2
    echo "${_DD_RED}         gh auth login --hostname github.com${_DD_NC}" >&2
    echo "${_DD_RED}         gh auth refresh --hostname github.com --scopes read:packages${_DD_NC}" >&2
    exit 1
fi

GH_SCOPE_OUTPUT="$(gh auth status --hostname github.com --show-token 2>&1 || true)"
if ! printf '%s' "$GH_SCOPE_OUTPUT" | grep -qE '(read|write|admin):packages'; then
    echo "${_DD_RED}ERROR: gh token for github.com lacks GHCR read access. Need one of: 'read:packages', 'write:packages', or 'admin:packages'. Run:${_DD_NC}" >&2
    echo "${_DD_RED}         gh auth refresh --hostname github.com --scopes read:packages${_DD_NC}" >&2
    exit 1
fi

# ---- 3. Install dir ----
mkdir -p "$INSTALL_DIR"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
echo "${_DD_CYAN}==> Install directory: $INSTALL_DIR${_DD_NC}"

ENV_FILE="$INSTALL_DIR/dashboard.env"

# ---- 4a. Volume-detection safety net + --reset-demo-defaults drift guard ----
if [ "$MODE_DEMO" = true ]; then
    # Demo path: skip test_pg_volume_conflict per S8.
    # --reset-demo-defaults drift guard per CR-0014 § 3c + OI-4.
    if docker volume inspect deployment-dashboard_pg-data >/dev/null 2>&1; then
        PERSISTED_PG=''
        if [ -f "$ENV_FILE" ]; then
            PERSISTED_PG="$(_dd_read_env_value "$ENV_FILE" 'POSTGRES_PASSWORD')"
        fi
        if [ -n "$PERSISTED_PG" ] && [ "$PERSISTED_PG" != 'local-dev-password' ]; then
            if [ "$RESET_DEMO_DEFAULTS" = false ]; then
                echo "${_DD_RED}ERROR: Demo re-run detected with a pg volume initialised under different credentials (POSTGRES_PASSWORD in $ENV_FILE is not 'local-dev-password').${_DD_NC}" >&2
                echo "" >&2
                echo "${_DD_RED}Remediation paths:${_DD_NC}" >&2
                echo "${_DD_RED}  1. Re-run with --reset-demo-defaults (force-overwrites dashboard.env with demo literals, then run uninstall --remove-data before next bringup).${_DD_NC}" >&2
                echo "${_DD_RED}  2. Run uninstall.sh --remove-data then re-run install.sh (clean slate).${_DD_NC}" >&2
                echo "${_DD_RED}  3. Manually edit $ENV_FILE and set POSTGRES_PASSWORD=local-dev-password (only if you know the cluster was seeded with that password).${_DD_NC}" >&2
                exit 1
            else
                echo "${_DD_YELLOW}WARNING: --reset-demo-defaults set. Overwriting dashboard.env with demo credentials.${_DD_NC}"
                echo "${_DD_YELLOW}WARNING: You MUST run 'uninstall.sh --remove-data' before the next bringup to drop the incompatible pg volume.${_DD_NC}"
            fi
        fi
    fi
else
    # Non-demo path: run the volume conflict guard per S8.
    test_pg_volume_conflict 'deployment-dashboard_pg-data' "$ENV_FILE" "$INSTALL_DIR"
fi

# ---- 4b. Secret handling via helper ----
eval "$(resolve_dashboard_secrets "$ENV_FILE" "$MODE_DEMO" "$RESET_DEMO_DEFAULTS")"
# API_TOKEN and PG_PASSWORD are now set in the current shell scope.

# ---- 4c. Persist env-file ----
if [ "$MODE_DEMO" = true ]; then
    # Capture demo defaults as an array of lines.
    mapfile -t DEMO_LINES < <(resolve_demo_env_defaults "$ENV_FILE" "$RESET_DEMO_DEFAULTS")
    write_dashboard_env_file "$ENV_FILE" "$VERSION" "$PORT" "$API_TOKEN" "$PG_PASSWORD" "${DEMO_LINES[@]}"
else
    write_dashboard_env_file "$ENV_FILE" "$VERSION" "$PORT" "$API_TOKEN" "$PG_PASSWORD"
fi
echo "${_DD_CYAN}==> Wrote $ENV_FILE${_DD_NC}"

# ---- 5 + 6. Download release assets via gh ----
REPO='kostiantyn-matsebora/deployment-dashboard'

download_asset() {
    local asset="$1" dest="$2"
    echo "${_DD_CYAN}==> gh release download ($VERSION) $asset -> $dest${_DD_NC}"
    if [ "$VERSION" = "latest" ]; then
        if ! gh release download --repo "$REPO" --pattern "$asset" --output "$dest" --clobber; then
            echo "${_DD_RED}ERROR: failed to download $asset from release '$VERSION' via gh release download.${_DD_NC}" >&2
            echo "${_DD_RED}       Confirm that release '$VERSION' exists and advertises a '$asset' asset, and that the active gh account can read this repo.${_DD_NC}" >&2
            exit 1
        fi
    else
        if ! gh release download "$VERSION" --repo "$REPO" --pattern "$asset" --output "$dest" --clobber; then
            echo "${_DD_RED}ERROR: failed to download $asset from release '$VERSION' via gh release download.${_DD_NC}" >&2
            echo "${_DD_RED}       Confirm that release '$VERSION' exists and advertises a '$asset' asset, and that the active gh account can read this repo.${_DD_NC}" >&2
            exit 1
        fi
    fi
}

COMPOSE_FILE="$INSTALL_DIR/docker-compose.release.yml"
download_asset 'docker-compose.release.yml' "$COMPOSE_FILE"

# ---- 7. GHCR docker login ----
GH_LOGIN="$(gh api user --jq .login 2>/dev/null || true)"
if [ -z "${GH_LOGIN}" ]; then GH_LOGIN='oauth2'; fi
if ! GH_TOKEN_VALUE="$(gh auth token 2>/dev/null)" || [ -z "${GH_TOKEN_VALUE}" ]; then
    echo "${_DD_RED}ERROR: docker login ghcr.io failed -- could not obtain a token from gh auth token.${_DD_NC}" >&2
    exit 1
fi
echo "${_DD_CYAN}==> docker login ghcr.io --username $GH_LOGIN --password-stdin${_DD_NC}"
if ! printf '%s' "$GH_TOKEN_VALUE" | docker login ghcr.io --username "$GH_LOGIN" --password-stdin; then
    echo "${_DD_RED}ERROR: docker login ghcr.io failed. Verify the gh account has 'read:packages' and access to the deployment-dashboard packages.${_DD_NC}" >&2
    exit 1
fi
unset GH_TOKEN_VALUE

# ---- 8. Build compose args via helper + pull images ----
mapfile -t COMPOSE_ARGS < <(resolve_compose_args \
    "$MODE_DEMO" "$MODE_REAL_GHA" "$MODE_EMPTY" "$BUILD_LOCALLY" \
    "$COMPOSE_FILE" "$ENV_FILE")

echo "${_DD_CYAN}==> docker compose ${COMPOSE_ARGS[*]} pull${_DD_NC}"
docker compose "${COMPOSE_ARGS[@]}" pull

# ---- 9. Bring up ----
# --force-recreate (issue #53): GHCR :latest digest swaps are invisible to
# compose's textual-equality heuristic. Unconditional --force-recreate guarantees
# the new image is in flight for every release-install service.
echo "${_DD_CYAN}==> All services will be recreated (--force-recreate ensures GHCR digest changes are picked up).${_DD_NC}"
echo "${_DD_CYAN}==> docker compose ${COMPOSE_ARGS[*]} up -d --wait --force-recreate${_DD_NC}"
if ! docker compose "${COMPOSE_ARGS[@]}" up -d --wait --force-recreate; then
    docker compose "${COMPOSE_ARGS[@]}" logs --tail=50 || true
    echo "${_DD_RED}docker compose up --force-recreate failed${_DD_NC}" >&2
    exit 1
fi

# ---- 10. Health-poll via helper ----
HEALTH_URL="http://localhost:$PORT/health"
wait_dashboard_health "$HEALTH_URL" "$HEALTH_TIMEOUT_SECONDS" "${COMPOSE_ARGS[@]}"

# ---- 11. URL panel via helper ----
write_dashboard_url_panel "$PORT" "$API_TOKEN" "$ENV_FILE" "$MODE_DEMO" "$MODE_REAL_GHA" "$MODE_EMPTY"
