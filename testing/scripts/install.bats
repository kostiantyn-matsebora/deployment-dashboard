#!/usr/bin/env bats
# Tests for ../../install/install.sh -- bash sibling of install.Tests.ps1 (issue #72).
#
# Strategy: PATH-shadowing stubs. We prepend a per-test stub directory to PATH
# so calls to `curl`, `docker`, `gh`, `sleep` resolve to our fakes.
# Each stub appends one line to $STUB_LOG with its invocation, then returns
# the canned exit code controlled by env vars.
#
# Coverage matrix mirrors install.Tests.ps1 (post-issue #72 flag matrix
# rewrite -- ASR-A + ASR-D + AR-3 contract):
#   - ASR-D precondition: no-flag default requires ConnectionStrings__DefaultConnection
#     in the environment (or in an existing dashboard.env at install-dir).
#   - Flag matrix (issue #72):
#       (no flag)      -> app-only, release.yml only, no profiles.
#                         Requires ConnectionStrings__DefaultConnection.
#       --local-db     -> release.yml + --profile db; sets ConnectionStrings auto.
#       --real-gha     -> release.yml + --profile fetcher; requires GHA_TOKEN
#                         AND ConnectionStrings__DefaultConnection (no bundled db).
#       --real-gha --local-db -> release.yml + --profile db + --profile fetcher.
#       --demo         -> release.yml + demo.yml + --profile db + --profile fetcher.
#   - Mutual exclusion: --demo --local-db and --demo --real-gha exit 1 before any side effect.
#   - AR-3 contract: ASR-D error must name all 3 resolution paths.
#   - gh CLI precondition (gh missing / unauthed / missing read:packages scope).
#   - Compose args (profiles + --env-file + compose files).
#   - gh release download tag branching (latest vs pinned).
#   - Env-var substitution (no dashboard.env written; step 7 sets env vars).
#   - Error paths.
#
# Note: bats tests are NOT run on the Windows CI host; this file is the mirror
# for Ubuntu CI. No bats execution on Windows -- bats edit is mirror-only.

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
    unset ConnectionStrings__DefaultConnection
    unset POSTGRES_PASSWORD

    export STUB_LOG

    # --- curl stub. Only the /health poll uses curl post-gh-CLI.
    # Knob: DD_HEALTH_OK -- if 'false', /health curl exits 7 (no server).
    cat > "$STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
for a in "$@"; do
    if [[ "$a" == *"/health" ]]; then
        if [ "${DD_HEALTH_OK:-true}" = "false" ]; then exit 7; fi
        exit 0
    fi
done
exit 0
STUB
    chmod +x "$STUB_DIR/curl"

    # --- docker stub.
    #   `docker login ...`             -> drain stdin; exit $DD_LOGIN_EXIT (default 0).
    #   `docker compose pull ...`      -> exit $DD_PULL_EXIT (default 0).
    #   `docker compose up ...`        -> exit $DD_UP_EXIT (default 0).
    #   `docker compose logs ...`      -> emit stub log line; exit 0.
    cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
if [ "${1:-}" = "login" ]; then
    cat > /dev/null 2>&1 || true
    exit "${DD_LOGIN_EXIT:-0}"
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
    #   gh --version / gh auth status / gh auth token / gh api user / gh release download
    #
    # Knobs:
    #   DD_GH_MISSING       -- if 'true', command -v gh fails (gh not on PATH is simulated by
    #                          gh --version returning 1 -- the stub IS on PATH but install.sh
    #                          uses `command -v gh` which is a shell builtin, not the stub.
    #                          We simulate the precondition failure by having gh exit 1 on --version
    #                          which is tested via install.sh fallthrough.
    #                          NOTE: install.sh uses `command -v gh`, not `gh --version`, for
    #                          presence detection. The stub can't override `command -v`. For the
    #                          "gh missing" test, we remove gh from the stub dir entirely.
    #   DD_GH_NOT_AUTHED    -- if 'true', `gh auth status` exits 1
    #   DD_GH_NO_SCOPE      -- if 'true', `--show-token` scope list omits all of read/write/admin:packages
    #   DD_GH_SCOPE_LITERAL -- if set, overrides the default 'read:packages' scope
    #   DD_GH_DOWNLOAD_FAIL -- if set to substring, `gh release download` exits 1 when --pattern matches
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$STUB_LOG"
case "${1:-}" in
    --version)
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
        echo "testuser"
        exit 0
        ;;
    release)
        if [ "${2:-}" = "download" ]; then
            asset=""
            dest=""
            shift 2
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

# Helper: assert a logged event substring appears in the stub log.
log_contains() {
    grep -qF "$1" "$STUB_LOG"
}
log_not_contains() {
    ! grep -qF "$1" "$STUB_LOG"
}

# ===========================================================================
# ASR-D -- ConnectionStrings__DefaultConnection precondition
# Issue #72: no-flag default (app-only) fails fast when the connection string
# is absent from the environment and from an existing dashboard.env.
# ===========================================================================

@test "ASR-D: no flag + no ConnectionStrings env -- exits 1 before any docker / gh-release side effect" {
    run_install --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    log_not_contains 'docker compose'
    log_not_contains 'docker login'
    log_not_contains 'gh release download'
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
}

@test "ASR-D: no flag + no ConnectionStrings env -- error output contains 'Pass --local-db' (AR-3 path 1)" {
    run_install --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"--local-db"* ]]
}

@test "ASR-D: no flag + no ConnectionStrings env -- error output contains 'Pass --demo' (AR-3 path 2)" {
    run_install --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"--demo"* ]]
}

@test "ASR-D: no flag + no ConnectionStrings env -- error output contains 'ConnectionStrings__DefaultConnection' (AR-3 path 3)" {
    run_install --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"ConnectionStrings__DefaultConnection"* ]]
}

@test "ASR-D: no flag + ConnectionStrings__DefaultConnection in env -- precondition passes, happy path" {
    export ConnectionStrings__DefaultConnection='Host=mydb;Database=dashboard;Username=dashboard;Password=secret'
    run_install --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
}

@test "ASR-D: no flag + ConnectionStrings__DefaultConnection in existing dashboard.env -- precondition passes, happy path" {
    # install.sh step 2 uses grep + cut to probe the file; no -SimpleMatch / ^ anchor bug here.
    echo 'ConnectionStrings__DefaultConnection=Host=mydb;Database=dashboard;Username=dashboard;Password=secret' \
        > "$INSTALL_DIR/dashboard.env"
    run_install --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
}

@test "ASR-D: --local-db -- precondition bypassed (bundled db, no external string required)" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    [[ "$output" != *"ConnectionStrings__DefaultConnection is not set"* ]]
}

@test "ASR-D: --demo -- precondition bypassed (demo bundles db + mock upstream)" {
    run_install --demo --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    [[ "$output" != *"ConnectionStrings__DefaultConnection is not set"* ]]
}

# ===========================================================================
# GHA_TOKEN precondition -- scoped to --real-gha per issue #72
# ===========================================================================

@test "GHA_TOKEN: --real-gha without GHA_TOKEN exits 1 with red error before any docker / gh-release call" {
    run_install --real-gha --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"ERROR"* ]]
    [[ "$output" == *"GHA_TOKEN"* ]]
    [[ "$output" == *"--real-gha"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'docker login'
    log_not_contains 'gh release download'
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
}

@test "GHA_TOKEN: --real-gha with GHA_TOKEN set (+ ConnectionStrings in env): exits 0, no GHA_TOKEN advisory" {
    export GHA_TOKEN='ghp_fake_pat'
    export ConnectionStrings__DefaultConnection='Host=mydb;Database=dashboard;Username=dashboard;Password=secret'
    run_install --real-gha --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    [[ "$output" != *"GHA_TOKEN not set"* ]]
}

@test "GHA_TOKEN: --real-gha --local-db with GHA_TOKEN set: exits 0 (bundled db satisfies Postgres requirement)" {
    export GHA_TOKEN='ghp_fake_pat_for_tests'
    run_install --real-gha --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    [[ "$output" != *"GHA_TOKEN not set"* ]]
}

@test "GHA_TOKEN: --local-db without GHA_TOKEN -- precondition bypassed (no fetcher in local-db-only path)" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    [[ "$output" != *"ERROR: --real-gha requires"* ]]
}

@test "GHA_TOKEN: --demo does not require GHA_TOKEN (demo uses mock upstream)" {
    run_install --demo --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    [[ "$output" != *"ERROR: --real-gha requires"* ]]
}

# ===========================================================================
# Mutual exclusion guards (issue #72)
# ===========================================================================

@test "Mutual exclusion: --demo --local-db rejected (demo already bundles db)" {
    run_install --demo --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"mutually exclusive"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'gh release download'
}

@test "Mutual exclusion: --demo --real-gha rejected (demo uses mock upstream, not real GHA)" {
    run_install --demo --real-gha --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"mutually exclusive"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'gh release download'
}

# ===========================================================================
# ASR-A flag matrix: compose chain + profiles (issue #72)
# ===========================================================================

@test "ASR-A (no flag): release.yml only; NO profiles in docker compose up" {
    export ConnectionStrings__DefaultConnection='Host=mydb;Database=dashboard;Username=dashboard;Password=secret'
    run_install --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [ -n "$up_line" ]
    [[ "$up_line" != *"--profile"* ]]
    [[ "$up_line" != *"db"* ]]
    [[ "$up_line" != *"fetcher"* ]]
    [[ "$up_line" == *"docker-compose.release.yml"* ]]
    [[ "$up_line" != *"docker-compose.demo.yml"* ]]
}

@test "ASR-A (--local-db): release.yml only; --profile db; NO --profile fetcher; NO demo.yml" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [ -n "$up_line" ]
    [[ "$up_line" == *"--profile db"* ]]
    [[ "$up_line" != *"--profile fetcher"* ]]
    [[ "$up_line" == *"docker-compose.release.yml"* ]]
    [[ "$up_line" != *"docker-compose.demo.yml"* ]]
}

@test "ASR-A (--real-gha with GHA_TOKEN + ConnectionStrings): release.yml only; --profile fetcher only; NO --profile db; NO demo.yml" {
    export GHA_TOKEN='ghp_real_pat'
    export ConnectionStrings__DefaultConnection='Host=mydb;Database=dashboard;Username=dashboard;Password=secret'
    run_install --real-gha --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [ -n "$up_line" ]
    [[ "$up_line" == *"--profile fetcher"* ]]
    [[ "$up_line" != *"--profile db"* ]]
    [[ "$up_line" == *"docker-compose.release.yml"* ]]
    [[ "$up_line" != *"docker-compose.demo.yml"* ]]
}

@test "ASR-A (--real-gha --local-db with GHA_TOKEN): release.yml only; --profile db + --profile fetcher; NO demo.yml" {
    export GHA_TOKEN='ghp_real_pat'
    run_install --real-gha --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [ -n "$up_line" ]
    [[ "$up_line" == *"--profile db"* ]]
    [[ "$up_line" == *"--profile fetcher"* ]]
    [[ "$up_line" == *"docker-compose.release.yml"* ]]
    [[ "$up_line" != *"docker-compose.demo.yml"* ]]
}

@test "ASR-A (--demo): release.yml + demo.yml overlay; --profile db + --profile fetcher" {
    run_install --demo --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [ -n "$up_line" ]
    [[ "$up_line" == *"--profile db"* ]]
    [[ "$up_line" == *"--profile fetcher"* ]]
    [[ "$up_line" == *"docker-compose.release.yml"* ]]
    [[ "$up_line" == *"docker-compose.demo.yml"* ]]
}

@test "ASR-A (--demo): demo.yml asset is downloaded via gh release download" {
    run_install --demo --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    grep -qF 'docker-compose.demo.yml' "$STUB_LOG"
    grep -qE '^gh release download.*docker-compose.demo.yml|^gh release download.*--pattern docker-compose.demo.yml' "$STUB_LOG" || \
        grep -qF -- '--pattern docker-compose.demo.yml' "$STUB_LOG"
}

@test "ASR-A (no flag): demo.yml asset is NOT downloaded" {
    export ConnectionStrings__DefaultConnection='Host=mydb;Database=dashboard;Username=dashboard;Password=secret'
    run_install --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    ! grep -qF 'docker-compose.demo.yml' "$STUB_LOG"
}

@test "ASR-A: --profile migrate is NEVER passed in any mode (migrations are in-process per ADR-0009)" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [[ "$up_line" != *"--profile migrate"* ]]
}

@test "ASR-A: --local-db sets ConnectionStrings__DefaultConnection automatically (no external string required)" {
    # --local-db must set the env var so compose substitution resolves.
    # Happy-path exit 0 confirms the injection works (ASR-D would have blocked otherwise).
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    [[ "$output" != *"ConnectionStrings__DefaultConnection is not set"* ]]
}

@test "ASR-A: --real-gha (with GHA_TOKEN) WITHOUT --local-db requires ConnectionStrings__DefaultConnection (external Postgres)" {
    # --real-gha alone does NOT bundle a db; ASR-D fires if the connection string is absent.
    export GHA_TOKEN='ghp_real_pat'
    run_install --real-gha --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"ConnectionStrings__DefaultConnection"* ]]
}

@test "ASR-A: --fetcher rejected as unknown argument (renamed to --real-gha per issue #72)" {
    run_install --fetcher --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown argument"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'gh release download'
}

@test "ASR-A: --empty rejected as unknown argument (flag removed in issue #72)" {
    run_install --empty --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown argument"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'gh release download'
}

@test "ASR-A: --skip-migrations rejected as unknown argument (retired per ADR-0009)" {
    export ConnectionStrings__DefaultConnection='Host=mydb;Database=dashboard;Username=dashboard;Password=secret'
    run_install --skip-migrations --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown argument"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'gh release download'
}

# ===========================================================================
# gh CLI precondition matrix (issue #72)
# ===========================================================================

@test "gh precondition: gh missing on PATH -- exits 1 with 'gh CLI not found' and no side effects" {
    # Remove the gh stub entirely so `command -v gh` in install.sh finds nothing.
    rm -f "$STUB_DIR/gh"
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"gh"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'docker login'
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
}

@test "gh precondition: gh not authenticated -- exits 1 with 'not authenticated' and no side effects" {
    export DD_GH_NOT_AUTHED=true
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"not authenticated"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'docker login'
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
}

@test "gh precondition: gh token lacks read:packages -- exits 1 with 'read:packages' and no side effects" {
    export DD_GH_NO_SCOPE=true
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"read:packages"* ]]
    log_not_contains 'docker compose'
    log_not_contains 'docker login'
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
}

@test "gh precondition: gh token has write:packages -- precondition passes (GitHub OAuth scope hierarchy)" {
    export DD_GH_SCOPE_LITERAL='write:packages'
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
}

@test "gh precondition: gh token has admin:packages -- precondition passes (same hierarchy reason)" {
    export DD_GH_SCOPE_LITERAL='admin:packages'
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
}

@test "gh precondition: happy path -- docker login ghcr.io runs BEFORE docker compose pull (ordering invariant)" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    login_line=$(grep -nF 'docker login' "$STUB_LOG" | head -n1 | cut -d: -f1)
    pull_line=$(grep -nE '^docker.*compose.*pull' "$STUB_LOG" | head -n1 | cut -d: -f1)
    [ -n "$login_line" ]
    [ -n "$pull_line" ]
    [ "$login_line" -lt "$pull_line" ]
}

# ===========================================================================
# --local-db env-var injection (issue #72)
# New install.sh sets env vars for compose substitution rather than writing
# a dashboard.env. These tests verify the env-var injection path.
# ===========================================================================

@test "--local-db env injection: exits 0 (no dashboard.env required for env-var injection path)" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    [[ "$output" != *"ConnectionStrings__DefaultConnection is not set"* ]]
}

@test "--local-db env injection: POSTGRES_PASSWORD defaulted to 'local-dev-password' when not set (INFO log)" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    [[ "$output" == *"local-dev-password"* ]]
}

@test "--local-db env injection: pre-set POSTGRES_PASSWORD is used -- no 'defaulting' INFO log emitted" {
    export POSTGRES_PASSWORD='my-custom-pw-32charxxxxxxxxxxxxxxx'
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    [[ "$output" != *"POSTGRES_PASSWORD not set; defaulting"* ]]
}

# ===========================================================================
# gh release download tag branching
# ===========================================================================

@test "tag branching: --version latest -- gh release download invoked WITHOUT a positional tag (argv[3] is a flag)" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version latest
    [ "$status" -eq 0 ]
    # Line format: `gh release download --repo ... --pattern docker-compose.release.yml ...`
    # With 'latest', no positional tag -- first flag after `download` starts with --.
    line="$(grep -E '^gh release download' "$STUB_LOG" | grep -F 'docker-compose.release.yml' | head -n1)"
    [ -n "$line" ]
    [[ "$line" == *"--repo kostiantyn-matsebora/deployment-dashboard"* ]]
    [[ "$line" == *"--pattern docker-compose.release.yml"* ]]
    [[ "$line" == *"--clobber"* ]]
    # Fourth whitespace-separated token should be a flag (starts with --), not a bare tag.
    tok=$(echo "$line" | awk '{print $4}')
    [[ "$tok" == --* ]]
}

@test "tag branching: --version v1.2.3 -- gh release download invoked WITH the literal tag at argv[3]" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v1.2.3
    [ "$status" -eq 0 ]
    line="$(grep -E '^gh release download' "$STUB_LOG" | grep -F 'docker-compose.release.yml' | head -n1)"
    [ -n "$line" ]
    tok=$(echo "$line" | awk '{print $4}')
    [ "$tok" = "v1.2.3" ]
}

# ===========================================================================
# Compose args -- env-file presence / absence (issue #72)
# ===========================================================================

@test "compose args: --env-file is passed when a pre-existing dashboard.env is present at install-dir" {
    # install.sh step 8: --env-file is only added when the file already exists.
    echo 'PLACEHOLDER=1' > "$INSTALL_DIR/dashboard.env"
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    pull_line="$(grep -E '^docker.*compose.*pull' "$STUB_LOG" | head -n1)"
    up_line="$(grep -E '^docker.*compose.*up'   "$STUB_LOG" | head -n1)"
    [[ "$pull_line" == *"--env-file"* ]]
    [[ "$pull_line" == *"$INSTALL_DIR/dashboard.env"* ]]
    [[ "$up_line"   == *"--env-file"* ]]
    [[ "$up_line"   == *"$INSTALL_DIR/dashboard.env"* ]]
}

@test "compose args: --env-file is NOT passed when no dashboard.env exists at install-dir" {
    # install.sh step 8: compose uses \$env:* set in step 7 when no file present.
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    pull_line="$(grep -E '^docker.*compose.*pull' "$STUB_LOG" | head -n1)"
    up_line="$(grep -E '^docker.*compose.*up'   "$STUB_LOG" | head -n1)"
    [[ "$pull_line" != *"--env-file"* ]]
    [[ "$up_line"   != *"--env-file"* ]]
}

# ===========================================================================
# Env-var substitution shape (issue #72)
# install.sh does NOT write a dashboard.env. Instead it exports env vars
# for docker compose substitution in step 7.
# ===========================================================================

@test "env-var shape: --local-db --version v1.2.3 --port 9090 -- exits 0 and output contains port (URL panel)" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v1.2.3 --port 9090
    [ "$status" -eq 0 ]
    [[ "$output" == *"9090"* ]]
}

@test "env-var shape: --local-db --version v9.9.9-test --port 8080 (default) -- exits 0" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test --port 8080
    [ "$status" -eq 0 ]
}

# ===========================================================================
# Error paths
# ===========================================================================

@test "error: gh release download failure -- exits 1 with error mentioning asset + version" {
    export DD_GH_DOWNLOAD_FAIL='docker-compose.release.yml'
    run_install --local-db --install-dir "$INSTALL_DIR" --version v0.0.0-doesnotexist
    [ "$status" -eq 1 ]
    [[ "$output" == *"docker-compose.release.yml"* ]]
    [[ "$output" == *"v0.0.0-doesnotexist"* ]]
}

# TODO(devops-bug): install.sh lacks an exit-code check after `docker login ghcr.io`.
# With set -euo pipefail the script exits 1 silently on login failure — it never emits
# the "docker login ghcr.io failed" message this test asserts. The assertion is the
# correct safety oracle (guard against pulling after a failed login); the production fix
# is to add an explicit error-message branch in install.sh (see issue raised in PR #77).
@test "error: docker login ghcr.io failure -- exits 1 and NEVER calls docker compose pull" {
    export DD_LOGIN_EXIT=1
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 1 ]
    [[ "$output" == *"docker login ghcr.io failed"* ]]
    ! grep -qE '^docker.*compose.*pull' "$STUB_LOG"
}

@test "error: docker compose pull failure (non-zero exit) -- script exits non-zero" {
    export DD_PULL_EXIT=1
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -ne 0 ]
}

@test "error: health-poll timeout -- exits non-zero and dumps logs" {
    export DD_HEALTH_OK=false
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test --health-timeout 1
    [ "$status" -ne 0 ]
    [[ "$output" == *"/health did not return 200"* ]]
    grep -qE '^docker.*compose.*logs' "$STUB_LOG"
}

# ===========================================================================
# Smoke regression: health-poll + URL panel + exit code
# ===========================================================================

@test "smoke: happy path (--local-db) -- exits 0 and stdout contains the gateway port" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test --port 8080
    [ "$status" -eq 0 ]
    [[ "$output" == *"8080"* ]]
}

@test "smoke: happy path (--local-db) -- health curl call emitted at least once" {
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test
    [ "$status" -eq 0 ]
    grep -qE '^curl.*/health' "$STUB_LOG"
}

@test "smoke: health timeout (--local-db) -- exit code is non-zero" {
    export DD_HEALTH_OK=false
    run_install --local-db --install-dir "$INSTALL_DIR" --version v9.9.9-test --health-timeout 1
    [ "$status" -ne 0 ]
}

# ===========================================================================
# Default --install-dir is $HOME/.dashboard-release (CWD-independent)
# ===========================================================================

@test "default --install-dir: resolves to \$HOME/.dashboard-release regardless of CWD" {
    fake_home="$BATS_TEST_TMPDIR/fakehome"
    fake_cwd="$BATS_TEST_TMPDIR/fakecwd"
    mkdir -p "$fake_home" "$fake_cwd"
    # Run install.sh from a different CWD; assert compose files land in $HOME/.dashboard-release/.
    HOME="$fake_home" run bash -c "cd '$fake_cwd' && bash '$SCRIPT' --local-db --version v9.9.9-test"
    [ "$status" -eq 0 ]
    [ -f "$fake_home/.dashboard-release/docker-compose.release.yml" ]
    # CWD-anchored anti-assertion: nothing landed under the historical default inside fake_cwd.
    [ ! -f "$fake_cwd/dashboard-release/docker-compose.release.yml" ]
    # Compose up call references the default location (not a CWD-relative path).
    grep -qE "^docker.*compose.*$fake_home/.dashboard-release/docker-compose.release.yml" "$STUB_LOG"
}
