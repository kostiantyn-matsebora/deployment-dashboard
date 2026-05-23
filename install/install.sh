#!/usr/bin/env bash
# Install + start a released Deployment Dashboard stack on the current host.
#
# Thin docker compose wrapper for the release-install flow. Brings up the
# demo stack (demo-gha + fetcher) -- zero-PAT, offline, populated dashboard
# within ~60s.
#
# Usage:
#   ./install.sh [OPTIONS]
#
# Options:
#   -v, --version <tag>   Release tag to install (default: latest). Sets
#                         DASHBOARD_VERSION for image-tag resolution.
#   -p, --port <int>      Host port for the gateway (default: 8080). Sets
#                         DASHBOARD_PORT.
#   -h, --help            Show this help.
#
# Examples:
#   ./install.sh
#   ./install.sh --version v1.2.3
#   ./install.sh --port 9090

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_COMPOSE="$SCRIPT_DIR/docker-compose.release.yml"
DEMO_COMPOSE="$SCRIPT_DIR/docker-compose.demo.yml"

# ---- ANSI colours (tty only) ----
if [ -t 1 ]; then
    _RED=$'\033[31m'; _NC=$'\033[0m'
else
    _RED=''; _NC=''
fi

VERSION='latest'
PORT=8080

while [ $# -gt 0 ]; do
    case "$1" in
        -v|--version)  VERSION="$2"; shift 2 ;;
        -p|--port)     PORT="$2"; shift 2 ;;
        -h|--help)     sed -n '/^# Usage:/,/^[^#]/{ /^#/{ s/^# \{0,2\}//; p } }' "$0"; exit 0 ;;
        *) echo "${_RED}ERROR: unknown argument '$1'${_NC}" >&2; exit 2 ;;
    esac
done

# GHCR login -- images are private.
if ! GH_TOKEN="$(gh auth token 2>/dev/null)" || [ -z "${GH_TOKEN}" ]; then
    echo "${_RED}ERROR: gh not authenticated. Run:${_NC}" >&2
    echo "${_RED}  gh auth login --hostname github.com${_NC}" >&2
    echo "${_RED}  gh auth refresh --hostname github.com --scopes read:packages${_NC}" >&2
    exit 1
fi
printf '%s' "$GH_TOKEN" | docker login ghcr.io --username oauth2 --password-stdin
unset GH_TOKEN

# Seed compose substitution vars when non-default.
[ "$VERSION" != 'latest' ] && export DASHBOARD_VERSION="$VERSION"
[ "$PORT" -ne 8080 ]       && export DASHBOARD_PORT="$PORT"

docker compose -f "$RELEASE_COMPOSE" -f "$DEMO_COMPOSE" --profile demo --profile fetcher up -d --wait --force-recreate
