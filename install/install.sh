#!/usr/bin/env bash
# Install + start a released Deployment Dashboard stack on the current host.
# Image-only -- no git clone, no source tree, no .NET SDK required.
#
# Release-install primary entrypoint (Option A per GitHub issue #7). The companion
# contributor flow is dev_env/start.ps1, which depends on a cloned repo.
#
# Bash sibling of install.ps1 -- CLI parity, identical step order:
#   1.  GHA_TOKEN precondition (issue #5 verbatim, ANSI-coloured on tty).
#   2.  Install dir.
#   3.  Secret handling (API_TOKEN + POSTGRES_PASSWORD; refuses the dev-literals).
#   4.  Download docker-compose.release.yml from the tag-pinned release URL.
#   5.  Download migration.sql (unless --skip-migrations).
#   6.  docker compose pull.
#   7.  docker compose up -d --wait (with --profile migrate and/or --profile fetcher).
#   8.  Health-poll http://localhost:$PORT/health.
#   9.  URL panel.
#
# Per ADR-0005: migrations apply via a one-shot postgres:16-alpine container
# running `psql -f /migration.sql`. The script is idempotent.
#
# Soft prereq: openssl for `openssl rand -hex`. Falls back to /dev/urandom + xxd.

set -euo pipefail

# ---- Defaults ----
VERSION='latest'
FETCHER=false
ALLOW_MISSING_GHA_TOKEN=false
SKIP_MIGRATIONS=false
PORT=8080
HEALTH_TIMEOUT_SECONDS=60
INSTALL_DIR="$PWD/dashboard-release"

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

Options:
  -v, --version <tag>                  Release tag (default: latest).
  -f, --fetcher                        Activate the fetcher Compose profile.
      --allow-missing-gha-token        Permit -f when GHA_TOKEN is unset.
      --skip-migrations                Bring stack up without applying migrations.
  -p, --port <int>                     Host port for the gateway (default: 8080).
      --health-timeout-seconds <int>   /health poll timeout (default: 60).
      --install-dir <path>             Install directory (default: ./dashboard-release).
  -h, --help                           Show this help.

Examples:
  ./install.sh
  ./install.sh --version v1.2.3
  ./install.sh --fetcher
  ./install.sh --port 9090 --install-dir /opt/dashboard
EOF
}

# ---- Arg parsing (case-based for portability) ----
while [ $# -gt 0 ]; do
    case "$1" in
        -v|--version) VERSION="$2"; shift 2 ;;
        -f|--fetcher) FETCHER=true; shift ;;
        --allow-missing-gha-token) ALLOW_MISSING_GHA_TOKEN=true; shift ;;
        --skip-migrations) SKIP_MIGRATIONS=true; shift ;;
        -p|--port) PORT="$2"; shift 2 ;;
        --health-timeout-seconds) HEALTH_TIMEOUT_SECONDS="$2"; shift 2 ;;
        --install-dir) INSTALL_DIR="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "${RED}ERROR: unknown argument '$1'${NC}" >&2; usage >&2; exit 2 ;;
    esac
done

# ---- 1. GHA_TOKEN precondition (issue #5 parity) ----
if [ "$FETCHER" = true ]; then
    TOKEN_SET=true
    if [ -z "${GHA_TOKEN:-}" ]; then TOKEN_SET=false; fi
    if [ "$TOKEN_SET" = false ] && [ "$ALLOW_MISSING_GHA_TOKEN" = false ]; then
        echo "${RED}ERROR: --fetcher requires \$GHA_TOKEN to be set. Set GHA_TOKEN=<PAT> or re-run with --allow-missing-gha-token to use the placeholder.${NC}" >&2
        exit 1
    fi
    if [ "$TOKEN_SET" = false ]; then
        echo "${YELLOW}GHA_TOKEN not set - fetcher will boot with placeholder; GitHub API calls will 401.${NC}"
    fi
fi

# ---- 2. Install dir ----
mkdir -p "$INSTALL_DIR"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
echo "${CYAN}==> Install directory: $INSTALL_DIR${NC}"

# ---- 3. Secret handling ----
ENV_FILE="$INSTALL_DIR/dashboard.env"
LOCAL_DEV_API_LITERAL='local-dev-token-not-for-production'
LOCAL_DEV_PW_LITERAL='local-dev-password'

read_env_value() {
    local path="$1" key="$2"
    if [ ! -f "$path" ]; then return 0; fi
    # POSIX grep: emit first matching value after the '='. Empty stdout on no match.
    grep -E "^${key}=" "$path" | head -n 1 | sed -E "s/^${key}=//"
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
echo "${CYAN}==> Wrote $ENV_FILE${NC}"

# ---- 4 + 5. Download release assets ----
# GitHub's canonical URL shapes differ between floating "latest" and pinned tags:
#   - latest:    https://github.com/<repo>/releases/latest/download/<asset>
#   - pinned vX: https://github.com/<repo>/releases/download/<vX>/<asset>
# Using the pinned shape with the literal string "latest" 404s.
REPO='kostiantyn-matsebora/deployment-dashboard'
if [ "$VERSION" = "latest" ]; then
    RELEASE_BASE="https://github.com/$REPO/releases/latest/download"
else
    RELEASE_BASE="https://github.com/$REPO/releases/download/$VERSION"
fi

download_asset() {
    local asset="$1" dest="$2"
    local url="$RELEASE_BASE/$asset"
    echo "${CYAN}==> Downloading $url${NC}"
    if ! curl -fsSL -o "$dest" "$url"; then
        echo "${RED}ERROR: failed to download $asset from $url${NC}" >&2
        echo "${RED}       Confirm that release '$VERSION' exists and advertises a '$asset' asset.${NC}" >&2
        exit 1
    fi
}

COMPOSE_FILE="$INSTALL_DIR/docker-compose.release.yml"
download_asset 'docker-compose.release.yml' "$COMPOSE_FILE"

if [ "$SKIP_MIGRATIONS" = false ]; then
    MIGRATION_FILE="$INSTALL_DIR/migration.sql"
    download_asset 'migration.sql' "$MIGRATION_FILE"
fi

# ---- 6. Pull images ----
echo "${CYAN}==> docker compose -f $COMPOSE_FILE --env-file $ENV_FILE pull${NC}"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull

# ---- 7. Bring up ----
COMPOSE_ARGS=(-f "$COMPOSE_FILE" --env-file "$ENV_FILE")
if [ "$SKIP_MIGRATIONS" = false ]; then COMPOSE_ARGS+=(--profile migrate); fi
if [ "$FETCHER" = true ]; then COMPOSE_ARGS+=(--profile fetcher); fi

echo "${CYAN}==> docker compose ${COMPOSE_ARGS[*]} up -d --wait${NC}"
if ! docker compose "${COMPOSE_ARGS[@]}" up -d --wait; then
    docker compose "${COMPOSE_ARGS[@]}" logs --tail=50 || true
    echo "${RED}docker compose up failed${NC}" >&2
    exit 1
fi

# ---- 8. Health-poll ----
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

# ---- 9. URL panel ----
echo ""
echo "  Dashboard / Gateway: http://localhost:$PORT/"
echo "  API_TOKEN:           $API_TOKEN (saved to $ENV_FILE)"
echo "  Postgres (dev):      localhost:5432 (user: dashboard / password in $ENV_FILE)"
if [ "$FETCHER" = true ]; then
    echo "  Fetcher:             profile 'fetcher' active - POSTs to gateway as dashboard-fetcher/github-actions"
fi
if [ "$SKIP_MIGRATIONS" = true ]; then
    echo "${YELLOW}  Migrations skipped - API likely failing. Re-run without --skip-migrations to apply.${NC}"
fi
echo ""
echo "  curl -X POST http://localhost:$PORT/api/deployments -H 'Content-Type: application/json' -H 'X-Api-Key: $API_TOKEN' -d '{\"service\":\"adminportal\",\"environment\":\"dev\",\"version\":\"v2.3.1\",\"status\":\"success\",\"run_url\":\"https://example.test/run/1\",\"run_number\":1,\"actor\":\"local\"}'"
