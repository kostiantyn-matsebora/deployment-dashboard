"""
Claude Code docs-keeper capture hook — appends doc-capture entries
written by /docs-capture (--add-capture) or compaction summaries
(--capture-from-summary).

Two invocation surfaces:

  --add-capture (PostToolUse hook on Skill):
    When a /docs-capture skill completes, appends the captured content +
    suggestedDoc to the per-session capture file.

  --capture-from-summary (PostCompact hook):
    Records the compaction summary as a capture entry so it can be surfaced
    and applied in a later session.

Capture file: .docs-keeper/capture.<sanitized-sid>.json
Surfacing (SessionStart proposal + SessionEnd report) stays in
invoke_docs_keeper_session.py alongside the session lifecycle.

Hook I/O contract:
  - Reads a JSON payload from stdin (session_id, tool_input.content, etc.).
  - Always exits 0.
  - Invalid / missing stdin is a no-op.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Pure helpers (intentional duplicates from invoke_docs_keeper_session.py)
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


def get_safe_session_id(session_id: str) -> str:
    """Sanitize a session id to only safe filesystem characters."""
    if not session_id or not session_id.strip():
        return ""
    return re.sub(r"[^A-Za-z0-9._-]", "_", session_id)


def get_session_id_from_payload(payload: dict) -> str:
    """Extract session_id string from the hook payload."""
    if payload and payload.get("session_id"):
        return str(payload["session_id"])
    return ""


def get_docs_capture_file_path(repo_root: str, session_id: str) -> str:
    """Return the path to the capture.<sid>.json file."""
    base = repo_root if repo_root else "."
    sid = get_safe_session_id(session_id)
    name = f"capture.{sid}.json" if sid else "capture.json"
    return str(Path(base) / ".docs-keeper" / name)


# ---------------------------------------------------------------------------
# Pure functions
# ---------------------------------------------------------------------------


def new_docs_capture_entry(
    content: str,
    suggested_doc: str,
    source: str,
    captured_at: str,
) -> dict:
    """
    Create a new capture entry dict. Source is validated to 'manual' or
    'compaction'; unknown values default to 'manual'.
    """
    safe_source = source if source in ("manual", "compaction") else "manual"
    return {
        "content": content,
        "suggestedDoc": suggested_doc,
        "source": safe_source,
        "capturedAt": captured_at,
    }


def add_docs_capture_entry(capture_file: dict, entry: dict) -> dict:
    """
    Pure. Returns updated capture dict with entry appended to captures.
    Does not mutate the input.
    """
    result = dict(capture_file)
    existing = list(result.get("captures") or [])
    existing.append(entry)
    result["captures"] = existing
    return result


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------


def read_docs_capture(path: str) -> dict | None:
    """
    Reads and parses the capture JSON file. Returns None on missing/error.
    Guarantees captures key defaults to [] if absent.
    """
    p = Path(path)
    if not p.exists():
        return None
    try:
        obj = json.loads(p.read_text(encoding="utf-8"))
        captures = []
        for c in obj.get("captures") or []:
            captures.append({
                "content": str(c.get("content", "")),
                "suggestedDoc": str(c.get("suggestedDoc", "")),
                "source": str(c.get("source", "")),
                "capturedAt": str(c.get("capturedAt", "")),
            })
        return {"sessionId": str(obj.get("sessionId", "")), "captures": captures}
    except (OSError, ValueError, TypeError):
        return None


def write_docs_capture(path: str, capture_file: dict) -> None:
    """
    Writes the capture dict as JSON. Creates .docs-keeper/ dir if absent.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(capture_file, separators=(",", ":")), encoding="utf-8")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _resolve_repo_root() -> str:
    """Resolve repo root from env var or git."""
    env_root = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if env_root:
        return env_root
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
        )
        detected = result.stdout.strip()
        if detected:
            return detected
    except Exception:  # noqa: BLE001
        pass
    return ""


def _utc_now_iso() -> str:
    """Return the current UTC time as an ISO 8601 string (millisecond precision, Z suffix)."""
    return datetime.now(tz=UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def main(clock=_utc_now_iso) -> None:
    parser = argparse.ArgumentParser(
        description="Docs-keeper capture hook.",
        add_help=True,
    )
    parser.add_argument("--add-capture", action="store_true", help="PostToolUse mode")
    parser.add_argument(
        "--capture-from-summary", action="store_true", help="PostCompact mode"
    )
    parser.add_argument("--repo-root", default="", help="Git working tree root")
    parser.add_argument("--session-id", default="", help="Claude session id")
    parser.add_argument(
        "--hook-input-json",
        default="",
        help="Hook stdin payload (JSON); reads stdin when omitted",
    )
    args = parser.parse_args()

    repo_root = args.repo_root or _resolve_repo_root()

    # Read stdin payload.
    hook_input_json = args.hook_input_json
    if not hook_input_json:
        payload = read_payload()
    else:
        try:
            payload = json.loads(hook_input_json) if hook_input_json.strip() else {}
        except (ValueError, TypeError):
            payload = {}

    session_id = args.session_id or get_session_id_from_payload(payload)

    if args.add_capture:
        try:
            content = ""
            suggested_doc = ""
            if payload:
                src = payload.get("tool_input") or payload
                content = str(src.get("content") or "")
                suggested_doc = str(src.get("suggestedDoc") or "")
            if content:
                capture_path = get_docs_capture_file_path(repo_root, session_id)
                capture_file = read_docs_capture(capture_path)
                if capture_file is None:
                    capture_file = {"sessionId": session_id, "captures": []}
                entry = new_docs_capture_entry(content, suggested_doc, "manual", clock())
                capture_file = add_docs_capture_entry(capture_file, entry)
                write_docs_capture(capture_path, capture_file)
        except Exception:  # noqa: BLE001
            pass
        sys.exit(0)

    if args.capture_from_summary:
        try:
            summary = ""
            if payload:
                if payload.get("summary"):
                    summary = str(payload["summary"])
                elif payload.get("compaction_summary"):
                    summary = str(payload["compaction_summary"])
                elif (payload.get("tool_response") or {}).get("summary"):
                    summary = str(payload["tool_response"]["summary"])
            if summary:
                capture_path = get_docs_capture_file_path(repo_root, session_id)
                capture_file = read_docs_capture(capture_path)
                if capture_file is None:
                    capture_file = {"sessionId": session_id, "captures": []}
                entry = new_docs_capture_entry(summary, "", "compaction", clock())
                capture_file = add_docs_capture_entry(capture_file, entry)
                write_docs_capture(capture_path, capture_file)
        except Exception:  # noqa: BLE001
            pass
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
