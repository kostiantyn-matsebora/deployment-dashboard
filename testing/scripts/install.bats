#!/usr/bin/env bats
# Tests for ../../install/install.sh -- bash sibling of install/install.ps1 (issue #7).
#
# Strategy: PATH-shadowing stubs. We prepend a per-test stub directory to PATH
# so calls to `curl`, `docker`, `openssl`, `xxd`, `od`, `grep`, `sed`, `head`
# resolve to our fakes. Each stub appends one line to $STUB_LOG with its
# invocation, then returns the canned exit code controlled by env vars.
#
# Coverage matrix mirrors install.Tests.ps1 -- see that file for the rationale.

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    SCRIPT="$REPO_ROOT/install/install.sh"
    INSTALL_DIR="$BATS_TEST_TMPDIR/dashboard"
    STUB_DIR="$BATS_TEST_TMPDIR/stub"
    STUB_LOG="$BATS_TEST_TMPDIR/stub.log"
    mkdir -p "$INSTALL_DIR" "$STUB_DIR"
    : > "$STUB_LOG"

    # Wipe any host-side state that the precondition / secret matrix depends on.
    unset GHA_TOKEN
    unset DASHBOARD_API_TOKEN

    export STUB_LOG

    # --- curl stub. Honours DD_CURL_FAIL substring; otherwise writes a tiny
    # placeholder to the destination so subsequent `-f` Test-Path-equivalents pass.
    cat > "$STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
# Log one line per invocation, args joined with single spaces so grep -E
# can match the whole call against a single regex without %q-induced
# multi-line splits.
echo "curl $*" >> "$STUB_LOG"
# Walk args. install.sh uses: curl -fsSL -o "$dest" "$url"
dest=""
url=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o) dest="$2"; shift 2 ;;
        --max-time) shift 2 ;;
        -fsSL|-fsS|-f|-s|-S|-L) shift ;;
        http*|https*) url="$1"; shift ;;
        *) shift ;;
    esac
done
if [ -n "${DD_CURL_FAIL:-}" ] && [[ "$url" == *"$DD_CURL_FAIL"* ]]; then
    exit 22  # 404-style failure
fi
if [[ "$url" == *"/health" ]]; then
    if [ "${DD_HEALTH_OK:-true}" = "true" ]; then
        exit 0
    else
        exit 7
    fi
fi
if [ -n "$dest" ]; then
    mkdir -p "$(dirname "$dest")"
    printf '# stub asset for %s\n' "$url" > "$dest"
fi
exit 0
STUB
    chmod +x "$STUB_DIR/curl"

    # --- docker stub.
    cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
# We only need to react to subcommands `compose pull|up|logs`.
if [ "${1:-}" = "compose" ]; then
    shift
    sub=""
    for a in "$@"; do
        case "$a" in
            pull) sub=pull ;;
            up)   sub=up   ;;
            logs) sub=logs ;;
            down) sub=down ;;
        esac
        if [ -n "$sub" ]; then break; fi
    done
    case "$sub" in
        pull) exit "${DD_PULL_EXIT:-0}" ;;
        up)   exit "${DD_UP_EXIT:-0}"   ;;
        logs) echo "[stub docker compose logs]"; exit 0 ;;
        down) exit "${DD_DOWN_EXIT:-0}" ;;
    esac
fi
exit 0
STUB
    chmod +x "$STUB_DIR/docker"

    # --- openssl stub (only `openssl rand -hex N` is used by install.sh).
    cat > "$STUB_DIR/openssl" <<'STUB'
#!/usr/bin/env bash
echo "openssl $*" >> "$STUB_LOG"
if [ "${1:-}" = "rand" ] && [ "${2:-}" = "-hex" ]; then
    n="${3:-32}"
    # Emit deterministic-looking hex (n bytes -> 2n hex chars).
    case "$n" in
        32) echo '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' ;;
        16) echo '0123456789abcdef0123456789abcdef' ;;
        *)
            # Generic fallback.
            python3 -c "import sys; print('ab' * int(sys.argv[1]))" "$n" 2>/dev/null \
                || awk 'BEGIN{for(i=0;i<'"$n"';i++) printf "ab"; printf "\n"}'
            ;;
    esac
    exit 0
fi
exit 0
STUB
    chmod +x "$STUB_DIR/openssl"

    # Sleep stub -- no-op so the health-poll loop ticks fast.
    cat > "$STUB_DIR/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
    chmod +x "$STUB_DIR/sleep"

    export PATH="$STUB_DIR:$PATH"
}

teardown() {
    :
}

# Helper: run install.sh with stubs in place, capturing output + exit.
run_install() {
    run bash "$SCRIPT" "$@"
}

# Helper: assert a logged event substring appears.
log_contains() {
    grep -qF "$1" "$STUB_LOG"
}
log_not_contains() {
    ! grep -qF "$1" "$STUB_LOG"
}

# ---- GHA_TOKEN precondition matrix ----

@test "--fetcher without GHA_TOKEN exits 1 with red error before any docker / curl call" {
    run_install --fetcher --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"--allow-missing-gha-token"* ]]
    [[ "$output" == *"ERROR"* ]]
    # Strongest precondition signal -- no docker + no curl was invoked.
    log_not_contains 'docker compose'
    log_not_contains 'curl '
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
}

@test "--fetcher --allow-missing-gha-token prints yellow notice and proceeds" {
    run_install --fetcher --allow-missing-gha-token --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" == *"GHA_TOKEN not set"* ]]
    [[ "$output" == *"placeholder"* ]]
}

@test "--fetcher with GHA_TOKEN set: no GHA_TOKEN advisory" {
    export GHA_TOKEN='ghp_fake_pat'
    run_install --fetcher --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" != *"GHA_TOKEN not set"* ]]
}

@test "no --fetcher: GHA_TOKEN irrelevant regardless of state" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" != *"GHA_TOKEN"* ]]
}

# ---- API_TOKEN secret handling ----

@test "new install -- generates a 64-char hex API_TOKEN persisted to dashboard.env" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [ -f "$INSTALL_DIR/dashboard.env" ]
    grep -E '^API_TOKEN=[0-9a-f]{64}$' "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"Generated random API_TOKEN"* ]]
}

@test "pre-existing dev-literal API_TOKEN -- regenerated to fresh random hex" {
    cat > "$INSTALL_DIR/dashboard.env" <<'EOF'
API_TOKEN=local-dev-token-not-for-production
POSTGRES_PASSWORD=preexisting-pg-pw
EOF
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    ! grep -q 'API_TOKEN=local-dev-token-not-for-production' "$INSTALL_DIR/dashboard.env"
    grep -E '^API_TOKEN=[0-9a-f]{64}$' "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"Generated random API_TOKEN"* ]]
}

@test "pre-existing valid API_TOKEN -- preserved (Reusing log line)" {
    preexisting=$(printf 'a%.0s' {1..64})
    cat > "$INSTALL_DIR/dashboard.env" <<EOF
API_TOKEN=$preexisting
POSTGRES_PASSWORD=preexisting-pg-pw
EOF
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE "^API_TOKEN=$preexisting$" "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"Reusing API_TOKEN"* ]]
}

@test "\$DASHBOARD_API_TOKEN -- wins over generation when no env-file exists" {
    custom='custom-api-token-from-env-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    export DASHBOARD_API_TOKEN="$custom"
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE "^API_TOKEN=$custom$" "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"DASHBOARD_API_TOKEN"* ]]
}

@test "\$DASHBOARD_API_TOKEN = dev literal -- refused, random generation kicks in" {
    export DASHBOARD_API_TOKEN='local-dev-token-not-for-production'
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    ! grep -q 'API_TOKEN=local-dev-token-not-for-production' "$INSTALL_DIR/dashboard.env"
    grep -E '^API_TOKEN=[0-9a-f]{64}$' "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"Generated random API_TOKEN"* ]]
}

# ---- POSTGRES_PASSWORD secret handling ----

@test "new install -- generates a 32-char hex POSTGRES_PASSWORD" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -E '^POSTGRES_PASSWORD=[0-9a-f]{32}$' "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"Generated random POSTGRES_PASSWORD"* ]]
}

@test "pre-existing dev-literal POSTGRES_PASSWORD -- regenerated" {
    a64=$(printf 'b%.0s' {1..64})
    cat > "$INSTALL_DIR/dashboard.env" <<EOF
POSTGRES_PASSWORD=local-dev-password
API_TOKEN=$a64
EOF
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    ! grep -q 'POSTGRES_PASSWORD=local-dev-password' "$INSTALL_DIR/dashboard.env"
    grep -E '^POSTGRES_PASSWORD=[0-9a-f]{32}$' "$INSTALL_DIR/dashboard.env"
}

@test "pre-existing valid POSTGRES_PASSWORD -- preserved" {
    pre=$(printf 'c%.0s' {1..32})
    a64=$(printf 'b%.0s' {1..64})
    cat > "$INSTALL_DIR/dashboard.env" <<EOF
POSTGRES_PASSWORD=$pre
API_TOKEN=$a64
EOF
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE "^POSTGRES_PASSWORD=$pre$" "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"Reusing POSTGRES_PASSWORD"* ]]
}

# ---- URL shape branching ----

@test "--version latest -- uses /releases/latest/download/ URL prefix" {
    run_install --version latest --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qF 'https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/latest/download/docker-compose.release.yml' "$STUB_LOG"
    ! grep -qF 'releases/download/latest/' "$STUB_LOG"
}

@test "--version v1.2.3 -- uses /releases/download/v1.2.3/ URL prefix" {
    run_install --version v1.2.3 --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qF 'https://github.com/kostiantyn-matsebora/deployment-dashboard/releases/download/v1.2.3/docker-compose.release.yml' "$STUB_LOG"
}

# ---- Env-file shape ----

@test "env-file -- contains every required key with -Version + -Port substituted" {
    run_install --version v1.2.3 --port 9090 --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    f="$INSTALL_DIR/dashboard.env"
    grep -qE '^POSTGRES_DB=dashboard$' "$f"
    grep -qE '^POSTGRES_USER=dashboard$' "$f"
    grep -qE '^POSTGRES_PASSWORD=[0-9a-f]{32}$' "$f"
    grep -qE '^API_TOKEN=[0-9a-f]{64}$' "$f"
    grep -qE '^DASHBOARD_VERSION=v1\.2\.3$' "$f"
    grep -qE '^DASHBOARD_PORT=9090$' "$f"
    grep -qE '^ConnectionStrings__DefaultConnection=Host=db;Database=dashboard;Username=dashboard;Password=[0-9a-f]{32}$' "$f"
}

@test "ConnectionStrings password matches POSTGRES_PASSWORD literally" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    f="$INSTALL_DIR/dashboard.env"
    pg=$(grep -E '^POSTGRES_PASSWORD=' "$f" | head -n1 | sed -E 's/^POSTGRES_PASSWORD=//')
    grep -qE "^ConnectionStrings__DefaultConnection=Host=db;Database=dashboard;Username=dashboard;Password=$pg$" "$f"
}

# ---- Compose args (profiles + env-file) ----

@test "default install -- --profile migrate present, --profile fetcher absent in up call" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    # Extract the `compose ... up ...` line from the stub log.
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [ -n "$up_line" ]
    [[ "$up_line" == *"--profile migrate"* ]]
    [[ "$up_line" != *"--profile fetcher"* ]]
}

@test "--fetcher (with GHA_TOKEN) -- both --profile migrate and --profile fetcher present" {
    export GHA_TOKEN='ghp_fake'
    run_install --fetcher --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [[ "$up_line" == *"--profile migrate"* ]]
    [[ "$up_line" == *"--profile fetcher"* ]]
}

@test "--skip-migrations -- no --profile migrate, no --profile fetcher" {
    run_install --skip-migrations --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [[ "$up_line" != *"--profile migrate"* ]]
    [[ "$up_line" != *"--profile fetcher"* ]]
}

@test "--env-file always passed to docker compose pull + up" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    # Both pull and up calls must include --env-file <INSTALL_DIR>/dashboard.env.
    pull_line="$(grep -E '^docker.*compose.*pull' "$STUB_LOG" | head -n1)"
    up_line="$(grep -E '^docker.*compose.*up'   "$STUB_LOG" | head -n1)"
    [[ "$pull_line" == *"--env-file"* ]]
    [[ "$pull_line" == *"$INSTALL_DIR/dashboard.env"* ]]
    [[ "$up_line"   == *"--env-file"* ]]
    [[ "$up_line"   == *"$INSTALL_DIR/dashboard.env"* ]]
}

# ---- Error paths ----

@test "asset download failure -- exits 1 with red error mentioning asset + version" {
    export DD_CURL_FAIL='docker-compose.release.yml'
    run_install --version v0.0.0-doesnotexist --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"docker-compose.release.yml"* ]]
    [[ "$output" == *"v0.0.0-doesnotexist"* ]]
}

@test "docker compose pull failure (non-zero exit) -- script exits non-zero" {
    export DD_PULL_EXIT=1
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -ne 0 ]
}

@test "health-poll timeout -- script exits non-zero and dumps logs" {
    export DD_HEALTH_OK=false
    run_install --version v9.9.9-test --health-timeout-seconds 1 --install-dir "$INSTALL_DIR"
    [ "$status" -ne 0 ]
    [[ "$output" == *"/health did not return 200"* ]]
    # `docker compose ... logs` was invoked on failure.
    grep -qE '^docker.*compose.*logs' "$STUB_LOG"
}
