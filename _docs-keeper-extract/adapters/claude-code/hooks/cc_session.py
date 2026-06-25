"""
Claude Code adapter — session tracker hook.

Translates Claude Code's session lifecycle events into core-engine session
calls. Five switches:

  --snapshot-session (SessionStart) : baseline HEAD + dirty set; surface
                                      unrevised files + pending captures.
  --session-end      (SessionEnd)   : GC per-session state; report captures.
  --track            (Stop)         : record session-edited .md into TrackedMd.
  --mark-revised     (PostToolUse)  : mark /docs-revise targets revised.
  --dismiss <path>                  : delete a tracker file.

Reads the CC payload from stdin (`session_id`, `tool_input`). Always exits 0.
"""

import argparse
import json
import os
import sys
from pathlib import Path

from _engine_import import drift, gitio, session


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


def main() -> None:
    parser = argparse.ArgumentParser(description="docs-keeper Claude Code session hook.")
    parser.add_argument("--snapshot-session", action="store_true", help="SessionStart mode")
    parser.add_argument("--session-end", action="store_true", help="SessionEnd mode")
    parser.add_argument("--track", action="store_true", help="Stop hook mode")
    parser.add_argument("--mark-revised", action="store_true", help="PostToolUse mode")
    parser.add_argument("--dismiss", metavar="PATH", help="Delete the specified tracker file")
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
    runner = gitio.make_git_text_runner(repo_root)

    # --dismiss: delete the specified tracker file.
    if args.dismiss:
        dismiss_path = Path(args.dismiss)
        if dismiss_path.exists():
            try:
                dismiss_path.unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                pass
        sys.exit(0)

    # --mark-revised: mark files from a completed /docs-revise skill as revised.
    if args.mark_revised:
        try:
            tool_input = payload.get("tool_input") or {}
            if str(tool_input.get("skill", "")) == "docs-revise":
                args_str = str(tool_input.get("args", ""))
                file_paths = [p for p in args_str.split() if p]
                if file_paths:
                    state = session.read_docs_keeper_session(repo_root, session_id)
                    if state is None:
                        state = {"Head": "", "Dirty": [], "TrackedMd": {}}
                    state = session.set_tracked_md_revised(state, file_paths)
                    session.write_docs_keeper_session(repo_root, session_id, state)
        except Exception:  # noqa: BLE001
            pass
        sys.exit(0)

    # --track: record session-edited .md files into TrackedMd.
    if args.track:
        try:
            state = session.read_docs_keeper_session(repo_root, session_id)
            if state is None:
                state = {"Head": "", "Dirty": [], "TrackedMd": {}}

            md_paths: list[str] = []
            if state.get("Head"):
                committed_raw = runner(["diff", "--name-only", state["Head"], "HEAD"])
                committed = [p for p in (committed_raw or "").splitlines() if p]
                dirty_raw = runner(["status", "--porcelain"])
                current_dirty = session.convert_from_git_porcelain(dirty_raw or "")
                session_paths = session.get_session_edited_paths(
                    committed, current_dirty, list(state.get("Dirty") or [])
                )
                md_paths = session.select_markdown_paths(session_paths)
            else:
                dirty_raw = runner(["status", "--porcelain"])
                md_paths = session.select_markdown_paths(session.convert_from_git_porcelain(dirty_raw or ""))

            if md_paths:
                state = session.add_tracked_md_files(state, md_paths)
                session.write_docs_keeper_session(repo_root, session_id, state)
        except Exception:  # noqa: BLE001
            pass
        sys.exit(0)

    # --snapshot-session: capture the per-session baseline + surface proposals.
    if args.snapshot_session:
        leftover_proposal = ""
        try:
            leftover_proposal = session.invoke_session_snapshot(repo_root, session_id, runner)
        except Exception:  # noqa: BLE001
            pass

        capture_proposal = ""
        try:
            def real_dir_lister(rel_dir: str) -> list[dict]:
                base = Path(repo_root) / rel_dir if repo_root else Path(rel_dir)
                if not base.exists():
                    return []
                return [{"Name": e.name, "IsDir": e.is_dir()} for e in base.iterdir()]

            def real_file_reader(rel_path: str) -> str:
                abs_path = Path(repo_root) / rel_path if repo_root else Path(rel_path)
                return abs_path.read_text(encoding="utf-8") if abs_path.exists() else ""

            pending = session.find_pending_capture_files(repo_root, session_id, real_dir_lister, real_file_reader)
            if pending:
                capture_proposal = session.format_capture_proposal(pending)
        except Exception:  # noqa: BLE001
            pass

        parts = [p for p in [leftover_proposal, capture_proposal] if p]
        if parts:
            combined = "\n\n".join(parts)
            print(json.dumps(
                {
                    "systemMessage": combined,
                    "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": combined},
                },
                separators=(",", ":"),
            ))
        sys.exit(0)

    # --session-end: GC per-session state + report captures.
    if args.session_end:
        try:
            session.remove_docs_session_state(repo_root, session_id, runner)
        except Exception:  # noqa: BLE001
            pass
        try:
            capture_path = session.get_docs_capture_file_path(repo_root, session_id)
            capture_file = session.read_docs_capture(capture_path)
            if capture_file and capture_file.get("captures"):
                report = session.format_capture_report(capture_file)
                if report:
                    print(json.dumps({"systemMessage": report}, separators=(",", ":")))
        except Exception:  # noqa: BLE001
            pass
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
