"""
PreToolUse(Edit|Write|MultiEdit|NotebookEdit) hook — enforces the "stay in your
lane" rule. If the worktree root holds a `.team-process/lane` file (written by
the lead when a member is spawned), edits are allowed only to paths matching one
of its globs. No lane file (e.g. the lead's main worktree) -> no restriction.

`.team-process/lane` format: one glob per line; blank lines and `#` comments ignored.
Globs: `*` = within a path segment, `**` = across segments, `?` = one char.

Hook I/O contract:
  - Reads a JSON payload from stdin (`tool_input.file_path`).
  - On a block decision, prints compact JSON {"decision": "block", "reason": ...}
    to stdout and exits 0.
  - On no-op, exits 0 silently.
  - Invalid / missing stdin is a no-op (exit 0).
"""

import json
import os
import re
import subprocess
import sys

# ---------------------------------------------------------------------------
# Default collaborators — injected as callables so tests can pass fakes.
# ---------------------------------------------------------------------------

def git_root_resolver() -> str:
    """Return the git repo root, falling back to cwd on failure."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
    )
    line = result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""
    return line.strip() if line.strip() else os.getcwd()


def lane_file_reader(path: str) -> list[str] | None:
    """Return lines from the lane file, or None if it doesn't exist."""
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read().splitlines()
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Pure helper functions.
# ---------------------------------------------------------------------------

def convert_from_lane_glob(glob: str) -> str:
    """
    Convert a lane glob string to a regex pattern.

    Glob rules:
      **  -> .* (matches across path segments)
      *   -> [^/]* (matches within one segment)
      ?   -> [^/] (matches one char, not a slash)
      all other chars -> regex-escaped literal
    """
    g = glob.strip().replace("\\", "/")
    parts = ["^"]
    i = 0
    while i < len(g):
        ch = g[i]
        if ch == "*":
            if i + 1 < len(g) and g[i + 1] == "*":
                parts.append(".*")
                i += 2
                continue
            parts.append("[^/]*")
            i += 1
            continue
        if ch == "?":
            parts.append("[^/]")
            i += 1
            continue
        parts.append(re.escape(ch))
        i += 1
    parts.append("$")
    return "".join(parts)


def get_active_lanes(lines: list[str]) -> list[str]:
    """Filter lane file lines: drop blanks and `#` comments, strip whitespace."""
    result = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            result.append(stripped)
    return result


def path_in_lanes(rel_path: str, lanes: list[str]) -> bool:
    """Return True if rel_path matches any of the lane globs."""
    p = rel_path.replace("\\", "/")
    if p.startswith("./"):
        p = p[2:]
    for lane in lanes:
        rx = convert_from_lane_glob(lane)
        if re.search(rx, p):
            return True
    return False


def get_relative_path(full_path: str, root: str) -> str:
    """
    Strip the root prefix from full_path and return the relative portion.
    Case-insensitive comparison (mirrors PowerShell OrdinalIgnoreCase).
    Returns full_path (normalized slashes) when outside root.
    """
    f = full_path.replace("\\", "/")
    r = root.replace("\\", "/").rstrip("/")
    prefix = r + "/"
    if f.lower().startswith(prefix.lower()):
        return f[len(prefix):]
    return f


def path_is_outbox(rel_path: str) -> bool:
    r"""
    Return True when rel_path is inside a session outbox.
    Matches `(^|/)\.team-process/sessions/[^/]+/outbox/`.
    """
    p = rel_path.replace("\\", "/")
    if p.startswith("./"):
        p = p[2:]
    return bool(re.search(r"(^|/)\.team-process/sessions/[^/]+/outbox/", p))


def path_has_dot_dot(rel_path: str) -> bool:
    """Return True when rel_path contains a `..` segment."""
    p = rel_path.replace("\\", "/")
    return ".." in p.split("/")


def get_lane_guard_decision(rel_path: str, lanes: list[str]) -> dict:
    """
    Evaluate lane constraints and return a decision dict.

    {"block": False}                       — allow
    {"block": True, "reason": "<string>"}  — deny
    """
    active = get_active_lanes(lanes)
    if not active:
        return {"block": False}

    if path_has_dot_dot(rel_path):
        return {
            "block": True,
            "reason": (
                f"Path traversal rejected: '{rel_path}' contains a '..' segment. "
                "Use a normalized in-lane path — '..' cannot be used to escape a lane or the outbox."
            ),
        }

    if path_is_outbox(rel_path):
        return {"block": False}

    if path_in_lanes(rel_path, active):
        return {"block": False}

    return {
        "block": True,
        "reason": (
            f"Out of lane: '{rel_path}' is not in your assigned lane(s): "
            f"{', '.join(active)}. Stay in your lane — hand cross-lane needs back to the lead "
            "via RESULT.follow (write it to your session outbox)."
        ),
    }


# ---------------------------------------------------------------------------
# Hook entry point — stdin JSON -> decision -> stdout + exit 0.
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


def main(
    root_resolver=git_root_resolver,
    file_reader=lane_file_reader,
) -> None:
    payload = read_payload()

    file_path = ""
    try:
        tool_input = payload.get("tool_input") or {}
        file_path = str(tool_input.get("file_path") or "")
    except (AttributeError, TypeError):
        file_path = ""

    if not file_path.strip():
        sys.exit(0)

    root = root_resolver()
    lane_file_path = os.path.join(root, ".team-process", "lane")

    lines = file_reader(lane_file_path)
    if lines is None:
        sys.exit(0)

    rel_path = get_relative_path(file_path, root)
    decision = get_lane_guard_decision(rel_path, lines)

    if decision["block"]:
        print(
            json.dumps(
                {"decision": "block", "reason": decision["reason"]},
                separators=(",", ":"),
            )
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
