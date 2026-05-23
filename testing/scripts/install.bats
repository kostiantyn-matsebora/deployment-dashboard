#!/usr/bin/env bats
# Tests for ../../install/install.sh -- bash sibling of install/install.ps1 (issue #7).
#
# Strategy: PATH-shadowing stubs. We prepend a per-test stub directory to PATH
# so calls to `curl`, `docker`, `gh`, `openssl`, `sleep` resolve to our fakes.
# Each stub appends one line to $STUB_LOG with its invocation, then returns the
# canned exit code controlled by env vars.
#
# Coverage matrix mirrors install.Tests.ps1 (post-gh-CLI contract + CR-0013
# flag inversion) -- see that file for the rationale.
#   - Asset fetch goes via `gh release download` (private repo).
#   - GHCR pulls require `docker login ghcr.io` with `gh auth token` piped in.
#   - curl is only used for the /health poll.
#   - Flag matrix (CR-0013): no-flag default -> demo stack; --real-gha (renamed
#     from --fetcher) -> real GitHub upstream; --empty -> bare-minimum;
#     --demo -> back-compat alias for the default + INFO log.

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

    # --- curl stub. Only the /health poll uses curl post-gh-CLI; asset fetch
    # routes through `gh release download`. Honours DD_HEALTH_OK for the
    # /health branch.
    cat > "$STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
# Walk args. install.sh uses: curl -fsSL -o "$dest" "$url" for non-asset calls,
# or curl -fsS ".../health" for the health poll.
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
    #   `docker login ...`               -> drain stdin (gh token piped in); exit $DD_LOGIN_EXIT (default 0).
    #   `docker volume inspect <name>`   -> exit 0 with stub JSON if DD_VOLUME_EXISTS=true, else exit 1 (issue #37 safety net).
    #   `docker compose pull|up|...`     -> exit per DD_PULL_EXIT / DD_UP_EXIT.
    cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
if [ "${1:-}" = "login" ]; then
    # Drain piped stdin (gh auth token is piped in) so the producer side gets EPIPE-free EOF.
    cat > /dev/null 2>&1 || true
    exit "${DD_LOGIN_EXIT:-0}"
fi
if [ "${1:-}" = "volume" ] && [ "${2:-}" = "inspect" ]; then
    # Issue #37 volume-detection safety net. Exit 0 (volume present) when
    # DD_VOLUME_EXISTS=true; exit 1 (absent) with a stderr 'No such volume'
    # message otherwise. Default = absent.
    if [ "${DD_VOLUME_EXISTS:-}" = "true" ]; then
        echo '[{"Name":"deployment-dashboard_pg-data","Driver":"local"}]'
        exit 0
    fi
    echo "Error response from daemon: No such volume: ${3:-}" >&2
    exit 1
fi
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

    # --- gh stub. Models the gh-CLI surface install.sh consumes:
    #   gh --version
    #   gh auth status --hostname github.com [--show-token]
    #   gh auth token
    #   gh api user --jq .login
    #   gh release download [tag] --repo <repo> --pattern <asset> --output <dest> --clobber
    #
    # Knobs (env vars set by the test):
    #   DD_GH_MISSING       -- if 'true', `gh --version` exits 1
    #   DD_GH_NOT_AUTHED    -- if 'true', `gh auth status` exits 1
    #   DD_GH_NO_SCOPE      -- if 'true', `--show-token` scope list omits all of read/write/admin:packages
    #   DD_GH_SCOPE_LITERAL -- if set, overrides the default 'read:packages' scope in the
    #                          stub output (use to assert write:packages / admin:packages pass too)
    #   DD_GH_DOWNLOAD_FAIL -- if set to substring, `gh release download` exits 1 when --pattern matches
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$STUB_LOG"
case "${1:-}" in
    --version)
        if [ "${DD_GH_MISSING:-}" = "true" ]; then exit 1; fi
        echo "gh version 2.0.0 (stub)"
        exit 0
        ;;
    auth)
        case "${2:-}" in
            status)
                if [ "${DD_GH_NOT_AUTHED:-}" = "true" ]; then
                    echo "You are not logged into any GitHub hosts."
                    exit 1
                fi
                # Emit a scope-list line when --show-token is present.
                # GitHub's OAuth scope model is hierarchical: write:packages includes
                # read:packages, admin:packages includes both. DD_GH_SCOPE_LITERAL lets a
                # test substitute the granted scope (e.g. write:packages alone) to assert
                # the install script accepts the union read|write|admin:packages.
                for a in "$@"; do
                    if [ "$a" = "--show-token" ]; then
                        if [ "${DD_GH_NO_SCOPE:-}" = "true" ]; then
                            echo "Token scopes: repo, workflow, gist"
                        elif [ -n "${DD_GH_SCOPE_LITERAL:-}" ]; then
                            echo "Token scopes: repo, ${DD_GH_SCOPE_LITERAL}, workflow"
                        else
                            echo "Token scopes: repo, read:packages, workflow"
                        fi
                        break
                    fi
                done
                echo "Logged in to github.com as testuser (stub)"
                exit 0
                ;;
            token)
                echo "gho_stub_token_for_tests"
                exit 0
                ;;
        esac
        exit 0
        ;;
    api)
        # `gh api user --jq .login` -- emit a stub login.
        echo "testuser"
        exit 0
        ;;
    release)
        if [ "${2:-}" = "download" ]; then
            asset=""
            dest=""
            i=3
            shift 2  # drop `release download`
            while [ $# -gt 0 ]; do
                case "$1" in
                    --pattern) asset="$2"; shift 2 ;;
                    --output)  dest="$2";  shift 2 ;;
                    *) shift ;;
                esac
            done
            if [ -n "${DD_GH_DOWNLOAD_FAIL:-}" ] && [[ "$asset" == *"$DD_GH_DOWNLOAD_FAIL"* ]]; then
                echo "stub gh release download forced failure for $asset" >&2
                exit 1
            fi
            if [ -n "$dest" ]; then
                mkdir -p "$(dirname "$dest")"
                printf '# stub asset for %s\n' "$asset" > "$dest"
            fi
            exit 0
        fi
        exit 0
        ;;
esac
exit 0
STUB
    chmod +x "$STUB_DIR/gh"

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

# ---- GHA_TOKEN precondition matrix (CR-0013: scoped to --real-gha) ----
#
# Per CR-0013 the GHA_TOKEN precondition fires ONLY when --real-gha is set.
# The no-flag default routes to the demo stack (no PAT, no real GitHub API
# calls); --empty has no fetcher at all; the back-compat --demo alias also
# lands on the demo path. --fetcher was renamed to --real-gha (the shell
# arg parser rejects the historical flag name).

@test "--real-gha without GHA_TOKEN exits 1 with red error before any docker / gh-release call" {
    # CR-0013 contract: --real-gha without $GHA_TOKEN red-errors and exits 1
    # before any side effect. The error literal must mention GHA_TOKEN,
    # --real-gha, and ERROR.
    run_install --real-gha --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"ERROR"* ]]
    [[ "$output" == *"GHA_TOKEN"* ]]
    [[ "$output" == *"--real-gha"* ]]
    # Strongest precondition signal -- no docker + no gh-release was invoked.
    log_not_contains 'docker compose'
    log_not_contains 'docker login'
    log_not_contains 'gh release download'
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
}

@test "--real-gha with GHA_TOKEN set: no GHA_TOKEN advisory" {
    export GHA_TOKEN='ghp_fake_pat'
    run_install --real-gha --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" != *"GHA_TOKEN not set"* ]]
}

@test "no --real-gha: GHA_TOKEN precondition is bypassed regardless of state" {
    # No-flag default = demo stack; the demo upstream is offline-mocked, so
    # the GHA_TOKEN precondition never fires.
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" != *"ERROR: --real-gha requires"* ]]
}

@test "--empty does not require GHA_TOKEN (no fetcher in the resolved stack)" {
    run_install --empty --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" != *"ERROR: --real-gha requires"* ]]
}

# ---- Flag matrix (CR-0013: demo default + --real-gha / --empty / --demo back-compat) ----
#
# Per CR-0013 the no-flag default routes to the *demo stack* (offline,
# zero-PAT, populated dashboard within 60 s). The historical --fetcher flag
# was renamed to --real-gha; --empty is new (bare-minimum direct-POST stack);
# --demo is a back-compat alias that silently maps to the new default and
# logs one INFO line.
#
# Demo-mode env-file seeding (CR-0013 § 3a + § 3b):
#   GHA_API_BASE_URL              = http://demo-gha:80
#   FETCHER_POLL_INTERVAL_SECONDS = 5
#   GHA_REPOSITORIES              = 6 demo-org repos (web-portal,
#                                    api-gateway, auth-service,
#                                    billing-service, notification-worker,
#                                    analytics-pipeline)
#   GHA_TOKEN                     = OMITTED on fresh install (demo-gha
#                                    never sees the Authorization header);
#                                    preserved on upgrade-re-run.

@test "no-flag default activates --profile demo + --profile fetcher in docker compose up" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [ -n "$up_line" ]
    [[ "$up_line" == *"--profile demo"* ]]
    [[ "$up_line" == *"--profile fetcher"* ]]
}

@test "no-flag default seeds demo-mode env-file keys (6 demo-org repos at 5 s poll, base URL = demo-gha)" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    f="$INSTALL_DIR/dashboard.env"
    [ -f "$f" ]
    grep -qE '^GHA_API_BASE_URL=http://demo-gha:80$' "$f"
    grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=5$' "$f"
    grep -qE '^GHA_REPOSITORIES=.*demo-org.*web-portal.*api-gateway.*auth-service.*billing-service.*notification-worker.*analytics-pipeline' "$f"
    # GHA_TOKEN is intentionally OMITTED on a fresh demo install -- demo-gha
    # never sees the Authorization header.
    ! grep -qE '^GHA_TOKEN=' "$f"
}

@test "--demo back-compat alias: logs INFO line + routes to the demo default" {
    # CR-0013 § 3a: --demo silently routes to the no-flag default and emits
    # exactly one INFO line steering callers to drop the flag.
    run_install --demo --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" == *"INFO: demo is now the default"* ]]
    [[ "$output" == *"--demo flag is redundant"* ]]
    # Same compose profile set as the no-flag default.
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [[ "$up_line" == *"--profile demo"* ]]
    [[ "$up_line" == *"--profile fetcher"* ]]
}

@test "--demo seeds the same demo-mode env-file keys as the no-flag default" {
    run_install --demo --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    f="$INSTALL_DIR/dashboard.env"
    grep -qE '^GHA_API_BASE_URL=http://demo-gha:80$' "$f"
    grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=5$' "$f"
    grep -qE '^GHA_REPOSITORIES=.*demo-org.*web-portal.*api-gateway.*auth-service.*billing-service.*notification-worker.*analytics-pipeline' "$f"
    ! grep -qE '^GHA_TOKEN=' "$f"
}

@test "--real-gha (with GHA_TOKEN) activates only --profile fetcher (NOT --profile demo)" {
    export GHA_TOKEN='ghp_real_pat'
    run_install --real-gha --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [[ "$up_line" == *"--profile fetcher"* ]]
    [[ "$up_line" != *"--profile demo"* ]]
}

@test "--real-gha does NOT seed demo-mode env-file keys" {
    export GHA_TOKEN='ghp_real_pat'
    run_install --real-gha --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    f="$INSTALL_DIR/dashboard.env"
    ! grep -qE '^GHA_API_BASE_URL=http://demo-gha:80$' "$f"
    ! grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=5$' "$f"
    ! grep -qE 'demo-org.*web-portal' "$f"
}

@test "--empty activates NO profiles (no demo, no fetcher) -- bare-minimum stack" {
    run_install --empty --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [[ "$up_line" != *"--profile demo"* ]]
    [[ "$up_line" != *"--profile fetcher"* ]]
    # Belt-and-suspenders -- the `--profile` flag itself should be absent.
    [[ "$up_line" != *"--profile"* ]]
}

@test "--empty does NOT seed demo-mode env-file keys" {
    run_install --empty --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    f="$INSTALL_DIR/dashboard.env"
    ! grep -qE '^GHA_API_BASE_URL=http://demo-gha:80$' "$f"
    ! grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=5$' "$f"
    ! grep -qE 'demo-org.*web-portal' "$f"
}

@test "--real-gha + --empty together: rejected as mutually exclusive" {
    run_install --real-gha --empty --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"mutually exclusive"* ]]
}

@test "--real-gha + --demo together: rejected as mutually exclusive" {
    run_install --real-gha --demo --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"mutually exclusive"* ]]
}

@test "--empty + --demo together: rejected as mutually exclusive" {
    run_install --empty --demo --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"mutually exclusive"* ]]
}

# ---- gh CLI precondition matrix ----

@test "gh missing on PATH -- exits 1 with 'gh CLI not found' and no side effects" {
    export DD_GH_MISSING=true
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"gh CLI not found"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'docker login'
    log_not_contains 'gh release download'
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
}

@test "gh not authenticated -- exits 1 with 'not authenticated' and no side effects" {
    export DD_GH_NOT_AUTHED=true
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"not authenticated"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'docker login'
    log_not_contains 'gh release download'
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
}

@test "gh token lacks read:packages scope -- exits 1 with 'read:packages' and no side effects" {
    export DD_GH_NO_SCOPE=true
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"read:packages"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'docker login'
    log_not_contains 'gh release download'
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
}

@test "gh token has write:packages (no explicit read:packages) -- precondition passes (regression guard: scope hierarchy)" {
    # `gh auth status --show-token` only lists the highest granted scope --
    # write:packages includes read:packages, so the redundant read:packages is
    # not separately listed. The script must accept any of read|write|admin:packages,
    # otherwise tokens granted via `gh auth refresh --scopes write:packages` get
    # rejected even though they can pull from GHCR.
    export DD_GH_SCOPE_LITERAL='write:packages'
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
}

@test "gh token has admin:packages -- precondition passes (regression guard: same hierarchy reason)" {
    export DD_GH_SCOPE_LITERAL='admin:packages'
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
}

@test "happy path -- docker login ghcr.io runs BEFORE docker compose pull (ordering invariant)" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    # Compare line numbers in the stub log: docker login must precede compose pull.
    login_line=$(grep -nE '^docker login.*ghcr\.io' "$STUB_LOG" | head -n1 | cut -d: -f1)
    pull_line=$(grep -nE '^docker.*compose.*pull' "$STUB_LOG" | head -n1 | cut -d: -f1)
    [ -n "$login_line" ]
    [ -n "$pull_line" ]
    [ "$login_line" -lt "$pull_line" ]
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

# ---- gh release download tag branching ----

@test "--version latest -- gh release download invoked WITHOUT a positional tag" {
    run_install --version latest --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    # The asset call carries --pattern docker-compose.release.yml + --repo + --clobber.
    line="$(grep -E '^gh release download' "$STUB_LOG" | grep -F 'docker-compose.release.yml' | head -n1)"
    [ -n "$line" ]
    [[ "$line" == *"--repo kostiantyn-matsebora/deployment-dashboard"* ]]
    [[ "$line" == *"--pattern docker-compose.release.yml"* ]]
    [[ "$line" == *"--clobber"* ]]
    # No positional tag -- the third whitespace-separated token after `gh release download`
    # must start with `--` (a flag), not be a bare tag string.
    # Tokens: gh release download <argv[2]> ...
    tok=$(echo "$line" | awk '{print $4}')
    [[ "$tok" == --* ]]
}

@test "--version v1.2.3 -- gh release download invoked WITH the literal tag at argv[2]" {
    run_install --version v1.2.3 --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    line="$(grep -E '^gh release download' "$STUB_LOG" | grep -F 'docker-compose.release.yml' | head -n1)"
    [ -n "$line" ]
    [[ "$line" == *"--pattern docker-compose.release.yml"* ]]
    # Tokens: gh release download v1.2.3 ...
    tok=$(echo "$line" | awk '{print $4}')
    [ "$tok" = "v1.2.3" ]
}

# ---- Env-file shape ----

@test "env-file -- contains every required key with -Version + -Port substituted" {
    run_install --empty --version v1.2.3 --port 9090 --install-dir "$INSTALL_DIR"
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

@test "default install -- --profile migrate is NEVER passed (API self-applies migrations per ADR-0009); demo + fetcher profiles ARE passed (CR-0013)" {
    # Post-#22 contract: migrations are applied in-process by the api
    # container on startup; there is no migrate profile in the compose file
    # and the installer never passes --profile migrate.
    # Post-CR-0013 contract: the no-flag default brings up the demo stack,
    # so --profile demo + --profile fetcher are BOTH present in the up call.
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [ -n "$up_line" ]
    [[ "$up_line" != *"--profile migrate"* ]]
    [[ "$up_line" == *"--profile demo"* ]]
    [[ "$up_line" == *"--profile fetcher"* ]]
}

@test "--real-gha (with GHA_TOKEN) -- only --profile fetcher present (no --profile demo, no --profile migrate)" {
    export GHA_TOKEN='ghp_fake'
    run_install --real-gha --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [[ "$up_line" == *"--profile fetcher"* ]]
    [[ "$up_line" != *"--profile demo"* ]]
    [[ "$up_line" != *"--profile migrate"* ]]
}

@test "--empty -- no --profile flag at all (no fetcher, no demo, no migrate)" {
    run_install --empty --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [[ "$up_line" != *"--profile demo"* ]]
    [[ "$up_line" != *"--profile fetcher"* ]]
    [[ "$up_line" != *"--profile migrate"* ]]
    [[ "$up_line" != *"--profile"* ]]
}

@test "--fetcher -- rejected as unknown argument (renamed to --real-gha per CR-0013)" {
    # install.sh's case-based arg parser falls into the `*)` branch for the
    # historical --fetcher flag and exits 2 with the 'unknown argument'
    # literal; the script MUST NOT proceed to any docker / gh side effect.
    run_install --fetcher --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown argument"* ]]
    [[ "$output" == *"--fetcher"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'gh release download'
}

@test "--skip-migrations -- rejected as unknown argument (the flag was retired per ADR-0009 / #22)" {
    # install.sh no longer accepts --skip-migrations because migrations are
    # now applied in-process by the api container. The shell arg parser's
    # default `*)` branch rejects unknown flags with exit code 2 and the
    # 'unknown argument' literal; the script MUST NOT proceed to any
    # docker / gh side effect.
    run_install --skip-migrations --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown argument"* ]]
    [[ "$output" == *"--skip-migrations"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'gh release download'
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

@test "gh release download failure -- exits 1 with red error mentioning asset + version" {
    export DD_GH_DOWNLOAD_FAIL='docker-compose.release.yml'
    run_install --version v0.0.0-doesnotexist --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"docker-compose.release.yml"* ]]
    [[ "$output" == *"v0.0.0-doesnotexist"* ]]
}

@test "docker login ghcr.io failure -- exits 1 with 'docker login ghcr.io failed' and NEVER calls docker compose pull" {
    export DD_LOGIN_EXIT=1
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"docker login ghcr.io failed"* ]]
    # Critically -- compose pull was never reached.
    log_not_contains 'compose pull'
    ! grep -qE '^docker.*compose.*pull' "$STUB_LOG"
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

# ---- Upgrade flow (issue #37) ----
# Phase 4 contract additions for the v0.3.0 -> v0.4.0 upgrade flow:
#   1. CWD-independent default --install-dir (= $HOME/.dashboard-release).
#   2. --demo defaults preservation on re-run (GHA_REPOSITORIES / FETCHER_POLL_INTERVAL_SECONDS / GHA_TOKEN).
#   3. Volume-detection safety net: `docker volume inspect deployment-dashboard_pg-data` exits 0
#      AND $ENV_FILE does NOT exist -> red-error + exit 1 BEFORE any side effect.
#   4. usage() upgrade-flow section + new --reset-demo-defaults flag (smoke-checked via behaviour, not text).
#
# Fake-home strategy: set HOME to a per-test tmpdir before invoking install.sh,
# so the new $HOME/.dashboard-release default lands in $BATS_TEST_TMPDIR rather
# than polluting the real $HOME.

@test "default --install-dir is \$HOME/.dashboard-release (CWD-independent)" {
    # Set HOME to a per-test tmpdir; run install.sh from a DIFFERENT CWD; assert
    # dashboard.env lands at $HOME/.dashboard-release/dashboard.env (NOT under CWD).
    fake_home="$BATS_TEST_TMPDIR/fakehome"
    fake_cwd="$BATS_TEST_TMPDIR/fakecwd"
    mkdir -p "$fake_home" "$fake_cwd"
    HOME="$fake_home" run bash -c "cd '$fake_cwd' && bash '$SCRIPT' --version v9.9.9-test"
    [ "$status" -eq 0 ]
    [ -f "$fake_home/.dashboard-release/dashboard.env" ]
    # CWD-anchored anti-assertion: nothing landed under the historical default
    # ($CWD/dashboard-release) inside fake_cwd.
    [ ! -f "$fake_cwd/dashboard-release/dashboard.env" ]
    # docker compose --env-file points at the default location.
    grep -qE "^docker.*compose.*--env-file $fake_home/.dashboard-release/dashboard.env" "$STUB_LOG"
}

@test "volume present + no env-file -> fail-fast with red error, no side effects" {
    fake_home="$BATS_TEST_TMPDIR/fakehome"
    mkdir -p "$fake_home"
    export DD_VOLUME_EXISTS=true
    HOME="$fake_home" run bash "$SCRIPT" --empty --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"Pre-existing Postgres volume detected"* ]]
    [ ! -f "$fake_home/.dashboard-release/dashboard.env" ]
    log_not_contains 'docker compose'
    log_not_contains 'gh release download'
}

@test "volume absent + no env-file -> happy path (guard not triggered)" {
    export DD_VOLUME_EXISTS=false
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [ -f "$INSTALL_DIR/dashboard.env" ]
    [[ "$output" != *"Pre-existing Postgres volume detected"* ]]
}

@test "volume present + env-file present -> happy path (guard not triggered, secrets reused)" {
    # Seed a valid env-file so the safety-net precondition is bypassed.
    apiTok=$(printf 'a%.0s' {1..64})
    pgPw=$(printf 'c%.0s' {1..32})
    cat > "$INSTALL_DIR/dashboard.env" <<EOF
API_TOKEN=$apiTok
POSTGRES_PASSWORD=$pgPw
EOF
    export DD_VOLUME_EXISTS=true
    run_install --empty --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Reusing API_TOKEN"* ]]
    [[ "$output" == *"Reusing POSTGRES_PASSWORD"* ]]
    grep -qE "^API_TOKEN=$apiTok$" "$INSTALL_DIR/dashboard.env"
    grep -qE "^POSTGRES_PASSWORD=$pgPw$" "$INSTALL_DIR/dashboard.env"
}

@test "demo re-run (no flag) preserves existing GHA_REPOSITORIES" {
    # No --demo on the re-run -- the no-flag default IS the demo path now.
    apiTok=$(printf 'a%.0s' {1..64})
    pgPw=$(printf 'c%.0s' {1..32})
    cat > "$INSTALL_DIR/dashboard.env" <<EOF
API_TOKEN=$apiTok
POSTGRES_PASSWORD=$pgPw
GHA_REPOSITORIES=[{"owner":"custom","repo":"thing"}]
EOF
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE '^GHA_REPOSITORIES=\[\{"owner":"custom","repo":"thing"\}\]$' "$INSTALL_DIR/dashboard.env"
    ! grep -qE 'demo-org.*web-portal' "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"Preserving GHA_REPOSITORIES"* ]]
}

@test "demo re-run (no flag) preserves existing FETCHER_POLL_INTERVAL_SECONDS" {
    apiTok=$(printf 'a%.0s' {1..64})
    pgPw=$(printf 'c%.0s' {1..32})
    cat > "$INSTALL_DIR/dashboard.env" <<EOF
API_TOKEN=$apiTok
POSTGRES_PASSWORD=$pgPw
FETCHER_POLL_INTERVAL_SECONDS=120
EOF
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=120$' "$INSTALL_DIR/dashboard.env"
    # The new demo default is 5 s; the preserved operator value (120) must win.
    ! grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=5$' "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"Preserving FETCHER_POLL_INTERVAL_SECONDS"* ]]
}

@test "demo re-run (no flag) preserves existing GHA_TOKEN when \$GHA_TOKEN unset" {
    apiTok=$(printf 'a%.0s' {1..64})
    pgPw=$(printf 'c%.0s' {1..32})
    cat > "$INSTALL_DIR/dashboard.env" <<EOF
API_TOKEN=$apiTok
POSTGRES_PASSWORD=$pgPw
GHA_TOKEN=ghp_existing
EOF
    unset GHA_TOKEN
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE '^GHA_TOKEN=ghp_existing$' "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"Preserving GHA_TOKEN"* ]]
}

@test "--reset-demo-defaults re-applies hard-coded demo defaults (6 demo-org repos at 5 s poll)" {
    apiTok=$(printf 'a%.0s' {1..64})
    pgPw=$(printf 'c%.0s' {1..32})
    cat > "$INSTALL_DIR/dashboard.env" <<EOF
API_TOKEN=$apiTok
POSTGRES_PASSWORD=$pgPw
GHA_REPOSITORIES=[{"owner":"custom","repo":"thing"}]
FETCHER_POLL_INTERVAL_SECONDS=120
EOF
    run_install --reset-demo-defaults --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE '^GHA_REPOSITORIES=.*demo-org.*web-portal.*api-gateway.*auth-service.*billing-service.*notification-worker.*analytics-pipeline' "$INSTALL_DIR/dashboard.env"
    grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=5$' "$INSTALL_DIR/dashboard.env"
    ! grep -qE 'custom.*thing' "$INSTALL_DIR/dashboard.env"
    [[ "$output" != *"Preserving GHA_REPOSITORIES"* ]]
    [[ "$output" != *"Preserving FETCHER_POLL_INTERVAL_SECONDS"* ]]
}

@test "demo re-run preserves persisted GHA_TOKEN even when \$GHA_TOKEN differs (demo upstream ignores Authorization header)" {
    # Per CR-0013 + install.sh § 4 demo-mode block: GHA_TOKEN is preserved on
    # demo upgrade-re-run so a later switch back to --real-gha keeps the
    # operator's PAT. The demo-gha upstream never sees the Authorization
    # header, so $GHA_TOKEN does NOT rotate the persisted value on the demo
    # path. (Caller wanting to drop the persisted token uses
    # --reset-demo-defaults; caller wanting to use the env value points at
    # --real-gha instead.)
    apiTok=$(printf 'a%.0s' {1..64})
    pgPw=$(printf 'c%.0s' {1..32})
    cat > "$INSTALL_DIR/dashboard.env" <<EOF
API_TOKEN=$apiTok
POSTGRES_PASSWORD=$pgPw
GHA_TOKEN=ghp_old
EOF
    export GHA_TOKEN='ghp_new'
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    # Persisted token wins on the demo path.
    grep -qE '^GHA_TOKEN=ghp_old$' "$INSTALL_DIR/dashboard.env"
    ! grep -qE '^GHA_TOKEN=ghp_new$' "$INSTALL_DIR/dashboard.env"
    [[ "$output" == *"Preserving GHA_TOKEN"* ]]
}

@test "--reset-demo-defaults drops the persisted GHA_TOKEN on demo re-run" {
    # The escape hatch -- pass --reset-demo-defaults to clear out the
    # persisted GHA_TOKEN (e.g. when migrating from a stale --real-gha
    # install to the demo default and the operator wants the token off-disk).
    apiTok=$(printf 'a%.0s' {1..64})
    pgPw=$(printf 'c%.0s' {1..32})
    cat > "$INSTALL_DIR/dashboard.env" <<EOF
API_TOKEN=$apiTok
POSTGRES_PASSWORD=$pgPw
GHA_TOKEN=ghp_existing
EOF
    run_install --reset-demo-defaults --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    ! grep -qE '^GHA_TOKEN=' "$INSTALL_DIR/dashboard.env"
}

# ---- Smoke regression: health-poll + URL panel + exit code (CR-0014 batch 5) ----

@test "smoke: happy path -- exits 0 and stdout contains gateway port (URL panel smoke)" {
    run_install --version v9.9.9-test --port 8080 --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" == *"8080"* ]]
}

@test "smoke: happy path -- health curl call emitted at least once (health-poll smoke)" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE '^curl.*\/health' "$STUB_LOG"
}

@test "smoke: health timeout -- exit code is non-zero (exit-code regression guard)" {
    export DD_HEALTH_OK=false
    run_install --version v9.9.9-test --health-timeout-seconds 1 --install-dir "$INSTALL_DIR"
    [ "$status" -ne 0 ]
}

# ---- CR-0014 demo fixed credentials + helper delegation ----
# CR-0014 § 3c: demo path writes fixed POSTGRES_PASSWORD=local-dev-password
# and API_TOKEN=demo-api-token. Non-demo paths remain random.

@test "demo path (no flag) -- writes POSTGRES_PASSWORD=local-dev-password (CR-0014 § 3c)" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE '^POSTGRES_PASSWORD=local-dev-password$' "$INSTALL_DIR/dashboard.env"
}

@test "demo path (no flag) -- writes API_TOKEN=demo-api-token (CR-0014 § 3c)" {
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE '^API_TOKEN=demo-api-token$' "$INSTALL_DIR/dashboard.env"
}

@test "--demo back-compat alias -- writes fixed demo credentials (CR-0014 § 3c)" {
    run_install --demo --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    grep -qE '^POSTGRES_PASSWORD=local-dev-password$' "$INSTALL_DIR/dashboard.env"
    grep -qE '^API_TOKEN=demo-api-token$' "$INSTALL_DIR/dashboard.env"
}

@test "--real-gha path -- does NOT write fixed demo POSTGRES_PASSWORD (still random) (CR-0014 § 3c non-demo)" {
    export GHA_TOKEN='ghp_fake_pat'
    run_install --real-gha --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    ! grep -qE '^POSTGRES_PASSWORD=local-dev-password$' "$INSTALL_DIR/dashboard.env"
    grep -qE '^POSTGRES_PASSWORD=[0-9a-f]' "$INSTALL_DIR/dashboard.env"
}

@test "--empty path -- does NOT write fixed demo credentials (still random) (CR-0014 § 3c non-demo)" {
    run_install --empty --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    ! grep -qE '^POSTGRES_PASSWORD=local-dev-password$' "$INSTALL_DIR/dashboard.env"
    ! grep -qE '^API_TOKEN=demo-api-token$' "$INSTALL_DIR/dashboard.env"
}

@test "demo re-run against existing pg-data volume -- succeeds without volume drop (CR-0014 § 3c re-run safety)" {
    # Seed env-file with fixed demo creds (post-CR-0014 state).
    cat > "$INSTALL_DIR/dashboard.env" <<'EOF'
API_TOKEN=demo-api-token
POSTGRES_PASSWORD=local-dev-password
EOF
    # Signal that pg volume exists; demo guard must not red-error.
    export DD_VOLUME_EXISTS=true
    run_install --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" != *"Pre-existing Postgres volume detected"* ]]
}
