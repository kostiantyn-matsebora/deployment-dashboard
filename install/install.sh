#!/usr/bin/env bash
# Install + start a released Deployment Dashboard stack on the current host.
# Image-only -- no git clone, no source tree, no .NET SDK required.
#
# Per issue #72, the release stack no longer bundles Postgres by default.
# The default install path assumes an external Postgres endpoint supplied
# via ConnectionStrings__DefaultConnection in the environment.
#
# Usage:
#   ./install.sh [OPTIONS]
#
# Options:
#   --local-db             Start the bundled Postgres container (--profile db).
#                          Sets ConnectionStrings__DefaultConnection automatically.
#   --real-gha             Real GitHub Actions upstream + fetcher (--profile fetcher).
#                          Requires GHA_TOKEN in the environment.
#   --demo                 Full demo stack: bundled Postgres + demo-gha mock + fetcher.
#                          Zero-PAT, self-contained, offline.
#   -v, --version <tag>    Release tag (default: latest).
#   -p, --port <int>       Host port for the gateway (default: 8080).
#   --install-dir <path>   Install directory (default: $HOME/.dashboard-release).
#   --health-timeout <s>   Seconds to wait for /health (default: 60).
#   -h, --help             Show this help.
#
# ConnectionStrings__DefaultConnection precondition (ASR-D):
#   When neither --local-db nor --demo is set, the installer fails fast (exit 1)
#   if ConnectionStrings__DefaultConnection is not set in the environment.
#   Resolution paths:
#     1. Pass --local-db to start the bundled Postgres container.
#     2. Pass --demo for the full self-contained demo stack.
#     3. export ConnectionStrings__DefaultConnection='Host=...;...' before running.
#
# Examples:
#   ./install.sh --local-db
#   ./install.sh --demo
#   export GHA_TOKEN='<PAT>'; export ConnectionStrings__DefaultConnection='Host=...'; ./install.sh --real-gha
#   ./install.sh --version v1.2.3 --local-db

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---- ANSI colours (tty only) ----
if [ -t 1 ]; then
    _RED=$'\033[31m'; _YEL=$'\033[33m'; _CYA=$'\033[36m'; _NC=$'\033[0m'
else
    _RED=''; _YEL=''; _CYA=''; _NC=''
fi

VERSION='latest'
PORT=8080
INSTALL_DIR="${HOME}/.dashboard-release"
HEALTH_TIMEOUT=60
FLAG_LOCAL_DB=false
FLAG_REAL_GHA=false
FLAG_DEMO=false

while [ $# -gt 0 ]; do
    case "$1" in
        --local-db)            FLAG_LOCAL_DB=true; shift ;;
        --real-gha)            FLAG_REAL_GHA=true; shift ;;
        --demo)                FLAG_DEMO=true; shift ;;
        -v|--version)          VERSION="$2"; shift 2 ;;
        -p|--port)             PORT="$2"; shift 2 ;;
        --install-dir)         INSTALL_DIR="$2"; shift 2 ;;
        --health-timeout)      HEALTH_TIMEOUT="$2"; shift 2 ;;
        -h|--help)
            sed -n '/^# Usage:/,/^[^#]/{ /^#/{ s/^# \{0,2\}//; p } }' "$0"
            exit 0
            ;;
        *) echo "${_RED}ERROR: unknown argument '$1'${_NC}" >&2; exit 2 ;;
    esac
done

# ---- 0. Mutual-exclusion guard ----
if [ "$FLAG_DEMO" = true ] && [ "$FLAG_REAL_GHA" = true ]; then
    echo "${_RED}ERROR: --demo and --real-gha are mutually exclusive.${_NC}" >&2
    exit 1
fi
if [ "$FLAG_DEMO" = true ] && [ "$FLAG_LOCAL_DB" = true ]; then
    echo "${_RED}ERROR: --demo and --local-db are mutually exclusive. --demo already activates the bundled Postgres.${_NC}" >&2
    exit 1
fi

# ---- 1. --real-gha GHA_TOKEN precondition ----
if [ "$FLAG_REAL_GHA" = true ]; then
    if [ -z "${GHA_TOKEN:-}" ]; then
        echo "${_RED}ERROR: --real-gha requires GHA_TOKEN to be set in the environment.${_NC}" >&2
        echo "${_RED}  export GHA_TOKEN='<your-github-pat>'${_NC}" >&2
        exit 1
    fi
fi

# ---- 2. ASR-D: ConnectionStrings__DefaultConnection precondition ----
if [ "$FLAG_LOCAL_DB" = false ] && [ "$FLAG_DEMO" = false ]; then
    CONN_STR="${ConnectionStrings__DefaultConnection:-}"
    INSTALL_ENV_FILE="${INSTALL_DIR}/dashboard.env"
    CONN_FROM_FILE=''
    if [ -f "$INSTALL_ENV_FILE" ]; then
        CONN_FROM_FILE="$(grep -m1 '^ConnectionStrings__DefaultConnection=' "$INSTALL_ENV_FILE" | cut -d= -f2- || true)"
    fi
    if [ -z "$CONN_STR" ] && [ -z "$CONN_FROM_FILE" ]; then
        echo "${_RED}ERROR: ConnectionStrings__DefaultConnection is not set. The default install path (no --local-db, no --demo) expects an external Postgres endpoint.${_NC}" >&2
        echo "" >&2
        echo "${_RED}Resolution paths:${_NC}" >&2
        echo "${_RED}  1. Pass --local-db to start the bundled Postgres container.${_NC}" >&2
        echo "${_RED}  2. Pass --demo for the full self-contained demo stack.${_NC}" >&2
        echo "${_RED}  3. export ConnectionStrings__DefaultConnection='Host=<host>;Database=dashboard;Username=<user>;Password=<password>'${_NC}" >&2
        exit 1
    fi
fi

# ---- 3. gh CLI precondition ----
if ! command -v gh >/dev/null 2>&1; then
    echo "${_RED}ERROR: 'gh' CLI not found on PATH. Install via 'brew install gh' (macOS) / 'apt install gh' (Debian/Ubuntu) / 'dnf install gh' (Fedora/RHEL), then re-run.${_NC}" >&2
    exit 1
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
    echo "${_RED}ERROR: gh is not authenticated for github.com. Run 'gh auth login' and retry.${_NC}" >&2
    exit 1
fi

GH_SCOPE_OUTPUT="$(gh auth status --hostname github.com --show-token 2>&1 || true)"
if ! echo "$GH_SCOPE_OUTPUT" | grep -qE '(read|write|admin):packages'; then
    echo "${_RED}ERROR: gh token for github.com lacks GHCR read access. Need one of: 'read:packages', 'write:packages', or 'admin:packages'. Run 'gh auth refresh --hostname github.com --scopes read:packages' and retry.${_NC}" >&2
    exit 1
fi

# ---- 4. Install dir ----
mkdir -p "$INSTALL_DIR"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
echo "${_CYA}==> Install directory: $INSTALL_DIR${_NC}"
ENV_FILE="${INSTALL_DIR}/dashboard.env"

# ---- 5. Download release assets ----
REPO='kostiantyn-matsebora/deployment-dashboard'
RELEASE_COMPOSE="${INSTALL_DIR}/docker-compose.release.yml"
DEMO_COMPOSE="${INSTALL_DIR}/docker-compose.demo.yml"

invoke_asset_download() {
    local asset="$1" dest="$2"
    echo "${_CYA}==> gh release download ($VERSION) $asset -> $dest${_NC}"
    if [ "$VERSION" = 'latest' ]; then
        gh release download --repo "$REPO" --pattern "$asset" --output "$dest" --clobber
    else
        gh release download "$VERSION" --repo "$REPO" --pattern "$asset" --output "$dest" --clobber
    fi
}

invoke_asset_download 'docker-compose.release.yml' "$RELEASE_COMPOSE"
if [ "$FLAG_DEMO" = true ]; then
    invoke_asset_download 'docker-compose.demo.yml' "$DEMO_COMPOSE"
fi

# ---- 6. GHCR docker login ----
GH_LOGIN="$(gh api user --jq .login 2>/dev/null || echo oauth2)"
GH_TOKEN="$(gh auth token)"
echo "${_CYA}==> docker login ghcr.io --username $GH_LOGIN${_NC}"
if ! printf '%s' "$GH_TOKEN" | docker login ghcr.io --username "$GH_LOGIN" --password-stdin; then
    rc=$?
    unset GH_TOKEN
    printf 'ERROR: docker login ghcr.io failed (exit %d).\n' "$rc" 1>&2
    exit 1
fi
unset GH_TOKEN

# ---- 7. Set env vars for compose substitution ----
[ "$VERSION" != 'latest' ] && export DASHBOARD_VERSION="$VERSION"
[ "$PORT" -ne 8080 ]       && export DASHBOARD_PORT="$PORT"

if [ "$FLAG_LOCAL_DB" = true ] && [ -z "${ConnectionStrings__DefaultConnection:-}" ]; then
    PG_PW="${POSTGRES_PASSWORD:-local-dev-password}"
    if [ -z "${POSTGRES_PASSWORD:-}" ]; then
        echo "${_YEL}INFO: POSTGRES_PASSWORD not set; defaulting to 'local-dev-password' for bundled db.${_NC}"
        export POSTGRES_PASSWORD="$PG_PW"
    fi
    export "ConnectionStrings__DefaultConnection=Host=db;Database=dashboard;Username=dashboard;Password=${PG_PW}"
fi

# ---- 8. Build compose args ----
COMPOSE_ARGS=(-f "$RELEASE_COMPOSE")
if [ "$FLAG_DEMO" = true ]; then
    COMPOSE_ARGS+=(-f "$DEMO_COMPOSE")
fi
if [ -f "$ENV_FILE" ]; then
    COMPOSE_ARGS+=(--env-file "$ENV_FILE")
fi

if [ "$FLAG_DEMO" = true ]; then
    COMPOSE_ARGS+=(--profile db --profile fetcher)
elif [ "$FLAG_LOCAL_DB" = true ] && [ "$FLAG_REAL_GHA" = true ]; then
    COMPOSE_ARGS+=(--profile db --profile fetcher)
elif [ "$FLAG_LOCAL_DB" = true ]; then
    COMPOSE_ARGS+=(--profile db)
elif [ "$FLAG_REAL_GHA" = true ]; then
    COMPOSE_ARGS+=(--profile fetcher)
fi
# Default (no flag): no profiles -- app-only, external Postgres.

# ---- 9. Pull images ----
echo "${_CYA}==> docker compose ${COMPOSE_ARGS[*]} pull${_NC}"
docker compose "${COMPOSE_ARGS[@]}" pull

# ---- 10. Bring up ----
echo "${_CYA}==> docker compose ${COMPOSE_ARGS[*]} up -d --wait --force-recreate${_NC}"
docker compose "${COMPOSE_ARGS[@]}" up -d --wait --force-recreate

# ---- 11. Health-poll ----
HEALTH_URL="http://localhost:${PORT}/health"
echo "${_CYA}==> Waiting up to ${HEALTH_TIMEOUT}s for ${HEALTH_URL}${_NC}"
DEADLINE=$(( $(date +%s) + HEALTH_TIMEOUT ))
OK=false
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
        OK=true; break
    fi
    sleep 2
done
if [ "$OK" = false ]; then
    docker compose "${COMPOSE_ARGS[@]}" logs --tail=50
    echo "${_RED}ERROR: /health did not return 200 at $HEALTH_URL within ${HEALTH_TIMEOUT}s.${_NC}" >&2
    exit 1
fi

# ---- 12. URL panel ----
echo ""
echo "  Dashboard: http://localhost:${PORT}/"
if [ "$FLAG_DEMO" = true ]; then
    echo "  Mode: Demo (self-contained mock upstream, offline, zero-PAT)"
elif [ "$FLAG_REAL_GHA" = true ]; then
    echo "  Mode: RealGha (fetcher points at https://api.github.com)"
elif [ "$FLAG_LOCAL_DB" = true ]; then
    echo "  Mode: LocalDb (bundled Postgres, external fetcher path)"
else
    echo "  Mode: App-only (external Postgres, no fetcher)"
fi
echo ""
