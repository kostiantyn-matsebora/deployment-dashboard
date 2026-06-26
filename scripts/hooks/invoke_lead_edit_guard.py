"""
PreToolUse(Edit|Write|MultiEdit|NotebookEdit) hook — stops the orchestrator/lead
from editing product/lane files. The lead may only edit paths matching the
orchestration whitelist. Subagents pass straight through; their lane is
enforced by the existing LaneGuard.

Whitelist source: <root>/.team-process/lead-lane if present (one glob per line;
blank lines and # comments ignored); otherwise the built-in DEFAULT list.

Hook I/O contract:
  - Reads a JSON payload from stdin (`tool_input.file_path`, `agent_type`, `agent_id`).
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

DEFAULT_LEAD_LANE_GLOBS: list[str] = [
    ".claude/team-process/**",
    ".claude/bindings/**",
    ".claude/agents/**",
    ".claude/commands/**",
    ".claude/skills/**",
    ".claude/*.md",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".team-process/**",
]


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


def lead_lane_file_reader(path: str) -> list[str] | None:
    """Return lines from the lead-lane file, or None if it doesn't exist."""
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


def path_in_globs(rel_path: str, globs: list[str]) -> bool:
    """
    Return True if rel_path matches any of the globs.
    Skips blank lines and `#` comments (inline filtering, mirrors PowerShell).
    """
    p = rel_path.replace("\\", "/")
    if p.startswith("./"):
        p = p[2:]
    for glob in globs:
        if not glob or not glob.strip():
            continue
        if glob.lstrip().startswith("#"):
            continue
        rx = convert_from_lane_glob(glob.strip())
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


def get_lead_lane_globs(root: str, file_reader=lead_lane_file_reader) -> list[str]:
    """
    Return the active lead-lane globs.

    If `<root>/.team-process/lead-lane` exists, read and return its non-blank,
    non-comment lines (stripped). Otherwise return DEFAULT_LEAD_LANE_GLOBS.
    """
    override_path = os.path.join(root, ".team-process", "lead-lane")
    lines = file_reader(override_path)
    if lines is not None:
        result = []
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                result.append(stripped)
        return result
    return list(DEFAULT_LEAD_LANE_GLOBS)


def get_lead_edit_decision(
    rel_path: str,
    is_subagent: bool,
    under_root: bool,
    globs: list[str],
) -> dict:
    """
    Evaluate the lead-edit whitelist and return a decision dict.

    {"block": False}                       — allow
    {"block": True, "reason": "<string>"}  — deny
    """
    if is_subagent:
        return {"block": False}
    if not under_root:
        return {"block": False}
    if path_in_globs(rel_path, globs):
        return {"block": False}
    return {
        "block": True,
        "reason": (
            f"The orchestrator does not edit lane files. '{rel_path}' is product-facing, "
            "outside the orchestration whitelist (the test is lane membership, not size). "
            "Delegate to the owning role via a BRIEF; keep your context to plan + ledger. "
            "See .claude/team-process/process.md -> 'Delegate by default'."
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
    file_reader=lead_lane_file_reader,
) -> None:
    payload = read_payload()
    if not payload:
        sys.exit(0)

    file_path = ""
    try:
        tool_input = payload.get("tool_input") or {}
        file_path = str(tool_input.get("file_path") or "")
    except (AttributeError, TypeError):
        file_path = ""

    if not file_path.strip():
        sys.exit(0)

    is_subagent = bool(
        (payload.get("agent_type") or "").strip()
        or (payload.get("agent_id") or "").strip()
    )

    root = root_resolver()
    root_normalized = root.replace("\\", "/")
    file_normalized = file_path.replace("\\", "/")
    under_root = file_normalized.lower().startswith((root_normalized.rstrip("/") + "/").lower())

    rel_path = get_relative_path(file_path, root)
    globs = get_lead_lane_globs(root, file_reader)
    decision = get_lead_edit_decision(rel_path, is_subagent, under_root, globs)

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
