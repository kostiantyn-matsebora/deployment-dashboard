#!/usr/bin/env bash
# ginee — Optimized-By trailer attestation gate (T13 / playbook #135, bash port).
# Fires at `git push`: scans <upstream>..HEAD for commits carrying Optimized-By:
# ai-engineer; missing-dispatch transcript → permissionDecision: "ask".
# Spec: migrations/optimized-by-attestation.md. Requires: bash 4+, jq.

set -u
[ "${SKIP_GINEE_COMPLIANCE:-0}" = "1" ] && exit 0

PAYLOAD_OVERRIDE=""
ROOT_OVERRIDE=""
TRANSCRIPT_OVERRIDE=""
RANGE_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --test-input)          shift; PAYLOAD_OVERRIDE="${1:-}"; shift || true ;;
    --repo-root)           shift; ROOT_OVERRIDE="${1:-}"; shift || true ;;
    --transcript-override) shift; TRANSCRIPT_OVERRIDE="${1:-}"; shift || true ;;
    --range-override)      shift; RANGE_OVERRIDE="${1:-}"; shift || true ;;
    *) shift ;;
  esac
done

PAYLOAD="${PAYLOAD_OVERRIDE:-$(cat)}"
[ -n "$PAYLOAD" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

TOOL="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null)"
[ "$TOOL" = "Bash" ] || exit 0

CMD="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$CMD" ] || exit 0

# Self-filter: only fire on git push.
printf '%s' "$CMD" | grep -qE '\bgit[[:space:]]+push\b' || exit 0

ROOT="${ROOT_OVERRIDE:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -n "$ROOT" ] || exit 0

CFG="$ROOT/local/framework.config.yaml"
if [ -f "$CFG" ] && grep -q '^compliance:[[:space:]]*$' "$CFG" \
   && grep -qE '^[[:space:]]+-[[:space:]]+optimized-by-attestation[[:space:]]*$' "$CFG"; then
  exit 0
fi

# Resolve the to-be-pushed range.
# SC2015 carve-out: `cmd 2>/dev/null || true` is the idiomatic fail-open guard
# here under set -u — capture whatever stdout the command produced without
# aborting on non-zero exit. shellcheck flags the pattern broadly; intent is
# exactly "swallow failure, keep going".

if [ -n "$RANGE_OVERRIDE" ]; then
  RANGE="$RANGE_OVERRIDE"
else
  RANGE=""
  # shellcheck disable=SC2015
  UPSTREAM="$(cd "$ROOT" && git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
  if [ -n "$UPSTREAM" ]; then
    RANGE="${UPSTREAM}..HEAD"
  else
    for base in origin/main origin/master; do
      if (cd "$ROOT" && git rev-parse --verify --quiet "$base" >/dev/null 2>&1); then
        RANGE="${base}..HEAD"
        break
      fi
    done
  fi
fi
[ -n "$RANGE" ] || exit 0

# shellcheck disable=SC2015
BODIES="$(cd "$ROOT" && git log "$RANGE" --format=%B%n--END-COMMIT-- 2>/dev/null || true)"
[ -n "$BODIES" ] || exit 0

# No Optimized-By trailer in any commit in the range → no attestation needed.
printf '%s' "$BODIES" | grep -qE 'Optimized-By:[[:space:]]*ai-engineer' || exit 0

# Trailer present → resolve transcript text.
TRANSCRIPT_TEXT=""
if [ -n "$TRANSCRIPT_OVERRIDE" ] && [ -f "$TRANSCRIPT_OVERRIDE" ]; then
  TRANSCRIPT_TEXT="$(cat "$TRANSCRIPT_OVERRIDE")"
else
  TP="$(printf '%s' "$PAYLOAD" | jq -r '.transcript_path // empty' 2>/dev/null)"
  if [ -n "$TP" ]; then
    case "$TP" in
      /*) ;;
      *) TP="$ROOT/$TP" ;;
    esac
    [ -f "$TP" ] && TRANSCRIPT_TEXT="$(cat "$TP" 2>/dev/null || true)"
  fi
fi

# Verifiable dispatch in transcript → pass through.
if [ -n "$TRANSCRIPT_TEXT" ] && printf '%s' "$TRANSCRIPT_TEXT" \
   | grep -qE '"subagent_type"[[:space:]]*:[[:space:]]*"ai-engineer"'; then
  exit 0
fi

# Trailer claimed in to-be-pushed range without verifiable dispatch — ask user.
REASON="[ginee:attest] Push range ${RANGE} contains a commit with Optimized-By: ai-engineer trailer, but no Agent(subagent_type=ai-engineer) dispatch found in this session"'"'"'s transcript. Proceed anyway (cross-session optimization · manual lossless pass · WIP push) or cancel + run the ai-engineer optimization pass first?"
jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: $reason
  }
}'
exit 0
