#!/usr/bin/env bats
# Sibling suite for 15-detect-dns-resolver.envsh (see .claude/scripts.md bash
# bootstrap exception — nginx entrypoint hooks are pure POSIX sh and cannot
# run under pytest).

setup() {
    SCRIPT="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)/15-detect-dns-resolver.envsh"
    FIXTURE_DIR="$(mktemp -d)"
}

teardown() {
    rm -rf "$FIXTURE_DIR"
}

@test "unset DNS_RESOLVER picks the first nameserver in resolv.conf" {
    printf 'nameserver 10.1.2.3\n' > "$FIXTURE_DIR/resolv.conf"
    unset DNS_RESOLVER
    RESOLV_CONF="$FIXTURE_DIR/resolv.conf" . "$SCRIPT"
    [ "$DNS_RESOLVER" = "10.1.2.3" ]
}

@test "empty DNS_RESOLVER is treated the same as unset" {
    printf 'nameserver 10.1.2.3\n' > "$FIXTURE_DIR/resolv.conf"
    DNS_RESOLVER=""
    RESOLV_CONF="$FIXTURE_DIR/resolv.conf" . "$SCRIPT"
    [ "$DNS_RESOLVER" = "10.1.2.3" ]
}

@test "already-set DNS_RESOLVER is left untouched (explicit override wins)" {
    printf 'nameserver 10.1.2.3\n' > "$FIXTURE_DIR/resolv.conf"
    DNS_RESOLVER="9.9.9.9"
    RESOLV_CONF="$FIXTURE_DIR/resolv.conf" . "$SCRIPT"
    [ "$DNS_RESOLVER" = "9.9.9.9" ]
}

@test "multiple nameserver lines: first one wins" {
    printf 'nameserver 10.1.2.3\nnameserver 10.4.5.6\n' > "$FIXTURE_DIR/resolv.conf"
    unset DNS_RESOLVER
    RESOLV_CONF="$FIXTURE_DIR/resolv.conf" . "$SCRIPT"
    [ "$DNS_RESOLVER" = "10.1.2.3" ]
}

@test "no nameserver line falls back to the Docker embedded-DNS default" {
    printf '# no nameserver here\nsearch example.com\n' > "$FIXTURE_DIR/resolv.conf"
    unset DNS_RESOLVER
    RESOLV_CONF="$FIXTURE_DIR/resolv.conf" . "$SCRIPT"
    [ "$DNS_RESOLVER" = "127.0.0.11" ]
}

@test "missing resolv.conf file falls back to the Docker embedded-DNS default" {
    unset DNS_RESOLVER
    RESOLV_CONF="$FIXTURE_DIR/does-not-exist.conf" . "$SCRIPT"
    [ "$DNS_RESOLVER" = "127.0.0.11" ]
}
