"""
PreToolUse(Bash) hook — enforces two Git guardrails:

  1. Single-integrator model: members never commit/push/PR from a linked
     worktree (integration happens only in the main worktree).
  2. Lazy branching: blocks `git commit` in detached HEAD, forcing a branch first.

Hook I/O contract:
  - Reads a JSON payload from stdin (`tool_input.command`).
  - On a block decision, prints compact JSON {"decision": "block", "reason": ...}
    to stdout and exits 0.
  - On no-op, exits 0 silently.
  - Invalid / missing stdin is a no-op (exit 0).
"""

import json
import re
import subprocess
import sys

# ---------------------------------------------------------------------------
# Default git runner — injected as a callable so tests can pass a fake.
# Runs git with the given argv list, suppresses stderr, returns the first line
# trimmed (mirrors `... | Select-Object -First 1` in the PowerShell original).
# ---------------------------------------------------------------------------

def git_runner(argv: list[str]) -> str:
    """Run git with argv, return first output line trimmed (stderr suppressed)."""
    result = subprocess.run(
        ["git", *argv],
        capture_output=True,
        text=True,
    )
    first_line = result.stdout.splitlines()[0] if result.stdout.strip() else ""
    return first_line.strip()


# ---------------------------------------------------------------------------
# Pure predicate functions — direct ports of the PowerShell Test-* functions.
# ---------------------------------------------------------------------------

def is_git_commit_command(command: str) -> bool:
    """Return True when command matches `git … commit …`."""
    return bool(re.search(r"\bgit\b.*\bcommit\b", command))


def is_git_push_command(command: str) -> bool:
    """Return True when command matches `git … push …`."""
    return bool(re.search(r"\bgit\b.*\bpush\b", command))


def is_pr_create_command(command: str) -> bool:
    """Return True when command matches `gh … pr … create …`."""
    return bool(re.search(r"\bgh\b.*\bpr\b.*\bcreate\b", command))


def is_detached_head(runner=git_runner) -> bool:
    """Return True when the current HEAD is detached (first line == 'HEAD')."""
    raw = runner(["rev-parse", "--abbrev-ref", "HEAD"])
    return raw == "HEAD"


def is_linked_worktree(runner=git_runner) -> bool:
    """
    Return True when the current worktree is a linked (member) worktree.

    A linked worktree has --git-dir != --git-common-dir.
    The main/integration worktree has them equal.
    Returns False when either value is empty (mirrors the PowerShell guard).
    """
    git_dir = runner(["rev-parse", "--git-dir"])
    common_dir = runner(["rev-parse", "--git-common-dir"])
    if not git_dir or not common_dir:
        return False
    return git_dir != common_dir


# ---------------------------------------------------------------------------
# Decision function — port of Get-BranchGuardDecision.
# Returns {"block": bool} or {"block": True, "reason": str}.
# ---------------------------------------------------------------------------

def get_branch_guard_decision(command: str, runner=git_runner) -> dict:
    """
    Evaluate the two branch guardrails and return a decision dict.

    {"block": False}                       — allow
    {"block": True, "reason": "<string>"}  — deny
    """
    is_commit = is_git_commit_command(command)
    is_push = is_git_push_command(command)
    is_pr = is_pr_create_command(command)

    if not (is_commit or is_push or is_pr):
        return {"block": False}

    # (1) Single-integrator model — no integration ops from a member worktree.
    if is_linked_worktree(runner):
        return {
            "block": True,
            "reason": (
                "Single-integrator model: members never commit/push/PR from a worktree. "
                "Hand your changes back to the lead via RESULT — integration happens only "
                "in the main worktree."
            ),
        }

    # (2) Lazy branching — no commit in detached HEAD.
    if is_commit and is_detached_head(runner):
        return {
            "block": True,
            "reason": (
                "HEAD is detached. Create a branch first: "
                "git checkout -b <descriptive-name>, then commit."
            ),
        }

    return {"block": False}


# ---------------------------------------------------------------------------
# Hook entry point — stdin JSON → decision → stdout + exit 0.
# ---------------------------------------------------------------------------

def read_payload() -> dict:
    """Read stdin JSON payload; return {} on empty / non-redirected / invalid."""
    if sys.stdin.isatty():
        return {}
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {}


def main() -> None:
    payload = read_payload()

    command = ""
    try:
        tool_input = payload.get("tool_input") or {}
        command = str(tool_input.get("command") or "")
    except (AttributeError, TypeError):
        command = ""

    decision = get_branch_guard_decision(command)

    if decision["block"]:
        print(json.dumps({"decision": "block", "reason": decision["reason"]}, separators=(",", ":")))

    sys.exit(0)


if __name__ == "__main__":
    main()
