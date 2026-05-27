#!/usr/bin/env bash
# ginee — UserPromptSubmit hook (T5 / #141, bash port). Mirrors .ps1 sibling.
# Spec: migrations/user-prompt-submit-hook.md. Requires: bash 4+, jq.

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
  grep -qE '^[[:space:]]+-[[:space:]]+user-prompt-submit-hook[[:space:]]*$' "$config"
}

# Parse keyword-triggers.yaml; emit one <label>\x1f<pattern>\x1f<context>\x1e per trigger.
parse_triggers() {
  local path="$1"
  [ -f "$path" ] || return 0
  awk '
    BEGIN { in_ctx = 0; pat = ""; lbl = ""; ctx = "" }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ {
      if (pat != "" && lbl != "") { printf "%s\x1f%s\x1f%s\x1e", lbl, pat, ctx }
      in_ctx = 0; pat = ""; lbl = ""; ctx = ""
      next
    }
    {
      if (in_ctx == 1) {
        if (match($0, /^  /)) {
          line = substr($0, 3)
          if (ctx == "") ctx = line; else ctx = ctx "\n" line
          next
        } else {
          in_ctx = 0
        }
      }
      if (match($0, /^pattern:[[:space:]]*\047(.*)\047[[:space:]]*$/, m)) {
        pat = m[1]
      } else if (match($0, /^pattern:[[:space:]]*(.*)$/, m)) {
        pat = m[1]; sub(/[[:space:]]+$/, "", pat)
      } else if (match($0, /^label:[[:space:]]*(.*)$/, m)) {
        lbl = m[1]; sub(/[[:space:]]+$/, "", lbl)
      } else if (match($0, /^context:[[:space:]]*\|[[:space:]]*$/)) {
        in_ctx = 1
      }
    }
    END {
      if (pat != "" && lbl != "") {
        printf "%s\x1f%s\x1f%s\x1e", lbl, pat, ctx
      }
    }
  ' "$path"
}

# --- main ---

PAYLOAD=""
if [ "${1:-}" = "--test-input" ] && [ -n "${2:-}" ]; then
  PAYLOAD="$2"
elif [ "${1:-}" = "--triggers-file" ] && [ -n "${2:-}" ] \
     && [ "${3:-}" = "--test-input" ] && [ -n "${4:-}" ]; then
  TRIGGERS_OVERRIDE="$2"
  PAYLOAD="$4"
else
  PAYLOAD="$(cat)"
fi

[ -n "$PAYLOAD" ] || exit 0

command -v jq >/dev/null 2>&1 || exit 0

PROMPT="$(printf '%s' "$PAYLOAD" | jq -r '.prompt // empty')"
[ -n "$PROMPT" ] || exit 0

ROOT="$(repo_root)"
[ -n "$ROOT" ] || exit 0

if is_opt_out "$ROOT"; then exit 0; fi

TRIGGERS_PATH="${TRIGGERS_OVERRIDE:-$ROOT/adapters/claude/hooks/keyword-triggers.yaml}"
[ -f "$TRIGGERS_PATH" ] || exit 0

RECORDS="$(parse_triggers "$TRIGGERS_PATH")"
[ -n "$RECORDS" ] || exit 0

INJECTIONS=""
# Split on RS (0x1e); each record has US (0x1f) separators.
OLD_IFS="$IFS"
IFS=$'\x1e'
for rec in $RECORDS; do
  [ -n "$rec" ] || continue
  IFS=$'\x1f' read -r LBL PAT CTX <<EOF
$rec
EOF
  IFS="$OLD_IFS"
  if [ -z "$LBL" ] || [ -z "$PAT" ]; then continue; fi
  # PCRE → POSIX-ERE for grep -E. YAML keeps .NET-compatible PCRE; translate here.
  EPAT="$PAT"
  EPAT="${EPAT//\\s/[[:space:]]}"
  EPAT="${EPAT//\\S/[^[:space:]]}"
  EPAT="${EPAT//\\d/[0-9]}"
  EPAT="${EPAT//\\D/[^0-9]}"
  EPAT="${EPAT//\\b/}"
  if printf '%s' "$PROMPT" | grep -qiE "$EPAT" 2>/dev/null; then
    if [ -z "$INJECTIONS" ]; then
      INJECTIONS="[ginee:context:$LBL]"$'\n'"$CTX"
    else
      INJECTIONS="$INJECTIONS"$'\n\n'"[ginee:context:$LBL]"$'\n'"$CTX"
    fi
  fi
done
IFS="$OLD_IFS"

[ -n "$INJECTIONS" ] || exit 0

# Emit hookSpecificOutput JSON.
printf '%s' "$INJECTIONS" | jq -Rs '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: .
  }
}'

exit 0
