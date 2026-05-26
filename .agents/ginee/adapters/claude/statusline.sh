#!/usr/bin/env bash
# ginee compliance — Claude Code statusline (T4, bash port).
# Mirrors adapters/claude/statusline.ps1; see that file's header for the full
# field spec. Outputs a single line (≤ 100 chars) to stdout summarising
# compliance state for the current repo + branch.
#
# Requires: bash 4+. jq optional (used only to consume stdin without parsing).
# Opt out: local/framework.config.yaml § compliance.disabled: [compliance-statusline].

set -u

# shellcheck disable=SC2317
emit_bare() {
  printf '%s' '[ginee]'
  exit 0
}

# Statusline MUST NOT crash the host — wrap with a trap that prints bare.
trap 'emit_bare' ERR

# Consume stdin even if we don't use it (avoid SIGPIPE upstream).
cat >/dev/null 2>&1 || true

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || true
}

is_opt_out() {
  local root="$1"
  local config="$root/local/framework.config.yaml"
  [ -f "$config" ] || return 1
  grep -q '^compliance:[[:space:]]*$' "$config" || return 1
  grep -qE '^[[:space:]]+-[[:space:]]+compliance-statusline[[:space:]]*$' "$config"
}

current_branch() {
  git rev-parse --abbrev-ref HEAD 2>/dev/null || true
}

issue_from_branch() {
  local branch="$1"
  # Pattern 1: explicit `#N`.
  local n
  n="$(printf '%s' "$branch" | grep -oE '#[0-9]+' | head -1)"
  if [ -n "$n" ]; then printf '%s' "${n#\#}"; return; fi
  # Pattern 2: `t<N>` after a `/`.
  n="$(printf '%s' "$branch" | grep -oE '/[tT][0-9]+' | head -1 | grep -oE '[0-9]+')"
  if [ -n "$n" ]; then printf '%s' "$n"; return; fi
}

has_optimized_by_trailer() {
  local root="$1"
  ( cd "$root" && git log --format='%B%n--END--' origin/main..HEAD 2>/dev/null \
    | grep -qE '^Optimized-By:[[:space:]]*ai-engineer[[:space:]]*$' )
}

min_cap_headroom_percent() {
  local root="$1"
  local min=""
  local file
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    [ -f "$root/$file" ] || continue
    case "$file" in
      core/process.md|core/process/*.md|core/protocols/*.md|core/roles/*.md) ;;
      *) continue ;;
    esac
    local cap
    cap="$(awk '
      /^---[[:space:]]*$/ { if (in_fm) exit; in_fm=1; next }
      in_fm && /^cap-bytes:[[:space:]]*[0-9]+[[:space:]]*$/ {
        sub(/^cap-bytes:[[:space:]]*/, "")
        sub(/[[:space:]]*$/, "")
        print
        exit
      }
    ' "$root/$file")"
    if [ -z "$cap" ] || [ "$cap" -le 0 ]; then continue; fi
    local size
    size="$(wc -c < "$root/$file" | awk '{print $1}')"
    local headroom=$(( (cap - size) * 100 / cap ))
    if [ -z "$min" ] || [ "$headroom" -lt "$min" ]; then
      min="$headroom"
    fi
  done < <( ( cd "$root" && git diff --name-only origin/main..HEAD 2>/dev/null ) )
  if [ -n "$min" ]; then printf '%s' "$min"; fi
}

# --- main ---

ROOT="$(repo_root)"
if [ -z "$ROOT" ]; then
  printf '%s' '[ginee] (no repo)'
  exit 0
fi
[ -e "$ROOT/.git" ] || { printf '%s' '[ginee] (no repo)'; exit 0; }

if is_opt_out "$ROOT"; then exit 0; fi

BRANCH="$(current_branch)"
ISSUE="$(issue_from_branch "$BRANCH")"

parts="[ginee]"
if [ -n "$ISSUE" ]; then
  parts="$parts · #$ISSUE"
elif [ -n "$BRANCH" ]; then
  parts="$parts · $BRANCH"
fi

parts="$parts · phase: ?"
parts="$parts · warm: ?"

if has_optimized_by_trailer "$ROOT"; then
  parts="$parts · trailer: ok"
else
  parts="$parts · trailer: needed"
fi

CAP="$(min_cap_headroom_percent "$ROOT")"
if [ -n "$CAP" ]; then
  parts="$parts · cap: ${CAP}%"
fi

# Truncate to 100 chars defensively.
if [ "${#parts}" -gt 100 ]; then
  parts="${parts:0:99}…"
fi

printf '%s' "$parts"
exit 0
