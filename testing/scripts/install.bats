#!/usr/bin/env bats
# Tests for ../../install/install.sh -- bash sibling of install/install.ps1 (issue #7).
#
# Strategy: PATH-shadowing stubs. We prepend a per-test stub directory to PATH
# so calls to `curl`, `docker`, `gh`, `openssl`, `sleep` resolve to our fakes.
# Each stub appends one line to $STUB_LOG with its invocation, then returns the
# canned exit code controlled by env vars.
#
# Coverage matrix mirrors install.Tests.ps1 (post-gh-CLI contract) -- see that
# file for the rationale.
#   - Asset fetch goes via `gh release download` (private repo).
#   - GHCR pulls require `docker login ghcr.io` with `gh auth token` piped in.
#   - curl is only used for the /health poll.

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
    #   `docker login ...`           -> drain stdin (gh token piped in); exit $DD_LOGIN_EXIT (default 0).
    #   `docker compose pull|up|...` -> exit per DD_PULL_EXIT / DD_UP_EXIT.
    cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
if [ "${1:-}" = "login" ]; then
    # Drain piped stdin (gh auth token is piped in) so the producer side gets EPIPE-free EOF.
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

# ---- GHA_TOKEN precondition matrix ----

@test "--fetcher without GHA_TOKEN (no --demo) exits 1 with red error before any docker / gh-release call" {
    # Post-Demo contract: --fetcher without $GHA_TOKEN and without --demo
    # red-errors and exits 1 before any side effect. The error literal must
    # mention GHA_TOKEN, --demo (the zero-PAT escape hatch), ERROR, and the
    # "60 req/h" anonymous-mode rate hint.
    run_install --fetcher --install-dir "$INSTALL_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"ERROR"* ]]
    [[ "$output" == *"GHA_TOKEN"* ]]
    [[ "$output" == *"--demo"* ]]
    [[ "$output" == *"60 req/h"* ]]
    # Strongest precondition signal -- no docker + no gh-release was invoked.
    log_not_contains 'docker compose'
    log_not_contains 'docker login'
    log_not_contains 'gh release download'
    [ ! -f "$INSTALL_DIR/dashboard.env" ]
    [ ! -f "$INSTALL_DIR/docker-compose.release.yml" ]
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

# ---- --demo mode ----
# --demo (zero-PAT demo install) implies --fetcher, bakes in a public-repo
# default (PostHog/posthog @ 60s poll), and threads $GHA_TOKEN through to
# dashboard.env IFF set. When unset, the GHA_TOKEN= line is OMITTED so the
# compose-level placeholder triggers the fetcher's anonymous-mode fallback
# (60 req/h). Contract source: install/install.sh § 1 + § 4 demo block.

@test "--demo implies --fetcher (--profile fetcher present in docker compose up args)" {
    # No explicit --fetcher; just --demo. The script must canonicalise
    # FETCHER=true and emit --profile fetcher in the up call.
    run_install --demo --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [ -n "$up_line" ]
    [[ "$up_line" == *"--profile fetcher"* ]]
}

@test "--demo without \$GHA_TOKEN: writes demo defaults; OMITS GHA_TOKEN line (anonymous-mode trigger)" {
    # Critical contract assertion -- the ABSENCE of GHA_TOKEN= is what makes
    # the fetcher container fall back to compose's placeholder and switch to
    # anonymous-mode GitHub API calls (60 req/h).
    run_install --demo --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    f="$INSTALL_DIR/dashboard.env"
    [ -f "$f" ]
    grep -qE 'GHA_REPOSITORIES=.*PostHog.*posthog' "$f"
    grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=60$' "$f"
    ! grep -qE '^GHA_TOKEN=' "$f"
}

@test "--demo with \$GHA_TOKEN set: threads token through to dashboard.env (authed mode)" {
    export GHA_TOKEN='ghp_demo_pat'
    run_install --demo --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    f="$INSTALL_DIR/dashboard.env"
    grep -qE 'GHA_REPOSITORIES=.*PostHog.*posthog' "$f"
    grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=60$' "$f"
    grep -qE '^GHA_TOKEN=ghp_demo_pat$' "$f"
}

@test "--demo + --fetcher together: still works (idempotent flag combo)" {
    # --demo implies --fetcher; supplying both explicitly must not break
    # parsing or duplicate state. Sanity check on the canonicalisation.
    run_install --demo --fetcher --version v9.9.9-test --install-dir "$INSTALL_DIR"
    [ "$status" -eq 0 ]
    f="$INSTALL_DIR/dashboard.env"
    grep -qE 'GHA_REPOSITORIES=.*PostHog.*posthog' "$f"
    grep -qE '^FETCHER_POLL_INTERVAL_SECONDS=60$' "$f"
    ! grep -qE '^GHA_TOKEN=' "$f"
    up_line="$(grep -E '^docker.*compose.*up' "$STUB_LOG" | head -n1)"
    [[ "$up_line" == *"--profile fetcher"* ]]
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
