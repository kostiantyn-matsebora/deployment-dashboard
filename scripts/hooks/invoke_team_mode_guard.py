"""
Multi-mode hook that enforces "mode is sticky" for team-process sessions and
persists resumable, per-session run records.

Each concurrent run owns a directory .team-process/sessions/<id>/ (gitignored
runtime state; <id> = sanitized team name) holding session.json (the ledger),
inbox/ (orchestrator typed-form dispatches: BRIEF/FIX) and outbox/ (member
typed-form hand-backs). The EXISTENCE of ANY sessions/<id>/session.json
= team mode is active. A record is the durable run ledger: the orchestrator
writes an initial record (and creates the inbox + outbox dirs) by calling
--set-marker explicitly from /feature-team; the orchestrator enriches it
(roster, phase, ledger) as the run proceeds; it is read on SessionStart to
resume + remind rather than wiped. 'workflow' classifies how to resume
(feature-team vs freeform). The session roster is the source of truth for the
lane file, which is a generated projection (see --sync-lane).

A legacy single-file record at .team-process/session.json (pre-multi-session)
is still read as one active session for back-compat.

Modes:
  (default, PreToolUse(Agent|Task)) when any session record exists, block
    foreground in-session subagent spawns. A spawn is a legitimate member
    (passes through) when it is a background Agent (tool_input.run_in_background
    truthy) OR carries tool_input.team_name (back-compat for any runtime where
    named teams still exist). Nested subagents pass through.
  --set-marker     Create/merge the session record for the run (preserves an
                   existing record's ledger/roster/createdAt). Called explicitly
                   by /feature-team before spawning members; --team names the
                   run (else read from a piped payload, legacy). --workflow sets
                   the classifier (default feature-team); --issue/--summary seed
                   a brand-new record.
  --clear-marker   Remove the named team's session record + lane (reads a piped
                   payload). Legacy: no longer hook-wired -- prefer
                   --end-session --id for teardown.
  --end-session    Manual abandon (the documented teardown). --id <id> abandons
                   one session; no --id abandons all.
  --sync-lane      Project a member's lane from the session roster into
                   run/lane (--id <id> --role <role>). Session roster = source
                   of truth.
  --on-session-start  SessionStart: if any session record exists, emit a resume
                   reminder listing every active run as additionalContext. Does
                   NOT clear.
  --find-session   Look up an active run for --issue <ref> (digits compared, so
                   '#351'/'351' match). Prints the matching run(s) so the lead
                   can PROPOSE resuming instead of starting a parallel team;
                   empty stdout = no match.

Hook I/O contract:
  - Reads a JSON payload from stdin.
  - On a block decision, prints compact JSON {"decision": "block", "reason": ...}
    to stdout and exits 0.
  - On no-op, exits 0 silently.
  - Invalid / missing stdin is a no-op (exit 0).
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Filesystem / clock collaborators — injected as callables so tests can substitute
# real-filesystem functions that work under tmp_path without any mocking.
# ---------------------------------------------------------------------------

def default_git_root() -> str:
    """Return the git repo root, or '' when outside a git repo."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
    )
    lines = result.stdout.strip().splitlines()
    return lines[0].strip() if lines else ""


def default_git_branch(root: str) -> str:
    """Return the current branch name, or '' when not in a git repo."""
    result = subprocess.run(
        ["git", "-C", root, "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
    )
    lines = result.stdout.strip().splitlines()
    return lines[0].strip() if lines else ""


def default_now() -> datetime:
    """Return the current UTC datetime."""
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Path helpers — direct ports of the PowerShell Get-* path functions.
# ---------------------------------------------------------------------------

def get_team_process_base_dir(root: str) -> Path:
    return Path(root) / ".team-process"


def get_sessions_dir(root: str) -> Path:
    return get_team_process_base_dir(root) / "sessions"


def get_lane_file_path(root: str) -> Path:
    return get_team_process_base_dir(root) / "lane"


def get_legacy_session_file_path(root: str) -> Path:
    return get_team_process_base_dir(root) / "session.json"


def get_session_dir(root: str, session_id: str) -> Path:
    return get_sessions_dir(root) / session_id


def get_session_file_path(root: str, session_id: str) -> Path:
    return get_session_dir(root, session_id) / "session.json"


def get_outbox_dir(root: str, session_id: str) -> Path:
    return get_session_dir(root, session_id) / "outbox"


def get_inbox_dir(root: str, session_id: str) -> Path:
    return get_session_dir(root, session_id) / "inbox"


# ---------------------------------------------------------------------------
# Session id helpers.
# ---------------------------------------------------------------------------

def convert_to_session_id(team: str) -> str:
    """
    Sanitize a team name into a filesystem-safe session id (the record's
    filename stem). Path-separator chars collapse to '-'; a dot-only result
    (., .., ...) is rejected so a crafted name can never resolve to a parent
    directory.
    """
    t = (team or "").strip()
    if not t:
        return "unknown"
    # Replace any char outside [A-Za-z0-9._-] with '-', then strip leading/trailing '-'.
    session_id = re.sub(r"[^A-Za-z0-9._\-]", "-", t).strip("-")
    if not session_id:
        return "unknown"
    # Dot-only result (.  ..  ...) -> traversal guard.
    if re.fullmatch(r"\.+", session_id):
        return "unknown"
    return session_id


def is_safe_session_id(session_id: str) -> bool:
    """
    A session id is safe iff it is a single path segment of the allowed charset
    and not dot-only. Backstop before any filesystem op that builds a path from
    an id -- even if a future caller forgets convert_to_session_id, a '..'/
    '/'-bearing id cannot delete a parent.
    """
    if not session_id or not session_id.strip():
        return False
    if not re.fullmatch(r"[A-Za-z0-9._\-]+", session_id):
        return False
    if re.fullmatch(r"\.+", session_id):
        return False
    return True


# ---------------------------------------------------------------------------
# Session record I/O.
# ---------------------------------------------------------------------------

def read_session_record(path: Path) -> dict | None:
    """Parse a session record from disk. Returns None if missing or unparseable."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None


def get_active_session_files(root: str) -> list[Path]:
    """
    All active session record paths: every sessions/<id>/session.json plus a
    legacy session.json if present.
    """
    files: list[Path] = []
    sessions_dir = get_sessions_dir(root)
    if sessions_dir.is_dir():
        for child in sorted(sessions_dir.iterdir()):
            if child.is_dir():
                candidate = child / "session.json"
                if candidate.is_file():
                    files.append(candidate)
    legacy = get_legacy_session_file_path(root)
    if legacy.is_file():
        files.append(legacy)
    return files


def is_any_session_active(root: str) -> bool:
    return len(get_active_session_files(root)) > 0


# ---------------------------------------------------------------------------
# Decision function — port of Get-TeamModeDecision.
# ---------------------------------------------------------------------------

def get_team_mode_decision(
    *,
    is_subagent: bool,
    session_active: bool,
    has_team_name: bool,
    is_background: bool = False,
) -> dict:
    """
    Evaluate the team-mode PreToolUse guardrail and return a decision dict.

    {"block": False}                       -- allow
    {"block": True, "reason": "<string>"}  -- deny
    """
    if is_subagent:
        return {"block": False}
    if not session_active:
        return {"block": False}
    if has_team_name or is_background:
        return {"block": False}
    return {
        "block": True,
        "reason": (
            "Team mode is active (a team-process run is in progress): dispatch to a spawned "
            "member via SendMessage, or spawn a member as a background Agent "
            "('run_in_background: true', 'name' = role) - not a foreground in-session subagent. "
            "Mode is sticky; to change substrate, surface it as a decision. "
            "To abandon a stale session: python3 scripts/hooks/invoke_team_mode_guard.py "
            "--end-session --id <id>. "
            "See .claude/team-process/process.md -> 'Mode is sticky' / 'Session state & resume'."
        ),
    }


# ---------------------------------------------------------------------------
# Payload helpers.
# ---------------------------------------------------------------------------

def get_payload_team_name(payload: dict) -> str:
    """
    Extract the team name from a piped payload (tool_input/tool_response).
    Used by the legacy --clear-marker path and as a fallback team source for
    --set-marker when --team is not supplied.
    """
    for src_key in ("tool_input", "tool_response"):
        src = payload.get(src_key)
        if not isinstance(src, dict):
            continue
        for field in ("team_name", "name", "team"):
            v = src.get(field, "")
            if isinstance(v, str) and v.strip():
                return v
    return ""


# ---------------------------------------------------------------------------
# Session record builder — port of New-SessionRecord.
# ---------------------------------------------------------------------------

def new_session_record(
    *,
    session_id: str,
    team: str,
    workflow: str = "",
    branch: str,
    now: datetime,
    claude_session_id: str = "",
    issue: str = "",
    summary: str = "",
    existing: dict | None = None,
) -> dict:
    """
    Build a fresh session record. existing (if any) preserves resume data on
    re-create (createdAt, phase, roster, ledger, acceptance, decisions, etc.).
    """
    ts = now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    rec: dict = {}

    # id
    rec["id"] = (
        session_id
        or (existing.get("id", "") if existing else "")
        or convert_to_session_id(team)
    )

    # workflow -- passed through RAW (empty when not supplied) so we preserve an
    # existing record's workflow on re-create and default only a brand-new record
    # to feature-team. Defaulting here would clobber a freeform session.
    rec["workflow"] = (
        workflow
        or (existing.get("workflow", "") if existing else "")
        or "feature-team"
    )

    # team
    rec["team"] = (
        team
        or (existing.get("team", "") if existing else "")
        or "unknown"
    )

    # claudeSessionId -- a new value (resume re-create) refreshes; else preserve.
    cs = (
        claude_session_id
        or (existing.get("claudeSessionId", "") if existing else "")
    )
    if cs:
        rec["claudeSessionId"] = cs

    # branch
    if branch:
        rec["branch"] = branch
    elif existing and existing.get("branch"):
        rec["branch"] = existing["branch"]

    # issue -- explicit value seeds brand-new record; existing value preserved on re-create.
    if issue:
        rec["issue"] = issue
    elif existing and existing.get("issue"):
        rec["issue"] = existing["issue"]

    # summary
    if summary:
        rec["summary"] = summary
    elif existing and existing.get("summary"):
        rec["summary"] = existing["summary"]

    # task (freeform) -- preserved from existing when present.
    if existing and existing.get("task"):
        rec["task"] = existing["task"]

    # phase
    rec["phase"] = (existing.get("phase", "") if existing else "") or "created"

    # timestamps
    rec["createdAt"] = (existing.get("createdAt", "") if existing else "") or ts
    rec["updatedAt"] = ts

    # roster -- omit when empty (optional; avoids JSON @()->null quirk).
    roster = list(existing.get("roster", [])) if existing else []
    if roster:
        rec["roster"] = roster

    # ledger
    ledger = list(existing.get("ledger", [])) if existing else []
    if ledger:
        rec["ledger"] = ledger

    # acceptance criteria -- durable resume state, preserved on re-create.
    acceptance = list(existing.get("acceptance", [])) if existing else []
    if acceptance:
        rec["acceptance"] = acceptance

    # decisions -- durable resume state, preserved on re-create.
    decisions = list(existing.get("decisions", [])) if existing else []
    if decisions:
        rec["decisions"] = decisions

    return rec


# ---------------------------------------------------------------------------
# Formatting helpers -- ports of Format-* PowerShell functions.
# ---------------------------------------------------------------------------

def format_roster_status(record: dict) -> str:
    """
    "role=status" digest of the roster, or '' when no roster. Tells the lead
    which member to re-dispatch (and from what status) on resume.
    """
    roster = record.get("roster")
    if not roster:
        return ""
    parts = []
    for entry in roster:
        role = entry.get("role") or "?"
        status = entry.get("status") or "spawned"
        parts.append(f"{role}={status}")
    return ", ".join(parts)


def format_decision_digest(record: dict, max_decisions: int = 6) -> str:
    """
    Compact digest of the locked/proposed decisions, capped so the reminder
    stays scannable. Surfaces the CONTENT (not a count) so the lead can
    re-attach without re-reading the file. '' when none.
    """
    decisions = record.get("decisions")
    if not decisions:
        return ""
    all_decisions = list(decisions)
    shown = []
    for entry in all_decisions[:max_decisions]:
        id_part = f"#{entry['id']} " if entry.get("id") is not None else ""
        text = entry.get("decision") or "(unstated)"
        sup = f" (supersedes: {entry['supersedes']})" if entry.get("supersedes") else ""
        shown.append(f"{id_part}{text}{sup}")
    line = "; ".join(shown)
    overflow = len(all_decisions) - max_decisions
    if overflow > 0:
        line += f" (+{overflow} more)"
    return line


def format_session_line(record: dict) -> str:
    """
    A per-session resume block: header line + (when present) agent statuses
    and the decision digest. Multi-line so the lead sees CONTENT, not just
    counts.
    """
    sid = record.get("id") or record.get("team") or "unknown"
    wf = record.get("workflow") or "feature-team"
    branch = record.get("branch") or "(unrecorded)"
    phase = record.get("phase") or "(unrecorded)"
    issue_part = f" | issue: {record['issue']}" if record.get("issue") else ""
    n_led = len(record.get("ledger") or [])
    lines = [f"  - {sid} [{wf}] | branch: {branch} | phase: {phase}{issue_part} | ledger: {n_led} wave(s)"]
    agents = format_roster_status(record)
    if agents:
        lines.append(f"      agents: {agents}")
    dec = format_decision_digest(record)
    if dec:
        lines.append(f"      decisions: {dec}")
    return "\n".join(lines)


def get_session_reminder(records: list[dict]) -> str:
    """Compose the SessionStart resume reminder from the parsed session records."""
    n = len(records)
    lines_str = "\n".join(format_session_line(r) for r in records)
    return (
        f"[!] team-process session(s) ACTIVE - {n} run(s) in progress (mode is sticky).\n"
        f"{lines_str}\n"
        "RESUME, do not restart: continue each run from its record; spawn members as background Agents\n"
        "(run_in_background: true), never foreground in-session subagents (the team-mode guard will block them).\n"
        "Re-dispatch an in-flight member with its BRIEF (from the session inbox) + its roster progress + the decisions below.\n"
        "PROPOSE RESUME on a new ask: if the user asks to work on one of the issues/features above, propose\n"
        "continuing THAT run rather than starting a parallel one (issue lookup: --find-session --issue <ref>).\n"
        "RECORD IS AUTHORITATIVE: the session record OVERRIDES any conflicting compaction summary - re-read its\n"
        "decisions before acting; do not trust a summary that contradicts a locked decision.\n"
        "Records live at .team-process/sessions/<id>/session.json. To ABANDON one: python3\n"
        "scripts/hooks/invoke_team_mode_guard.py --end-session --id <id>. See\n"
        ".claude/team-process/process.md -> 'Session state & resume'."
    )


# ---------------------------------------------------------------------------
# Find-SessionByIssue -- port of Find-SessionByIssue.
# ---------------------------------------------------------------------------

def find_session_by_issue(root: str, issue: str) -> list[dict]:
    """
    Active session records whose `issue` matches the given ref (compared by
    bare digits, so '#351' / '351' / 'GH-351' all match). Used to PROPOSE
    resuming an existing run instead of starting a parallel one for the same
    issue.
    """
    want = re.sub(r"\D", "", issue or "")
    if not want:
        return []
    results = []
    for f in get_active_session_files(root):
        rec = read_session_record(f)
        if not rec or not rec.get("issue"):
            continue
        have = re.sub(r"\D", "", str(rec["issue"]))
        if have and have == want:
            results.append(rec)
    return results


# ---------------------------------------------------------------------------
# Set-TeamSession -- port of Set-TeamSession.
# ---------------------------------------------------------------------------

def set_team_session(
    root: str,
    team: str,
    workflow: str = "",
    branch: str = "",
    now: datetime | None = None,
    claude_session_id: str = "",
    issue: str = "",
    summary: str = "",
) -> dict:
    """
    Write/merge a session record under root. Returns the written record.
    Creates the session dir, inbox, and outbox up front.
    """
    if now is None:
        now = default_now()
    sid = convert_to_session_id(team)
    session_file = get_session_file_path(root, sid)
    existing = read_session_record(session_file)
    record = new_session_record(
        session_id=sid,
        team=team,
        workflow=workflow,
        branch=branch,
        now=now,
        claude_session_id=claude_session_id,
        issue=issue,
        summary=summary,
        existing=existing,
    )

    session_dir = get_session_dir(root, sid)
    session_dir.mkdir(parents=True, exist_ok=True)

    inbox = get_inbox_dir(root, sid)
    inbox.mkdir(parents=True, exist_ok=True)

    outbox = get_outbox_dir(root, sid)
    outbox.mkdir(parents=True, exist_ok=True)

    session_file.write_text(
        json.dumps(record, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return record


# ---------------------------------------------------------------------------
# Clear-TeamSession -- port of Clear-TeamSession.
# ---------------------------------------------------------------------------

def clear_team_session(root: str, session_id: str = "") -> None:
    """
    Remove session director(ies) + the lane projection.
    session_id non-empty removes one; empty removes all.
    """
    import shutil

    if session_id:
        # Refuse an unsafe id outright -- never let a '..'/separator id reach
        # recursive removal.
        if not is_safe_session_id(session_id):
            return
        d = get_session_dir(root, session_id)
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
    else:
        sessions_dir = get_sessions_dir(root)
        if sessions_dir.exists():
            shutil.rmtree(sessions_dir, ignore_errors=True)
        legacy = get_legacy_session_file_path(root)
        if legacy.exists():
            legacy.unlink(missing_ok=True)

    # lane is a per-worktree projection of the roster -- clear it when a session ends.
    lane = get_lane_file_path(root)
    if lane.exists():
        lane.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Sync-LaneFromSession -- port of Sync-LaneFromSession.
# ---------------------------------------------------------------------------

def sync_lane_from_session(root: str, session_id: str, role: str) -> list[str] | None:
    """
    Project a member's lane from the session roster into run/lane.
    Returns the written globs, or None when no match.
    """
    if not is_safe_session_id(session_id):
        return None
    rec = read_session_record(get_session_file_path(root, session_id))
    if not rec or not rec.get("roster"):
        return None
    entry = None
    for item in rec["roster"]:
        if item.get("role") == role:
            entry = item
            break
    if not entry or not (entry.get("lane") or "").strip():
        return None
    # roster[].lane may carry one glob or several (comma/newline-separated).
    raw_lane = str(entry["lane"])
    globs = [g.strip() for g in re.split(r"[,\r\n]+", raw_lane) if g.strip()]
    if not globs:
        return None
    base_dir = get_team_process_base_dir(root)
    base_dir.mkdir(parents=True, exist_ok=True)
    get_lane_file_path(root).write_text("\n".join(globs), encoding="utf-8")
    return globs


# ---------------------------------------------------------------------------
# Get-SessionStartContext -- port of Get-SessionStartContext.
# ---------------------------------------------------------------------------

def get_session_start_context(root: str) -> str:
    """
    Return the SessionStart additionalContext JSON when any session is active,
    else ''.
    """
    files = get_active_session_files(root)
    if not files:
        return ""
    records = []
    for f in files:
        rec = read_session_record(f)
        if rec:
            records.append(rec)
    if not records:
        return ""
    msg = get_session_reminder(records)
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": msg,
        }
    }
    return json.dumps(payload, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Stdin payload reader (hook I/O contract).
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
# Entry point.
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Team-mode guard hook and session lifecycle manager.",
        add_help=True,
    )
    # Mode switches (mirrors PS1 [switch] params).
    parser.add_argument("--set-marker", action="store_true",
                        help="Write/merge the session record and exit.")
    parser.add_argument("--clear-marker", action="store_true",
                        help="Remove the named team's session record + lane (legacy).")
    parser.add_argument("--end-session", action="store_true",
                        help="Manual abandon: --id for one session, or all.")
    parser.add_argument("--sync-lane", action="store_true",
                        help="Project run/lane from a roster entry and exit.")
    parser.add_argument("--on-session-start", action="store_true",
                        help="Emit the resume reminder (SessionStart) and exit.")
    parser.add_argument("--find-session", action="store_true",
                        help="Print any active run matching --issue and exit.")
    # Value params.
    parser.add_argument("--id", default="", help="Session id for --end-session / --sync-lane.")
    parser.add_argument("--role", default="", help="Member role for --sync-lane.")
    parser.add_argument("--workflow", default="", help="Workflow classifier for --set-marker.")
    parser.add_argument("--issue", default="", help="Issue ref for --find-session; seeds --set-marker.")
    parser.add_argument("--team", default="", help="Run/team name for explicit --set-marker.")
    parser.add_argument("--summary", default="", help="Short run summary that seeds --set-marker.")

    args = parser.parse_args()

    # Resolve repo root (fall back to CWD when not in a git repo, mirroring the PS1).
    git_root = default_git_root()
    root = git_root if git_root else str(Path.cwd())

    if args.set_marker:
        # Read the piped payload ONLY on the legacy path (no --team). When --team is
        # supplied (the explicit /feature-team call) we must NOT touch stdin: a child
        # process launched with an inherited-but-open redirected stdin would block forever
        # in read() waiting for an EOF that never arrives.
        payload: dict = {}
        if not args.team and not sys.stdin.isatty():
            try:
                raw = sys.stdin.read()
                if raw.strip():
                    payload = json.loads(raw)
            except (OSError, ValueError, TypeError):
                payload = {}
        # Team source precedence: explicit --team > piped payload (legacy).
        team = args.team or get_payload_team_name(payload)
        branch = default_git_branch(root)
        claude_session_id = str(payload.get("session_id", "")) if payload else ""
        # Pass --workflow through RAW so new_session_record can PRESERVE an existing
        # record's workflow on re-create and default only a brand-new record to
        # feature-team. Defaulting here would clobber a freeform session.
        set_team_session(
            root,
            team=team,
            workflow=args.workflow,
            branch=branch,
            now=default_now(),
            claude_session_id=claude_session_id,
            issue=args.issue,
            summary=args.summary,
        )
        sys.exit(0)

    if args.clear_marker:
        # Same stdin guard as --set-marker.
        payload = {}
        if not args.team and not sys.stdin.isatty():
            try:
                raw = sys.stdin.read()
                if raw.strip():
                    payload = json.loads(raw)
            except (OSError, ValueError, TypeError):
                payload = {}
        team = args.team or get_payload_team_name(payload)
        # Only clear the named team's session -- never nuke concurrent runs on a missing name.
        if team.strip():
            clear_team_session(root, convert_to_session_id(team))
        sys.exit(0)

    if args.end_session:
        # Sanitize the id through the same gate as session ids.
        if args.id:
            clear_team_session(root, convert_to_session_id(args.id))
        else:
            clear_team_session(root)
        sys.exit(0)

    if args.sync_lane:
        sync_lane_from_session(root, convert_to_session_id(args.id), args.role)
        sys.exit(0)

    if args.on_session_start:
        ctx = get_session_start_context(root)
        if ctx:
            print(ctx)
        sys.exit(0)

    if args.find_session:
        hits = find_session_by_issue(root, args.issue)
        if hits:
            lines_str = "\n".join(format_session_line(r) for r in hits)
            print(
                f"Existing active run(s) for issue {args.issue} - PROPOSE RESUME "
                f"(continue this run; do NOT start a parallel team for the same issue):\n"
                f"{lines_str}"
            )
        sys.exit(0)

    # PreToolUse mode (default, no switches).
    payload = read_payload()
    if not payload:
        sys.exit(0)

    is_subagent = bool(
        (payload.get("agent_type") or "").strip()
        or (payload.get("agent_id") or "").strip()
    )
    session_active = is_any_session_active(root)
    tool_input = payload.get("tool_input") or {}
    has_team_name = bool(
        isinstance(tool_input, dict)
        and (tool_input.get("team_name") or "").strip()
    )
    # A background Agent (run_in_background truthy) is the new member substrate.
    # JSON may carry a real bool or the string 'true'; treat both as background.
    rib = tool_input.get("run_in_background") if isinstance(tool_input, dict) else None
    is_background = rib is True or str(rib).lower() == "true"

    decision = get_team_mode_decision(
        is_subagent=is_subagent,
        session_active=session_active,
        has_team_name=has_team_name,
        is_background=is_background,
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
