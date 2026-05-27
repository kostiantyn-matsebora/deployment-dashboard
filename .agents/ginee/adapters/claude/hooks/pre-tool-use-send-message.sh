#!/usr/bin/env bash
# ginee — PreToolUse SendMessage hook (T8 / #144, bash port). Mirrors .ps1 sibling.
# Spec: migrations/carry-forward-injection.md. Requires: bash 4+, jq.

set -u

if [ "${SKIP_GINEE_COMPLIANCE:-0}" = "1" ]; then exit 0; fi

block() {
  local rule="$1"; local detail="$2"; local remediation="$3"
  printf '[ginee:gate] %s — %s\n' "$rule" "$detail" >&2
  printf '  Remediation: %s\n' "$remediation" >&2
  printf '  Bypass (emergency): SKIP_GINEE_COMPLIANCE=1\n' >&2
  printf '  Opt out repo-wide: local/framework.config.yaml § compliance.disabled: [pretooluse-send-message-hook]\n' >&2
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
  grep -qE '^[[:space:]]+-[[:space:]]+pretooluse-send-message-hook[[:space:]]*$' "$config"
}

# Look up a per-target rule; case-insensitive exact or substring match.
# Args: rules-file target. Echoes the rule body, or empty if not found.
lookup_rule() {
  local path="$1"; local target="$2"
  [ -f "$path" ] || return 0
  local lc; lc="$(printf '%s' "$target" | tr '[:upper:]' '[:lower:]')"
  # Exact match first.
  local exact
  exact="$(awk -v t="$lc" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      idx = index($0, ":")
      if (idx == 0) next
      k = tolower(substr($0, 1, idx - 1))
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
      v = substr($0, idx + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      if (k == t) { print v; exit }
    }
  ' "$path")"
  if [ -n "$exact" ]; then printf '%s' "$exact"; return 0; fi
  # Substring fallback.
  awk -v t="$lc" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      idx = index($0, ":")
      if (idx == 0) next
      k = tolower(substr($0, 1, idx - 1))
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
      v = substr($0, idx + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      if (index(t, k) > 0) { print v; exit }
    }
  ' "$path"
}

# --- main ---

PAYLOAD=""
RULES_OVERRIDE=""
if [ "${1:-}" = "--test-input" ] && [ -n "${2:-}" ]; then
  PAYLOAD="$2"
elif [ "${1:-}" = "--rules-file" ] && [ -n "${2:-}" ] \
     && [ "${3:-}" = "--test-input" ] && [ -n "${4:-}" ]; then
  RULES_OVERRIDE="$2"
  PAYLOAD="$4"
else
  PAYLOAD="$(cat)"
fi

[ -n "$PAYLOAD" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

TOOL_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty')"
[ "$TOOL_NAME" = "SendMessage" ] || exit 0

ROOT="$(repo_root)"
[ -n "$ROOT" ] || exit 0

if is_opt_out "$ROOT"; then exit 0; fi

# Find target field — try common spellings.
TARGET=""
for k in to target recipient agent agent_name; do
  V="$(printf '%s' "$PAYLOAD" | jq -r ".tool_input.${k} // empty")"
  if [ -n "$V" ]; then TARGET="$V"; break; fi
done
[ -n "$TARGET" ] || exit 0

# Find message body — try common spellings.
MESSAGE=""
for k in message prompt body content; do
  V="$(printf '%s' "$PAYLOAD" | jq -r ".tool_input.${k} // empty")"
  if [ -n "$V" ]; then MESSAGE="$V"; break; fi
done
[ -n "$MESSAGE" ] || exit 0

# Anchor check: the first non-blank line must start with `[carry-forward]`.
FIRST_LINE="$(printf '%s' "$MESSAGE" | awk 'NF { print; exit }')"
case "$FIRST_LINE" in
  '[carry-forward]'*) exit 0 ;;
esac

RULES_PATH="${RULES_OVERRIDE:-$ROOT/adapters/claude/hooks/carry-forward-rules.yaml}"
RULE_TEXT="$(lookup_rule "$RULES_PATH" "$TARGET")"
if [ -z "$RULE_TEXT" ]; then
  RULE_TEXT="stay within your role's surface; never edit outside owned paths."
fi

block 'SendMessage continuation missing [carry-forward] anchor' \
  "Continuation to '$TARGET' lacks the leading [carry-forward] Remember: line required for warm-cardinal drift defence." \
  "Prepend a single line: '[carry-forward] Remember: ${RULE_TEXT}' then the continuation body. Format spec: core/protocols/dispatch-prompt-schema.md."
