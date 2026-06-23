"""
PreToolUse(Read|Grep|Glob) hook — stops the orchestrator/lead from reading
product/source code in its own context *while a team-process run is active*.

Rationale: the orchestrator is a pure coordinator. Discovery is delegated to a
read-only `Explore` agent (-> RESEARCH) and judgment to an analyst / owning role
(-> ANALYSIS / REVIEW). Code-cognition in the lead's own long-lived context is
the exact pollution this guard exists to prevent. See
.claude/team-process/process.md -> 'Investigation and analysis are delegated'.

Distinguishing properties vs. the lead-edit guard:
  - SESSION-GATED. It acts ONLY while a run is active (a session record exists).
    Outside team mode, normal solo Claude Code reads code freely -> no-op.
  - Tools matched: Read (tool_input.file_path) and Grep/Glob (tool_input.path).
    An absent path on Grep/Glob = a repo-wide search = reading source broadly ->
    blocked.

The orchestration whitelist (paths the lead MAY read even mid-run):
  .team-process/**  (session forms, ledger, inbox/outbox)
  .claude/**        (process / protocol / commands / bindings — orchestration state)
  docs/**           (the owning spec — docs-first intake is the bounded contract
                     read, not code-spelunking)
Anything else under the repo root (backend/**, frontend/**, scripts/**, ...) is
blocked. Subagents pass straight through; their lane is enforced by LaneGuard.

Whitelist source: <root>/.team-process/orch-read-lane if present (one glob per
line; blank lines and # comments ignored); otherwise DEFAULT_ORCH_READ_GLOBS.

Hook I/O contract:
  - Reads a JSON payload from stdin (`tool_input.file_path` / `tool_input.path`,
    `agent_type`, `agent_id`).
  - On a block decision, prints compact JSON {"decision": "block", "reason": ...}
    to stdout and exits 0.
  - On no-op, exits 0 silently.
  - Invalid / missing stdin is a no-op (exit 0).
"""

import json
import os
import subprocess
import sys

# Shared glob/path helpers — reuse the lead-edit guard's tested implementation.
from invoke_lead_edit_guard import (
    get_relative_path,
    path_in_globs,
)
from invoke_team_mode_guard import is_any_session_active

DEFAULT_ORCH_READ_GLOBS: list[str] = [
    ".team-process/**",
    ".claude/**",
    "docs/**",
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


def orch_read_lane_file_reader(path: str) -> list[str] | None:
    """Return lines from the orch-read-lane file, or None if it doesn't exist."""
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read().splitlines()
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Pure helper functions.
# ---------------------------------------------------------------------------

def get_orch_read_globs(root: str, file_reader=orch_read_lane_file_reader) -> list[str]:
    """
    Return the active orchestration read whitelist.

    If `<root>/.team-process/orch-read-lane` exists, read and return its
    non-blank, non-comment lines (stripped). Otherwise return
    DEFAULT_ORCH_READ_GLOBS.
    """
    override_path = os.path.join(root, ".team-process", "orch-read-lane")
    lines = file_reader(override_path)
    if lines is not None:
        result = []
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                result.append(stripped)
        return result
    return list(DEFAULT_ORCH_READ_GLOBS)


def get_orch_read_decision(
    rel_path: str,
    is_subagent: bool,
    session_active: bool,
    under_root: bool,
    globs: list[str],
) -> dict:
    """
    Evaluate the orchestrator read whitelist and return a decision dict.

    {"block": False}                       — allow
    {"block": True, "reason": "<string>"}  — deny

    Allow when: a subagent (it must read code), no run active (solo mode reads
    freely), the path is outside the repo root, or the path is whitelisted
    orchestration state. Block any other in-root read while a run is active.
    """
    if is_subagent:
        return {"block": False}
    if not session_active:
        return {"block": False}
    if not under_root:
        return {"block": False}
    if path_in_globs(rel_path, globs):
        return {"block": False}
    target = rel_path if rel_path else "(repo-wide search)"
    return {
        "block": True,
        "reason": (
            f"The orchestrator does not read source in its own context. '{target}' is "
            "product code, outside the orchestration whitelist (.team-process/**, "
            ".claude/**, docs/**). Delegate discovery to an Explore agent (-> RESEARCH) "
            "and judgment to an analyst / owning role (-> ANALYSIS / REVIEW); reading "
            "code here pollutes the lead's long-lived context. See "
            ".claude/team-process/process.md -> 'Investigation and analysis are delegated'."
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
    file_reader=orch_read_lane_file_reader,
    session_checker=is_any_session_active,
) -> None:
    payload = read_payload()
    if not payload:
        sys.exit(0)

    # Read tool reports `file_path`; Grep/Glob report `path` (absent = repo-wide).
    file_path = ""
    try:
        tool_input = payload.get("tool_input") or {}
        file_path = str(tool_input.get("file_path") or tool_input.get("path") or "")
    except (AttributeError, TypeError):
        file_path = ""

    is_subagent = bool(
        (payload.get("agent_type") or "").strip()
        or (payload.get("agent_id") or "").strip()
    )

    root = root_resolver()
    session_active = bool(session_checker(root))

    if not file_path.strip():
        # No path -> an unscoped Grep/Glob over the repo root = reading source
        # broadly. Treat as in-root + non-whitelisted.
        rel_path = ""
        under_root = True
    else:
        root_normalized = root.replace("\\", "/")
        file_normalized = file_path.replace("\\", "/")
        under_root = file_normalized.lower().startswith(
            (root_normalized.rstrip("/") + "/").lower()
        )
        rel_path = get_relative_path(file_path, root)

    globs = get_orch_read_globs(root, file_reader)
    decision = get_orch_read_decision(
        rel_path, is_subagent, session_active, under_root, globs
    )

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
