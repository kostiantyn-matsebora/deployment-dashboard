"""
Claude Code adapter — doc-capture hook.

Translates Claude Code skill/compaction events into core-engine capture writes:

  --add-capture          (PostToolUse on Skill) : append /docs-capture content.
  --capture-from-summary (PostCompact)          : record the compaction summary.

Reads the CC payload from stdin (`session_id`, `tool_input.content`, `summary`).
Always exits 0; invalid / missing stdin is a no-op.
"""

import argparse
import json
import os
import sys
from datetime import UTC, datetime

from _engine_import import capture, drift, gitio


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


def _resolve_repo_root() -> str:
    return os.environ.get("CLAUDE_PROJECT_DIR", "") or gitio.resolve_repo_root_from_git()


def _utc_now_iso() -> str:
    """Current UTC time as an ISO 8601 string (millisecond precision, Z suffix)."""
    return datetime.now(tz=UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def main(clock=_utc_now_iso) -> None:
    parser = argparse.ArgumentParser(description="docs-keeper Claude Code capture hook.")
    parser.add_argument("--add-capture", action="store_true", help="PostToolUse mode")
    parser.add_argument("--capture-from-summary", action="store_true", help="PostCompact mode")
    parser.add_argument("--repo-root", default="", help="Git working tree root")
    parser.add_argument("--session-id", default="", help="Claude session id")
    parser.add_argument("--hook-input-json", default="", help="Hook stdin payload (JSON); reads stdin when omitted")
    args = parser.parse_args()

    repo_root = args.repo_root or _resolve_repo_root()

    hook_input_json = args.hook_input_json
    if not hook_input_json:
        payload = read_payload()
    else:
        try:
            payload = json.loads(hook_input_json) if hook_input_json.strip() else {}
        except (ValueError, TypeError):
            payload = {}

    session_id = args.session_id or drift.get_session_id_from_payload(payload)

    if args.add_capture:
        try:
            content = ""
            suggested_doc = ""
            if payload:
                src = payload.get("tool_input") or payload
                content = str(src.get("content") or "")
                suggested_doc = str(src.get("suggestedDoc") or "")
            if content:
                capture_path = capture.get_docs_capture_file_path(repo_root, session_id)
                capture_file = capture.read_docs_capture(capture_path)
                if capture_file is None:
                    capture_file = {"sessionId": session_id, "captures": []}
                entry = capture.new_docs_capture_entry(content, suggested_doc, "manual", clock())
                capture_file = capture.add_docs_capture_entry(capture_file, entry)
                capture.write_docs_capture(capture_path, capture_file)
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
                capture_path = capture.get_docs_capture_file_path(repo_root, session_id)
                capture_file = capture.read_docs_capture(capture_path)
                if capture_file is None:
                    capture_file = {"sessionId": session_id, "captures": []}
                entry = capture.new_docs_capture_entry(summary, "", "compaction", clock())
                capture_file = capture.add_docs_capture_entry(capture_file, entry)
                capture.write_docs_capture(capture_path, capture_file)
        except Exception:  # noqa: BLE001
            pass
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
