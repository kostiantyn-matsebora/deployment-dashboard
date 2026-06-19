"""
PreToolUse(Bash) hook — docs-keeper maintenance gate.

Two invocation surfaces:

  PreToolUse mode (default):
    Wired via .claude/settings.json as a PreToolUse hook matched on the Bash
    tool. Reads the hook JSON payload from stdin, filters for `git commit`
    invocations that touch any .md file, and runs deterministic drift detection
    plus the Mode B revise scope (the STAGED .md set). Files already marked
    revised: true in the session tracker are skipped.

  DriftOnly mode (--drift-only flag):
    CI path — index + registry drift check only, no session/revise logic.
    Exits 0 (clean) or 2 (drift detected, message on stderr).

Hook I/O contract:
  - Reads a JSON payload from stdin (tool_input.command).
  - On a block decision prints compact JSON {"decision": "block", "reason": ...}
    to stdout and exits 0 (warn) or 2 (block).
  - In warn mode exits 0 and emits {"systemMessage": ...} to stdout.
  - Invalid / missing stdin is a no-op (exit 0).

Enforcement (DOCS_KEEPER_ENFORCE env var): `block` (default; exit 2) or
`warn` (exit 0, queue still surfaced).
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Default collaborators — injected as callables so tests pass plain fakes.
# ---------------------------------------------------------------------------

_EXCLUDE_DIRS_DEFAULT = frozenset(
    {"node_modules", "dist", "build", "bin", "obj", "vendor", "out", ".next", ".nuxt", "coverage", "target"}
)


def git_runner(argv: list[str], repo_root: str = "") -> list[str]:
    """Run git with argv; return stdout lines (stderr suppressed)."""
    cmd = ["git"]
    if repo_root:
        cmd += ["-C", repo_root]
    cmd += argv
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout.splitlines()


def make_dir_lister(repo_root: str):
    """Return a dir_lister callable rooted at repo_root."""

    def dir_lister(rel_dir: str) -> list[dict]:
        base = Path(repo_root) / rel_dir if repo_root else Path(rel_dir)
        if not base.exists():
            return []
        entries = []
        try:
            for child in sorted(base.iterdir()):
                entries.append({"name": child.name, "is_dir": child.is_dir()})
        except OSError:
            pass
        return entries

    return dir_lister


def make_file_reader(repo_root: str):
    """Return a file_reader callable rooted at repo_root."""

    def file_reader(rel_path: str) -> str:
        abs_path = Path(repo_root) / rel_path if repo_root else Path(rel_path)
        try:
            return abs_path.read_text(encoding="utf-8")
        except (OSError, ValueError):
            return ""

    return file_reader


# ---------------------------------------------------------------------------
# Pure functions: payload + git parsing
# ---------------------------------------------------------------------------


def read_hook_payload(json_str: str) -> dict | None:
    """Parse a JSON payload string; return None on empty/invalid."""
    if not json_str or not json_str.strip():
        return None
    try:
        return json.loads(json_str)
    except (ValueError, TypeError):
        return None


def get_session_id_from_payload(payload: dict | None) -> str:
    """Extract session_id from a parsed payload; return '' when absent."""
    if payload and isinstance(payload, dict) and payload.get("session_id"):
        return str(payload["session_id"])
    return ""


def get_safe_session_id(session_id: str) -> str:
    """
    Sanitize a session id for use in a filename: keep [A-Za-z0-9._-],
    collapse anything else to '_'. Empty / whitespace -> ''.
    """
    if not session_id or not session_id.strip():
        return ""
    return re.sub(r"[^A-Za-z0-9._-]", "_", session_id)


def is_git_commit(command: str) -> bool:
    """
    Return True when command contains `git … commit` (word boundary match).

    Accepts flags between `git` and `commit` (e.g. git -C /repo commit).
    Must be preceded by start-of-string, whitespace, &, ; or |.
    The word 'commit' must be followed by end-of-string, whitespace, or flags
    — prevents matching `git commit-tree` / `git commit-graph`.
    """
    if not command or not command.strip():
        return False
    return bool(re.search(r"(^|[\s;&|])git(\s+-[A-Za-z]+(\s+\S+)?)*\s+commit($|[\s])", command))


def convert_git_name_status(name_status: str) -> list[dict]:
    """
    Parse `git diff --name-status -M` output into a list of change dicts.

    Each dict has keys: status, path, old_path (may be None).
    """
    if not name_status or not name_status.strip():
        return []
    changes = []
    for line in re.split(r"\r?\n", name_status):
        if not line.strip():
            continue
        parts = line.split("\t")
        raw_status = parts[0]
        if re.match(r"^[RC]\d*$", raw_status) and len(parts) >= 3:
            changes.append({"status": raw_status[0], "old_path": parts[1], "path": parts[2]})
        elif len(parts) >= 2:
            changes.append({"status": raw_status, "path": parts[1], "old_path": None})
    return changes


def is_markdown_path(path: str | None) -> bool:
    """Return True when path ends with .md (case-sensitive)."""
    if not path:
        return False
    return path.endswith(".md")


def touches_indexed_content(changes: list[dict]) -> bool:
    """Return True when any change record involves a .md file."""
    for change in changes:
        for p in (change.get("path"), change.get("old_path")):
            if is_markdown_path(p):
                return True
    return False


# ---------------------------------------------------------------------------
# Pure functions: discovery + drift
# ---------------------------------------------------------------------------


def is_hidden_name(name: str) -> bool:
    """Return True for dot- or underscore-prefixed names."""
    return name.startswith(".") or name.startswith("_")


def find_host_root_prompt_file(file_reader) -> str:
    """
    Return the first non-empty candidate host prompt file path.

    Candidates in order: CLAUDE.md, AGENTS.md, .agent/INDEX.md.
    """
    for candidate in ("CLAUDE.md", "AGENTS.md", ".agent/INDEX.md"):
        content = file_reader(candidate)
        if content and content.strip():
            return candidate
    return ""


def get_expected_children(dir_path: str, dir_lister, prefix: str = "") -> list[str]:
    """
    Compute the expected children: entries for a docs-keeper index directory.

    Rules (mirrors the PowerShell Get-ExpectedChildren):
    - Hidden/underscore entries are skipped.
    - Sub-directory WITH index.md -> single boundary entry "/<prefix><name>".
    - Sub-directory WITHOUT index.md -> recurse, prefixing names.
    - index.md file itself -> skipped.
    - *.md files -> "/<prefix><basename>" (extension stripped).
    - Other files -> "/<prefix><name>" (extension kept).
    """
    entries = []
    for entry in dir_lister(dir_path):
        name = entry["name"]
        if is_hidden_name(name):
            continue
        if entry["is_dir"]:
            child_dir = name if dir_path == "." else f"{dir_path}/{name}"
            child_listing = dir_lister(child_dir)
            has_index = any(e["name"] == "index.md" for e in child_listing)
            if has_index:
                entries.append(f"/{prefix}{name}")
            else:
                entries.extend(get_expected_children(child_dir, dir_lister, f"{prefix}{name}/"))
        else:
            if name == "index.md":
                continue
            if name.endswith(".md"):
                base = name[: -len(".md")]
                entries.append(f"/{prefix}{base}")
            else:
                entries.append(f"/{prefix}{name}")
    return entries


def get_declared_children(content: str) -> list[str]:
    """
    Parse the YAML front-matter children: block list from an index.md.

    Returns items exactly as declared (order preserved, set comparison later).
    """
    if not content or not content.strip():
        return []
    children = []
    fm_delimiters = 0
    in_children = False
    for line in re.split(r"\r?\n", content):
        if re.match(r"^---\s*$", line):
            fm_delimiters += 1
            if fm_delimiters >= 2:
                break
            continue
        if fm_delimiters != 1:
            continue
        if re.match(r"^children:\s*$", line):
            in_children = True
            continue
        if in_children:
            m = re.match(r"^\s+-\s+(\S+)\s*$", line)
            if m:
                children.append(m.group(1))
            elif re.match(r"^\S", line):
                in_children = False
    return children


def sets_equal(a: list, b: list) -> bool:
    """Return True when a and b contain the same elements (order-insensitive)."""
    return set(a) == set(b)


def get_index_dirs(dir_path: str, dir_lister, exclude_dirs: frozenset | set = _EXCLUDE_DIRS_DEFAULT) -> list[str]:
    """
    Recursively find all directories that contain an index.md.

    Hidden directories and those in exclude_dirs are skipped.
    """
    result = []
    listing = dir_lister(dir_path)
    if any(e["name"] == "index.md" for e in listing):
        result.append(dir_path)
    for entry in listing:
        if not entry["is_dir"]:
            continue
        name = entry["name"]
        if is_hidden_name(name):
            continue
        if name in exclude_dirs:
            continue
        child_path = name if dir_path == "." else f"{dir_path}/{name}"
        result.extend(get_index_dirs(child_path, dir_lister, exclude_dirs))
    return result


def get_root_index_dirs(index_dirs: list[str]) -> list[str]:
    """
    Return the subset of index_dirs whose parent directory is NOT itself an index dir.

    These are the ROOT index directories for registry checking.
    """
    dir_set = set(index_dirs)
    roots = []
    for d in index_dirs:
        # Parent: everything before the last '/'
        m = re.match(r"^(.*)/[^/]+$", d)
        parent = m.group(1) if m else ""
        if parent not in dir_set:
            roots.append(d)
    return roots


def check_registry_has_entry(content: str, dir_path: str) -> bool:
    """
    Return True when dir_path/ appears in the "Sources of truth" section.

    Named check_ (not test_) so pytest does not collect it as a fixture.
    """
    if not content or not content.strip():
        return False
    needle = dir_path if dir_path.endswith("/") else f"{dir_path}/"
    in_section = False
    for line in re.split(r"\r?\n", content):
        if re.match(r"^#{1,6}\s", line):
            in_section = bool(re.search(r"(?i)sources?\s+of\s+truth|authoritative", line))
            continue
        if in_section and needle in line:
            return True
    return False


def check_registry_role_in_sync(content: str, dir_path: str, intro: str) -> bool:
    """
    Return True when the registry line for dir_path also contains intro.

    If intro is empty, returns True (nothing to verify).
    Named check_ (not test_) so pytest does not collect it as a fixture.
    """
    if not intro:
        return True
    if not content or not content.strip():
        return False
    needle = dir_path if dir_path.endswith("/") else f"{dir_path}/"
    in_section = False
    for line in re.split(r"\r?\n", content):
        if re.match(r"^#{1,6}\s", line):
            in_section = bool(re.search(r"(?i)sources?\s+of\s+truth|authoritative", line))
            continue
        if in_section and needle in line:
            return intro in line
    return False


# ---------------------------------------------------------------------------
# Pure functions: Mode B (docs-revise)
# ---------------------------------------------------------------------------


def get_content_sha(content: str | None) -> str:
    """Return the SHA-256 hex digest of content (UTF-8 encoded)."""
    if content is None:
        content = ""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def get_intro_from_front_matter(content: str) -> str:
    """
    Extract the `intro:` value from YAML front-matter.

    Strips surrounding single or double quotes; returns '' when absent.
    """
    if not content or not content.strip():
        return ""
    fm_delimiters = 0
    for line in re.split(r"\r?\n", content):
        if re.match(r"^---\s*$", line):
            fm_delimiters += 1
            if fm_delimiters >= 2:
                break
            continue
        if fm_delimiters != 1:
            continue
        m = re.match(r"^intro:\s*(.+?)\s*$", line)
        if m:
            val = m.group(1)
            if re.match(r"^'(.*)'$", val):
                return re.match(r"^'(.*)'$", val).group(1)
            if re.match(r'^"(.*)"$', val):
                return re.match(r'^"(.*)"$', val).group(1)
            return val
    return ""


def resolve_revise_queue(paths: list[str]) -> list[dict]:
    """
    Return a single /docs-revise queue entry for all sorted paths,
    or an empty list when paths is empty.
    """
    if not paths:
        return []
    sorted_paths = sorted(paths)
    return [{"command": "/docs-revise", "args": " ".join(sorted_paths)}]


def resolve_enforcement_mode(env_value: str) -> str:
    """Return 'warn' only for 'warn' (case-insensitive); else 'block'."""
    if env_value and env_value.strip().lower() == "warn":
        return "warn"
    return "block"


def expand_host_content(content: str, file_reader) -> str:
    """
    Expand @<path> import lines in content (non-recursive, one level only).

    Lines matching `^@<path>$` cause the referenced file's content to be
    appended. Lines with @ in the middle are ignored.
    """
    expanded = content
    for line in re.split(r"\r?\n", content):
        m = re.match(r"^@(\S+)\s*$", line)
        if m:
            import_path = m.group(1)
            imported = file_reader(import_path)
            if imported and imported.strip():
                expanded = expanded + "\n" + imported
    return expanded


# ---------------------------------------------------------------------------
# Pure function: queue assembly
# ---------------------------------------------------------------------------


def resolve_command_queue(drifted_index_dirs: list[str], registry_drift: bool) -> list[dict]:
    """
    Build the ordered command queue from drift results.

    /docs-index entries come first (sorted by dir), then /docs-registry-sync.
    """
    queue = []
    for d in sorted(drifted_index_dirs):
        args = d if d.endswith("/") else f"{d}/"
        queue.append({"command": "/docs-index", "args": args})
    if registry_drift:
        queue.append({"command": "/docs-registry-sync", "args": ""})
    return queue


def format_block_message(queue: list[dict], standalone: bool = False, mode: str = "block") -> str:
    """
    Format a human-readable block/warn message from the command queue.

    Returns '' for empty/None queues.
    """
    if not queue:
        return ""
    if mode == "warn":
        header = "Documentation maintenance suggested (non-blocking)."
        follow_up = "Recommended commands, in order:"
    else:
        header = "Documentation drift detected in the working tree."
        if standalone:
            follow_up = "Run the following commands to fix:"
        else:
            follow_up = "Run the following commands in order, re-stage modified files, then re-commit:"

    lines = [header, follow_up, ""]
    for i, item in enumerate(queue, start=1):
        cmd = f"{item['command']} {item['args']}" if item.get("args") else item["command"]
        lines.append(f"  {i}. {cmd}")
    lines.append("")
    lines.append("Binding gates: `.claude/agents/docs-keeper.md` §§ Non-overwrite policy + Hard rules.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def get_docs_drift_queue(
    dir_lister,
    file_reader,
    docs_root: str = ".",
    exclude_dirs: frozenset | set = _EXCLUDE_DIRS_DEFAULT,
) -> list[dict]:
    """
    Compute the full drift queue (index + registry) for the docs tree.

    Returns an ordered command queue (may be empty when no drift).
    """
    index_dirs = get_index_dirs(docs_root, dir_lister, exclude_dirs)
    if not index_dirs:
        return []

    # Index drift: compare expected vs declared children for each index dir.
    drifted = []
    for d in index_dirs:
        expected = get_expected_children(d, dir_lister)
        index_path = "index.md" if d == "." else f"{d}/index.md"
        declared = get_declared_children(file_reader(index_path))
        if not sets_equal(expected, declared):
            drifted.append(d)

    # Registry drift: every ROOT must appear in the host root prompt.
    roots = get_root_index_dirs(index_dirs)
    host_file = find_host_root_prompt_file(file_reader)
    host_content = file_reader(host_file) if host_file else ""
    host_content = expand_host_content(host_content, file_reader)

    registry_drift = False
    for root in roots:
        if not check_registry_has_entry(host_content, root):
            registry_drift = True
            continue
        root_index_path = "index.md" if root == "." else f"{root}/index.md"
        intro = get_intro_from_front_matter(file_reader(root_index_path))
        if not check_registry_role_in_sync(host_content, root, intro):
            registry_drift = True

    return resolve_command_queue(drifted, registry_drift)


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
    Core PreToolUse logic — pure orchestration with injectable collaborators.

    Returns a dict: {exit_code, message, reason, queue, mode}.
    """
    # Wire real defaults for any un-injected collaborators.
    if not repo_root:
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                capture_output=True,
                text=True,
            )
            detected = result.stdout.strip()
            if detected:
                repo_root = detected
        except Exception:
            pass

    if git_command_runner is None:
        captured_root = repo_root

        def git_command_runner(argv: list[str]) -> list[str]:
            return git_runner(argv, captured_root)

    if dir_lister is None:
        dir_lister = make_dir_lister(repo_root)

    if file_reader is None:
        file_reader = make_file_reader(repo_root)

    if session_reader is None:
        session_reader = _make_default_session_reader(repo_root, git_command_runner)

    mode = resolve_enforcement_mode(enforcement_mode)

    # PreToolUse: react only to a git commit that stages markdown.
    payload = read_hook_payload(hook_input_json)
    if payload is None:
        return {"exit_code": 0, "message": "", "reason": "no-payload", "queue": [], "mode": mode}

    command = ""
    try:
        tool_input = payload.get("tool_input") or {}
        command = str(tool_input.get("command") or "")
    except (AttributeError, TypeError):
        command = ""

    if not is_git_commit(command):
        return {"exit_code": 0, "message": "", "reason": "not-git-commit", "queue": [], "mode": mode}

    # Get staged changes.
    raw_lines = git_command_runner(["diff", "--cached", "--name-status", "-M"])
    name_status = "\n".join(raw_lines) if isinstance(raw_lines, list) else str(raw_lines)
    changes = convert_git_name_status(name_status)

    if not touches_indexed_content(changes):
        return {"exit_code": 0, "message": "", "reason": "no-docs-change", "queue": [], "mode": mode}

    # Collect staged .md paths (deduplicated).
    staged = []
    seen = set()
    for change in changes:
        p = change.get("path")
        if is_markdown_path(p) and p not in seen:
            staged.append(p)
            seen.add(p)

    # Read session tracker to filter out already-revised files.
    session = session_reader()
    tracked_md = (session or {}).get("tracked_md") or {}

    # reviseMd = staged .md files NOT in tracked_md, OR in tracked_md with revised: false.
    revise_md = [
        p for p in staged if not tracked_md.get(p, {}).get("revised", False)
    ]

    # Index + registry drift.
    drift_queue = get_docs_drift_queue(dir_lister, file_reader)

    # Compose ordered chain: revise -> index -> registry-sync.
    queue = resolve_revise_queue(revise_md) + drift_queue

    if not queue:
        return {"exit_code": 0, "message": "", "reason": "no-docs-drift", "queue": [], "mode": mode}

    exit_code = 0 if mode == "warn" else 2
    reason = "docs-action-suggested" if mode == "warn" else "docs-drift-detected"
    msg = format_block_message(queue, standalone=False, mode=mode)
    return {"exit_code": exit_code, "message": msg, "reason": reason, "queue": queue, "mode": mode}


# ---------------------------------------------------------------------------
# Session I/O (impure) — real filesystem implementations
# ---------------------------------------------------------------------------


def get_docs_keeper_session_path(repo_root: str = "", session_id: str = "") -> str:
    """Return the absolute path to the session JSON file."""
    base = Path(repo_root) / ".docs-keeper" if repo_root else Path(".docs-keeper")
    sid = get_safe_session_id(session_id)
    name = f"session.{sid}.json" if sid else "session.json"
    return str(base / name)


def read_docs_keeper_session(repo_root: str = "", session_id: str = "") -> dict | None:
    """
    Read a single session file; return None when absent or unparseable.

    Result shape: {head, dirty, tracked_md} where tracked_md maps path ->
    {revised: bool}.
    """
    f = Path(get_docs_keeper_session_path(repo_root, session_id))
    if not f.exists():
        return None
    try:
        raw = f.read_text(encoding="utf-8")
        o = json.loads(raw)
        tracked_md = {}
        for path_key, val in (o.get("TrackedMd") or {}).items():
            tracked_md[path_key] = {"revised": bool(val.get("revised", False))}
        return {
            "head": str(o.get("Head") or ""),
            "dirty": list(o.get("Dirty") or []),
            "tracked_md": tracked_md,
        }
    except Exception:
        return None


def read_merged_docs_keeper_sessions(
    repo_root: str = "",
    current_head: str = "",
    session_file_lister=None,
    session_file_reader=None,
) -> dict | None:
    """
    Merge revised: true entries from ALL session files whose Head matches current_head.

    Returns None when no matching sessions exist.

    Accepts injectable session_file_lister / session_file_reader for tests.
    """
    docs_keeper_dir = Path(repo_root) / ".docs-keeper" if repo_root else Path(".docs-keeper")

    if session_file_lister is None:

        def session_file_lister():
            if not docs_keeper_dir.exists():
                return []
            return [str(p) for p in sorted(docs_keeper_dir.glob("session*.json"))]

    if session_file_reader is None:

        def session_file_reader(path: str) -> str:
            try:
                return Path(path).read_text(encoding="utf-8")
            except OSError:
                return ""

    merged: dict[str, dict] = {}
    found = False
    for file_path in session_file_lister():
        try:
            raw = session_file_reader(file_path)
            if not raw or not raw.strip():
                continue
            o = json.loads(raw)
            if not current_head or not o.get("Head") or o["Head"] != current_head:
                continue
            found = True
            for path_key, val in (o.get("TrackedMd") or {}).items():
                if bool(val.get("revised", False)):
                    merged[path_key] = {"revised": True}
        except Exception:
            continue

    if not found:
        return None
    return {"head": current_head, "dirty": [], "tracked_md": merged}


def _make_default_session_reader(repo_root: str, git_command_runner):
    """Build the default session_reader callable used when none is injected."""

    def session_reader() -> dict | None:
        head = ""
        try:
            lines = git_command_runner(["rev-parse", "HEAD"])
            raw = "".join(lines).strip() if isinstance(lines, list) else str(lines).strip()
            if raw:
                head = raw
        except Exception:
            pass
        return read_merged_docs_keeper_sessions(repo_root=repo_root, current_head=head)

    return session_reader


# ---------------------------------------------------------------------------
# stdin reading
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


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Docs-keeper maintenance hook / CI drift gate.")
    parser.add_argument("--drift-only", action="store_true", help="CI path: drift check only.")
    args, _ = parser.parse_known_args()

    # Resolve repo root.
    repo_root = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not repo_root:
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                capture_output=True,
                text=True,
            )
            detected = result.stdout.strip()
            if detected:
                repo_root = detected
        except Exception:
            pass

    # Read stdin for the hook payload (carries session_id).
    hook_input_json = ""
    if not sys.stdin.isatty():
        try:
            hook_input_json = sys.stdin.read()
        except Exception:
            hook_input_json = ""

    enforcement_mode = os.environ.get("DOCS_KEEPER_ENFORCE", "")
    mode = resolve_enforcement_mode(enforcement_mode)

    if args.drift_only:
        # CI path: index + registry drift check only.
        dl = make_dir_lister(repo_root)
        fr = make_file_reader(repo_root)
        drift_queue = get_docs_drift_queue(dl, fr)
        if not drift_queue:
            sys.exit(0)
        msg = format_block_message(drift_queue, standalone=True, mode=mode)
        print(msg, file=sys.stderr)
        sys.exit(0 if mode == "warn" else 2)

    result = invoke_docs_keeper_maintenance(
        hook_input_json=hook_input_json,
        repo_root=repo_root,
        enforcement_mode=enforcement_mode,
    )

    if result["exit_code"] != 0 and result["message"]:
        # Block mode: stderr is surfaced by Claude Code on exit 2.
        print(result["message"], file=sys.stderr)
    elif result["exit_code"] == 0 and result["message"]:
        # Warn mode: exit 0 — emit systemMessage on stdout so the user sees it.
        print(json.dumps({"systemMessage": result["message"]}, separators=(",", ":")))

    sys.exit(result["exit_code"])


if __name__ == "__main__":
    main()
