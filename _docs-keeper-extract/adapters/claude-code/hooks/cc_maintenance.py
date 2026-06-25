"""
Claude Code adapter — PreToolUse(Bash) maintenance gate + CI drift gate.

Thin glue: translate the Claude Code hook payload (`tool_input.command`,
`session_id`) and git output into core-engine calls, then translate the
engine's neutral result back into Claude Code's hook protocol (exit 0 / 2,
stderr block message, `systemMessage` JSON on warn).

  PreToolUse mode (default): react to a `git commit` that stages markdown.
  --drift-only            : CI path; index + registry drift only.

Enforcement (DOCS_KEEPER_ENFORCE): `block` (default; exit 2) or `warn` (exit 0).
"""

import argparse
import json
import os
import sys

from _engine_import import drift, gitio, session

# Host-specific binding-gates footer for the installed plugin.
CC_BINDING_GATES_REF = "Binding gates: docs-keeper agent (Non-overwrite policy + Hard rules)."


def invoke_docs_keeper_maintenance(
    hook_input_json: str = "",
    repo_root: str = "",
    git_command_runner=None,
    dir_lister=None,
    file_reader=None,
    session_reader=None,
    enforcement_mode: str = "",
) -> dict:
    """
    PreToolUse orchestration — parse the CC payload, wire git/session/fs
    collaborators, and delegate the decision to the engine.

    Returns {exit_code, message, reason, queue, mode}.
    """
    if not repo_root:
        repo_root = gitio.resolve_repo_root_from_git()

    if git_command_runner is None:
        git_command_runner = gitio.make_git_lines_runner(repo_root)
    if dir_lister is None:
        dir_lister = gitio.make_dir_lister(repo_root)
    if file_reader is None:
        file_reader = gitio.make_file_reader(repo_root)
    if session_reader is None:
        session_reader = _make_default_session_reader(repo_root, git_command_runner)

    mode = drift.resolve_enforcement_mode(enforcement_mode)

    payload = drift.read_hook_payload(hook_input_json)
    if payload is None:
        return {"exit_code": 0, "message": "", "reason": "no-payload", "queue": [], "mode": mode}

    command = ""
    try:
        tool_input = payload.get("tool_input") or {}
        command = str(tool_input.get("command") or "")
    except (AttributeError, TypeError):
        command = ""

    if not drift.is_git_commit(command):
        return {"exit_code": 0, "message": "", "reason": "not-git-commit", "queue": [], "mode": mode}

    raw_lines = git_command_runner(["diff", "--cached", "--name-status", "-M"])
    name_status = "\n".join(raw_lines) if isinstance(raw_lines, list) else str(raw_lines)

    session_state = session_reader()
    tracked_md = (session_state or {}).get("tracked_md") or {}

    return drift.evaluate_commit_maintenance(
        command=command,
        name_status=name_status,
        session_tracked_md=tracked_md,
        dir_lister=dir_lister,
        file_reader=file_reader,
        enforcement_mode=enforcement_mode,
        binding_gates_ref=CC_BINDING_GATES_REF,
    )


def _make_default_session_reader(repo_root: str, git_command_runner):
    """Build the default session reader (merged revised:true across sessions)."""

    def session_reader() -> dict | None:
        head = ""
        try:
            lines = git_command_runner(["rev-parse", "HEAD"])
            raw = "".join(lines).strip() if isinstance(lines, list) else str(lines).strip()
            if raw:
                head = raw
        except Exception:  # noqa: BLE001
            pass
        return session.read_merged_docs_keeper_sessions(repo_root=repo_root, current_head=head)

    return session_reader


def main() -> None:
    parser = argparse.ArgumentParser(description="docs-keeper Claude Code maintenance hook / CI drift gate.")
    parser.add_argument("--drift-only", action="store_true", help="CI path: drift check only.")
    args, _ = parser.parse_known_args()

    repo_root = os.environ.get("CLAUDE_PROJECT_DIR", "") or gitio.resolve_repo_root_from_git()

    hook_input_json = ""
    if not sys.stdin.isatty():
        try:
            hook_input_json = sys.stdin.read()
        except Exception:  # noqa: BLE001
            hook_input_json = ""

    enforcement_mode = os.environ.get("DOCS_KEEPER_ENFORCE", "")
    mode = drift.resolve_enforcement_mode(enforcement_mode)

    if args.drift_only:
        dl = gitio.make_dir_lister(repo_root)
        fr = gitio.make_file_reader(repo_root)
        drift_queue = drift.get_docs_drift_queue(dl, fr)
        if not drift_queue:
            sys.exit(0)
        msg = drift.format_block_message(drift_queue, standalone=True, mode=mode, binding_gates_ref=CC_BINDING_GATES_REF)
        print(msg, file=sys.stderr)
        sys.exit(0 if mode == "warn" else 2)

    result = invoke_docs_keeper_maintenance(
        hook_input_json=hook_input_json,
        repo_root=repo_root,
        enforcement_mode=enforcement_mode,
    )

    if result["exit_code"] != 0 and result["message"]:
        print(result["message"], file=sys.stderr)
    elif result["exit_code"] == 0 and result["message"]:
        print(json.dumps({"systemMessage": result["message"]}, separators=(",", ":")))

    sys.exit(result["exit_code"])


if __name__ == "__main__":
    main()
