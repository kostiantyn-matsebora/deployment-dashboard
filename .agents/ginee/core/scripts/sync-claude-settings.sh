#!/usr/bin/env bash
# ginee installer hook — idempotently merge compliance-playbook entries into
# the adopter's .claude/settings.json (bash port).
#
# Mirrors core/scripts/sync-claude-settings.ps1; see that script's header for
# the full contract (Tier 1 entries: T2 / T3 / T4; Tier 2: T5 / T6 / T7 / T8).
#
# Usage:
#   sync-claude-settings.sh --target <project-root> [--framework-rel <path>]
#
# Requires: jq. Without jq we surface a warning and skip the merge so the
# installer can still complete — adopter applies the snippet manually per
# adapters/claude/install.md § Compliance hooks.

set -eu

TARGET=""
FRAMEWORK_REL=".agents/ginee"

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --framework-rel) FRAMEWORK_REL="$2"; shift 2 ;;
    *) echo "sync-claude-settings: unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "sync-claude-settings: --target is required" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "sync-claude-settings: jq not on PATH — leaving .claude/settings.json untouched." >&2
  echo "  Install jq, then run /ginee-update again, OR apply the snippet manually per" >&2
  echo "  adapters/claude/install.md § Compliance hooks." >&2
  exit 0
fi

CLAUDE_DIR="$TARGET/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"

EDIT_HOOK_CMD="pwsh -NoProfile -File $FRAMEWORK_REL/adapters/claude/hooks/pre-tool-use-edit.ps1"
BASH_HOOK_CMD="pwsh -NoProfile -File $FRAMEWORK_REL/adapters/claude/hooks/pre-tool-use-bash.ps1"
SENDMSG_HOOK_CMD="pwsh -NoProfile -File $FRAMEWORK_REL/adapters/claude/hooks/pre-tool-use-send-message.ps1"
POSTEDIT_HOOK_CMD="pwsh -NoProfile -File $FRAMEWORK_REL/adapters/claude/hooks/post-tool-use-edit.ps1"
UPSH_HOOK_CMD="pwsh -NoProfile -File $FRAMEWORK_REL/adapters/claude/hooks/user-prompt-submit.ps1"
STOP_HOOK_CMD="pwsh -NoProfile -File $FRAMEWORK_REL/adapters/claude/hooks/stop.ps1"
SESSION_START_CMD="pwsh -NoProfile -File $FRAMEWORK_REL/adapters/claude/hooks/session-start.ps1"
ATTEST_OB_CMD="pwsh -NoProfile -File $FRAMEWORK_REL/adapters/claude/hooks/attest-optimized-by.ps1"
STATUSLINE_CMD="pwsh -NoProfile -File $FRAMEWORK_REL/adapters/claude/statusline.ps1"

EDIT_HOOK_MARKER="adapters/claude/hooks/pre-tool-use-edit"
BASH_HOOK_MARKER="adapters/claude/hooks/pre-tool-use-bash"
SENDMSG_HOOK_MARKER="adapters/claude/hooks/pre-tool-use-send-message"
POSTEDIT_HOOK_MARKER="adapters/claude/hooks/post-tool-use-edit"
UPSH_HOOK_MARKER="adapters/claude/hooks/user-prompt-submit"
STOP_HOOK_MARKER="adapters/claude/hooks/stop"
SESSION_START_MARKER="adapters/claude/hooks/session-start"
ATTEST_OB_MARKER="adapters/claude/hooks/attest-optimized-by"
STATUSLINE_MARKER="adapters/claude/statusline"

mkdir -p "$CLAUDE_DIR"

if [ -f "$SETTINGS" ]; then
  if ! jq empty "$SETTINGS" 2>/dev/null; then
    echo "sync-claude-settings: settings.json: failed to parse — leaving file untouched." >&2
    echo "  Manual merge required per adapters/claude/install.md § Compliance hooks." >&2
    exit 0
  fi
  CURRENT="$(cat "$SETTINGS")"
else
  CURRENT='{}'
fi

ORIGINAL="$CURRENT"

# --- statusLine (T4) ---
HAS_STATUSLINE="$(printf '%s' "$CURRENT" | jq 'has("statusLine")')"
if [ "$HAS_STATUSLINE" = "false" ]; then
  CURRENT="$(printf '%s' "$CURRENT" | jq --arg cmd "$STATUSLINE_CMD" \
    '.statusLine = { type: "command", command: $cmd }')"
else
  EXISTING_STATUSLINE_CMD="$(printf '%s' "$CURRENT" | jq -r '.statusLine.command // ""')"
  case "$EXISTING_STATUSLINE_CMD" in
    *"$STATUSLINE_MARKER"*)
      CURRENT="$(printf '%s' "$CURRENT" | jq --arg cmd "$STATUSLINE_CMD" \
        '.statusLine.command = $cmd')"
      ;;
    *) ;;
  esac
fi

# --- hooks scaffolding ---
CURRENT="$(printf '%s' "$CURRENT" | jq '
  if has("hooks") | not then .hooks = {} else . end
  | if .hooks | has("PreToolUse")        | not then .hooks.PreToolUse = []        else . end
  | if .hooks | has("PostToolUse")       | not then .hooks.PostToolUse = []       else . end
  | if .hooks | has("UserPromptSubmit")  | not then .hooks.UserPromptSubmit = []  else . end
  | if .hooks | has("Stop")              | not then .hooks.Stop = []              else . end
  | if .hooks | has("SessionStart")      | not then .hooks.SessionStart = []      else . end
')"

# Add a top-level entry under .hooks[event] (matcher optional).
add_entry() {
  local event="$1"; local marker="$2"; local matcher="$3"; local cmd="$4"; local timeout="${5:-10}"
  local found
  found="$(printf '%s' "$CURRENT" | jq --arg event "$event" --arg m "$marker" '
    [.hooks[$event][]? | .hooks[]? | .command // "" | select(contains($m))] | length > 0
  ')"
  if [ "$found" = "true" ]; then return 0; fi
  if [ -n "$matcher" ]; then
    CURRENT="$(printf '%s' "$CURRENT" | jq --arg event "$event" \
      --arg matcher "$matcher" --arg cmd "$cmd" --argjson timeout "$timeout" '
      .hooks[$event] += [{
        matcher: $matcher,
        hooks: [{ type: "command", command: $cmd, timeout: $timeout }]
      }]')"
  else
    CURRENT="$(printf '%s' "$CURRENT" | jq --arg event "$event" \
      --arg cmd "$cmd" --argjson timeout "$timeout" '
      .hooks[$event] += [{
        hooks: [{ type: "command", command: $cmd, timeout: $timeout }]
      }]')"
  fi
}

# PreToolUse — T2, T3, T8, T13.
add_entry "PreToolUse" "$EDIT_HOOK_MARKER"    "Edit|Write|MultiEdit" "$EDIT_HOOK_CMD"
add_entry "PreToolUse" "$BASH_HOOK_MARKER"    "Bash"                  "$BASH_HOOK_CMD"
add_entry "PreToolUse" "$SENDMSG_HOOK_MARKER" "SendMessage"           "$SENDMSG_HOOK_CMD"
add_entry "PreToolUse" "$ATTEST_OB_MARKER"    "Bash"                  "$ATTEST_OB_CMD"

# PostToolUse — T6 only (framework-self-dev context-economy-check.ps1 is not
# wired in adopter installs: scripts/ is pruned + the gate is framework-only).
add_entry "PostToolUse" "$POSTEDIT_HOOK_MARKER" "Edit|Write|MultiEdit" "$POSTEDIT_HOOK_CMD"

# UserPromptSubmit — T5.
add_entry "UserPromptSubmit" "$UPSH_HOOK_MARKER" "" "$UPSH_HOOK_CMD"

# Stop — T7.
add_entry "Stop" "$STOP_HOOK_MARKER" "" "$STOP_HOOK_CMD"

# SessionStart — T12 / #148.
add_entry "SessionStart" "$SESSION_START_MARKER" "" "$SESSION_START_CMD"

# --- Main-thread permission lockdown (T11 / #147) ---
# Honours per-tactic opt-out: local/framework.config.yaml § compliance.disabled: [main-thread-permissions]
MAIN_THREAD_OPTOUT=0
CFG="$TARGET/local/framework.config.yaml"
if [ -f "$CFG" ]; then
  if grep -q '^compliance:[[:space:]]*$' "$CFG" && \
     grep -qE '^[[:space:]]+-[[:space:]]+main-thread-permissions[[:space:]]*$' "$CFG"; then
    MAIN_THREAD_OPTOUT=1
  fi
fi

if [ "$MAIN_THREAD_OPTOUT" = "0" ]; then
  CURRENT="$(printf '%s' "$CURRENT" | jq '
    if has("permissions") | not then .permissions = {} else . end
    | if .permissions | type != "object" then .permissions = {} else . end
    | if .permissions | has("deny") | not then .permissions.deny = [] else . end
  ')"
  # Idempotent merge — only append rules not already present.
  GINEE_DENY_RULES=(
    "Edit($FRAMEWORK_REL/core/**)"
    "Edit($FRAMEWORK_REL/adapters/**)"
    "Edit($FRAMEWORK_REL/extras/**)"
    "Write($FRAMEWORK_REL/core/**)"
    "Write($FRAMEWORK_REL/adapters/**)"
    "Write($FRAMEWORK_REL/extras/**)"
    "MultiEdit($FRAMEWORK_REL/core/**)"
    "MultiEdit($FRAMEWORK_REL/adapters/**)"
    "MultiEdit($FRAMEWORK_REL/extras/**)"
    "Bash(rm -rf:*)"
    "Bash(git push --force:*)"
    "Bash(git push -f:*)"
    "Bash(git reset --hard:*)"
  )
  for rule in "${GINEE_DENY_RULES[@]}"; do
    CURRENT="$(printf '%s' "$CURRENT" | jq --arg r "$rule" '
      if .permissions.deny | index($r) then . else .permissions.deny += [$r] end
    ')"
  done
fi

# --- Persist if changed ---
if [ "$CURRENT" = "$ORIGINAL" ]; then
  echo ".claude/settings.json already current — no change"
else
  printf '%s\n' "$CURRENT" | jq '.' > "$SETTINGS"
  echo "Synced .claude/settings.json (statusLine + PreToolUse/PostToolUse/UserPromptSubmit/Stop hooks)"
fi
