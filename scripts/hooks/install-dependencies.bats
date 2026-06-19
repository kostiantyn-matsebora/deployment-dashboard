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
  # Capture real chmod so the chmod stub can delegate to it; chmod calls inside
  # apt-get/snap stubs must actually set execute permissions on the written pwsh stub.
  CHMOD_BIN="$(command -v chmod)"

  SANDBOX="$(mktemp -d)"
  SENTINEL="$SANDBOX/invoked.log"

  # id stub — pretend we are root (uid 0) so tests bypass the sudo branch.
  printf '#!%s\necho "0"\n' "$BASH_BIN" > "$SANDBOX/id"
  chmod +x "$SANDBOX/id"

  # pwsh stub — pre-installs a working pwsh (overridden per test as needed).
  printf '#!%s\necho "PowerShell 7.4.0"\n' "$BASH_BIN" > "$SANDBOX/pwsh"
  chmod +x "$SANDBOX/pwsh"

  # curl stub — appends name to sentinel; writes the -o destination as an empty file.
  # Explicit "exit 0" is required: without it the stub exits with the return code of
  # the last command in the for-loop body ([ "$arg" = "-o" ]), which is 1 for the
  # final argument (the destination path), causing set -e to abort the script.
  cat > "$SANDBOX/curl" << STUB
#!$BASH_BIN
echo "curl" >> "$SENTINEL"
next_is_dest=0
for arg in "\$@"; do
  if [ "\$next_is_dest" = "1" ]; then
    touch "\$arg"
    next_is_dest=0
  fi
  [ "\$arg" = "-o" ] && next_is_dest=1
done
exit 0
STUB
  chmod +x "$SANDBOX/curl"

  # wget stub — appends name to sentinel; writes the -O destination as an empty file.
  # Same exit-0 requirement as the curl stub above.
  cat > "$SANDBOX/wget" << STUB
#!$BASH_BIN
echo "wget" >> "$SENTINEL"
next_is_dest=0
for arg in "\$@"; do
  if [ "\$next_is_dest" = "1" ]; then
    touch "\$arg"
    next_is_dest=0
  fi
  [ "\$arg" = "-O" ] && next_is_dest=1
done
exit 0
STUB
  chmod +x "$SANDBOX/wget"

  # dpkg stub — appends name to sentinel; exits 0.
  cat > "$SANDBOX/dpkg" << STUB
#!$BASH_BIN
echo "dpkg" >> "$SENTINEL"
STUB
  chmod +x "$SANDBOX/dpkg"

  # apt-get stub — appends name to sentinel.
  # On "install powershell", writes a real pwsh stub so the post-install
  # command -v check in the script succeeds.
  cat > "$SANDBOX/apt-get" << STUB
#!$BASH_BIN
echo "apt-get" >> "$SENTINEL"
if [ "\$1" = "install" ]; then
  printf '#!$BASH_BIN\necho "PowerShell 7.4.0"\n' > "$SANDBOX/pwsh"
  chmod +x "$SANDBOX/pwsh"
fi
STUB
  chmod +x "$SANDBOX/apt-get"

  # snap stub — appends name to sentinel.
  # On "install", writes a real pwsh stub so the post-install check passes.
  cat > "$SANDBOX/snap" << STUB
#!$BASH_BIN
echo "snap" >> "$SENTINEL"
if [ "\$1" = "install" ]; then
  printf '#!$BASH_BIN\necho "PowerShell 7.4.0"\n' > "$SANDBOX/pwsh"
  chmod +x "$SANDBOX/pwsh"
fi
STUB
  chmod +x "$SANDBOX/snap"

  # sudo stub — appends name to sentinel; forwards remaining args.
  cat > "$SANDBOX/sudo" << STUB
#!$BASH_BIN
echo "sudo" >> "$SENTINEL"
shift
exec "\$@"
STUB
  chmod +x "$SANDBOX/sudo"

  # mktemp stub — echoes a deterministic path inside $SANDBOX and touches it
  # so the script can write to it and rm it without hitting the real filesystem.
  cat > "$SANDBOX/mktemp" << STUB
#!$BASH_BIN
_dest="$SANDBOX/pkg.deb"
touch "\$_dest"
echo "\$_dest"
STUB
  chmod +x "$SANDBOX/mktemp"

  # rm stub — no-op; prevents the script from deleting sandbox stubs or
  # touching the real filesystem when it cleans up the temp .deb file.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/rm"
  chmod +x "$SANDBOX/rm"

  # chmod stub — delegates to the real chmod binary.  apt-get/snap stubs call
  # chmod +x on the written pwsh stub; a no-op here would leave pwsh non-executable
  # and cause the post-install "command -v pwsh" check in the script to fail.
  printf '#!%s\nexec %s "$@"\n' "$BASH_BIN" "$CHMOD_BIN" > "$SANDBOX/chmod"
  chmod +x "$SANDBOX/chmod"

  # touch stub — no-op; curl/wget stubs call touch when writing the download
  # destination file; prevents "command not found" under env -i.
  printf '#!%s\n: # no-op touch\n' "$BASH_BIN" > "$SANDBOX/touch"
  chmod +x "$SANDBOX/touch"

  # serena stub — pre-installs a working serena (overridden per test as needed).
  printf '#!%s\necho "Serena 1.5.4.dev0"\n' "$BASH_BIN" > "$SANDBOX/serena"
  chmod +x "$SANDBOX/serena"

  # mcp-server-markdown stub — pre-installs a working mcp-server-markdown.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/mcp-server-markdown"
  chmod +x "$SANDBOX/mcp-server-markdown"

  # playwright-mcp stub — pre-installs a working playwright-mcp.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/playwright-mcp"
  chmod +x "$SANDBOX/playwright-mcp"

  # playwright stub — pre-installs a working playwright CLI.
  # Treats "playwright install chromium" as a no-op success (exit 0).
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/playwright"
  chmod +x "$SANDBOX/playwright"

  # uv stub — appends name to sentinel.
  # On "tool install ...", writes an executable serena stub into $SANDBOX so
  # the post-install command -v check in the script succeeds.
  cat > "$SANDBOX/uv" << STUB
#!$BASH_BIN
echo "uv" >> "$SENTINEL"
if [ "\$1" = "tool" ] && [ "\$2" = "install" ]; then
  printf '#!$BASH_BIN\necho "Serena 1.5.4.dev0"\n' > "$SANDBOX/serena"
  chmod +x "$SANDBOX/serena"
fi
STUB
  chmod +x "$SANDBOX/uv"

  # npm stub — appends name to sentinel.
  # On "install -g <pkgs...>", writes the correct bin stub(s) into $SANDBOX
  # based on which package names appear in the argument list:
  #   mcp-server-markdown  → writes mcp-server-markdown stub
  #   @playwright/mcp      → writes playwright-mcp stub
  #   playwright           → writes playwright stub (CLI, not the MCP package)
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
  if [ -f "$SENTINEL" ] && grep -qE '^(apt-get|snap|dpkg|wget|curl|uv|npm)$' "$SENTINEL"; then
    echo "Unexpected installer invocation in sentinel log:"
    grep -E '^(apt-get|snap|dpkg|wget|curl|uv|npm)$' "$SENTINEL"
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
# 5. Idempotent: remote + pwsh already on PATH
# ---------------------------------------------------------------------------

@test "idempotent: remote + pwsh present exits 0 without invoking any installer" {
  # sandbox already has a pwsh stub from setup(); no further action needed.
  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  assert_no_installer_invoked
}

# ---------------------------------------------------------------------------
# 6. Remote + no pwsh + no apt-get/snap → exits 1 with "no supported installer"
# ---------------------------------------------------------------------------

@test "remote + no pwsh + no installer exits 1 with 'no supported installer' on stderr" {
  # Remove apt-get, snap, and pwsh from sandbox — only id remains.
  rm -f "$SANDBOX/pwsh"
  rm -f "$SANDBOX/apt-get"
  rm -f "$SANDBOX/snap"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"no supported installer"* ]]
}

# ---------------------------------------------------------------------------
# 7. Remote + no pwsh + apt-get present → installs via apt and exits 0
# ---------------------------------------------------------------------------

@test "remote + no pwsh + apt-get present: installs via apt and exits 0" {
  # /etc/os-release must be readable for the script to determine the distro.
  # On non-Linux hosts this file is absent; skip rather than fail spuriously.
  if [ ! -f /etc/os-release ]; then
    skip "/etc/os-release absent on this host; apt install path not exercisable"
  fi

  # Remove the pre-installed pwsh from the sandbox — script must install it.
  rm -f "$SANDBOX/pwsh"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^apt-get$" "$SENTINEL"
}

# ---------------------------------------------------------------------------
# 8. Remote + no pwsh + no apt-get + snap present → installs via snap and exits 0
# ---------------------------------------------------------------------------

@test "remote + no pwsh + snap fallback: installs via snap and exits 0" {
  # Remove pwsh and apt-get from the sandbox so the script falls through to snap.
  rm -f "$SANDBOX/pwsh"
  rm -f "$SANDBOX/apt-get"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^snap$" "$SENTINEL"
}

# ---------------------------------------------------------------------------
# 9. Remote + not root + sudo absent → exits 1
# ---------------------------------------------------------------------------

@test "remote + not root + sudo absent exits 1 with 'sudo not found' on stderr" {
  # Override id stub to return a non-zero uid (non-root).
  printf '#!%s\necho "1001"\n' "$BASH_BIN" > "$SANDBOX/id"
  chmod +x "$SANDBOX/id"
  # Remove sudo and pwsh from sandbox so the script hits the sudo-absent branch.
  rm -f "$SANDBOX/sudo"
  rm -f "$SANDBOX/pwsh"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"sudo not found"* ]]
}

# ---------------------------------------------------------------------------
# 10. apt-get update is scoped to the Microsoft repo list (regression guard)
# ---------------------------------------------------------------------------

@test "apt update is scoped to microsoft-prod.list, not a blanket update" {
  # /etc/os-release must exist for the apt install path to be reached.
  if [ ! -f /etc/os-release ]; then
    skip "/etc/os-release absent on this host; apt install path not exercisable"
  fi

  # Remove pre-installed pwsh so the script attempts installation.
  rm -f "$SANDBOX/pwsh"

  # Replace the default apt-get stub with one that records full argv to a
  # dedicated log file, so we can assert the exact flags used for `update`.
  APT_ARGS_LOG="$SANDBOX/apt-args.log"
  cat > "$SANDBOX/apt-get" << STUB
#!$BASH_BIN
echo "apt-get" >> "$SENTINEL"
echo "\$@" >> "$APT_ARGS_LOG"
if [ "\$1" = "install" ]; then
  printf '#!$BASH_BIN\necho "PowerShell 7.4.0"\n' > "$SANDBOX/pwsh"
  chmod +x "$SANDBOX/pwsh"
fi
STUB
  chmod +x "$SANDBOX/apt-get"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]

  # The update invocation must target only the Microsoft repo list.
  grep -q "update" "$APT_ARGS_LOG"
  grep -q "sources.list.d/microsoft-prod.list" "$APT_ARGS_LOG"
}

# ---------------------------------------------------------------------------
# 11. serena: idempotent — serena already present, uv must NOT be invoked
# ---------------------------------------------------------------------------

@test "serena idempotent: serena present exits 0 without invoking uv" {
  # sandbox already has a serena stub from setup(); uv is present but must not run.
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
# 12. serena: install path — serena absent, uv present → uv invoked, exit 0
# ---------------------------------------------------------------------------

@test "serena install: serena absent + uv present installs serena and exits 0" {
  # Remove the pre-installed serena stub so the script must install it.
  rm -f "$SANDBOX/serena"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^uv$" "$SENTINEL"
  # serena must now be resolvable (uv stub wrote it into $SANDBOX).
  [ -x "$SANDBOX/serena" ]
}

# ---------------------------------------------------------------------------
# 13. serena: missing uv prereq → exit 1 with missing-uv error on stderr
# ---------------------------------------------------------------------------

@test "serena missing uv: serena absent + uv absent exits 1 with 'uv not found' on stderr" {
  # Remove both serena and uv from the sandbox.
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
# 14. markdown: idempotent — mcp-server-markdown present, npm must NOT be invoked
# ---------------------------------------------------------------------------

@test "markdown idempotent: mcp-server-markdown present exits 0 without invoking npm" {
  # sandbox already has mcp-server-markdown and npm stubs from setup().
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
# 15. markdown: install path — mcp-server-markdown absent, npm present → exit 0
# ---------------------------------------------------------------------------

@test "markdown install: mcp-server-markdown absent + npm present installs it and exits 0" {
  # Remove the pre-installed mcp-server-markdown stub.
  rm -f "$SANDBOX/mcp-server-markdown"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^npm$" "$SENTINEL"
  # mcp-server-markdown must now be resolvable (npm stub wrote it into $SANDBOX).
  [ -x "$SANDBOX/mcp-server-markdown" ]
}

# ---------------------------------------------------------------------------
# 16. markdown: missing npm prereq → exit 1 with missing-npm error on stderr
# ---------------------------------------------------------------------------

@test "markdown missing npm: mcp-server-markdown absent + npm absent exits 1 with 'npm not found' on stderr" {
  # Remove both mcp-server-markdown and npm from the sandbox.
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
# 17. playwright: idempotent — playwright-mcp + playwright present, npm NOT invoked
# ---------------------------------------------------------------------------

@test "playwright idempotent: playwright-mcp and playwright present exits 0 without invoking npm" {
  # sandbox already has playwright-mcp and playwright stubs from setup().
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
# 18. playwright: install path — bins absent, npm present → npm invoked, exit 0,
#     both bins resolvable afterward
# ---------------------------------------------------------------------------

@test "playwright install: playwright-mcp and playwright absent + npm present installs both and exits 0" {
  # Remove the pre-installed playwright-mcp and playwright stubs.
  rm -f "$SANDBOX/playwright-mcp"
  rm -f "$SANDBOX/playwright"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^npm$" "$SENTINEL"
  # Both bins must now be resolvable (npm stub wrote them into $SANDBOX).
  [ -x "$SANDBOX/playwright-mcp" ]
  [ -x "$SANDBOX/playwright" ]
}

# ---------------------------------------------------------------------------
# 19. playwright: missing npm prereq → exit 1 with npm-not-found error on stderr
# ---------------------------------------------------------------------------

@test "playwright missing npm: playwright-mcp and playwright absent + npm absent exits 1 with 'npm not found' on stderr" {
  # Remove playwright-mcp, playwright, and npm from the sandbox.
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
# 20. playwright: browser download failure is non-fatal — script still exits 0
# ---------------------------------------------------------------------------

@test "playwright browser non-fatal: chromium download fails but script exits 0" {
  # Strategy: place playwright-mcp and a failing-playwright stub BEFORE the npm
  # stub runs, then use an npm stub that does NOT overwrite these pre-placed stubs.
  # This way: the idempotency check fails (only one bin is present — we remove
  # playwright-mcp so the install path runs), npm is invoked, it writes
  # playwright-mcp, and the pre-placed failing playwright stub remains in place.
  # The verify step passes (both bins exist), but the browser step returns non-zero
  # — the non-fatal guard must let the script continue to exit 0.

  # Remove playwright-mcp so idempotency check fails; keep a failing playwright stub.
  rm -f "$SANDBOX/playwright-mcp"

  # Overwrite the default playwright stub with one that fails on "install".
  printf '#!%s\nif [ "$1" = "install" ]; then exit 1; fi\nexit 0\n' \
    "$BASH_BIN" > "$SANDBOX/playwright"
  chmod +x "$SANDBOX/playwright"

  # Override the npm stub to write only playwright-mcp (not playwright),
  # so the pre-placed failing playwright stub is used for the browser step.
  # Uses only shell builtins + $BASH_BIN (no cat/sed/chmod in PATH under env -i).
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

  # Browser failure must NOT abort the bootstrap.
  [ "$status" -eq 0 ]
  # The chromium-failure warning must appear in stderr output.
  [[ "$output" == *"chromium download failed"* ]]
}
