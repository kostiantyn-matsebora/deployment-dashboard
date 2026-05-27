#!/usr/bin/env bash
# ginee — SessionStart hook (T12 / #148, bash port). Mirrors .ps1 sibling.
# Spec: migrations/session-start-hook.md. Requires: bash 4+, jq, git.

set -u
[ "${SKIP_GINEE_COMPLIANCE:-0}" = "1" ] && exit 0

NO_GH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --test-input) shift; PAYLOAD_OVERRIDE="${1:-}"; shift || true ;;
    --repo-root)  shift; ROOT_OVERRIDE="${1:-}"; shift || true ;;
    --no-gh)      NO_GH=1; shift ;;
    *) shift ;;
  esac
done

[ -z "${PAYLOAD_OVERRIDE:-}" ] && cat >/dev/null 2>&1
command -v jq >/dev/null 2>&1 || exit 0

ROOT="${ROOT_OVERRIDE:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -n "$ROOT" ] || exit 0

CFG="$ROOT/local/framework.config.yaml"
if [ -f "$CFG" ] && grep -q '^compliance:[[:space:]]*$' "$CFG" \
   && grep -qE '^[[:space:]]+-[[:space:]]+session-start-hook[[:space:]]*$' "$CFG"; then
  exit 0
fi

LINES=""
add() { LINES="${LINES:+$LINES$'\n'}$1"; }

# SC2015 carve-out: `... 2>/dev/null || true` is the idiomatic fail-open guard
# under set -u here — capturing whatever stdout the command produced (possibly
# empty) without aborting the script on non-zero exit. shellcheck flags the
# pattern broadly but the intent is exactly "swallow failure, keep going".

# Branch scan — only on issue/<N>-... branches.
# shellcheck disable=SC2015
BRANCH="$(cd "$ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if printf '%s' "$BRANCH" | grep -qE '^issue/[0-9]+'; then
  # shellcheck disable=SC2015
  RL="$(cd "$ROOT" && git rev-list --count --left-right "origin/main...HEAD" 2>/dev/null || true)"
  AHEAD="$(printf '%s' "$RL" | awk '{print $2+0}')"
  # shellcheck disable=SC2015
  ST="$(cd "$ROOT" && git status --porcelain 2>/dev/null || true)"
  DIRTY=""; [ -n "$ST" ] && DIRTY=" · uncommitted changes"
  add "branch: ${BRANCH} — ${AHEAD:-0} ahead of origin/main${DIRTY}"
fi

# Issue scan — gh-backed; offline-safe.
if [ "$NO_GH" = "0" ] && command -v gh >/dev/null 2>&1; then
  # shellcheck disable=SC2015
  ISSUE_JSON="$(cd "$ROOT" && gh issue list --label ginee:in-progress --json number,title,labels --limit 20 2>/dev/null || true)"
  if [ -n "$ISSUE_JSON" ] && [ "$ISSUE_JSON" != "[]" ]; then
    HEADER=1
    while IFS= read -r row; do
      [ -n "$row" ] || continue
      [ "$HEADER" = "1" ] && add "open ginee:in-progress issues:" && HEADER=0
      add "  $row"
    done < <(printf '%s' "$ISSUE_JSON" | jq -r '.[] |
      ( [ .labels[].name | select(test("^ginee:phase-")) ][0] // "" ) as $plabel
      | (if $plabel != "" then $plabel | sub("ginee:phase-"; " · phase ") else "" end) as $tag
      | "- #\(.number)\($tag) — \(.title)"' 2>/dev/null)
  fi
fi

[ -n "$LINES" ] || exit 0

printf '[ginee:resume]\n%s' "$LINES" | jq -Rs '{
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: . }
}'
exit 0
