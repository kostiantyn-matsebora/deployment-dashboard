#!/usr/bin/env bash
# Tear down a release-installed Deployment Dashboard stack.
# Bash sibling of uninstall.ps1.
#
# Default behaviour preserves the named pg-data volume and <InstallDir>/dashboard.env.
# Pass --remove-data to drop the volume; pass --remove-secrets to delete dashboard.env.
# --remove-data is irreversible.

set -euo pipefail

INSTALL_DIR="$PWD/dashboard-release"
REMOVE_DATA=false
REMOVE_SECRETS=false

if [ -t 1 ]; then RED=$'\033[31m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; NC=$'\033[0m'
else RED=''; YELLOW=''; CYAN=''; NC=''
fi

usage() {
    cat <<EOF
Usage: uninstall.sh [OPTIONS]

Tear down a release-installed Deployment Dashboard stack.

Options:
      --install-dir <path>   Install directory (default: ./dashboard-release).
      --remove-data          Remove the pg-data named volume. IRREVERSIBLE.
      --remove-secrets       Delete <InstallDir>/dashboard.env.
  -h, --help                 Show this help.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --install-dir) INSTALL_DIR="$2"; shift 2 ;;
        --remove-data) REMOVE_DATA=true; shift ;;
        --remove-secrets) REMOVE_SECRETS=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "${RED}ERROR: unknown argument '$1'${NC}" >&2; usage >&2; exit 2 ;;
    esac
done

if [ ! -d "$INSTALL_DIR" ]; then
    echo "${RED}ERROR: no install found at $INSTALL_DIR (directory does not exist).${NC}" >&2
    exit 1
fi
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"

COMPOSE_FILE="$INSTALL_DIR/docker-compose.release.yml"
ENV_FILE="$INSTALL_DIR/dashboard.env"

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "${RED}ERROR: no install found at $INSTALL_DIR (missing docker-compose.release.yml).${NC}" >&2
    exit 1
fi

COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if [ -f "$ENV_FILE" ]; then COMPOSE_ARGS+=(--env-file "$ENV_FILE"); fi
# Include every profile-gated service so any active container is also torn
# down regardless of which install mode brought it up:
#   fetcher     -- CR-0009 pull-mode worker (no-flag default + --real-gha)
#   demo        -- CR-0013 demo-gha mock GitHub upstream (no-flag default)
#   integration -- CR-0012 mock-gha (dev-time test runner; not normally
#                  reachable from a release-install host, but defensive
#                  inclusion is cheap and keeps `down` exhaustive).
# Migrations apply in-process inside the api container (ADR-0009); no separate profile.
COMPOSE_ARGS+=(--profile fetcher --profile demo --profile integration)

DOWN_ARGS=(down)
if [ "$REMOVE_DATA" = true ]; then DOWN_ARGS+=(-v); fi

echo "${CYAN}==> docker compose ${COMPOSE_ARGS[*]} ${DOWN_ARGS[*]}${NC}"
docker compose "${COMPOSE_ARGS[@]}" "${DOWN_ARGS[@]}"

if [ "$REMOVE_SECRETS" = true ] && [ -f "$ENV_FILE" ]; then
    rm -f "$ENV_FILE"
    echo "${CYAN}==> Removed $ENV_FILE${NC}"
fi

echo ""
echo "  Stack torn down. Install dir: $INSTALL_DIR"
if [ "$REMOVE_DATA" = true ];    then echo "${YELLOW}  Data volume removed (pg-data). All deployment history lost.${NC}"; fi
if [ "$REMOVE_SECRETS" = true ]; then echo "${YELLOW}  Secrets removed -- a fresh install will generate a new API_TOKEN.${NC}"; fi
if [ "$REMOVE_DATA" = false ];   then echo "  Data volume preserved -- a subsequent install reattaches to it."; fi
