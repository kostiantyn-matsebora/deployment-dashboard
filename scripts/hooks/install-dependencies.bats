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
  if [ -f "$SENTINEL" ] && grep -qE '^(apt-get|snap|dpkg|wget|curl)$' "$SENTINEL"; then
    echo "Unexpected installer invocation in sentinel log:"
    grep -E '^(apt-get|snap|dpkg|wget|curl)$' "$SENTINEL"
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
