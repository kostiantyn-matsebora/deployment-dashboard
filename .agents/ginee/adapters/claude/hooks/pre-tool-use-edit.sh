#!/usr/bin/env bash
# ginee compliance — PreToolUse hook on Edit / Write / MultiEdit (bash port).
# Mirrors adapters/claude/hooks/pre-tool-use-edit.ps1; see that file's header
# for the full spec of the 5 violation classes blocked here.
#
# Requires: bash 4+, jq (POSIX JSON parser).
# Bypass: SKIP_GINEE_COMPLIANCE=1 (emergency only).
# Opt out repo-wide: local/framework.config.yaml § compliance.disabled: [pretooluse-edit-hook].

set -u

if [ "${SKIP_GINEE_COMPLIANCE:-0}" = "1" ]; then exit 0; fi

# --- helpers ---

block() {
  local rule="$1"; local detail="$2"; local remediation="$3"
  printf '[ginee:gate] %s — %s\n' "$rule" "$detail" >&2
  printf '  Remediation: %s\n' "$remediation" >&2
  printf '  Bypass (emergency): SKIP_GINEE_COMPLIANCE=1\n' >&2
  printf '  Opt out repo-wide: local/framework.config.yaml § compliance.disabled: [pretooluse-edit-hook]\n' >&2
  exit 2
}

repo_root() {
  local r
  r="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  printf '%s' "$r"
}

is_opt_out() {
  local root="$1"
  local config="$root/local/framework.config.yaml"
  [ -f "$config" ] || return 1
  awk '
    /^compliance:/ { in_block=1; next }
    in_block && /^[^[:space:]]/ { in_block=0 }
    in_block && /^[[:space:]]+disabled:/ { in_disabled=1; next }
    in_disabled && /^[[:space:]]+-[[:space:]]+pretooluse-edit-hook[[:space:]]*$/ { found=1; exit }
    in_disabled && /^[[:space:]]+[^[:space:]-]/ { in_disabled=0 }
    END { exit (found ? 0 : 1) }
  ' "$config"
}

is_hotspec_path() {
  local p="$1"
  case "$p" in
    core/process.md) return 0 ;;
    core/process/*.md) return 0 ;;
    core/protocols/*.md) return 0 ;;
    core/roles/*.md) return 0 ;;
  esac
  return 1
}

has_frontmatter() {
  local content="$1"
  printf '%s' "$content" | head -1 | grep -qE '^---[[:space:]]*$'
}

cap_bytes_from_frontmatter() {
  local content="$1"
  printf '%s' "$content" | awk '
    /^---[[:space:]]*$/ { if (in_fm) exit; in_fm=1; next }
    in_fm && /^cap-bytes:[[:space:]]*[0-9]+[[:space:]]*$/ {
      sub(/^cap-bytes:[[:space:]]*/, "")
      sub(/[[:space:]]*$/, "")
      print
      exit
    }
  '
}

is_load_always() {
  local content="$1"
  printf '%s' "$content" | awk '
    /^---[[:space:]]*$/ { if (in_fm) exit; in_fm=1; next }
    in_fm && /^load:[[:space:]]*always[[:space:]]*$/ { found=1; exit }
    END { exit (found ? 0 : 1) }
  '
}

has_optimized_by_trailer_on_branch() {
  local root="$1"
  ( cd "$root" && git log --format='%B%n--END--' origin/main..HEAD 2>/dev/null \
    | grep -qE '^Optimized-By:[[:space:]]*ai-engineer[[:space:]]*$' )
}

# Extract bare D<N> tokens (D1..D999) introduced by an edit.
# Args: old_content new_content. Echoes newline-separated novel tokens.
new_d_tokens() {
  local old="$1"; local new="$2"
  comm -23 \
    <(printf '%s' "$new" | grep -oE '(^|[^A-Za-z0-9_-])D[0-9]{1,3}([^A-Za-z0-9_-]|$)' | grep -oE 'D[0-9]{1,3}' | sort -u) \
    <(printf '%s' "$old" | grep -oE '(^|[^A-Za-z0-9_-])D[0-9]{1,3}([^A-Za-z0-9_-]|$)' | grep -oE 'D[0-9]{1,3}' | sort -u)
}

has_rfc2119_modifier_in_added() {
  local added="$1"
  printf '%s' "$added" | grep -qiE '\b(always|never|binding|mandatory)\b'
}

# --- main ---

# Read payload from stdin (or --test-input for tests).
PAYLOAD=""
if [ "${1:-}" = "--test-input" ] && [ -n "${2:-}" ]; then
  PAYLOAD="$2"
else
  PAYLOAD="$(cat)"
fi

if [ -z "$PAYLOAD" ]; then exit 0; fi

# jq required for safe JSON parsing.
if ! command -v jq >/dev/null 2>&1; then
  printf '[ginee:gate] jq not on PATH — hook degraded to fail-open (install jq to enforce).\n' >&2
  exit 0
fi

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

# Compose proposed post-edit content.
OLD_CONTENT=""
NEW_CONTENT=""
case "$TOOL_NAME" in
  Write)
    NEW_CONTENT="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.content // ""')"
    [ -f "$FILE_PATH" ] && OLD_CONTENT="$(cat "$FILE_PATH")"
    ;;
  Edit)
    OLD_STR="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.old_string // ""')"
    NEW_STR="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.new_string // ""')"
    if [ -f "$FILE_PATH" ]; then
      OLD_CONTENT="$(cat "$FILE_PATH")"
      NEW_CONTENT="${OLD_CONTENT//${OLD_STR}/${NEW_STR}}"
    else
      NEW_CONTENT="$NEW_STR"
    fi
    ;;
  MultiEdit)
    if [ -f "$FILE_PATH" ]; then
      OLD_CONTENT="$(cat "$FILE_PATH")"
      NEW_CONTENT="$OLD_CONTENT"
    fi
    EDIT_COUNT="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.edits | length // 0')"
    i=0
    while [ "$i" -lt "$EDIT_COUNT" ]; do
      OLD_STR="$(printf '%s' "$PAYLOAD" | jq -r ".tool_input.edits[$i].old_string // \"\"")"
      NEW_STR="$(printf '%s' "$PAYLOAD" | jq -r ".tool_input.edits[$i].new_string // \"\"")"
      NEW_CONTENT="${NEW_CONTENT//${OLD_STR}/${NEW_STR}}"
      i=$((i+1))
    done
    ;;
esac

# --- Violation 1: hot-spec frontmatter required (D47) ---
if is_hotspec_path "$REL"; then
  if ! has_frontmatter "$NEW_CONTENT"; then
    block 'hot-spec frontmatter required (D47)' \
      "$REL is a hot-spec path; post-edit content is missing the required YAML frontmatter block." \
      'Add a 5-key frontmatter block per core/protocols/hot-spec-format.md before saving.'
  fi
fi

# --- Violation 3: D<N> token introduced on core/** (D42) ---
case "$REL" in
  core/*)
    NEW_TOKENS="$(new_d_tokens "$OLD_CONTENT" "$NEW_CONTENT")"
    if [ -n "$NEW_TOKENS" ]; then
      SAMPLE="$(printf '%s' "$NEW_TOKENS" | head -3 | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
      block 'D<N> token introduction blocked (D42)' \
        "$REL would introduce bare D-token(s): $SAMPLE. Runtime surface (core/**) MUST stay D-free." \
        'Cite the rule by location (file § section), not by D-number. New decisions log to PLAN.md only.'
    fi
    ;;
esac

# --- Violation 4: RFC 2119 modifier on added content (D48) ---
if [ -n "$OLD_CONTENT" ] && [ -n "$NEW_CONTENT" ]; then
  ADDED="$(diff <(printf '%s' "$OLD_CONTENT") <(printf '%s' "$NEW_CONTENT") | grep -E '^>' | sed 's/^> //' || true)"
elif [ -n "$NEW_CONTENT" ]; then
  ADDED="$NEW_CONTENT"
else
  ADDED=""
fi
# Strip YAML frontmatter from added body so `load: always` isn't a false hit.
ADDED="$(printf '%s\n' "$ADDED" | awk '
  /^---[[:space:]]*$/ {
    if (in_fm == 0) { in_fm = 1; next }
    if (in_fm == 1) { in_fm = 2; next }
  }
  in_fm == 2 || in_fm == 0 { print }
')"
if [ -n "$ADDED" ] && has_rfc2119_modifier_in_added "$ADDED"; then
  block 'RFC 2119 keyword convention (D48)' \
    "$REL introduces 'always' / 'never' / 'binding' / 'mandatory' as a rule modifier. Use MUST / MUST NOT / SHOULD / SHALL etc." \
    'Restate the rule with RFC 2119 keywords per core/protocols/rfc2119-keywords.md.'
fi

# --- Violation 2: cap-bytes exceeded without Optimized-By trailer ---
CAP="$(cap_bytes_from_frontmatter "$NEW_CONTENT")"
if [ -n "$CAP" ] && [ "$CAP" -gt 0 ]; then
  SIZE="$(printf '%s' "$NEW_CONTENT" | wc -c | awk '{print $1}')"
  if [ "$SIZE" -gt "$CAP" ]; then
    if ! has_optimized_by_trailer_on_branch "$ROOT"; then
      block 'cap-bytes exceeded without Optimized-By trailer (D44+D47)' \
        "$REL post-edit size $SIZE > cap-bytes $CAP; no commit on this branch carries Optimized-By: ai-engineer." \
        'Dispatch ai-engineer for a lossless optimization pass; commit with Optimized-By: ai-engineer trailer.'
    fi
  fi
fi

# --- Violation 5: always-loaded surface bloat without trailer (D21) ---
if [ -n "$OLD_CONTENT" ] && is_load_always "$NEW_CONTENT"; then
  OLD_LINES=$(printf '%s' "$OLD_CONTENT" | wc -l | awk '{print $1}')
  NEW_LINES=$(printf '%s' "$NEW_CONTENT" | wc -l | awk '{print $1}')
  DELTA=$((NEW_LINES - OLD_LINES))
  if [ "$DELTA" -gt 50 ]; then
    if ! has_optimized_by_trailer_on_branch "$ROOT"; then
      block 'always-loaded surface bloat without trailer (D21)' \
        "$REL grows by $DELTA lines and is always-loaded; no commit on this branch carries Optimized-By: ai-engineer." \
        'Trim to keep the always-loaded surface lean, OR dispatch ai-engineer + commit with Optimized-By: ai-engineer.'
    fi
  fi
fi

exit 0
