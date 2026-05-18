#!/usr/bin/env bash
# migrate-engineering-team-to-ginee.sh
#
# One-shot rename migration for adopters upgrading past the D11 rebrand
# (engineering-team -> ginee). Rewrites textual 'engineering-team' references
# in adopter-owned local/* files. Install-dir rename + CLAUDE.md pointer-block
# refresh are handled by install.sh / install.ps1 -UpdateOnly — this script
# only handles the local/* surface the installer cannot touch by design.
#
# Idempotent: re-running on a clean tree is a no-op.
#
# Usage:
#   .agents/ginee/core/scripts/migrate-engineering-team-to-ginee.sh [--dry-run]
#
# Run from anywhere — script auto-resolves local/ relative to its own location.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_DIR="$SCRIPT_DIR/../../local"

DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//' | head -n -1
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ ! -d "$LOCAL_DIR" ]; then
  echo "ERROR: local/ not found at $LOCAL_DIR" >&2
  echo "Run after the installer's --update-only pass (or pre-rebrand: from inside .agents/engineering-team/)." >&2
  exit 1
fi
LOCAL_DIR="$(cd "$LOCAL_DIR" && pwd)"

echo "ginee rename migration"
echo "  Scanning : $LOCAL_DIR"
if [ $DRY_RUN -eq 1 ]; then
  echo "  Mode     : dry-run (no writes)"
else
  echo "  Mode     : in-place rewrite"
fi
echo ""

FILES="$(grep -rlF 'engineering-team' "$LOCAL_DIR" 2>/dev/null || true)"

if [ -z "$FILES" ]; then
  echo "No stale 'engineering-team' references found. local/ is clean."
  exit 0
fi

TOTAL_FILES=0
TOTAL_HITS=0

while IFS= read -r file; do
  [ -z "$file" ] && continue
  # Defensive: skip binaries
  if command -v file >/dev/null 2>&1 && file "$file" 2>/dev/null | grep -q 'binary'; then
    echo "  SKIP (binary): $file"
    continue
  fi
  hits=$(grep -cF 'engineering-team' "$file" || true)
  TOTAL_FILES=$((TOTAL_FILES + 1))
  TOTAL_HITS=$((TOTAL_HITS + hits))
  rel="${file#"$LOCAL_DIR"/}"
  printf "  %3d hit(s)  %s\n" "$hits" "$rel"
  if [ $DRY_RUN -eq 0 ]; then
    tmp="$(mktemp)"
    sed 's|engineering-team|ginee|g' "$file" > "$tmp"
    # Preserve original mode
    chmod --reference="$file" "$tmp" 2>/dev/null || true
    mv "$tmp" "$file"
  fi
done <<EOF
$FILES
EOF

echo ""
if [ $DRY_RUN -eq 1 ]; then
  echo "Summary: $TOTAL_HITS hit(s) across $TOTAL_FILES file(s) (dry-run; nothing written)"
else
  echo "Summary: $TOTAL_HITS hit(s) across $TOTAL_FILES file(s) rewritten"
fi
echo ""
echo "GitHub-side prerequisites (adopter-owned — not handled here):"
echo "  - Confirm the renamed framework repo + labels:"
echo "      gh repo view kostiantyn-matsebora/ginee"
echo "      gh label list -R kostiantyn-matsebora/ginee | grep '^ginee:'"
echo "  - On your primary repo, mirror the label rename if you use the same scheme:"
echo "      gh label edit engineering-team:ready -n ginee:ready -R <owner>/<repo>"
echo "      gh label edit engineering-team:in-progress -n ginee:in-progress -R <owner>/<repo>"
echo "      gh label edit engineering-team:blocked -n ginee:blocked -R <owner>/<repo>"
echo ""
echo "Done."
