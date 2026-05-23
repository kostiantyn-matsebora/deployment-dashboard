#!/usr/bin/env bats
# Tests for install/_bringup-core.sh -- six-function helper contract + guard helper.
#
# CR-0014 § 3b -- frozen signature table. QA asserts the surface; devops authors the impl.
# Parity coverage against _bringup-core.Tests.ps1 enforces O-2 pwsh/bash drift detection.
#
# Strategy: source the helper in a subshell; call each function directly; assert
# stdout, file content, and exit codes. External calls (docker, curl) are shadowed
# by local function/command stubs so no daemon or live network is needed.
#
# Helper-existence guard: all tests skip when the helper is not yet present.

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
HELPER="$REPO_ROOT/install/_bringup-core.sh"

setup() {
    INSTALL_DIR="$BATS_TEST_TMPDIR/dashboard"
    mkdir -p "$INSTALL_DIR"

    if [ ! -f "$HELPER" ]; then
        skip "install/_bringup-core.sh not yet present on branch (devops parallel delivery)"
    fi

    # Stub directory for PATH-shadowed commands.
    STUB_DIR="$BATS_TEST_TMPDIR/stubs"
    mkdir -p "$STUB_DIR"

    # Default openssl stub for random hex generation.
    cat > "$STUB_DIR/openssl" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "rand" ] && [ "${2:-}" = "-hex" ]; then
    n="${3:-32}"
    case "$n" in
        32) echo '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' ;;
        16) echo '0123456789abcdef0123456789abcdef' ;;
        *)  python3 -c "print('ab' * int('$n'))" 2>/dev/null || printf '%0.sab' $(seq 1 $n) ;;
    esac
    exit 0
fi
exit 0
STUB
    chmod +x "$STUB_DIR/openssl"

    export PATH="$STUB_DIR:$PATH"
}

# ---------------------------------------------------------------------------
# Function 1 -- write_dashboard_env_file
# CR-0014 § 3b row 1.
# ---------------------------------------------------------------------------

@test "write_dashboard_env_file -- writes VERSION, PORT, API_TOKEN, POSTGRES_PASSWORD" {
    env_file="$INSTALL_DIR/dashboard.env"
    run bash -c ". '$HELPER' && write_dashboard_env_file '$env_file' 'v1.2.3' '8080' 'test-token-abc' 'test-pg-password'"
    [ "$status" -eq 0 ]
    grep -qE '^DASHBOARD_VERSION=v1\.2\.3$' "$env_file"
    grep -qE '^DASHBOARD_PORT=8080$' "$env_file"
    grep -qE '^API_TOKEN=test-token-abc$' "$env_file"
    grep -qE '^POSTGRES_PASSWORD=test-pg-password$' "$env_file"
}

@test "write_dashboard_env_file -- ConnectionStrings contains the same POSTGRES_PASSWORD" {
    env_file="$INSTALL_DIR/dashboard.env"
    run bash -c ". '$HELPER' && write_dashboard_env_file '$env_file' 'v9.9.9' '8080' 'tok' 'pg-secret-42'"
    [ "$status" -eq 0 ]
    grep -qE 'Password=pg-secret-42' "$env_file"
}

@test "write_dashboard_env_file -- appends demo_lines when supplied as extra args" {
    env_file="$INSTALL_DIR/dashboard.env"
    run bash -c ". '$HELPER' && write_dashboard_env_file '$env_file' 'v1.0.0' '8080' 'tok' 'pg' 'GHA_API_BASE_URL=http://demo-gha:80' 'FETCHER_POLL_INTERVAL_SECONDS=5'"
    [ "$status" -eq 0 ]
    grep -qE '^GHA_API_BASE_URL=http://demo-gha:80$' "$env_file"
    grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=5$' "$env_file"
}

# ---------------------------------------------------------------------------
# Function 2 -- resolve_dashboard_secrets
# CR-0014 § 3b row 2 + § 3c. Function emits shell assignments (eval-form).
# ---------------------------------------------------------------------------

@test "resolve_dashboard_secrets -- demo path emits API_TOKEN=demo-api-token" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_dashboard_secrets '$env_file' true false")
    echo "$out" | grep -q 'API_TOKEN=demo-api-token'
}

@test "resolve_dashboard_secrets -- demo path emits PG_PASSWORD=local-dev-password" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_dashboard_secrets '$env_file' true false")
    echo "$out" | grep -q 'PG_PASSWORD=local-dev-password'
}

@test "resolve_dashboard_secrets -- non-demo path emits random API_TOKEN of >=32 hex chars" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_dashboard_secrets '$env_file' false false")
    tok=$(echo "$out" | grep '^API_TOKEN=' | sed "s/^API_TOKEN='\\?//;s/'\\?\$//" | tr -d "'")
    [ "${#tok}" -ge 32 ]
    [ "$tok" != "demo-api-token" ]
}

@test "resolve_dashboard_secrets -- non-demo path emits random PG_PASSWORD (not fixed literal)" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_dashboard_secrets '$env_file' false false")
    pw=$(echo "$out" | grep '^PG_PASSWORD=' | sed "s/^PG_PASSWORD='\\?//;s/'\\?\$//" | tr -d "'")
    [ "$pw" != "local-dev-password" ]
    [[ "$pw" =~ ^[0-9a-f]+ ]]
}

# ---------------------------------------------------------------------------
# Function 3 -- resolve_demo_env_defaults
# CR-0014 § 3b row 3. Emits key=value lines (plus comments) to stdout.
# ---------------------------------------------------------------------------

@test "resolve_demo_env_defaults -- includes GHA_API_BASE_URL=http://demo-gha:80" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_demo_env_defaults '$env_file' false")
    echo "$out" | grep -q 'GHA_API_BASE_URL=http://demo-gha:80'
}

@test "resolve_demo_env_defaults -- includes FETCHER_POLL_INTERVAL_SECONDS=5" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_demo_env_defaults '$env_file' false")
    echo "$out" | grep -q 'FETCHER_POLL_INTERVAL_SECONDS=5'
}

@test "resolve_demo_env_defaults -- includes GHA_REPOSITORIES with demo-org repos" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_demo_env_defaults '$env_file' false")
    echo "$out" | grep -q 'GHA_REPOSITORIES=.*demo-org.*web-portal'
}

@test "resolve_demo_env_defaults -- reset_demo_defaults=true forces FETCHER_POLL_INTERVAL_SECONDS=5 over custom value" {
    env_file="$INSTALL_DIR/dashboard.env"
    printf 'GHA_REPOSITORIES=custom\nFETCHER_POLL_INTERVAL_SECONDS=120\n' > "$env_file"
    out=$(bash -c ". '$HELPER' && resolve_demo_env_defaults '$env_file' true")
    echo "$out" | grep -q 'FETCHER_POLL_INTERVAL_SECONDS=5'
    ! echo "$out" | grep -q 'FETCHER_POLL_INTERVAL_SECONDS=120'
}

# ---------------------------------------------------------------------------
# Function 4 -- resolve_compose_args
# CR-0014 § 3b row 4. Emits one token per line.
# ---------------------------------------------------------------------------

@test "resolve_compose_args -- demo mode includes --profile demo AND --profile fetcher" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_compose_args true false false false docker-compose.release.yml '$env_file'")
    echo "$out" | grep -q -- '--profile'
    echo "$out" | grep -q 'demo'
    echo "$out" | grep -q 'fetcher'
}

@test "resolve_compose_args -- real-gha mode includes fetcher but NOT demo" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_compose_args false true false false docker-compose.release.yml '$env_file'")
    echo "$out" | grep -q 'fetcher'
    ! echo "$out" | grep -wq 'demo'
}

@test "resolve_compose_args -- empty mode includes neither demo nor fetcher" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_compose_args false false true false docker-compose.release.yml '$env_file'")
    ! echo "$out" | grep -wq 'demo'
    ! echo "$out" | grep -wq 'fetcher'
}

@test "resolve_compose_args -- includes -f <compose_file> and --env-file <env_file>" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && resolve_compose_args true false false false docker-compose.release.yml '$env_file'")
    echo "$out" | grep -q -- '-f'
    echo "$out" | grep -q 'docker-compose.release.yml'
    echo "$out" | grep -q -- '--env-file'
    echo "$out" | grep -q "$env_file"
}

# ---------------------------------------------------------------------------
# Function 5 -- wait_dashboard_health
# CR-0014 § 3b row 5: exits 0 on healthy; exits 1 on timeout.
# ---------------------------------------------------------------------------

@test "wait_dashboard_health -- exits 0 when curl returns 0 (simulates 200)" {
    # Stub curl to always succeed (exit 0 = HTTP 200-class).
    cat > "$STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
    chmod +x "$STUB_DIR/curl"
    run bash -c ". '$HELPER' && wait_dashboard_health 'http://localhost:8080/health' 5"
    [ "$status" -eq 0 ]
}

@test "wait_dashboard_health -- exits 1 when health never succeeds within timeout" {
    # Stub curl to always fail (exit 7 = could not connect).
    cat > "$STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
exit 7
STUB
    chmod +x "$STUB_DIR/curl"
    # Stub docker so log dump doesn't error.
    cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
    chmod +x "$STUB_DIR/docker"
    # Stub sleep so the timeout loop completes in milliseconds.
    cat > "$STUB_DIR/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
    chmod +x "$STUB_DIR/sleep"
    run bash -c ". '$HELPER' && wait_dashboard_health 'http://localhost:8080/health' 1"
    [ "$status" -eq 1 ]
}

# ---------------------------------------------------------------------------
# Function 6 -- write_dashboard_url_panel
# CR-0014 § 3b row 6: stdout contains port number per mode.
# ---------------------------------------------------------------------------

@test "write_dashboard_url_panel -- demo mode stdout contains port" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && write_dashboard_url_panel 8080 'demo-api-token' '$env_file' true false false")
    echo "$out" | grep -q '8080'
}

@test "write_dashboard_url_panel -- real-gha mode stdout contains port" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && write_dashboard_url_panel 9090 'abcdef' '$env_file' false true false")
    echo "$out" | grep -q '9090'
}

@test "write_dashboard_url_panel -- empty mode stdout contains port" {
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(bash -c ". '$HELPER' && write_dashboard_url_panel 8080 'tok' '$env_file' false false true")
    echo "$out" | grep -q '8080'
}

# ---------------------------------------------------------------------------
# Guard helper -- test_pg_volume_conflict
# CR-0014 § 3b row 7: exits 1 when volume present + no env-file.
# Takes 3 args: volume_name env_file_path install_dir.
# ---------------------------------------------------------------------------

@test "test_pg_volume_conflict -- volume absent exits 0 (no conflict)" {
    env_file="$INSTALL_DIR/dashboard.env"
    cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "volume" ] && [ "${2:-}" = "inspect" ]; then
    echo "Error response from daemon: No such volume: ${3:-}" >&2
    exit 1
fi
exit 0
STUB
    chmod +x "$STUB_DIR/docker"
    run bash -c ". '$HELPER' && test_pg_volume_conflict 'deployment-dashboard_postgres-data' '$env_file' '$INSTALL_DIR'"
    [ "$status" -eq 0 ]
}

@test "test_pg_volume_conflict -- volume present + no env-file exits 1 (conflict)" {
    # env_file must NOT exist for the conflict to fire.
    env_file="$INSTALL_DIR/dashboard.env"
    rm -f "$env_file"
    cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "volume" ] && [ "${2:-}" = "inspect" ]; then
    echo '[{"Name":"deployment-dashboard_postgres-data"}]'
    exit 0
fi
exit 0
STUB
    chmod +x "$STUB_DIR/docker"
    run bash -c ". '$HELPER' && test_pg_volume_conflict 'deployment-dashboard_postgres-data' '$env_file' '$INSTALL_DIR'"
    [ "$status" -eq 1 ]
}
