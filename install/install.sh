#!/usr/bin/env bash
# Install + start a released Deployment Dashboard stack on the current host.
#
# Thin docker compose wrapper for the release-install flow. Same shape as
# dev_env/start.ps1 -- the only differences are: uses the release compose
# (no build), layers docker-compose.demo.yml for the default demo mode, and
# authenticates to GHCR before pulling images.
#
# Default (no flags): demo stack -- demo-gha + fetcher, zero-PAT, offline.
#
# Usage:
#   ./install.sh [OPTIONS]
#
# Options:
#   -v, --version <tag>   Release tag to install (default: latest). Sets
#                         DASHBOARD_VERSION for image-tag resolution.
#       --real-gha        Real GitHub Actions upstream. Requires $GHA_TOKEN.
#       --empty           Bare-minimum stack (db + api + gateway + dashboard).
#                         No fetcher, no demo-gha. Direct-POST integrators only.
#   -p, --port <int>      Host port for the gateway (default: 8080). Sets
#                         DASHBOARD_PORT.
#   -h, --help            Show this help.
#
# Examples:
#   ./install.sh
#   ./install.sh --version v1.2.3
#   GHA_TOKEN=<PAT> ./install.sh --real-gha
#   ./install.sh --empty
#   ./install.sh --port 9090

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_COMPOSE="$SCRIPT_DIR/docker-compose.release.yml"
DEMO_COMPOSE="$SCRIPT_DIR/docker-compose.demo.yml"

# ---- ANSI colours (tty only) ----
if [ -t 1 ]; then
    _RED=$'\033[31m'; _CYAN=$'\033[36m'; _NC=$'\033[0m'
else
    _RED=''; _CYAN=''; _NC=''
fi

VERSION='latest'
REAL_GHA=false
EMPTY=false
PORT=8080

usage() { sed -n '/^# Usage:/,/^[^#]/{ /^#/{ s/^# \{0,2\}//; p } }' "$0"; }

while [ $# -gt 0 ]; do
    case "$1" in
        -v|--version)  VERSION="$2"; shift 2 ;;
        --real-gha)    REAL_GHA=true; shift ;;
        --empty)       EMPTY=true; shift ;;
        -p|--port)     PORT="$2"; shift 2 ;;
        -h|--help)     usage; exit 0 ;;
        *) echo "${_RED}ERROR: unknown argument '$1'${_NC}" >&2; exit 2 ;;
    esac
done

if [ "$REAL_GHA" = true ] && [ "$EMPTY" = true ]; then
    echo "${_RED}ERROR: --real-gha and --empty are mutually exclusive.${_NC}" >&2; exit 1
fi

if [ "$REAL_GHA" = true ] && [ -z "${GHA_TOKEN:-}" ]; then
    echo "${_RED}ERROR: --real-gha requires \$GHA_TOKEN to be set.${_NC}" >&2; exit 1
fi

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

if [ "$EMPTY" = true ]; then
    docker compose -f "$RELEASE_COMPOSE" up -d --wait --force-recreate
    exit $?
fi

if [ "$REAL_GHA" = true ]; then
    docker compose -f "$RELEASE_COMPOSE" --profile fetcher up -d --wait --force-recreate
    exit $?
fi

docker compose -f "$RELEASE_COMPOSE" -f "$DEMO_COMPOSE" --profile demo --profile fetcher up -d --wait --force-recreate
