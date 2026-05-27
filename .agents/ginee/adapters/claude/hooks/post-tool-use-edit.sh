#!/usr/bin/env bash
# ginee — PostToolUse self-check reminder (T6 / #142, bash port). Mirrors .ps1 sibling.
# Spec: migrations/posttooluse-edit-hook.md. Requires: bash 4+, jq.

set -u

if [ "${SKIP_GINEE_COMPLIANCE:-0}" = "1" ]; then exit 0; fi

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || true
}

is_opt_out() {
  local root="$1"
  local config="$root/local/framework.config.yaml"
  [ -f "$config" ] || return 1
  grep -q '^compliance:[[:space:]]*$' "$config" || return 1
  grep -qE '^[[:space:]]+-[[:space:]]+posttooluse-edit-hook[[:space:]]*$' "$config"
}

is_always_loaded() {
  case "$1" in
    core/process.md) return 0 ;;
    core/roles/*.md)
      case "$1" in
        core/roles/*.details.md) return 1 ;;
        *) return 0 ;;
      esac
      ;;
  esac
  return 1
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

TOOL_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty')"
case "$TOOL_NAME" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

ROOT="$(repo_root)"
[ -n "$ROOT" ] || exit 0

if is_opt_out "$ROOT"; then exit 0; fi

FILE_PATH="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.file_path // empty')"
[ -n "$FILE_PATH" ] || exit 0

# Resolve absolute → repo-relative.
case "$FILE_PATH" in
  /*|[A-Za-z]:*)
    REL="${FILE_PATH#"$ROOT"/}"
    REL="${REL#"$ROOT"\\}"
    ;;
  *) REL="$FILE_PATH" ;;
esac
REL="$(printf '%s' "$REL" | sed 's|\\|/|g')"

# Path gate.
case "$REL" in
  core/*) ;;
  *) exit 0 ;;
esac

BODY="[ginee:self-check] You just edited ${REL}. Verify before continuing:
- frontmatter present + valid (hot-spec contract: core/protocols/hot-spec-format.md)
- size <= cap-bytes; if exceeded, dispatch ai-engineer + commit with Optimized-By: ai-engineer trailer
- runtime surface stayed D-free (no bare D<N> tokens introduced — PLAN.md only)
- lossless invariant: every prior rule survives byte-for-byte"

if is_always_loaded "$REL"; then
  BODY="$BODY
- always-loaded surface: consider whether an ai-engineer optimization pass is needed before merge"
fi

printf '%s' "$BODY" | jq -Rs '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: .
  }
}'

exit 0
