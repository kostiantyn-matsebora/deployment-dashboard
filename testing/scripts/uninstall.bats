#!/usr/bin/env bats
# Tests for ../../install/uninstall.sh -- bash sibling of install/uninstall.ps1.
#
# Strategy mirrors install.bats: PATH-shadowing `docker` stub captures
# every compose call to $STUB_LOG; the script's args + exit code are
# asserted by inspecting that log + final filesystem state.

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    SCRIPT="$REPO_ROOT/install/uninstall.sh"
    INSTALL_DIR="$BATS_TEST_TMPDIR/dashboard"
    STUB_DIR="$BATS_TEST_TMPDIR/stub"
    STUB_LOG="$BATS_TEST_TMPDIR/stub.log"
    mkdir -p "$INSTALL_DIR" "$STUB_DIR"
    : > "$STUB_LOG"

    export STUB_LOG

    cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
if [ "${1:-}" = "compose" ]; then
    shift
    sub=""
    for a in "$@"; do
        case "$a" in
            down) sub=down ;;
        esac
        if [ -n "$sub" ]; then break; fi
    done
    case "$sub" in
        down) exit "${DD_DOWN_EXIT:-0}" ;;
    esac
fi
exit 0
STUB
    chmod +x "$STUB_DIR/docker"

    export PATH="$STUB_DIR:$PATH"
}

# Helpers
seed_install() {
    mkdir -p "$INSTALL_DIR"
    # By default seed both the compose file + env file.
    if [ "${NO_COMPOSE:-false}" != "true" ]; then
        echo 'services: {}' > "$INSTALL_DIR/docker-compose.release.yml"
    fi
    if [ "${NO_ENV:-false}" != "true" ]; then
        echo 'API_TOKEN=abc' > "$INSTALL_DIR/dashboard.env"
    fi
}

# ---- Preconditions ----

@test "missing install dir -- exits 1 with 'no install found'" {
    rm -rf "$INSTALL_DIR"
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"no install found"* ]]
    ! grep -qE '^docker' "$STUB_LOG"
}

@test "install dir exists but missing docker-compose.release.yml -- exits 1" {
    NO_COMPOSE=true seed_install
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"no install found"* ]]
    [[ "$output" == *"docker-compose.release.yml"* ]]
    ! grep -qE '^docker' "$STUB_LOG"
}

# ---- docker compose down ----

@test "default uninstall -- invokes docker compose ... down WITHOUT -v / --volumes" {
    seed_install
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    down_line="$(grep -E '^docker.*compose.*down' "$STUB_LOG" | head -n1)"
    [ -n "$down_line" ]
    [[ "$down_line" != *" -v "* ]]
    [[ "$down_line" != *" -v"$'\n'* ]]
    [[ "$down_line" != *"--volumes"* ]]
}

@test "--remove-data -- appends -v to docker compose down" {
    seed_install
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR" --remove-data
    [ "$status" -eq 0 ]
    down_line="$(grep -E '^docker.*compose.*down' "$STUB_LOG" | head -n1)"
    [[ "$down_line" == *" -v"* ]]
}

@test "compose down -- includes --profile fetcher but NOT --profile migrate (ADR-0009: API self-applies migrations)" {
    # Post-#22 contract: the migrate profile no longer exists in the
    # compose file -- migrations are applied in-process by the api
    # container on startup. The uninstaller continues to pass
    # --profile fetcher so any active fetcher service is torn down too.
    seed_install
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    down_line="$(grep -E '^docker.*compose.*down' "$STUB_LOG" | head -n1)"
    [[ "$down_line" == *"--profile fetcher"* ]]
    [[ "$down_line" != *"--profile migrate"* ]]
}

@test "compose down -- includes --env-file when dashboard.env exists" {
    seed_install
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    down_line="$(grep -E '^docker.*compose.*down' "$STUB_LOG" | head -n1)"
    [[ "$down_line" == *"--env-file"* ]]
    [[ "$down_line" == *"$INSTALL_DIR/dashboard.env"* ]]
}

@test "compose down -- omits --env-file when dashboard.env is absent" {
    NO_ENV=true seed_install
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    down_line="$(grep -E '^docker.*compose.*down' "$STUB_LOG" | head -n1)"
    [[ "$down_line" != *"--env-file"* ]]
}

# ---- Secret handling ----

@test "default uninstall -- dashboard.env is preserved" {
    seed_install
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [ -f "$INSTALL_DIR/dashboard.env" ]
}

@test "--remove-secrets -- dashboard.env is removed AFTER docker compose down" {
    seed_install
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR" --remove-secrets
    [ "$status" -eq 0 ]
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
    # docker compose down was still invoked.
    grep -qE '^docker.*compose.*down' "$STUB_LOG"
}

@test "--remove-secrets when dashboard.env is absent -- no error" {
    NO_ENV=true seed_install
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR" --remove-secrets
    [ "$status" -eq 0 ]
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
}

# ---- Error surfacing ----

@test "docker compose down failure -- script exits non-zero" {
    seed_install
    export DD_DOWN_EXIT=1
    run bash "$SCRIPT" --install-dir "$INSTALL_DIR"
    [ "$status" -ne 0 ]
}

# ---- Unknown arg ----

@test "unknown argument -- exits 2 with usage" {
    run bash "$SCRIPT" --bogus
    [ "$status" -eq 2 ]
    [[ "$output" == *"unknown argument"* ]]
    [[ "$output" == *"Usage:"* ]]
}
