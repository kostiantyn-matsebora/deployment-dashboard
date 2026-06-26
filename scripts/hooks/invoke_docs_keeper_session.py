"""
Claude Code docs-keeper session hook — manages the per-session tracker
that records which .md files were edited and whether they have been revised.

Five invocation surfaces (via argparse switches):

  --snapshot-session (SessionStart hook):
    Captures HEAD + the already-dirty path set to .docs-keeper/session.<sid>.json
    so the Track hook can isolate THIS session's doc edits. Also surfaces
    unrevised files from prior sessions and pending captures. Never blocks.

  --session-end (SessionEnd hook):
    Deletes this session's per-session state files (unless TrackedMd has
    unrevised entries that still differ from HEAD, which are forwarded).
    Surfaces captured docs as a systemMessage. Never blocks.

  --track (Stop hook):
    Records session-edited .md files into the session tracker (TrackedMd).
    Never blocks.

  --mark-revised (PostToolUse hook on Skill):
    When a /docs-revise skill call completes, marks the revised files in
    TrackedMd as revised: true.

  --dismiss <path>:
    Deletes the specified tracker file and exits 0.

Hook I/O contract:
  - Reads a JSON payload from stdin (session_id field).
  - On SessionStart with proposals, prints compact JSON to stdout.
  - Always exits 0.
  - Invalid / missing stdin is a no-op (exit 0).

Drift detection and pre-commit gate live in invoke_docs_keeper_maintenance.py.
Capture write operations live in invoke_docs_keeper_capture.py.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Default git runner — injected as a callable so tests can pass a fake.
# ---------------------------------------------------------------------------


def git_runner(argv: list[str], repo_root: str = "") -> str:
    """Run git with argv, return stdout as a string (stderr suppressed)."""
    cmd = ["git"]
    if repo_root:
        cmd += ["-C", repo_root]
    cmd += argv
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout


def make_git_runner(repo_root: str = ""):
    """Return a git_runner bound to repo_root."""
    def runner(argv: list[str]) -> str:
        return git_runner(argv, repo_root)
    return runner


# ---------------------------------------------------------------------------
# Duplicated helpers (also in invoke_docs_keeper_maintenance.py)
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


def get_session_id_from_payload(payload: dict) -> str:
    """Extract session_id string from the hook payload."""
    if payload and payload.get("session_id"):
        return str(payload["session_id"])
    return ""


def get_safe_session_id(session_id: str) -> str:
    """Sanitize a session id to only safe filesystem characters."""
    if not session_id or not session_id.strip():
        return ""
    return re.sub(r"[^A-Za-z0-9._-]", "_", session_id)


def is_markdown_path(path: str) -> bool:
    """Return True when path ends with .md."""
    if not path or not path.strip():
        return False
    return path.endswith(".md")


# ---------------------------------------------------------------------------
# Pure functions: git porcelain + session-path computation
# ---------------------------------------------------------------------------


def convert_from_git_porcelain(porcelain: str) -> list[str]:
    """
    Parse `git status --porcelain` output into a list of file paths.
    Renames resolve to the new path (right side of '->').
    """
    if not porcelain or not porcelain.strip():
        return []
    paths = []
    for line in re.split(r"\r?\n", porcelain):
        if not line.strip():
            continue
        rest = line[3:] if len(line) > 3 else line.strip()
        if "->" in rest:
            rest = rest.split("->")[-1]
        rest = rest.strip().strip('"')
        if rest:
            paths.append(rest)
    return paths


def get_session_edited_paths(
    committed_paths: list[str],
    current_dirty_paths: list[str],
    snapshot_dirty_paths: list[str],
) -> list[str]:
    """
    Return the union of:
      - all committed paths since the snapshot, plus
      - dirty paths that were NOT already dirty at snapshot time.
    Deduplicates while preserving order (committed first).
    """
    snap_set = set(snapshot_dirty_paths)
    seen: set[str] = set()
    result = []
    for p in committed_paths:
        if p and p not in seen:
            seen.add(p)
            result.append(p)
    for p in current_dirty_paths:
        if p and p not in snap_set and p not in seen:
            seen.add(p)
            result.append(p)
    return result


def select_markdown_paths(paths: list[str]) -> list[str]:
    """Filter a list of paths to only .md files."""
    return [p for p in paths if is_markdown_path(p)]


# ---------------------------------------------------------------------------
# Pure functions: TrackedMd
# ---------------------------------------------------------------------------


def add_tracked_md_files(session: dict, paths: list[str]) -> dict:
    """
    Pure. Returns updated session dict. For each path in paths: if NOT already
    in TrackedMd, add with revised: False. If already present, leave unchanged
    (preserves revised: True).
    """
    updated = {
        "Head": session.get("Head", ""),
        "Dirty": session.get("Dirty", []),
    }
    tracked = dict(session.get("TrackedMd", {}))
    for p in paths:
        if not p:
            continue
        if p not in tracked:
            tracked[p] = {"revised": False}
        # already present -> leave unchanged
    updated["TrackedMd"] = tracked
    return updated


def set_tracked_md_revised(session: dict, paths: list[str]) -> dict:
    """
    Pure. Returns updated session dict with each path in paths set to
    revised: True. Adds path if not present.
    """
    updated = {
        "Head": session.get("Head", ""),
        "Dirty": session.get("Dirty", []),
    }
    tracked = dict(session.get("TrackedMd", {}))
    for p in paths:
        if not p:
            continue
        tracked[p] = {"revised": True}
    updated["TrackedMd"] = tracked
    return updated


def format_session_start_proposal(unrevised_by_file: list[list[str]]) -> str:
    """
    Pure. Given a list of [trackerPath, file1, file2, ...] lists, formats the
    additionalContext string proposing to the user: revise now / snooze / dismiss.
    """
    lines = ["Docs changed in a previous session but not revised:"]
    for pair in unrevised_by_file:
        tracker_path = pair[0]
        files = ", ".join(pair[1:])
        lines.append(f"  From session file {tracker_path}: {files}")
    lines.append("")
    lines.append("Options (reply with your choice):")
    lines.append('  - "revise" — run /docs-revise on these files now')
    lines.append('  - "snooze" — ask me again next session (tracker kept)')
    lines.append('  - "dismiss" — delete the tracker, never ask again')
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Pure functions: docs-capture read side
# ---------------------------------------------------------------------------


def get_docs_capture_file_path(repo_root: str, session_id: str) -> str:
    """Return the path to the capture.<sid>.json file."""
    base = repo_root if repo_root else "."
    sid = get_safe_session_id(session_id)
    name = f"capture.{sid}.json" if sid else "capture.json"
    return str(Path(base) / ".docs-keeper" / name)


def format_capture_report(capture_file: dict) -> str:
    """
    Pure. Returns a concise structured string for systemMessage (SessionEnd).
    Returns empty string when captures is absent or empty.
    """
    if not capture_file or "captures" not in capture_file:
        return ""
    captures = list(capture_file["captures"])
    if not captures:
        return ""
    lines = [f"Docs captured this session ({len(captures)}):"]
    for i, entry in enumerate(captures):
        text = str(entry.get("content", ""))
        if len(text) > 80:
            text = text[:80] + "…"
        src = str(entry.get("source", ""))
        doc = str(entry.get("suggestedDoc", ""))
        line = f"  {i + 1}. [{src}] {text}"
        if doc:
            line += f" -> {doc}"
        lines.append(line)
    return "\n".join(lines)


def format_capture_proposal(capture_files: list[dict]) -> str:
    """
    Pure. capture_files is a list of parsed capture dicts (one per prior session).
    Returns a concise structured string for additionalContext (SessionStart).
    Returns empty string when empty or all have no captures.
    """
    if not capture_files:
        return ""
    all_entries = []
    for cf in capture_files:
        if not cf or "captures" not in cf:
            continue
        all_entries.extend(cf["captures"])
    if not all_entries:
        return ""
    lines = [f"Pending doc captures from previous session(s) ({len(all_entries)} total):"]
    for i, entry in enumerate(all_entries):
        text = str(entry.get("content", ""))
        if len(text) > 80:
            text = text[:80] + "…"
        src = str(entry.get("source", ""))
        doc = str(entry.get("suggestedDoc", ""))
        line = f"  {i + 1}. [{src}] {text}"
        if doc:
            line += f" -> {doc}"
        lines.append(line)
    lines.append("")
    lines.append('Reply "apply" to update the suggested docs now, or "dismiss" to discard.')
    return "\n".join(lines)


def find_pending_capture_files(
    repo_root: str,
    current_session_id: str,
    dir_lister,
    file_reader,
) -> list[dict]:
    """
    Pure. Scans .docs-keeper/ for capture.*.json files whose session id does
    NOT match current_session_id. Returns list of parsed capture dicts that
    have at least one entry in captures.

    dir_lister(rel_dir: str) -> list of {"Name": str, "IsDir": bool}
    file_reader(rel_path: str) -> str (raw file content, "" if absent)
    """
    state_dir = ".docs-keeper"
    safe_current = get_safe_session_id(current_session_id)
    dir_entries = dir_lister(state_dir)
    results = []
    for entry in dir_entries:
        if entry.get("IsDir"):
            continue
        name = str(entry.get("Name", ""))
        m = re.match(r"^capture\.(.+)\.json$", name)
        if not m:
            continue
        file_sid = m.group(1)
        if file_sid == safe_current:
            continue
        rel_path = f"{state_dir}/{name}"
        raw = file_reader(rel_path)
        if not raw or not raw.strip():
            continue
        try:
            parsed = json.loads(raw)
            captures_raw = parsed.get("captures") or []
            if not captures_raw:
                continue
            capture_list = [
                {
                    "content": str(c.get("content", "")),
                    "suggestedDoc": str(c.get("suggestedDoc", "")),
                    "source": str(c.get("source", "")),
                    "capturedAt": str(c.get("capturedAt", "")),
                }
                for c in captures_raw
            ]
            results.append({"sessionId": str(parsed.get("sessionId", "")), "captures": capture_list})
        except (ValueError, TypeError):
            continue
    return results


# ---------------------------------------------------------------------------
# Session I/O
# ---------------------------------------------------------------------------


def get_docs_keeper_session_path(repo_root: str, session_id: str) -> str:
    """Return the path to session.<sid>.json."""
    base = repo_root if repo_root else "."
    sid = get_safe_session_id(session_id)
    name = f"session.{sid}.json" if sid else "session.json"
    return str(Path(base) / ".docs-keeper" / name)


def read_docs_keeper_session(repo_root: str, session_id: str) -> dict | None:
    """
    Returns {"Head": str, "Dirty": list, "TrackedMd": dict} or None when the
    file does not exist or cannot be parsed.
    """
    path = get_docs_keeper_session_path(repo_root, session_id)
    if not Path(path).exists():
        return None
    try:
        raw = Path(path).read_text(encoding="utf-8")
        obj = json.loads(raw)
        tracked_md = {}
        for k, v in (obj.get("TrackedMd") or {}).items():
            tracked_md[k] = {"revised": bool(v.get("revised", False))}
        return {
            "Head": str(obj.get("Head", "")),
            "Dirty": list(obj.get("Dirty") or []),
            "TrackedMd": tracked_md,
        }
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def write_docs_keeper_session(repo_root: str, session_id: str, session: dict) -> None:
    """
    Writes the full session dict {"Head", "Dirty", "TrackedMd"} to
    .docs-keeper/session.<sid>.json. Creates .docs-keeper/ dir if absent.
    """
    path = Path(get_docs_keeper_session_path(repo_root, session_id))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(session, separators=(",", ":")), encoding="utf-8")


def get_leftover_session_files(repo_root: str, current_session_id: str) -> list[str]:
    """
    Finds all session.*.json files under .docs-keeper/ whose session id does
    NOT match current_session_id. Returns list of absolute file paths.
    """
    base = Path(repo_root) if repo_root else Path(".")
    state_dir = base / ".docs-keeper"
    if not state_dir.exists():
        return []
    safe_current = get_safe_session_id(current_session_id)
    results = []
    for f in state_dir.iterdir():
        if not f.is_file():
            continue
        m = re.match(r"^session\.(.+)\.json$", f.name)
        if m:
            file_sid = m.group(1)
            if file_sid != safe_current:
                results.append(str(f))
    return results


def tracker_has_pending_work(tracker: dict, git_runner_fn, head: str = "HEAD") -> bool:
    """
    Returns True iff the tracker has at least one entry where revised: False
    AND `git diff HEAD -- <path>` returns non-empty output.
    git_runner_fn is injectable for tests.
    """
    tracked_md = tracker.get("TrackedMd") if tracker else None
    if not tracked_md:
        return False
    for path, info in tracked_md.items():
        if not bool(info.get("revised", False)):
            try:
                diff_out = git_runner_fn(["diff", head, "--", path])
                if diff_out and diff_out.strip():
                    return True
            except Exception:  # noqa: BLE001
                pass
    return False


def remove_docs_session_state(
    repo_root: str,
    session_id: str,
    git_runner_fn=None,
) -> None:
    """
    SessionEnd cleanup.
    - Current session file: delete unless tracker_has_pending_work is True.
    - Each leftover session file: delete when no pending work; keep when pending.
    - Delete the legacy attempts file if it still exists (backward compat).
    Best-effort; never throws.
    """
    if git_runner_fn is None:
        git_runner_fn = make_git_runner(repo_root)

    # Current session file.
    session_file = Path(get_docs_keeper_session_path(repo_root, session_id))
    if session_file.exists():
        try:
            session = read_docs_keeper_session(repo_root, session_id)
            has_pending = tracker_has_pending_work(session, git_runner_fn)
            if not has_pending:
                session_file.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass

    # Leftover session files from other sessions.
    for leftover_path in get_leftover_session_files(repo_root, session_id):
        try:
            raw = Path(leftover_path).read_text(encoding="utf-8")
            if not raw or not raw.strip():
                Path(leftover_path).unlink(missing_ok=True)
                continue
            obj = json.loads(raw)
            tracked_md = {}
            for k, v in (obj.get("TrackedMd") or {}).items():
                tracked_md[k] = {"revised": bool(v.get("revised", False))}
            leftover_tracker = {
                "Head": str(obj.get("Head", "")),
                "Dirty": [],
                "TrackedMd": tracked_md,
            }
            has_pending = tracker_has_pending_work(leftover_tracker, git_runner_fn)
            if not has_pending:
                Path(leftover_path).unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass

    # Backward compat: remove legacy attempts file if present.
    base = Path(repo_root) if repo_root else Path(".")
    sid = get_safe_session_id(session_id)
    attempts_name = f"attempts.{sid}.json" if sid else "attempts.json"
    attempts_file = base / ".docs-keeper" / attempts_name
    if attempts_file.exists():
        try:
            attempts_file.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass


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


# ---------------------------------------------------------------------------
# Invoke-SessionSnapshot equivalent
# ---------------------------------------------------------------------------


def invoke_session_snapshot(
    repo_root: str,
    session_id: str,
    git_runner_fn=None,
    snapshot_writer=None,
) -> str:
    """
    SessionStart hook: capture HEAD + the already-dirty path set so the Track
    hook can isolate THIS session's doc edits. Also surfaces unrevised files
    from prior sessions. Best-effort; never blocks.
    Returns the leftover-proposal string (empty string when none).
    """
    if git_runner_fn is None:
        git_runner_fn = make_git_runner(repo_root)
    if snapshot_writer is None:
        def snapshot_writer(snap: dict) -> None:
            write_docs_keeper_session(repo_root, session_id, snap)

    try:
        head_raw = git_runner_fn(["rev-parse", "HEAD"])
        head = (head_raw.splitlines()[0].strip() if head_raw.strip() else "")
    except Exception:  # noqa: BLE001
        head = ""

    try:
        dirty_raw = git_runner_fn(["status", "--porcelain"])
        dirty = convert_from_git_porcelain(dirty_raw if isinstance(dirty_raw, str) else "\n".join(dirty_raw))
    except Exception:  # noqa: BLE001
        dirty = []

    # Preserve existing TrackedMd if the session file already exists.
    existing = read_docs_keeper_session(repo_root, session_id)
    tracked_md = existing.get("TrackedMd", {}) if existing and existing.get("TrackedMd") else {}

    snapshot_writer({"Head": head, "Dirty": dirty, "TrackedMd": tracked_md})

    # Surface unrevised files from prior sessions.
    leftovers = get_leftover_session_files(repo_root, session_id)
    unrevised_by_file = []
    for tracker_path in leftovers:
        try:
            obj = json.loads(Path(tracker_path).read_text(encoding="utf-8"))
            tracked = obj.get("TrackedMd") or {}
            unrevised = []
            for rel_path, info in tracked.items():
                if not bool(info.get("revised", False)):
                    diff_out = git_runner_fn(["diff", "HEAD", "--", rel_path])
                    if diff_out and diff_out.strip():
                        unrevised.append(rel_path)
            if unrevised:
                unrevised_by_file.append([tracker_path] + unrevised)
        except Exception:  # noqa: BLE001
            continue

    if unrevised_by_file:
        return format_session_start_proposal(unrevised_by_file)
    return ""


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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Docs-keeper session hook.",
        add_help=True,
    )
    parser.add_argument("--snapshot-session", action="store_true", help="SessionStart mode")
    parser.add_argument("--session-end", action="store_true", help="SessionEnd mode")
    parser.add_argument("--track", action="store_true", help="Stop hook mode")
    parser.add_argument("--mark-revised", action="store_true", help="PostToolUse mode")
    parser.add_argument("--dismiss", metavar="PATH", help="Delete the specified tracker file")
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
                    session = read_docs_keeper_session(repo_root, session_id)
                    if session is None:
                        session = {"Head": "", "Dirty": [], "TrackedMd": {}}
                    session = set_tracked_md_revised(session, file_paths)
                    write_docs_keeper_session(repo_root, session_id, session)
        except Exception:  # noqa: BLE001
            pass
        sys.exit(0)

    # --track: record session-edited .md files into TrackedMd.
    if args.track:
        try:
            session = read_docs_keeper_session(repo_root, session_id)
            if session is None:
                session = {"Head": "", "Dirty": [], "TrackedMd": {}}

            runner = make_git_runner(repo_root)

            md_paths: list[str] = []
            if session.get("Head"):
                committed_raw = runner(["diff", "--name-only", session["Head"], "HEAD"])
                committed = [p for p in (committed_raw or "").splitlines() if p]
                dirty_raw = runner(["status", "--porcelain"])
                current_dirty = convert_from_git_porcelain(dirty_raw or "")
                session_paths = get_session_edited_paths(
                    committed, current_dirty, list(session.get("Dirty") or [])
                )
                md_paths = select_markdown_paths(session_paths)
            else:
                dirty_raw = runner(["status", "--porcelain"])
                all_dirty = convert_from_git_porcelain(dirty_raw or "")
                md_paths = select_markdown_paths(all_dirty)

            if md_paths:
                session = add_tracked_md_files(session, md_paths)
                write_docs_keeper_session(repo_root, session_id, session)
        except Exception:  # noqa: BLE001
            pass
        sys.exit(0)

    # --snapshot-session: capture the per-session baseline.
    if args.snapshot_session:
        leftover_proposal = ""
        try:
            leftover_proposal = invoke_session_snapshot(repo_root, session_id)
        except Exception:  # noqa: BLE001
            pass

        # Surface pending captures from prior sessions.
        capture_proposal = ""
        try:
            def real_dir_lister(rel_dir: str) -> list[dict]:
                base = Path(repo_root) / rel_dir if repo_root else Path(rel_dir)
                if not base.exists():
                    return []
                return [
                    {"Name": entry.name, "IsDir": entry.is_dir()}
                    for entry in base.iterdir()
                ]

            def real_file_reader(rel_path: str) -> str:
                abs_path = Path(repo_root) / rel_path if repo_root else Path(rel_path)
                if abs_path.exists():
                    return abs_path.read_text(encoding="utf-8")
                return ""

            pending_captures = find_pending_capture_files(
                repo_root, session_id, real_dir_lister, real_file_reader
            )
            if pending_captures:
                capture_proposal = format_capture_proposal(pending_captures)
        except Exception:  # noqa: BLE001
            pass

        parts = [p for p in [leftover_proposal, capture_proposal] if p]
        if parts:
            combined = "\n\n".join(parts)
            print(json.dumps(
                {
                    "systemMessage": combined,
                    "hookSpecificOutput": {
                        "hookEventName": "SessionStart",
                        "additionalContext": combined,
                    },
                },
                separators=(",", ":"),
            ))
        sys.exit(0)

    # --session-end: delete this session's per-session state files.
    if args.session_end:
        runner = make_git_runner(repo_root)
        try:
            remove_docs_session_state(repo_root, session_id, runner)
        except Exception:  # noqa: BLE001
            pass

        # Surface captured docs as a systemMessage.
        try:
            capture_path = get_docs_capture_file_path(repo_root, session_id)
            capture_file = read_docs_capture(capture_path)
            if capture_file and capture_file.get("captures"):
                report = format_capture_report(capture_file)
                if report:
                    print(json.dumps({"systemMessage": report}, separators=(",", ":")))
        except Exception:  # noqa: BLE001
            pass
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
