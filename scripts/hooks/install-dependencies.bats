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
  # On "install", inspects package args and writes the correct bin stub(s):
  #   powershell       → writes pwsh stub
  #   dotnet-sdk-10.0  → writes dotnet stub (--list-sdks + --version)
  # "update" and all other subcommands are logged and exit 0.
  cat > "$SANDBOX/apt-get" << STUB
#!$BASH_BIN
echo "apt-get" >> "$SENTINEL"
if [ "\$1" = "install" ]; then
  for _arg in "\$@"; do
    case "\$_arg" in
      powershell)
        printf '#!$BASH_BIN\necho "PowerShell 7.4.0"\n' > "$SANDBOX/pwsh"
        chmod +x "$SANDBOX/pwsh"
        ;;
      dotnet-sdk-10.0)
        printf '#!$BASH_BIN\nif [ "\$1" = "--list-sdks" ]; then\n  echo "10.0.109 [/usr/lib/dotnet/sdk]"\nelif [ "\$1" = "--version" ]; then\n  echo "10.0.109"\nfi\nexit 0\n' > "$SANDBOX/dotnet"
        chmod +x "$SANDBOX/dotnet"
        ;;
    esac
  done
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

  # mktemp stub — echoes a deterministic path inside $SANDBOX.
  # Handles both the file form (default; for .deb download) and directory form (-d;
  # for the tokensave temp-dir).  Delegates mkdir to the real binary via its absolute path.
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
  _dest="$SANDBOX/pkg.deb"
  : > "\$_dest"
  echo "\$_dest"
fi
STUB
  chmod +x "$SANDBOX/mktemp"

  # mkdir stub — delegates to the real mkdir binary (needed for $HOME/.local/bin creation).
  MKDIR_BIN="$(command -v mkdir)"
  printf '#!%s\nexec %s "$@"\n' "$BASH_BIN" "$MKDIR_BIN" > "$SANDBOX/mkdir"
  chmod +x "$SANDBOX/mkdir"

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
  # Accepts all subcommands (including "install-browser chrome-for-testing") and exits 0.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/playwright-mcp"
  chmod +x "$SANDBOX/playwright-mcp"

  # playwright stub — pre-installs a working playwright CLI.
  # Treats "playwright install chromium" as a no-op success (exit 0).
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/playwright"
  chmod +x "$SANDBOX/playwright"

  # dotnet stub — pre-installs a working dotnet with a 10.x SDK.
  # Handles: --list-sdks (prints a 10.x line) and --version (prints version).
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
  # On "tool install <pkg>", writes the correct bin stub into $SANDBOX so the
  # post-install command -v check in the script succeeds:
  #   serena               → writes serena stub
  #   code-review-graph    → writes code-review-graph stub
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
  # Accepts all subcommands (including "build") and exits 0.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/code-review-graph"
  chmod +x "$SANDBOX/code-review-graph"

  # tokensave stub — pre-installs a working tokensave.
  # Accepts all subcommands (including "serve", "init", "disable-upload-counter") and exits 0.
  printf '#!%s\nexit 0\n' "$BASH_BIN" > "$SANDBOX/tokensave"
  chmod +x "$SANDBOX/tokensave"

  # tar stub — appends name to sentinel; extracts nothing (no-op).
  # tokensave install uses tar -xzf; under env -i tar must be stubbed.
  printf '#!%s\necho "tar" >> "%s"\nexit 0\n' "$BASH_BIN" "$SENTINEL" > "$SANDBOX/tar"
  chmod +x "$SANDBOX/tar"

  # install stub — appends name to sentinel; copies the source file to the
  # destination so command -v can resolve the installed binary.
  # Usage: install -m 0755 <src> <dest>
  cat > "$SANDBOX/install" << STUB
#!$BASH_BIN
echo "install" >> "$SENTINEL"
# Parse: install [-m <mode>] <src> <dest>
_src=""
_dest=""
_skip_next=0
for _a in "\$@"; do
  if [ "\$_skip_next" = "1" ]; then _skip_next=0; continue; fi
  case "\$_a" in
    -m) _skip_next=1 ;;
    -*) ;;
    *) if [ -z "\$_src" ]; then _src="\$_a"; else _dest="\$_a"; fi ;;
  esac
done
if [ -n "\$_src" ] && [ -n "\$_dest" ]; then
  printf '#!$BASH_BIN\nexit 0\n' > "\$_dest"
  chmod +x "\$_dest"
fi
exit 0
STUB
  chmod +x "$SANDBOX/install"

  # find stub — used by tokensave install to locate the extracted binary.
  # Returns a deterministic path that the install stub will act on.
  cat > "$SANDBOX/find" << STUB
#!$BASH_BIN
echo "$SANDBOX/tokensave"
STUB
  chmod +x "$SANDBOX/find"

  # cargo stub — appends name to sentinel; exits 1 by default (crates.io blocked).
  # Overridden per test for cargo-success scenarios.
  printf '#!%s\necho "cargo" >> "%s"\nexit 1\n' "$BASH_BIN" "$SENTINEL" > "$SANDBOX/cargo"
  chmod +x "$SANDBOX/cargo"

  # sed stub — used by tokensave version resolution (sed -E 's#.*/tag/v?##').
  # Delegates to the real sed binary.
  SED_BIN="$(command -v sed)"
  printf '#!%s\nexec %s "$@"\n' "$BASH_BIN" "$SED_BIN" > "$SANDBOX/sed"
  chmod +x "$SANDBOX/sed"

  # head stub — used by tokensave install (find ... | head -n1).
  # Delegates to the real head binary.
  HEAD_BIN="$(command -v head)"
  printf '#!%s\nexec %s "$@"\n' "$BASH_BIN" "$HEAD_BIN" > "$SANDBOX/head"
  chmod +x "$SANDBOX/head"

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

# ---------------------------------------------------------------------------
# 20b. playwright: MCP browser download failure is non-fatal — script still exits 0
# ---------------------------------------------------------------------------

@test "playwright MCP browser non-fatal: chrome-for-testing download fails but script exits 0" {
  # Trigger the install path by removing playwright-mcp; keep a failing playwright-mcp stub
  # for the browser sub-step while the npm stub writes a fresh bin for the post-install check.

  # Remove playwright-mcp so the idempotency check fails and npm runs.
  rm -f "$SANDBOX/playwright-mcp"

  # Override npm stub: write the post-install playwright-mcp inline via printf (bash builtin,
  # always available under env -i).  The written stub exits 1 on install-browser to simulate
  # a failed cdn download, and exits 0 for all other invocations.
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

  # MCP browser failure must NOT abort the bootstrap.
  [ "$status" -eq 0 ]
  # The chrome-for-testing failure warning must appear in stderr output.
  [[ "$output" == *"chrome-for-testing download failed"* ]]
}

# ---------------------------------------------------------------------------
# 21. dotnet: idempotent — dotnet already present with 10.x SDK, apt NOT invoked
# ---------------------------------------------------------------------------

@test "dotnet idempotent: dotnet with 10.x SDK present exits 0 without invoking apt-get install" {
  # sandbox already has a dotnet stub with a 10.x SDK from setup().
  # Capture apt-get args to an install log so we can assert no dotnet install ran.
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
  # dotnet-sdk-10.0 must NOT appear in any apt-get install invocation.
  if [ -f "$APT_INSTALL_LOG" ] && grep -q "dotnet-sdk-10.0" "$APT_INSTALL_LOG"; then
    echo "apt-get install dotnet-sdk-10.0 was invoked despite 10.x SDK already present"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 22. dotnet: install path — dotnet absent, apt-get present → installed, exit 0
# ---------------------------------------------------------------------------

@test "dotnet install: dotnet absent + apt-get present installs dotnet and exits 0" {
  # Remove the pre-installed dotnet stub so the script must install it.
  rm -f "$SANDBOX/dotnet"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^apt-get$" "$SENTINEL"
  # dotnet must now be resolvable (apt-get stub wrote it into $SANDBOX).
  [ -x "$SANDBOX/dotnet" ]
}

# ---------------------------------------------------------------------------
# 23. dotnet: missing apt-get prereq → exit 1 with apt-get-not-found on stderr
# ---------------------------------------------------------------------------

@test "dotnet missing apt-get: dotnet absent + apt-get absent exits 1 with 'apt-get not found' on stderr" {
  # Keep pwsh + serena + mcp-server-markdown + playwright-mcp + playwright so
  # those sections skip; remove dotnet and apt-get to trigger the .NET prereq failure.
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
  # Override the default dotnet stub to report only an 8.x SDK — no 10.x line.
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
  # After install, dotnet stub written by apt-get stub must report a 10.x SDK.
  "$SANDBOX/dotnet" --list-sdks | grep -q '^10\.'
}

# ---------------------------------------------------------------------------
# 25. code-review-graph: idempotent — present, uv must NOT be invoked
# ---------------------------------------------------------------------------

@test "code-review-graph idempotent: code-review-graph present exits 0 without invoking uv" {
  # sandbox already has a code-review-graph stub from setup(); uv must not run for it.
  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  # uv must not have been invoked for code-review-graph (it may be absent from log entirely).
  if [ -f "$SENTINEL" ] && grep -q "^uv$" "$SENTINEL"; then
    echo "uv was invoked despite code-review-graph already being on PATH"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 26. code-review-graph: install path — absent + uv present → installs, exits 0
# ---------------------------------------------------------------------------

@test "code-review-graph install: absent + uv present installs it and exits 0" {
  # Remove the pre-installed code-review-graph stub so the script must install it.
  rm -f "$SANDBOX/code-review-graph"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -q "^uv$" "$SENTINEL"
  # code-review-graph must now be resolvable (uv stub wrote it into $SANDBOX).
  [ -x "$SANDBOX/code-review-graph" ]
}

# ---------------------------------------------------------------------------
# 27. code-review-graph: missing uv prereq → exit 1 with 'uv not found' on stderr
# ---------------------------------------------------------------------------

@test "code-review-graph missing uv: absent + uv absent exits 1 with 'uv not found' on stderr" {
  # Remove both code-review-graph and uv from the sandbox.
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
# 28. tokensave: idempotent — present, no download attempted
# ---------------------------------------------------------------------------

@test "tokensave idempotent: tokensave present exits 0 without attempting download" {
  # sandbox already has a tokensave stub from setup().
  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"
  [ "$status" -eq 0 ]
  # curl must not have been called for tokensave (idempotency check skips download).
  # We check that no download path was entered by asserting tar was not invoked
  # (the prebuilt download path calls tar; if tokensave is present it never runs).
  if [ -f "$SENTINEL" ] && grep -q "^tar$" "$SENTINEL"; then
    echo "tar was invoked despite tokensave already being on PATH"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 29. tokensave: prebuilt install success — absent; stub curl+tar+install so a
#     fake tokensave bin is produced → exits 0, tokensave now resolvable
# ---------------------------------------------------------------------------

@test "tokensave prebuilt install: absent + curl+tar available installs binary and exits 0" {
  # Remove the pre-installed tokensave stub — script must download and install it.
  rm -f "$SANDBOX/tokensave"

  # The default curl stub writes the -o file as empty; tar is a no-op; the find
  # stub returns $SANDBOX/tokensave as the extracted binary path; the install stub
  # copies source to destination writing a real executable — all already set up in setup().
  # We need curl to write a non-empty tarball path for tar to accept, but since
  # tar is a stub (no-op) the content doesn't matter — curl just needs to write
  # the -o file (which the existing curl stub does via touch).

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    HOME="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  [ "$status" -eq 0 ]
  # curl must have been invoked for the version redirect + download.
  grep -q "^curl$" "$SENTINEL"
  # tokensave must now be resolvable.
  [ -x "$SANDBOX/.local/bin/tokensave" ] || [ -x "$SANDBOX/tokensave" ]
}

# ---------------------------------------------------------------------------
# 30. tokensave: install failure is NON-FATAL — absent; curl fails, cargo absent
#     → script still exits 0 and prints 'continuing without' warning
# ---------------------------------------------------------------------------

@test "tokensave install failure non-fatal: curl fails + cargo absent exits 0 with 'continuing without' warning" {
  # Remove the pre-installed tokensave stub.
  rm -f "$SANDBOX/tokensave"
  # Remove cargo so the fallback also fails.
  rm -f "$SANDBOX/cargo"

  # Override the curl stub to fail on all invocations.
  printf '#!%s\necho "curl" >> "%s"\nexit 1\n' "$BASH_BIN" "$SENTINEL" > "$SANDBOX/curl"
  chmod +x "$SANDBOX/curl"

  run env -i \
    CLAUDE_CODE_REMOTE=1 \
    PATH="$SANDBOX" \
    HOME="$SANDBOX" \
    "$BASH_BIN" "$SCRIPT"

  # Failure must NOT abort the bootstrap.
  [ "$status" -eq 0 ]
  # The non-fatal warning must appear in output (bats merges stdout+stderr via `run`).
  [[ "$output" == *"continuing without"* ]]
}
