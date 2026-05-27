#!/usr/bin/env bash
# ginee — Stop hook (T7 / #143, bash port). Mirrors .ps1 sibling.
# Spec: migrations/stop-hook.md. Requires: bash 4+, jq.

set -u

if [ "${SKIP_GINEE_COMPLIANCE:-0}" = "1" ]; then exit 0; fi

block() {
  local rule="$1"; local detail="$2"; local remediation="$3"
  printf '[ginee:stop-gate] %s — %s\n' "$rule" "$detail" >&2
  printf '  Remediation: %s\n' "$remediation" >&2
  printf '  Bypass (emergency): SKIP_GINEE_COMPLIANCE=1\n' >&2
  printf '  Opt out repo-wide: local/framework.config.yaml § compliance.disabled: [stop-hook]\n' >&2
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
  grep -qE '^[[:space:]]+-[[:space:]]+stop-hook[[:space:]]*$' "$config"
}

# --- main ---

PAYLOAD=""
if [ "${1:-}" = "--test-input" ] && [ -n "${2:-}" ]; then
  PAYLOAD="$2"
else
  PAYLOAD="$(cat)"
fi

[ -n "$PAYLOAD" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# Anti-loop guard.
STOP_ACTIVE="$(printf '%s' "$PAYLOAD" | jq -r '.stop_hook_active // false')"
if [ "$STOP_ACTIVE" = "true" ]; then exit 0; fi

ROOT="$(repo_root)"
[ -n "$ROOT" ] || exit 0

if is_opt_out "$ROOT"; then exit 0; fi

# Compose transcript text.
TRANSCRIPT=""
TINLINE="$(printf '%s' "$PAYLOAD" | jq -r '.transcript // empty')"
if [ -n "$TINLINE" ]; then
  TRANSCRIPT="$TINLINE"
else
  TPATH="$(printf '%s' "$PAYLOAD" | jq -r '.transcript_path // empty')"
  if [ -n "$TPATH" ]; then
    case "$TPATH" in
      /*|[A-Za-z]:*) ;;
      *) TPATH="$ROOT/$TPATH" ;;
    esac
    if [ -f "$TPATH" ]; then
      TRANSCRIPT="$(cat "$TPATH")"
    fi
  fi
fi

# --- Block condition 1: cardinal return missing self-lint marker ---
if [ -n "$TRANSCRIPT" ]; then
  if printf '%s' "$TRANSCRIPT" | grep -qE '^##[[:space:]]+(Files touched|Decisions made|Verification log|Open issues|Next dispatch needed|Source reads)'; then
    # Look at the tail starting from the last return-marker section header.
    LAST_LINE="$(printf '%s' "$TRANSCRIPT" | grep -nE '^##[[:space:]]+(Files touched|Decisions made|Verification log|Open issues|Next dispatch needed|Source reads)' | tail -1 | cut -d: -f1)"
    if [ -n "$LAST_LINE" ]; then
      TAIL="$(printf '%s' "$TRANSCRIPT" | tail -n +"$LAST_LINE")"
      if ! printf '%s' "$TAIL" | grep -qE '<!-- self-lint: pass -->'; then
        block 'cardinal return missing self-lint marker' \
          'The most recent specialist return omits the literal <!-- self-lint: pass --> tail required by core/templates/phase-report.md.' \
          'Re-dispatch is FORBIDDEN for format alone — acknowledge as advisory in main thread, then continue. Re-running with this acknowledgement passes the gate.'
      fi
    fi
  fi
fi

# --- Block condition 3: gh pr create without acceptance signal ---
if [ -n "$TRANSCRIPT" ] && printf '%s' "$TRANSCRIPT" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+create\b'; then
  # Get the last occurrence's line number.
  LAST_LINE="$(printf '%s' "$TRANSCRIPT" | grep -nE '\bgh[[:space:]]+pr[[:space:]]+create\b' | tail -1 | cut -d: -f1)"
  if [ -n "$LAST_LINE" ]; then
    TAIL="$(printf '%s' "$TRANSCRIPT" | tail -n +"$LAST_LINE")"
    ACCEPTED=0
    if printf '%s' "$TAIL" | grep -qiE '(accept|merged|approve|looks[[:space:]]+good|lgtm|ship[[:space:]]+it)\b'; then
      ACCEPTED=1
    fi
    # ci-watch posture detection.
    CI_WATCHED=1  # default: poll
    CONFIG="$ROOT/local/framework.config.yaml"
    if [ -f "$CONFIG" ]; then
      if grep -qE '^[[:space:]]*ci-watch-policy:[[:space:]]*[a-z]+[[:space:]]*$' "$CONFIG"; then
        POSTURE="$(grep -E '^[[:space:]]*ci-watch-policy:' "$CONFIG" | head -1 | sed -E 's/^[[:space:]]*ci-watch-policy:[[:space:]]*([a-z]+)[[:space:]]*$/\1/')"
        if [ "$POSTURE" != "poll" ]; then
          CI_WATCHED=0
        fi
      fi
    fi
    if [ "$CI_WATCHED" = "1" ] && [ "$ACCEPTED" = "0" ]; then
      # shellcheck disable=SC2016 # backticks are literal here, not command substitution
      block 'PR opened without CI-watch sign-off' \
        'A gh pr create was issued earlier this turn; default ci-watch policy is `poll` but no CI-green signal is recorded.' \
        'Enter CI-watch per core/protocols/ci-watch.md OR explicitly hand back. Switch posture via ci-watch-policy: async|hybrid|disabled.'
    fi
  fi
fi

# --- Block condition 4: open ginee:in-progress issue with no close comment ---
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ -n "$BRANCH" ]; then
  ISSUE_N="$(printf '%s' "$BRANCH" | sed -nE 's|^([0-9]+)[-_/].*|\1|p')"
  if [ -n "$ISSUE_N" ] && command -v gh >/dev/null 2>&1; then
    STATE_JSON="$(gh issue view "$ISSUE_N" --json state,labels 2>/dev/null || true)"
    if [ -n "$STATE_JSON" ]; then
      STATE="$(printf '%s' "$STATE_JSON" | jq -r '.state // empty' 2>/dev/null || true)"
      HAS_INPROGRESS="$(printf '%s' "$STATE_JSON" | jq -r '[.labels[]?.name] | index("ginee:in-progress") // empty' 2>/dev/null || true)"
      CLOSED=0
      if [ -n "$TRANSCRIPT" ]; then
        if printf '%s' "$TRANSCRIPT" | grep -qiE '^##[[:space:]]+Phase[[:space:]]+8\b'; then CLOSED=1; fi
        if printf '%s' "$TRANSCRIPT" | grep -qE "gh[[:space:]]+issue[[:space:]]+close[[:space:]]+$ISSUE_N\\b"; then CLOSED=1; fi
      fi
      if [ "$STATE" = "OPEN" ] && [ -n "$HAS_INPROGRESS" ] && [ "$CLOSED" = "0" ]; then
        # shellcheck disable=SC2016 # backticks are literal here, not command substitution
        block 'open ginee:in-progress issue without Phase-8 close' \
          "Issue #$ISSUE_N remains OPEN with the ginee:in-progress label and no Phase-8 close comment in this turn." \
          'Either post the Phase-8 close (`gh issue close <N> -c ...`) before ending the turn, OR explicitly hand back with a stop-state note.'
      fi
    fi
  fi
fi

exit 0
