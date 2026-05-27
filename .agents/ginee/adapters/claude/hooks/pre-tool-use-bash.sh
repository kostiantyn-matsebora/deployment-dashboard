#!/usr/bin/env bash
# ginee compliance — PreToolUse hook on Bash (T3 / playbook tactic 3, bash port).
# Mirrors adapters/claude/hooks/pre-tool-use-bash.ps1; see that file's header
# for the full spec.
#
# Requires: bash 4+, jq.
# Bypass: SKIP_GINEE_COMPLIANCE=1.
# Opt out: local/framework.config.yaml § compliance.disabled: [pretooluse-bash-hook].

set -u

if [ "${SKIP_GINEE_COMPLIANCE:-0}" = "1" ]; then exit 0; fi

block() {
  local rule="$1"; local detail="$2"; local remediation="$3"
  printf '[ginee:gate] %s — %s\n' "$rule" "$detail" >&2
  printf '  Remediation: %s\n' "$remediation" >&2
  printf '  Bypass (emergency): SKIP_GINEE_COMPLIANCE=1\n' >&2
  printf '  Opt out repo-wide: local/framework.config.yaml § compliance.disabled: [pretooluse-bash-hook]\n' >&2
  exit 2
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || true
}

is_opt_out() {
  local root="$1"
  local config="$root/local/framework.config.yaml"
  [ -f "$config" ] || return 1
  grep -q '^compliance:[[:space:]]*$' "$config" || return 1
  grep -qE '^[[:space:]]+-[[:space:]]+pretooluse-bash-hook[[:space:]]*$' "$config"
}

# --- main ---

PAYLOAD=""
if [ "${1:-}" = "--test-input" ] && [ -n "${2:-}" ]; then
  PAYLOAD="$2"
else
  PAYLOAD="$(cat)"
fi

if [ -z "$PAYLOAD" ]; then exit 0; fi

if ! command -v jq >/dev/null 2>&1; then
  printf '[ginee:gate] jq not on PATH — hook degraded to fail-open.\n' >&2
  exit 0
fi

TOOL_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty')"
[ "$TOOL_NAME" = "Bash" ] || exit 0

ROOT="$(repo_root)"
[ -n "$ROOT" ] || exit 0

if is_opt_out "$ROOT"; then exit 0; fi

CMD="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // empty')"
[ -n "$CMD" ] || exit 0

# Normalise whitespace for pattern matching.
NORM="$(printf '%s' "$CMD" | tr '\r\n' '  ' | tr -s ' ')"

# --- Violation 1: git commit --no-verify ---
if printf '%s' "$NORM" | grep -qE '\bgit[[:space:]]+commit\b' \
   && printf '%s' "$NORM" | grep -qE '(--no-verify|[[:space:]]-n[[:space:]]|[[:space:]]-n$)'; then
  block 'git commit --no-verify blocked' \
    'Skipping pre-commit hooks bypasses the context-economy gate + ginee compliance enforcement.' \
    'Resolve the underlying hook failure (run hooks individually with -v); commit normally afterwards.'
fi

# --- Violation 2: git push --force on main / master ---
if printf '%s' "$NORM" | grep -qE '\bgit[[:space:]]+push\b' \
   && printf '%s' "$NORM" | grep -qE '(--force|--force-with-lease|[[:space:]]-f[[:space:]]|[[:space:]]-f$)' \
   && printf '%s' "$NORM" | grep -qE '\b(main|master)\b'; then
  block 'git push --force on main / master blocked' \
    'Force-pushing the trunk rewrites history other contributors have pulled.' \
    'Push to a feature branch and open a PR. If trunk recovery is genuinely needed, coordinate explicitly with the user first.'
fi

# --- Violation 3: git reset --hard ---
if printf '%s' "$NORM" | grep -qE '\bgit[[:space:]]+reset\b' \
   && printf '%s' "$NORM" | grep -qE '(^|[[:space:]])--hard([[:space:]]|$)'; then
  # shellcheck disable=SC2016
  block 'git reset --hard blocked' \
    'Discards uncommitted work + repositions HEAD destructively.' \
    'Use `git restore <path>` or `git checkout <ref> -- <path>` for targeted resets. If full reset is truly required, set SKIP_GINEE_COMPLIANCE=1 for this invocation.'
fi

# --- Violation 4: gh pr create without --body ---
if printf '%s' "$NORM" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+create\b'; then
  if ! printf '%s' "$NORM" | grep -qE '(--body|--body-file|--draft|[[:space:]]-B[[:space:]]|[[:space:]]-B$)'; then
    block 'gh pr create missing PR body' \
      'Every ginee PR cites a requirement / NFR / mockup section / CR / ADR per core/templates/pr-description.md.' \
      'Compose the PR body using the template (--body / --body-file); --draft also accepted for in-progress PRs.'
  fi
fi

exit 0
