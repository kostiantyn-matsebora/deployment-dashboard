"""
Reads all active team-process sessions and emits a one-line status string for
the Claude Code statusbar.

Output rules:
  - Zero active sessions  -> emit nothing (empty stdout = no status to Claude Code).
  - Exactly one session   -> emit
      "team: <id> - <summary> (<phase>) | <role>: <task>, <role>: <task>"
    where <summary> and the agent digest are appended only when present;
    phase defaults to "?".
  - Two or more sessions  -> show the CURRENT run's detail plus "(+N other)"; fall back
    to "teams (N active)" when the current run can't be resolved.

Resolving the CURRENT run among many (in precedence order):
  1. claudeSessionId — the record owned by the current Claude session_id (read from
     the statusLine stdin payload). UNIQUE even when several runs share a branch.
  2. branch — the record whose `branch` == the checked-out branch.
  3. otherwise -> "teams (N active)".

ASCII separators only ('-' and '|') — the statusline goes to a terminal and must not
trip console encoding.

Stdin contract: Claude Code pipes a JSON payload with {"session_id": "..."} for the
statusLine command. Reads from stdin only when not a tty.

Usage:
    python3 scripts/statusline/show_status_line.py
"""

import json
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Session-discovery helpers (inlined from Invoke-TeamModeGuard.ps1)
# These are self-contained here so the script is invocable by absolute path.
# ---------------------------------------------------------------------------


def _get_sessions_dir(root: str) -> Path:
    return Path(root) / ".team-process" / "sessions"


def _get_legacy_session_file(root: str) -> Path:
    return Path(root) / ".team-process" / "session.json"


def read_session_record(path: str) -> dict | None:
    """
    Parse a session record from disk. Returns None if missing or unparseable.
    """
    p = Path(path)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None


def get_active_session_files(root: str) -> list[str]:
    """
    All active session record paths: every sessions/<id>/session.json
    plus a legacy session.json if present.
    """
    files: list[str] = []
    sessions_dir = _get_sessions_dir(root)
    if sessions_dir.is_dir():
        for child in sorted(sessions_dir.iterdir()):
            if child.is_dir():
                candidate = child / "session.json"
                if candidate.exists():
                    files.append(str(candidate))
    legacy = _get_legacy_session_file(root)
    if legacy.exists():
        files.append(str(legacy))
    return files


# ---------------------------------------------------------------------------
# Pure functions (fully unit-tested)
# ---------------------------------------------------------------------------


def get_active_sessions(root: str) -> list[dict]:
    """
    Returns a list of parsed session objects for all active sessions under root.
    Ignores unreadable / malformed files silently.
    """
    sessions: list[dict] = []
    for f in get_active_session_files(root):
        record = read_session_record(f)
        if record is not None:
            sessions.append(record)
    return sessions


def limit_text(text: str, max_len: int) -> str:
    """
    Truncate to keep the statusline from running away; appends a single '.'
    ellipsis (ASCII).
    """
    t = str(text) if text is not None else ""
    if max_len > 0 and len(t) > max_len:
        return t[: max(1, max_len - 1)].rstrip() + "."
    return t


def format_agent_digest(record: dict, max_task: int = 24) -> str:
    """
    "role: task, role: task" from the roster (task truncated). Falls back to
    the bare role when a member has no task yet. '' when there is no roster.
    """
    roster = record.get("roster")
    if not roster:
        return ""
    parts = []
    for member in roster:
        role = str(member.get("role") or "?")
        task_raw = member.get("task")
        task = limit_text(str(task_raw), max_task) if task_raw else ""
        parts.append(f"{role}: {task}" if task else role)
    return ", ".join(parts)


def format_session_detail(record: dict) -> str:
    """
    One session's full detail line: "team: <id> - <summary> (<phase>) | <agent digest>".
    Summary and the agent digest are appended only when present.
    """
    id_ = str(record.get("id") or "unknown")
    phase = str(record.get("phase") or "?")
    summary_raw = record.get("summary")
    summary = (" - " + limit_text(str(summary_raw), 48)) if summary_raw else ""
    line = f"team: {id_}{summary} ({phase})"
    agents = format_agent_digest(record)
    if agents:
        line += f" | {agents}"
    return line


def get_status_line(
    sessions: list[dict],
    current_branch: str = "",
    current_session_id: str = "",
) -> str:
    """
    Returns the status string for the active sessions.

    - none      -> '' (empty).
    - one       -> that session's detail line.
    - many      -> the CURRENT run detailed + "(+N other)". "Current" is resolved by
                   claudeSessionId first (unique), then branch (heuristic); falls back to
                   "teams (N active)" when neither resolves a single record.
    """
    s = list(sessions)
    n = len(s)

    if n == 0:
        return ""
    if n == 1:
        return format_session_detail(s[0])

    # Multi-session: surface the run the user is actually in.
    # Try the unique key first (the owning Claude session_id), then fall back to
    # the checked-out branch heuristic.
    for key_value, prop in [
        (current_session_id, "claudeSessionId"),
        (current_branch, "branch"),
    ]:
        if not key_value or not key_value.strip():
            continue
        hits = [r for r in s if r.get(prop) and str(r[prop]) == key_value]
        if len(hits) == 1:
            return format_session_detail(hits[0]) + f" (+{n - 1} other)"

    return f"teams ({n} active)"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _read_stdin_payload() -> dict:
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
    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if result.returncode == 0 and result.stdout.strip():
        root = result.stdout.strip().splitlines()[0].strip()
    else:
        # Fallback: two levels up from this script's directory
        root = str(Path(__file__).resolve().parent.parent)

    # Claude Code pipes a JSON payload to the statusLine command on stdin;
    # session_id is the unique key for "which run is this session in" when
    # several are active.
    payload = _read_stdin_payload()
    session_id = str(payload.get("session_id") or "")

    # The checked-out branch is the fallback disambiguator.
    branch_result = subprocess.run(
        ["git", "-C", root, "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
    )
    branch = branch_result.stdout.strip().splitlines()[0].strip() if branch_result.stdout.strip() else ""

    sessions = get_active_sessions(root)
    line = get_status_line(sessions, current_branch=branch, current_session_id=session_id)
    if line.strip():
        print(line)


if __name__ == "__main__":
    main()
