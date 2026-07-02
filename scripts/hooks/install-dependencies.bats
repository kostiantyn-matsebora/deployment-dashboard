#!/usr/bin/env bats
# install-dependencies.bats
#
# Bats-core test suite for install-dependencies.sh.
# NO real installs — all external commands are stubs that append their
# basename to a sentinel log file so tests can assert which (if any)
# tools were actually invoked.
#
# Run: bats scripts/hooks/install-dependencies.bats

SCRIPT="$BATS_TEST_DIRNAME/install-dependencies.sh"
SANDBOX=""
SENTINEL=""
BASH_BIN=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Write a one-liner stub: appends its name to $SENTINEL, then exits 0.
# Shebang uses the absolute BASH_BIN so stubs survive env -i (no system PATH).
# Usage: make_stub <name>
make_stub() {
  local name="$1"
  local path="$SANDBOX/$name"
  printf '#!%s\necho "%s" >> "%s"\n' "$BASH_BIN" "$name" "$SENTINEL" > "$path"
  chmod +x "$path"
}

# ---------------------------------------------------------------------------
# Setup / teardown
# ---------------------------------------------------------------------------

setup() {
  # Capture absolute bash path once.  Used as shebang in all stubs so that
  # env -i (which clears PATH) can still execute them without /usr/bin/env.
  BASH_BIN="$(command -v bash)"
  # Capture real chmod so the chmod stub can delegate to it.
  CHMOD_BIN="$(command -v chmod)"

  SANDBOX="$(mktemp -d)"
  SENTINEL="$SANDBOX/invoked.log"

  # id stub — pretend we are root (uid 0) so tests bypass the sudo branch.
  printf '#!%s\necho "0"\n' "$BASH_BIN" > "$SANDBOX/id"
  chmod +x "$SANDBOX/id"

  # python3 stub — pre-installs a working python3.
  # Handles: --version, -m pip install (no-op), -m pytest (no-op).
  cat > "$SANDBOX/python3" << STUB
#!$BASH_BIN
echo "python3" >> "$SENTINEL"
if [ "\$1" = "--version" ]; then
  echo "Python 3.11.0"
  exit 0
fi
if [ "\$1" = "-m" ] && [ "\$2" = "pip" ]; then
  exit 0
fi
exit 0
STUB
  chmod +x "$SANDBOX/python3"

  # pip3 stub — pre-installs a working pip3.
  printf '#!%s\necho "pip3" >> "%s"\nexit 0\n' "$BASH_BIN" "$SENTINEL" > "$SANDBOX/pip3"
  chmod +x "$SANDBOX/pip3"

  # apt-get stub — appends name to sentinel.
  # On "install", inspects package args and writes the correct bin stub(s):
  #   python3          → writes python3 stub
  #   python3-pip      → writes pip3 stub
  #   dotnet-sdk-10.0  → writes dotnet stub (--list-sdks + --version)
  # "update" and all other subcommands are logged and exit 0.
  cat > "$SANDBOX/apt-get" << STUB
#!$BASH_BIN
echo "apt-get" >> "$SENTINEL"
if [ "\$1" = "install" ]; then
  for _arg in "\$@"; do
    case "\$_arg" in
      python3)
        cat > "$SANDBOX/python3" << 'PYSTUB'
#!BASH_BIN_PLACEHOLDER
echo "python3" >> "SENTINEL_PLACEHOLDER"
if [ "$1" = "--version" ]; then
  echo "Python 3.11.0"
  exit 0
fi
exit 0
PYSTUB
        sed -i "s|BASH_BIN_PLACEHOLDER|$BASH_BIN|g; s|SENTINEL_PLACEHOLDER|$SENTINEL|g" "$SANDBOX/python3"
        chmod +x "$SANDBOX/python3"
        ;;
      python3-pip)
        printf '#!$BASH_BIN\necho "pip3" >> "$SENTINEL"\nexit 0\n' > "$SANDBOX/pip3"
        chmod +x "$SANDBOX/pip3"
        ;;
      dotnet-sdk-10.0)
        printf '#!$BASH_BIN\nif [ "\$1" = "--list-sdks" ]; then\n  echo "10.0.109 [/usr/lib/dotnet/sdk]"\nelif [ "\$1" = "--version" ]; then\n  echo "10.0.109"\nfi\nexit 0\n' > "$SANDBOX/dotnet"
        chmod +x "$SANDBOX/dotnet"
        ;;
      docker.io)
        cat > "$SANDBOX/docker" << 'DKSTUB'
#!BASH_BIN_PLACEHOLDER
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  echo "Docker Compose version v2.29.0"
  exit 0
fi
if [ "$1" = "--version" ]; then
  echo "Docker version 27.0.0, build abc"
fi
exit 0
DKSTUB
        sed -i "s|BASH_BIN_PLACEHOLDER|$BASH_BIN|g" "$SANDBOX/docker"
        chmod +x "$SANDBOX/docker"
        ;;
    esac
  done
fi
STUB
  chmod +x "$SANDBOX/apt-get"

  # sudo stub — appends name to sentinel; forwards remaining args.
  cat > "$SANDBOX/sudo" << STUB
#!$BASH_BIN
echo "sudo" >> "$SENTINEL"
shift
exec "\$@"
STUB
  chmod +x "$SANDBOX/sudo"

  # mktemp stub — echoes a deterministic path inside $SANDBOX.
  # Handles both the file form (default) and directory form (-d).
  MKDIR_BIN="$(command -v mkdir)"
  cat > "$SANDBOX/mktemp" << STUB
#!$BASH_BIN
_make_dir=0
for _a in "\$@"; do [ "\$_a" = "-d" ] && _make_dir=1; done
if [ "\$_make_dir" = "1" ]; then
  _dest="$SANDBOX/mktemp-dir-\$\$"
  $MKDIR_BIN -p "\$_dest"
  echo "\$_dest"
else
  _dest="$SANDBOX/pkg.tmp"
  : > "\$_dest"
  echo "\$_dest"
fi
STUB
  chmod +x "$SANDBOX/mktemp"

  # mkdir stub — delegates to the real mkdir binary.
  MKDIR_BIN="$(command -v mkdir)"
  printf '#!%s\nexec %s "$@"\n' "$BASH_BIN" "$MKDIR_BIN" > "$SANDBOX/mkdir"
  chmod +x "$SANDBOX/mkdir"

  # rm stub — no-op; prevents the script from touching the real filesystem.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/rm"
  chmod +x "$SANDBOX/rm"

  # chmod stub — delegates to the real chmod binary.
  printf '#!%s\nexec %s "$@"\n' "$BASH_BIN" "$CHMOD_BIN" > "$SANDBOX/chmod"
  chmod +x "$SANDBOX/chmod"

  # touch stub — no-op.
  printf '#!%s\n: # no-op touch\n' "$BASH_BIN" > "$SANDBOX/touch"
  chmod +x "$SANDBOX/touch"

  # serena stub — pre-installs a working serena.
  printf '#!%s\necho "Serena 1.5.4.dev0"\n' "$BASH_BIN" > "$SANDBOX/serena"
  chmod +x "$SANDBOX/serena"

  # mcp-server-markdown stub — pre-installs a working mcp-server-markdown.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/mcp-server-markdown"
  chmod +x "$SANDBOX/mcp-server-markdown"

  # playwright-mcp stub — pre-installs a working playwright-mcp.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/playwright-mcp"
  chmod +x "$SANDBOX/playwright-mcp"

  # playwright stub — pre-installs a working playwright CLI.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/playwright"
  chmod +x "$SANDBOX/playwright"

  # dotnet stub — pre-installs a working dotnet with a 10.x SDK.
  cat > "$SANDBOX/dotnet" << STUB
#!$BASH_BIN
if [ "\$1" = "--list-sdks" ]; then
  echo "10.0.109 [/usr/lib/dotnet/sdk]"
elif [ "\$1" = "--version" ]; then
  echo "10.0.109"
fi
exit 0
STUB
  chmod +x "$SANDBOX/dotnet"

  # uv stub — appends name to sentinel.
  # On "tool install <pkg>", writes the correct bin stub into $SANDBOX.
  cat > "$SANDBOX/uv" << STUB
#!$BASH_BIN
echo "uv" >> "$SENTINEL"
if [ "\$1" = "tool" ] && [ "\$2" = "install" ]; then
  case "\$3" in
    *serena*)
      printf '#!$BASH_BIN\necho "Serena 1.5.4.dev0"\n' > "$SANDBOX/serena"
      chmod +x "$SANDBOX/serena"
      ;;
    code-review-graph)
      printf '#!$BASH_BIN\nexit 0\n' > "$SANDBOX/code-review-graph"
      chmod +x "$SANDBOX/code-review-graph"
      ;;
  esac
fi
STUB
  chmod +x "$SANDBOX/uv"

  # code-review-graph stub — pre-installs a working code-review-graph.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/code-review-graph"
  chmod +x "$SANDBOX/code-review-graph"

  # docker stub — pre-installs a working docker with the compose v2 plugin.
  cat > "$SANDBOX/docker" << STUB
#!$BASH_BIN
if [ "\$1" = "compose" ] && [ "\$2" = "version" ]; then
  echo "Docker Compose version v2.29.0"
  exit 0
fi
if [ "\$1" = "--version" ]; then
  echo "Docker version 27.0.0, build abc"
fi
exit 0
STUB
  chmod +x "$SANDBOX/docker"

  # sed stub — delegates to the real sed binary.
  SED_BIN="$(command -v sed)"
  printf '#!%s\nexec %s "$@"\n' "$BASH_BIN" "$SED_BIN" > "$SANDBOX/sed"
  chmod +x "$SANDBOX/sed"

  # npm stub — appends name to sentinel; writes correct bin stub(s) on "install".
  cat > "$SANDBOX/npm" << STUB
#!$BASH_BIN
echo "npm" >> "$SENTINEL"
if [ "\$1" = "install" ]; then
  for _arg in "\$@"; do
    case "\$_arg" in
      mcp-server-markdown)
        printf '#!$BASH_BIN\nexit 0\n' > "$SANDBOX/mcp-server-markdown"
        chmod +x "$SANDBOX/mcp-server-markdown"
        ;;
      @playwright/mcp)
        printf '#!$BASH_BIN\nexit 0\n' > "$SANDBOX/playwright-mcp"
        chmod +x "$SANDBOX/playwright-mcp"
        ;;
      playwright)
        printf '#!$BASH_BIN\nexit 0\n' > "$SANDBOX/playwright"
        chmod +x "$SANDBOX/playwright"
        ;;
    esac
  done
fi
STUB
  chmod +x "$SANDBOX/npm"
}

teardown() {
  # Use the real rm (not the stub) to clean up the sandbox.
  command rm -rf "$SANDBOX"
}

# ---------------------------------------------------------------------------
# Assertion helpers
# ---------------------------------------------------------------------------

# Assert sentinel log is absent or empty (no stub was invoked at all).
assert_sentinel_empty() {
  if [ -f "$SENTINEL" ] && [ -s "$SENTINEL" ]; then
    echo "Expected sentinel log to be empty but got:"
    cat "$SENTINEL"
    return 1
  fi
}

# Assert none of the installer tools appear in the sentinel log.
assert_no_installer_invoked() {
  if [ -f "$SENTINEL" ] && grep -qE '^(apt-get|snap|dpkg|wget|curl|uv|npm|cargo)$' "$SENTINEL"; then
    echo "Unexpected installer invocation in sentinel log:"
    grep -E '^(apt-get|snap|dpkg|wget|curl|uv|npm|cargo)$' "$SENTINEL"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 1. Local no-op — CLAUDE_CODE_REMOTE unset
# ---------------------------------------------------------------------------

@test "local no-op: CLAUDE_CODE_REMOTE unset exits 0 and invokes no tool" {
  run env -i \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  assert_sentinel_empty
}

# ---------------------------------------------------------------------------
# 2–4. Local no-op — falsy values
# ---------------------------------------------------------------------------

@test "local no-op: CLAUDE_CODE_REMOTE='' exits 0 and invokes no tool" {
  run env -i \
    CLAUDE_CODE_REMOTE='' \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  assert_sentinel_empty
}

@test "local no-op: CLAUDE_CODE_REMOTE=0 exits 0 and invokes no tool" {
  run env -i \
    CLAUDE_CODE_REMOTE=0 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  assert_sentinel_empty
}

@test "local no-op: CLAUDE_CODE_REMOTE=false exits 0 and invokes no tool" {
  run env -i \
    CLAUDE_CODE_REMOTE=false \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  assert_sentinel_empty
}

# ---------------------------------------------------------------------------
# 5. Idempotent: remote + python3 + pip3 already on PATH
# ---------------------------------------------------------------------------

@test "idempotent: remote + python3 and pip3 present exits 0 without invoking apt-get install" {
  # sandbox already has python3 and pip3 stubs from setup().
  APT_INSTALL_LOG="$SANDBOX/apt-install.log"
  cat > "$SANDBOX/apt-get" << STUB
#!$BASH_BIN
echo "apt-get" >> "$SENTINEL"
if [ "\$1" = "install" ]; then
  echo "\$@" >> "$APT_INSTALL_LOG"
fi
STUB
  chmod +x "$SANDBOX/apt-get"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  # python3/python3-pip must NOT appear in any apt-get install invocation.
  if [ -f "$APT_INSTALL_LOG" ] && grep -qE 'python3|python3-pip' "$APT_INSTALL_LOG"; then
    echo "apt-get install python3/python3-pip was invoked despite python3+pip3 already present"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 6. Remote + no python3 + apt-get present → installs python3 and pip3, exits 0
# ---------------------------------------------------------------------------

@test "remote + no python3 + apt-get: installs python3 and pip3 and exits 0" {
  # Remove the pre-installed python3 and pip3 stubs so the script must install them.
  rm -f "$SANDBOX/python3"
  rm -f "$SANDBOX/pip3"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^apt-get$" "$SENTINEL"
}

# ---------------------------------------------------------------------------
# 7. Remote + no python3 + no apt-get → exits 1 with 'apt-get not found'
# ---------------------------------------------------------------------------

@test "remote + no python3 + no apt-get exits 1 with 'apt-get not found' on stderr" {
  # Remove python3, pip3, and apt-get from sandbox.
  rm -f "$SANDBOX/python3"
  rm -f "$SANDBOX/pip3"
  rm -f "$SANDBOX/apt-get"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"apt-get not found"* ]]
}

# ---------------------------------------------------------------------------
# 8. Remote + not root + sudo absent → exits 1
# ---------------------------------------------------------------------------

@test "remote + not root + sudo absent exits 1 with 'sudo not found' on stderr" {
  # Override id stub to return a non-zero uid (non-root).
  printf '#!%s\necho "1001"\n' "$BASH_BIN" > "$SANDBOX/id"
  chmod +x "$SANDBOX/id"
  # Remove sudo and python3 from sandbox so the script hits the sudo-absent branch.
  rm -f "$SANDBOX/sudo"
  rm -f "$SANDBOX/python3"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"sudo not found"* ]]
}

# ---------------------------------------------------------------------------
# 9. pip install step runs when python3 + pip3 already present (idempotent upgrade)
# ---------------------------------------------------------------------------

@test "pip install: python3+pip3 present, python3 -m pip install is invoked" {
  # The script always runs pip install after the python3 idempotency check.
  # Track invocations via the sentinel.
  PIP_ARGS_LOG="$SANDBOX/pip-args.log"
  cat > "$SANDBOX/python3" << STUB
#!$BASH_BIN
echo "python3" >> "$SENTINEL"
if [ "\$1" = "--version" ]; then
  echo "Python 3.11.0"
  exit 0
fi
if [ "\$1" = "-m" ] && [ "\$2" = "pip" ]; then
  echo "\$@" >> "$PIP_ARGS_LOG"
  exit 0
fi
exit 0
STUB
  chmod +x "$SANDBOX/python3"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  # python3 -m pip install must have been called with pytest ruff jsonschema.
  [ -f "$PIP_ARGS_LOG" ]
  grep -q "pytest" "$PIP_ARGS_LOG"
  grep -q "ruff" "$PIP_ARGS_LOG"
  grep -q "jsonschema" "$PIP_ARGS_LOG"
}

# ---------------------------------------------------------------------------
# 10. serena: idempotent — serena already present, uv must NOT be invoked
# ---------------------------------------------------------------------------

@test "serena idempotent: serena present exits 0 without invoking uv" {
  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  if [ -f "$SENTINEL" ] && grep -q "^uv$" "$SENTINEL"; then
    echo "uv was invoked despite serena already being on PATH"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 11. serena: install path — serena absent, uv present → uv invoked, exit 0
# ---------------------------------------------------------------------------

@test "serena install: serena absent + uv present installs serena and exits 0" {
  rm -f "$SANDBOX/serena"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^uv$" "$SENTINEL"
  [ -x "$SANDBOX/serena" ]
}

# ---------------------------------------------------------------------------
# 12. serena: missing uv prereq → exit 1 with missing-uv error on stderr
# ---------------------------------------------------------------------------

@test "serena missing uv: serena absent + uv absent exits 1 with 'uv not found' on stderr" {
  rm -f "$SANDBOX/serena"
  rm -f "$SANDBOX/uv"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"uv not found"* ]]
}

# ---------------------------------------------------------------------------
# 13. markdown: idempotent — mcp-server-markdown present, npm must NOT be invoked
# ---------------------------------------------------------------------------

@test "markdown idempotent: mcp-server-markdown present exits 0 without invoking npm" {
  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  if [ -f "$SENTINEL" ] && grep -q "^npm$" "$SENTINEL"; then
    echo "npm was invoked despite mcp-server-markdown already being on PATH"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 14. markdown: install path — mcp-server-markdown absent, npm present → exit 0
# ---------------------------------------------------------------------------

@test "markdown install: mcp-server-markdown absent + npm present installs it and exits 0" {
  rm -f "$SANDBOX/mcp-server-markdown"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^npm$" "$SENTINEL"
  [ -x "$SANDBOX/mcp-server-markdown" ]
}

# ---------------------------------------------------------------------------
# 15. markdown: missing npm prereq → exit 1 with missing-npm error on stderr
# ---------------------------------------------------------------------------

@test "markdown missing npm: mcp-server-markdown absent + npm absent exits 1 with 'npm not found' on stderr" {
  rm -f "$SANDBOX/mcp-server-markdown"
  rm -f "$SANDBOX/npm"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"npm not found"* ]]
}

# ---------------------------------------------------------------------------
# 16. playwright: idempotent — playwright-mcp + playwright present, npm NOT invoked
# ---------------------------------------------------------------------------

@test "playwright idempotent: playwright-mcp and playwright present exits 0 without invoking npm" {
  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  if [ -f "$SENTINEL" ] && grep -q "^npm$" "$SENTINEL"; then
    echo "npm was invoked despite playwright-mcp and playwright already being on PATH"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 17. playwright: install path — bins absent, npm present → npm invoked, exit 0
# ---------------------------------------------------------------------------

@test "playwright install: playwright-mcp and playwright absent + npm present installs both and exits 0" {
  rm -f "$SANDBOX/playwright-mcp"
  rm -f "$SANDBOX/playwright"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^npm$" "$SENTINEL"
  [ -x "$SANDBOX/playwright-mcp" ]
  [ -x "$SANDBOX/playwright" ]
}

# ---------------------------------------------------------------------------
# 18. playwright: missing npm prereq → exit 1 with npm-not-found error on stderr
# ---------------------------------------------------------------------------

@test "playwright missing npm: playwright-mcp and playwright absent + npm absent exits 1 with 'npm not found' on stderr" {
  rm -f "$SANDBOX/playwright-mcp"
  rm -f "$SANDBOX/playwright"
  rm -f "$SANDBOX/npm"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"npm not found"* ]]
}

# ---------------------------------------------------------------------------
# 19. playwright: browser download failure is non-fatal — script still exits 0
# ---------------------------------------------------------------------------

@test "playwright browser non-fatal: chromium download fails but script exits 0" {
  rm -f "$SANDBOX/playwright-mcp"

  printf '#!%s\nif [ "$1" = "install" ]; then exit 1; fi\nexit 0\n' \
    "$BASH_BIN" > "$SANDBOX/playwright"
  chmod +x "$SANDBOX/playwright"

  cat > "$SANDBOX/npm" << NPMSTUB
#!$BASH_BIN
echo "npm" >> "$SENTINEL"
if [ "\$1" = "install" ]; then
  printf '#!$BASH_BIN\nexit 0\n' > "$SANDBOX/playwright-mcp"
  $CHMOD_BIN +x "$SANDBOX/playwright-mcp"
fi
NPMSTUB
  chmod +x "$SANDBOX/npm"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  [[ "$output" == *"chromium download failed"* ]]
}

# ---------------------------------------------------------------------------
# 20. playwright: MCP browser download failure is non-fatal — script still exits 0
# ---------------------------------------------------------------------------

@test "playwright MCP browser non-fatal: chrome-for-testing download fails but script exits 0" {
  rm -f "$SANDBOX/playwright-mcp"

  cat > "$SANDBOX/npm" << NPMSTUB
#!$BASH_BIN
echo "npm" >> "$SENTINEL"
if [ "\$1" = "install" ]; then
  printf '#!$BASH_BIN\nif [ "\$1" = "install-browser" ]; then exit 1; fi\nexit 0\n' > "$SANDBOX/playwright-mcp"
  chmod +x "$SANDBOX/playwright-mcp"
fi
NPMSTUB
  chmod +x "$SANDBOX/npm"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  [[ "$output" == *"chrome-for-testing download failed"* ]]
}

# ---------------------------------------------------------------------------
# 21. dotnet: idempotent — dotnet already present with 10.x SDK, apt NOT invoked
# ---------------------------------------------------------------------------

@test "dotnet idempotent: dotnet with 10.x SDK present exits 0 without invoking apt-get install" {
  APT_INSTALL_LOG="$SANDBOX/apt-install.log"
  cat > "$SANDBOX/apt-get" << STUB
#!$BASH_BIN
echo "apt-get" >> "$SENTINEL"
if [ "\$1" = "install" ]; then
  echo "\$@" >> "$APT_INSTALL_LOG"
fi
STUB
  chmod +x "$SANDBOX/apt-get"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  if [ -f "$APT_INSTALL_LOG" ] && grep -q "dotnet-sdk-10.0" "$APT_INSTALL_LOG"; then
    echo "apt-get install dotnet-sdk-10.0 was invoked despite 10.x SDK already present"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 22. dotnet: install path — dotnet absent, apt-get present → installed, exit 0
# ---------------------------------------------------------------------------

@test "dotnet install: dotnet absent + apt-get present installs dotnet and exits 0" {
  rm -f "$SANDBOX/dotnet"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^apt-get$" "$SENTINEL"
  [ -x "$SANDBOX/dotnet" ]
}

# ---------------------------------------------------------------------------
# 23. dotnet: missing apt-get prereq → exit 1 with apt-get-not-found on stderr
# ---------------------------------------------------------------------------

@test "dotnet missing apt-get: dotnet absent + apt-get absent exits 1 with 'apt-get not found' on stderr" {
  # Keep python3+pip3+serena+mcp-server-markdown+playwright-mcp+playwright so those
  # sections skip; remove dotnet and apt-get to trigger the .NET prereq failure.
  rm -f "$SANDBOX/dotnet"
  rm -f "$SANDBOX/apt-get"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"apt-get not found"* ]]
}

# ---------------------------------------------------------------------------
# 24. dotnet: wrong-version not idempotent — 8.x SDK present → installs 10.x, exit 0
# ---------------------------------------------------------------------------

@test "dotnet wrong version: dotnet with only 8.x SDK present is not idempotent; installs 10.x and exits 0" {
  cat > "$SANDBOX/dotnet" << STUB
#!$BASH_BIN
if [ "\$1" = "--list-sdks" ]; then
  echo "8.0.404 [/usr/lib/dotnet/sdk]"
elif [ "\$1" = "--version" ]; then
  echo "8.0.404"
fi
exit 0
STUB
  chmod +x "$SANDBOX/dotnet"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^apt-get$" "$SENTINEL"
  "$SANDBOX/dotnet" --list-sdks | grep -q '^10\.'
}

# ---------------------------------------------------------------------------
# 25. code-review-graph: idempotent — present, uv must NOT be invoked
# ---------------------------------------------------------------------------

@test "code-review-graph idempotent: code-review-graph present exits 0 without invoking uv" {
  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  if [ -f "$SENTINEL" ] && grep -q "^uv$" "$SENTINEL"; then
    echo "uv was invoked despite code-review-graph already being on PATH"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 26. code-review-graph: install path — absent + uv present → installs, exits 0
# ---------------------------------------------------------------------------

@test "code-review-graph install: absent + uv present installs it and exits 0" {
  rm -f "$SANDBOX/code-review-graph"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^uv$" "$SENTINEL"
  [ -x "$SANDBOX/code-review-graph" ]
}

# ---------------------------------------------------------------------------
# 27. code-review-graph: missing uv prereq → exit 1 with 'uv not found' on stderr
# ---------------------------------------------------------------------------

@test "code-review-graph missing uv: absent + uv absent exits 1 with 'uv not found' on stderr" {
  rm -f "$SANDBOX/code-review-graph"
  rm -f "$SANDBOX/uv"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"uv not found"* ]]
}

# ---------------------------------------------------------------------------
# 28. docker: idempotent — docker + compose plugin present, apt NOT invoked
# ---------------------------------------------------------------------------

@test "docker idempotent: docker with compose v2 plugin present exits 0 without invoking apt-get install" {
  APT_INSTALL_LOG="$SANDBOX/apt-install.log"
  cat > "$SANDBOX/apt-get" << STUB
#!$BASH_BIN
echo "apt-get" >> "$SENTINEL"
if [ "\$1" = "install" ]; then
  echo "\$@" >> "$APT_INSTALL_LOG"
fi
STUB
  chmod +x "$SANDBOX/apt-get"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  if [ -f "$APT_INSTALL_LOG" ] && grep -q "docker.io" "$APT_INSTALL_LOG"; then
    echo "apt-get install docker.io was invoked despite docker + compose plugin already present"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 29. docker: install path — docker absent, apt-get present → installed, exit 0
# ---------------------------------------------------------------------------

@test "docker install: docker absent + apt-get present installs docker and exits 0" {
  rm -f "$SANDBOX/docker"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^apt-get$" "$SENTINEL"
  [ -x "$SANDBOX/docker" ]
  "$SANDBOX/docker" compose version
}

# ---------------------------------------------------------------------------
# 30. docker: missing apt-get prereq → exit 1 with apt-get-not-found on stderr
# ---------------------------------------------------------------------------

@test "docker missing apt-get: docker absent + apt-get absent exits 1 with 'apt-get not found' on stderr" {
  rm -f "$SANDBOX/docker"
  rm -f "$SANDBOX/apt-get"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"apt-get not found"* ]]
}
