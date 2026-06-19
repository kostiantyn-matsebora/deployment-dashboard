"""
PreToolUse(Read|Grep) hook — enforces the project rule that CODE exploration goes
through tokensave + serena, not raw Read/Grep (CLAUDE.md "Code intelligence").

Blocks Read/Grep that targets a source file (.cs/.ts/.tsx/.js/.jsx) ONLY WHEN the
current git branch is tracked by tokensave (a key in `.tokensave/branch-meta.json`)
— i.e. tokensave can actually answer for branch-local symbols.

If the branch is NOT tracked, tokensave silently falls back to the default branch
and returns empty for branch-new symbols; blocking there would dead-end the agent,
so the hook ALLOWS Read/Grep in that case. Declarative files (.json/.yaml/.csproj/
.md/...) and non-code-targeted Greps are always allowed.

Hook I/O contract:
  - Reads a JSON payload from stdin (`tool_name`, `tool_input`).
  - On a block decision, prints compact JSON {"decision": "block", "reason": ...}
    to stdout and exits 0.
  - On no-op, exits 0 silently.
  - Invalid / missing stdin is a no-op (exit 0).
"""

import json
import os
import subprocess
import sys

DEFAULT_CODE_EXTENSIONS: list[str] = [".cs", ".ts", ".tsx", ".js", ".jsx"]
DEFAULT_CODE_GREP_TYPES: list[str] = [
    "cs", "csharp", "ts", "tsx", "typescript", "js", "jsx", "javascript"
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


def git_branch_resolver() -> str:
    """Return the current branch name (abbrev ref), stripped."""
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
    )
    line = result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""
    return line.strip()


def meta_file_reader(path: str) -> str | None:
    """Return the raw contents of the branch-meta.json file, or None if missing."""
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Pure helper functions.
# ---------------------------------------------------------------------------

def is_code_path(path: str, code_extensions: list[str] = DEFAULT_CODE_EXTENSIONS) -> bool:
    """Return True when path ends with one of the code extensions (case-insensitive)."""
    if not path or not path.strip():
        return False
    p = path.replace("\\", "/").lower()
    for ext in code_extensions:
        if p.endswith(ext.lower()):
            return True
    return False


def branch_tracked(
    branch: str,
    meta_path: str,
    file_reader=meta_file_reader,
) -> bool:
    """
    Return True when `branch` is a key in branch-meta.json's `branches` object.
    Returns False on missing file, empty branch, or malformed JSON.
    """
    if not branch or not branch.strip():
        return False
    raw = file_reader(meta_path)
    if raw is None:
        return False
    try:
        meta = json.loads(raw)
    except (ValueError, TypeError):
        return False
    branches = meta.get("branches")
    if not branches or not isinstance(branches, dict):
        return False
    return branch in branches


def get_tokensave_guard_decision(
    tool_name: str,
    tool_input: dict,
    branch_tracked: bool,
    code_extensions: list[str] = DEFAULT_CODE_EXTENSIONS,
    code_types: list[str] = DEFAULT_CODE_GREP_TYPES,
) -> dict:
    """
    Evaluate the tokensave guard rule and return a decision dict.

    {"block": False}                       — allow
    {"block": True, "reason": "<string>"}  — deny
    """
    # Only enforce when tokensave actually serves this branch.
    if not branch_tracked:
        return {"block": False}
    if tool_name not in ("Read", "Grep"):
        return {"block": False}

    is_code = False
    target = ""

    if tool_name == "Read":
        target = str(tool_input.get("file_path") or "")
        is_code = is_code_path(target, code_extensions)
    else:
        # Grep counts as code exploration when it explicitly targets source:
        # a code `type`, a glob ending in a code extension, or a code-file `path`.
        type_val = str(tool_input.get("type") or "")
        glob_val = str(tool_input.get("glob") or "")
        path_val = str(tool_input.get("path") or "")
        target = glob_val or path_val or str(tool_input.get("pattern") or "")
        if type_val and type_val.lower() in [t.lower() for t in code_types]:
            is_code = True
        elif is_code_path(glob_val, code_extensions):
            is_code = True
        elif is_code_path(path_val, code_extensions):
            is_code = True

    if not is_code:
        return {"block": False}

    return {
        "block": True,
        "reason": (
            f"Code-intelligence guard: explore source with tokensave + serena, not raw {tool_name} "
            f"('{target}'). "
            "Use tokensave_context / tokensave_callers / tokensave_outline for understanding & call sites, and "
            "serena find_symbol / get_symbols_overview for exact symbol bodies. Read/Grep are for declarative "
            "files (json/yaml/csproj/md) or exact line ranges only (CLAUDE.md \"Code intelligence\"). "
            "If tokensave returns empty for a branch-new symbol the branch index may be stale — report to the "
            "lead rather than silently falling back."
        ),
    }


# ---------------------------------------------------------------------------
# Hook entry point — stdin JSON -> decision -> stdout + exit 0.
# ---------------------------------------------------------------------------

def read_payload() -> dict | None:
    """Read stdin JSON payload; return None on empty / non-redirected / invalid."""
    if sys.stdin.isatty():
        return None
    raw = sys.stdin.read()
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


def main(
    root_resolver=git_root_resolver,
    branch_resolver=git_branch_resolver,
    file_reader=meta_file_reader,
) -> None:
    payload = read_payload()
    if payload is None:
        sys.exit(0)
    if not isinstance(payload, dict):
        sys.exit(0)

    tool_name = str(payload.get("tool_name") or "")
    if tool_name not in ("Read", "Grep"):
        sys.exit(0)

    root = root_resolver()
    branch = branch_resolver()
    meta_path = os.path.join(root, ".tokensave", "branch-meta.json")
    tracked = branch_tracked(branch, meta_path, file_reader)

    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        tool_input = {}

    decision = get_tokensave_guard_decision(tool_name, tool_input, tracked)

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
