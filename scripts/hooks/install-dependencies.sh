#!/usr/bin/env bash
# install-dependencies.sh
#
# PURPOSE: Remote-only bootstrap for dependencies that must exist before any
#          .ps1 hook or MCP server can run: PowerShell 7+, serena MCP server,
#          and markdown MCP server.
#          Guarded on CLAUDE_CODE_REMOTE; idempotent — safe to call repeatedly.
#
# WHY BASH, NOT PWSH:
#   Every other hook in this project is PowerShell (.ps1) per .claude/scripts.md.
#   This file is the ONE unavoidable exception: you cannot use pwsh to install
#   pwsh. The remote container starts with no PowerShell present, so the
#   bootstrap must be a POSIX shell script.
#   Precedent for inline bash in this repo's hooks exists in .claude/settings.json
#   (the `git rev-parse` SessionStart command that runs in sh, not pwsh).
#
# PESTER COVERAGE:
#   Not applicable. Pester is a PowerShell test framework; it cannot load or
#   exercise a bash script. The .claude/scripts.md Pester mandate applies only
#   to .ps1/.psm1 files.
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
## PowerShell 7+
# ===========================================================================

# Idempotency — nothing to do if pwsh is already available.
if command -v pwsh >/dev/null 2>&1; then
  echo "install-dependencies.sh: pwsh already on PATH — skipping." >&2
else
  # Install — Debian/Ubuntu via Microsoft apt repo; fallback to snap.
  if command -v apt-get >/dev/null 2>&1; then
    echo "install-dependencies.sh: installing pwsh via Microsoft apt repo..." >&2

    # Source os-release to get distro ID and version.
    if [[ ! -f /etc/os-release ]]; then
      echo "install-dependencies.sh: /etc/os-release not found; cannot determine distro." >&2
      exit 1
    fi
    # shellcheck source=/dev/null
    source /etc/os-release

    _pkg_url="https://packages.microsoft.com/config/${ID}/${VERSION_ID}/packages-microsoft-prod.deb"
    _tmp_deb="$(mktemp /tmp/packages-microsoft-prod.XXXXXX.deb)"

    echo "install-dependencies.sh: fetching ${_pkg_url}" >&2
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$_pkg_url" -o "$_tmp_deb" >&2
    elif command -v wget >/dev/null 2>&1; then
      wget -qO "$_tmp_deb" "$_pkg_url" >&2
    else
      echo "install-dependencies.sh: neither curl nor wget found." >&2
      rm -f "$_tmp_deb"
      exit 1
    fi

    $_sudo dpkg -i "$_tmp_deb" >&2
    rm -f "$_tmp_deb"

    # Refresh ONLY the Microsoft repo list. A blanket `apt-get update` aborts the
    # whole bootstrap (set -e) whenever an unrelated third-party repo shipped in
    # the base image is unreachable under the remote network policy — e.g. the
    # deadsnakes / ondrej PPAs returning HTTP 403. Scoping the update to
    # packages.microsoft.com keeps pwsh installable regardless of other repos'
    # health.
    $_sudo apt-get update -qq \
      -o Dir::Etc::sourcelist="sources.list.d/microsoft-prod.list" \
      -o Dir::Etc::sourceparts="-" \
      -o APT::Get::List-Cleanup="0" >&2
    $_sudo apt-get install -y powershell >&2

  elif command -v snap >/dev/null 2>&1; then
    echo "install-dependencies.sh: apt-get not found; falling back to snap..." >&2
    $_sudo snap install powershell --classic >&2

  else
    echo "install-dependencies.sh: no supported installer found (apt-get or snap required)." >&2
    exit 1
  fi

  # Verify — confirm pwsh is now on PATH and emit its version.
  if ! command -v pwsh >/dev/null 2>&1; then
    echo "install-dependencies.sh: installation completed but pwsh is still not on PATH." >&2
    exit 1
  fi

  _version="$(pwsh --version 2>&1)"
  echo "install-dependencies.sh: pwsh installed successfully — ${_version}" >&2
fi

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
# Future dependencies go here as additional "## <dep>" sections.
# ===========================================================================
