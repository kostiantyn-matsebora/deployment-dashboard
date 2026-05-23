#!/usr/bin/env bats
# Tests for install/_bringup-core.sh -- six-function helper contract + guard helper.
#
# CR-0014 § 3b -- frozen signature table. QA asserts the surface; devops authors the impl.
# Parity coverage against _bringup-core.Tests.ps1 enforces O-2 pwsh/bash drift detection.
#
# Strategy: source the helper in a subshell; call each function directly; assert
# stdout, file content, and exit codes. External calls (docker) are shadowed by
# local function overrides inside each @test body so no daemon is needed.
#
# Helper-existence guard: all tests skip when the helper is not yet present
# on the branch (devops delivers in parallel).

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
HELPER="$REPO_ROOT/install/_bringup-core.sh"

setup() {
    INSTALL_DIR="$BATS_TEST_TMPDIR/dashboard"
    mkdir -p "$INSTALL_DIR"

    # Skip all tests when devops has not yet committed the helper.
    if [ ! -f "$HELPER" ]; then
        skip "install/_bringup-core.sh not yet present on branch (devops parallel delivery)"
    fi
}

# ---------------------------------------------------------------------------
# Function 1 -- write_dashboard_env_file
# CR-0014 § 3b row 1: writes env file from positional inputs.
# ---------------------------------------------------------------------------

@test "write_dashboard_env_file -- writes VERSION, PORT, API_TOKEN, POSTGRES_PASSWORD" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    write_dashboard_env_file "$env_file" "v1.2.3" "8080" "test-token-abc" "test-pg-password"
    grep -qE '^DASHBOARD_VERSION=v1\.2\.3$' "$env_file"
    grep -qE '^DASHBOARD_PORT=8080$' "$env_file"
    grep -qE '^API_TOKEN=test-token-abc$' "$env_file"
    grep -qE '^POSTGRES_PASSWORD=test-pg-password$' "$env_file"
}

@test "write_dashboard_env_file -- ConnectionStrings contains the same POSTGRES_PASSWORD" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    write_dashboard_env_file "$env_file" "v9.9.9" "8080" "tok" "pg-secret-42"
    grep -qE 'Password=pg-secret-42' "$env_file"
}

@test "write_dashboard_env_file -- appends demo_lines when supplied" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    demo_lines=("GHA_API_BASE_URL=http://demo-gha:80" "FETCHER_POLL_INTERVAL_SECONDS=5")
    write_dashboard_env_file "$env_file" "v1.0.0" "8080" "tok" "pg" "${demo_lines[@]}"
    grep -qE '^GHA_API_BASE_URL=http://demo-gha:80$' "$env_file"
    grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=5$' "$env_file"
}

# ---------------------------------------------------------------------------
# Function 2 -- resolve_dashboard_secrets
# CR-0014 § 3b row 2 + § 3c: demo path returns fixed literals; non-demo generates random.
# ---------------------------------------------------------------------------

@test "resolve_dashboard_secrets -- demo path returns POSTGRES_PASSWORD=local-dev-password" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    result=$(resolve_dashboard_secrets "$env_file" "true" "false")
    echo "$result" | grep -q 'POSTGRES_PASSWORD=local-dev-password'
}

@test "resolve_dashboard_secrets -- demo path returns API_TOKEN=demo-api-token" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    result=$(resolve_dashboard_secrets "$env_file" "true" "false")
    echo "$result" | grep -q 'API_TOKEN=demo-api-token'
}

@test "resolve_dashboard_secrets -- non-demo path generates random hex POSTGRES_PASSWORD" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    result=$(resolve_dashboard_secrets "$env_file" "false" "false")
    pg=$(echo "$result" | grep 'POSTGRES_PASSWORD=' | sed 's/POSTGRES_PASSWORD=//')
    [[ "$pg" =~ ^[0-9a-f]+ ]]
    [ "$pg" != "local-dev-password" ]
}

@test "resolve_dashboard_secrets -- non-demo path generates API_TOKEN of >=32 chars" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    result=$(resolve_dashboard_secrets "$env_file" "false" "false")
    tok=$(echo "$result" | grep 'API_TOKEN=' | sed 's/API_TOKEN=//')
    [ "${#tok}" -ge 32 ]
    [ "$tok" != "demo-api-token" ]
}

# ---------------------------------------------------------------------------
# Function 3 -- resolve_demo_env_defaults
# CR-0014 § 3b row 3: returns 4-key env-line array.
# ---------------------------------------------------------------------------

@test "resolve_demo_env_defaults -- returns exactly 4 lines" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    result=$(resolve_demo_env_defaults "$env_file" "false")
    count=$(echo "$result" | grep -c '.')
    [ "$count" -eq 4 ]
}

@test "resolve_demo_env_defaults -- includes GHA_API_BASE_URL=http://demo-gha:80" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    result=$(resolve_demo_env_defaults "$env_file" "false")
    echo "$result" | grep -q 'GHA_API_BASE_URL=http://demo-gha:80'
}

@test "resolve_demo_env_defaults -- includes FETCHER_POLL_INTERVAL_SECONDS=5" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    result=$(resolve_demo_env_defaults "$env_file" "false")
    echo "$result" | grep -q 'FETCHER_POLL_INTERVAL_SECONDS=5'
}

@test "resolve_demo_env_defaults -- reset_demo_defaults=true forces defaults over pre-existing values" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    printf 'GHA_REPOSITORIES=custom\nFETCHER_POLL_INTERVAL_SECONDS=120\n' > "$env_file"
    result=$(resolve_demo_env_defaults "$env_file" "true")
    echo "$result" | grep -q 'FETCHER_POLL_INTERVAL_SECONDS=5'
    ! echo "$result" | grep -q 'FETCHER_POLL_INTERVAL_SECONDS=120'
}

# ---------------------------------------------------------------------------
# Function 4 -- resolve_compose_args
# CR-0014 § 3b row 4: returns token list with -f / --profile / --env-file.
# ---------------------------------------------------------------------------

@test "resolve_compose_args -- demo mode includes --profile demo AND --profile fetcher" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    result=$(resolve_compose_args "true" "false" "false" "false" "docker-compose.release.yml" "$env_file")
    echo "$result" | grep -q -- '--profile demo'
    echo "$result" | grep -q -- '--profile fetcher'
}

@test "resolve_compose_args -- real-gha mode includes --profile fetcher but NOT demo" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    result=$(resolve_compose_args "false" "true" "false" "false" "docker-compose.release.yml" "$env_file")
    echo "$result" | grep -q -- '--profile fetcher'
    ! echo "$result" | grep -q -- '--profile demo'
}

@test "resolve_compose_args -- empty mode includes neither demo nor fetcher profile" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    result=$(resolve_compose_args "false" "false" "true" "false" "docker-compose.release.yml" "$env_file")
    ! echo "$result" | grep -q -- '--profile demo'
    ! echo "$result" | grep -q -- '--profile fetcher'
}

@test "resolve_compose_args -- includes -f <compose_file> and --env-file <env_file>" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    compose_file="docker-compose.release.yml"
    result=$(resolve_compose_args "true" "false" "false" "false" "$compose_file" "$env_file")
    echo "$result" | grep -q -- "-f $compose_file"
    echo "$result" | grep -q -- "--env-file $env_file"
}

# ---------------------------------------------------------------------------
# Function 5 -- wait_dashboard_health
# CR-0014 § 3b row 5: exits 0 on 200; exits 1 on timeout.
# ---------------------------------------------------------------------------

@test "wait_dashboard_health -- exits 0 when health returns 200" {
    source "$HELPER"
    # Stub curl to simulate a healthy 200 response.
    curl() { return 0; }
    export -f curl
    wait_dashboard_health "http://localhost:8080/health" 5 ""
    [ "$?" -eq 0 ]
}

@test "wait_dashboard_health -- exits 1 when health never returns 200 within timeout" {
    source "$HELPER"
    # Stub curl to always fail (exit 7 = could not connect).
    curl() { return 7; }
    export -f curl
    # Stub docker so log dump doesn't fail.
    docker() { return 0; }
    export -f docker
    wait_dashboard_health "http://localhost:8080/health" 1 ""
    [ "$?" -eq 1 ]
}

# ---------------------------------------------------------------------------
# Function 6 -- write_dashboard_url_panel
# CR-0014 § 3b row 6: stdout layout contains the port number per mode.
# ---------------------------------------------------------------------------

@test "write_dashboard_url_panel -- demo mode stdout contains port" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(write_dashboard_url_panel "8080" "demo-api-token" "$env_file" "true" "false" "false")
    echo "$out" | grep -q '8080'
}

@test "write_dashboard_url_panel -- real-gha mode stdout contains port" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(write_dashboard_url_panel "9090" "abcdef" "$env_file" "false" "true" "false")
    echo "$out" | grep -q '9090'
}

@test "write_dashboard_url_panel -- empty mode stdout contains port" {
    source "$HELPER"
    env_file="$INSTALL_DIR/dashboard.env"
    out=$(write_dashboard_url_panel "8080" "tok" "$env_file" "false" "false" "true")
    echo "$out" | grep -q '8080'
}

# ---------------------------------------------------------------------------
# Guard helper -- test_pg_volume_conflict
# CR-0014 § 3b row 7: exits 0/1; relaxed on demo path.
# ---------------------------------------------------------------------------

@test "test_pg_volume_conflict -- volume absent exits 0 (no conflict)" {
    source "$HELPER"
    docker() {
        if [ "${1:-}" = "volume" ] && [ "${2:-}" = "inspect" ]; then
            echo "Error response from daemon: No such volume: ${3:-}" >&2
            return 1
        fi
        return 0
    }
    export -f docker
    test_pg_volume_conflict "deployment-dashboard_postgres-data"
    [ "$?" -eq 0 ]
}

@test "test_pg_volume_conflict -- volume present + no env-file exits 1 (non-demo conflict)" {
    source "$HELPER"
    docker() {
        if [ "${1:-}" = "volume" ] && [ "${2:-}" = "inspect" ]; then
            echo '[{"Name":"deployment-dashboard_postgres-data"}]'
            return 0
        fi
        return 0
    }
    export -f docker
    test_pg_volume_conflict "deployment-dashboard_postgres-data"
    [ "$?" -eq 1 ]
}
