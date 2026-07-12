#!/usr/bin/env bash
# install-dependencies.sh
#
# PURPOSE: Remote-only bootstrap for dependencies that must exist before any
#          Python hook or MCP server can run: Python 3 + pip + pytest/ruff/jsonschema,
#          serena MCP server, markdown MCP server, Playwright MCP server + CLI,
#          and .NET 10 SDK.
#          Guarded on CLAUDE_CODE_REMOTE; idempotent — safe to call repeatedly.
#
# WHY BASH, NOT PYTHON:
#   Every other hook in this project is Python (.py) per .claude/scripts.md.
#   This file is the ONE unavoidable exception: you cannot use python3 to install
#   python3. The remote container may start without Python present, so the
#   bootstrap must be a POSIX shell script.
#   Precedent for inline bash in this repo's hooks exists in .claude/settings.json
#   (the `git rev-parse` SessionStart command that runs in sh, not python3).
#
# BATS COVERAGE:
#   Covered by install-dependencies.bats (Bats-core).  Python's pytest cannot
#   load or exercise a bash script; the .claude/scripts.md pytest mandate applies
#   only to .py files.
#
# ADDING A NEW DEPENDENCY:
#   Append a clearly delimited "## <dep>" section below the existing ones,
#   following the same pattern: idempotency check → install → verify.

set -euo pipefail

# ---------------------------------------------------------------------------
# Remote guard — exit immediately on any local run.
# Treat unset, empty, "0", and "false" all as "not remote".
# ---------------------------------------------------------------------------
_remote="${CLAUDE_CODE_REMOTE:-}"
if [[ -z "$_remote" || "$_remote" == "0" || "$_remote" == "false" ]]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# sudo prefix: omit when already root; require sudo binary when not root.
# ---------------------------------------------------------------------------
_sudo=""
if [[ "$(id -u)" != "0" ]]; then
  if command -v sudo >/dev/null 2>&1; then
    _sudo="sudo"
  else
    echo "install-dependencies.sh: not root and sudo not found — cannot elevate." >&2
    exit 1
  fi
fi

# ===========================================================================
## Python 3 + pip + script toolchain (pytest, ruff, jsonschema)
# ===========================================================================

# Idempotency — check python3 and pip together; install only if either is absent.
if command -v python3 >/dev/null 2>&1 && command -v pip3 >/dev/null 2>&1; then
  echo "install-dependencies.sh: python3 and pip3 already on PATH — skipping system install." >&2
else
  if command -v apt-get >/dev/null 2>&1; then
    echo "install-dependencies.sh: installing python3 and pip via apt-get..." >&2
    # Refresh package lists (best-effort; NON-FATAL so a broken third-party repo
    # does not abort the bootstrap).
    $_sudo apt-get update -qq >&2 || echo "install-dependencies.sh: apt-get update reported errors; continuing with cached lists." >&2
    $_sudo apt-get install -y python3 python3-pip >&2
  else
    echo "install-dependencies.sh: apt-get not found — cannot install python3/pip." >&2
    exit 1
  fi

  # Verify — confirm python3 and pip3 are now on PATH.
  if ! command -v python3 >/dev/null 2>&1; then
    echo "install-dependencies.sh: installation completed but python3 is still not on PATH." >&2
    exit 1
  fi
  if ! command -v pip3 >/dev/null 2>&1; then
    echo "install-dependencies.sh: installation completed but pip3 is still not on PATH." >&2
    exit 1
  fi

  _py_version="$(python3 --version 2>&1)"
  echo "install-dependencies.sh: python3 installed successfully — ${_py_version}" >&2
fi

# Install / upgrade the script-toolchain packages (pytest, ruff, jsonschema).
# pip install --quiet is idempotent: already-satisfied versions are skipped.
echo "install-dependencies.sh: installing/verifying pytest, ruff, jsonschema via pip..." >&2
python3 -m pip install --quiet --upgrade pytest ruff jsonschema >&2
echo "install-dependencies.sh: pytest/ruff/jsonschema ready." >&2

# ===========================================================================
## serena (MCP server)
# ===========================================================================

# Idempotency — nothing to do if serena is already on PATH.
if command -v serena >/dev/null 2>&1; then
  echo "install-dependencies.sh: serena already on PATH — skipping." >&2
else
  # Prereq — uv must be available (serena is a uv-managed Python tool).
  if ! command -v uv >/dev/null 2>&1; then
    echo "install-dependencies.sh: uv not found on PATH — cannot install serena; install uv first." >&2
    exit 1
  fi

  # Install — per-user uv tool; must NOT run as root (sudo would target wrong home).
  echo "install-dependencies.sh: installing serena via uv tool install..." >&2
  uv tool install "git+https://github.com/oraios/serena" >&2

  # Verify — confirm serena is now on PATH.
  if ! command -v serena >/dev/null 2>&1; then
    echo "install-dependencies.sh: installation completed but serena is still not on PATH." >&2
    exit 1
  fi

  _serena_version="$(serena --version 2>&1)"
  echo "install-dependencies.sh: serena installed successfully — ${_serena_version}" >&2
fi

# ===========================================================================
## markdown (MCP server)
# ===========================================================================

# Idempotency — nothing to do if mcp-server-markdown is already on PATH.
if command -v mcp-server-markdown >/dev/null 2>&1; then
  echo "install-dependencies.sh: mcp-server-markdown already on PATH — skipping." >&2
else
  # Prereq — npm must be available (markdown MCP server is a Node package).
  if ! command -v npm >/dev/null 2>&1; then
    echo "install-dependencies.sh: npm not found on PATH — cannot install mcp-server-markdown; install Node.js/npm first." >&2
    exit 1
  fi

  # Install — global npm install (needs root; $_sudo is empty when already root).
  echo "install-dependencies.sh: installing mcp-server-markdown via npm install -g..." >&2
  $_sudo npm install -g mcp-server-markdown >&2

  # Verify — confirm mcp-server-markdown is now on PATH.
  if ! command -v mcp-server-markdown >/dev/null 2>&1; then
    echo "install-dependencies.sh: installation completed but mcp-server-markdown is still not on PATH." >&2
    exit 1
  fi

  echo "install-dependencies.sh: mcp-server-markdown installed successfully." >&2
fi

# ===========================================================================
## playwright (MCP server + CLI)
# ===========================================================================

# Idempotency — nothing to do if both playwright-mcp and playwright are already on PATH.
if command -v playwright-mcp >/dev/null 2>&1 && command -v playwright >/dev/null 2>&1; then
  echo "install-dependencies.sh: playwright-mcp and playwright already on PATH — skipping." >&2
else
  # Prereq — npm must be available (both packages are installed via npm).
  if ! command -v npm >/dev/null 2>&1; then
    echo "install-dependencies.sh: npm not found on PATH — cannot install @playwright/mcp or playwright; install Node.js/npm first." >&2
    exit 1
  fi

  # Install — global npm install of both the MCP server and the CLI.
  echo "install-dependencies.sh: installing @playwright/mcp and playwright via npm install -g..." >&2
  $_sudo npm install -g @playwright/mcp playwright >&2

  # Install browser (NON-FATAL — egress-gated).
  # cdn.playwright.dev may be blocked by the remote network egress allowlist;
  # a failure here must NOT abort the bootstrap.
  if ! playwright install chromium >&2; then
    echo "install-dependencies.sh: chromium download failed (is cdn.playwright.dev in the network egress allowlist?) — continuing; install it later with 'playwright install chromium'." >&2
  fi

  # Install the browser the @playwright/mcp server itself resolves (NON-FATAL — egress-gated).
  # @playwright/mcp bundles its own playwright-core, which may expect a DIFFERENT chromium
  # build than the system `playwright` CLI (e.g. chrome-for-testing v1226 vs chromium v1228).
  # Installing via the MCP's own installer guarantees the build it looks for at runtime exists,
  # otherwise it fails with: Browser "chrome-for-testing" is not installed.
  if ! playwright-mcp install-browser chrome-for-testing >&2; then
    echo "install-dependencies.sh: chrome-for-testing download failed (is cdn.playwright.dev in the network egress allowlist?) — continuing; install it later with 'playwright-mcp install-browser chrome-for-testing'." >&2
  fi

  # Verify — confirm BOTH bins are now on PATH (browser availability is not checked here).
  if ! command -v playwright-mcp >/dev/null 2>&1; then
    echo "install-dependencies.sh: installation completed but playwright-mcp is still not on PATH." >&2
    exit 1
  fi
  if ! command -v playwright >/dev/null 2>&1; then
    echo "install-dependencies.sh: installation completed but playwright is still not on PATH." >&2
    exit 1
  fi

  echo "install-dependencies.sh: playwright-mcp and playwright installed successfully." >&2
fi

# ===========================================================================
## code-review-graph (MCP server)
# ===========================================================================

# Idempotency — nothing to do if code-review-graph is already on PATH.
if command -v code-review-graph >/dev/null 2>&1; then
  echo "install-dependencies.sh: code-review-graph already on PATH — skipping." >&2
else
  # Prereq — uv must be available (code-review-graph is a uv-managed Python tool).
  if ! command -v uv >/dev/null 2>&1; then
    echo "install-dependencies.sh: uv not found on PATH — cannot install code-review-graph; install uv first." >&2
    exit 1
  fi

  # Install — per-user uv tool.
  echo "install-dependencies.sh: installing code-review-graph via uv tool install..." >&2
  uv tool install code-review-graph >&2

  # Verify — confirm code-review-graph is now on PATH.
  if ! command -v code-review-graph >/dev/null 2>&1; then
    echo "install-dependencies.sh: installation completed but code-review-graph is still not on PATH." >&2
    exit 1
  fi

  echo "install-dependencies.sh: code-review-graph installed successfully." >&2

  # Build initial graph NON-FATALLY — parsing can fail on fresh repos; the server
  # will rebuild on first update, so a failure here must not abort the bootstrap.
  if ! code-review-graph build >&2; then
    echo "install-dependencies.sh: code-review-graph initial build failed — continuing; it will build on first update." >&2
  fi
fi

# ===========================================================================
## .NET 10 SDK
# ===========================================================================

# Idempotency — nothing to do if dotnet is already on PATH with a 10.x SDK.
# Uses a shell read-loop to avoid requiring grep on PATH (env -i sandbox safe).
_dotnet_has_10sdk() {
  command -v dotnet >/dev/null 2>&1 || return 1
  while IFS= read -r _sdk_line; do
    case "$_sdk_line" in 10.*) return 0 ;; esac
  done < <(dotnet --list-sdks 2>/dev/null)
  return 1
}

if _dotnet_has_10sdk; then
  echo "install-dependencies.sh: .NET 10.x SDK already present — skipping." >&2
else
  # Prereq — apt-get must be available (.NET SDK comes from the distro feed).
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "install-dependencies.sh: apt-get not found — cannot install .NET 10 SDK." >&2
    exit 1
  fi

  echo "install-dependencies.sh: installing dotnet-sdk-10.0 via apt-get..." >&2

  # Refresh distro package lists (resilient, NON-FATAL).
  # The SDK ships in the distro feed (noble-updates/security); lists are usually
  # pre-cached in the base image.  Refresh them, but do NOT let an unreachable
  # third-party repo (broken PPAs returning 403) abort the bootstrap.
  $_sudo apt-get update -qq >&2 || echo "install-dependencies.sh: apt-get update reported errors (unreachable repos); continuing with cached package lists." >&2

  # Install.
  $_sudo apt-get install -y dotnet-sdk-10.0 >&2

  # Verify — confirm dotnet is now on PATH and a 10.x SDK is listed.
  if ! _dotnet_has_10sdk; then
    echo "install-dependencies.sh: installation completed but .NET 10.x SDK is not available." >&2
    exit 1
  fi

  _dotnet_version="$(dotnet --version 2>&1)"
  echo "install-dependencies.sh: dotnet-sdk-10.0 installed successfully — ${_dotnet_version}" >&2
fi

# ===========================================================================
## Docker Engine + Compose v2 plugin
# ===========================================================================

# Idempotency — nothing to do if docker is on PATH AND the `docker compose`
# plugin resolves (the project drives the stack via `docker compose`, not the
# legacy `docker-compose` standalone binary).
# `docker compose version` queries only the plugin — it does NOT require the
# daemon to be running, so it is safe to probe during bootstrap.
_docker_ready() {
  command -v docker >/dev/null 2>&1 || return 1
  docker compose version >/dev/null 2>&1 || return 1
  return 0
}

if _docker_ready; then
  echo "install-dependencies.sh: docker and the compose v2 plugin already present — skipping." >&2
else
  # Prereq — apt-get must be available (both packages come from the distro feed).
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "install-dependencies.sh: apt-get not found — cannot install Docker." >&2
    exit 1
  fi

  echo "install-dependencies.sh: installing docker.io and docker-compose-v2 via apt-get..." >&2

  # Refresh distro package lists (resilient, NON-FATAL) — same rationale as the
  # .NET section: a broken third-party repo must not abort the bootstrap.
  $_sudo apt-get update -qq >&2 || echo "install-dependencies.sh: apt-get update reported errors (unreachable repos); continuing with cached package lists." >&2

  # Install — docker.io provides the engine + `docker` CLI; docker-compose-v2
  # provides the `docker compose` plugin.
  $_sudo apt-get install -y docker.io docker-compose-v2 >&2

  # Verify — confirm docker is on PATH and the compose plugin resolves.
  if ! _docker_ready; then
    echo "install-dependencies.sh: installation completed but docker or the compose v2 plugin is not available." >&2
    exit 1
  fi

  _docker_version="$(docker --version 2>&1)"
  echo "install-dependencies.sh: docker installed successfully — ${_docker_version}" >&2
fi

# ===========================================================================
# Future dependencies go here as additional "## <dep>" sections.
# ===========================================================================
