"""
Publish a team-process session's decision record to its owning GitHub issue as a
single, idempotent MANAGED COMMENT (upsert by hidden marker — never clobbers the
issue body, never spams duplicate comments).

The session record (.team-process/sessions/<id>/session.json) is the SOURCE OF
TRUTH; this comment is a published Markdown PROJECTION of its `acceptance`,
`decisions`, and the aggregated `ledger[].deferred`. Decisions survive compaction
in the session record; this publishes them to the durable issue at ship so
requirements/decisions are not re-lost.

Pure, unit-tested surface:
  - get_decision_marker        the hidden HTML marker that tags the managed comment.
  - convert_to_decision_markdown render a session record dict into the comment body.
  - find_managed_comment_id     locate the existing managed comment by marker.

Usage:
    python3 scripts/team-process/update_issue_decision_record.py
        (--session-file PATH | --id ID) [--issue NUMBER] [--repo owner/repo]
        [--dry-run]
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Pure functions (fully unit-tested)
# ---------------------------------------------------------------------------


def get_decision_marker() -> str:
    """Return the hidden marker that identifies the single managed comment."""
    return "<!-- team-process:decision-record -->"


def format_cell(text: str) -> str:
    """Escape a value for a single Markdown table cell."""
    t = str(text) if text is not None else ""
    t = re.sub(r"\r?\n", " ", t)
    t = t.replace("|", r"\|")
    return t.strip()


def convert_to_decision_markdown(record: dict) -> str:
    """
    Render a session record dict into the managed-comment body (Markdown).

    Sections with no content are omitted; the decisions table is always present.
    """
    marker = get_decision_marker()
    issue = str(record.get("issue") or "")
    branch = str(record.get("branch") or "(unrecorded)")
    updated = str(record.get("updatedAt") or "")

    lines: list[str] = []
    lines.append(marker)

    if issue:
        title = f"## \U0001f512 Decision record — {issue} · branch `{branch}`"
    else:
        title = f"## \U0001f512 Decision record — branch `{branch}`"
    lines.append(title)

    stamp = f" — last updated {updated}" if updated else ""
    lines.append(
        f"_Maintained by team-process{stamp}. "
        "The session record is the source of truth; this comment is a published projection._"
    )
    lines.append("")

    # Acceptance criteria (locked)
    acceptance = [a for a in (record.get("acceptance") or []) if a]
    if acceptance:
        lines.append("### Acceptance criteria (locked)")
        for a in acceptance:
            lines.append(f"- {a}")
        lines.append("")

    # Decisions (always present)
    lines.append("### Decisions")
    decisions = [d for d in (record.get("decisions") or []) if d]
    if decisions:
        lines.append("| # | Decision | Why | Supersedes | Status |")
        lines.append("|---|---|---|---|---|")
        for d in decisions:
            id_ = str(d["id"]) if d.get("id") is not None else ""
            dec = format_cell(d.get("decision") or "")
            why = format_cell(d.get("why") or "")
            sup = format_cell(d.get("supersedes") or "")
            st = format_cell(d.get("status") or "locked")
            lines.append(f"| {id_} | {dec} | {why} | {sup} | {st} |")
    else:
        lines.append("_No decisions recorded yet._")
    lines.append("")

    # Deferred / follow-ups — aggregated from the per-wave ledger.
    deferred: list[str] = []
    for entry in (record.get("ledger") or []):
        if not entry:
            continue
        d_val = entry.get("deferred")
        if d_val:
            wave = entry.get("wave")
            prefix = f"wave {wave}: " if wave is not None else ""
            deferred.append(f"{prefix}{d_val}")
    if deferred:
        lines.append("### Deferred / follow-ups")
        for f in deferred:
            lines.append(f"- {f}")
        lines.append("")

    # Artifacts (source of truth) — deduped union of all decision refs.
    seen_refs: set[str] = set()
    refs: list[str] = []
    for d in decisions:
        for r in (d.get("refs") or []):
            r_str = str(r)
            if r_str and r_str not in seen_refs:
                seen_refs.add(r_str)
                refs.append(r_str)
    if refs:
        lines.append("### Artifacts (source of truth)")
        for r in refs:
            lines.append(f"- {r}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def find_managed_comment_id(comments: list[dict], marker: str | None = None) -> int | None:
    """
    Find the REST id of the managed comment in a comments list, or None if none exists.

    Comments items must expose 'id' (numeric) and 'body'.
    """
    if marker is None:
        marker = get_decision_marker()
    for c in (comments or []):
        if c is None:
            continue
        if marker in str(c.get("body") or ""):
            return c["id"]
    return None


def get_issue_number(ref: str) -> str:
    """
    Normalize an issue ref ('#351' / '351' / 'GH-351') to its bare number,
    or '' if none.
    """
    if not ref or not ref.strip():
        return ""
    m = re.search(r"\d+", str(ref))
    return m.group(0) if m else ""


# ---------------------------------------------------------------------------
# Entry block (integration only — not unit-tested)
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Publish a team-process session's decision record to its GitHub issue."
    )
    session_group = parser.add_mutually_exclusive_group()
    session_group.add_argument("--session-file", default="", help="Path to session.json.")
    session_group.add_argument("--id", default="", help="Session id (filename stem).")
    parser.add_argument("--issue", default="", help="Issue number.")
    parser.add_argument("--repo", default="", help="owner/repo. If omitted, resolved via gh.")
    parser.add_argument("--dry-run", action="store_true", help="Render the comment body to stdout and exit.")
    args = parser.parse_args()

    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    root = result.stdout.strip().splitlines()[0].strip() if result.returncode == 0 and result.stdout.strip() else ""
    if not root:
        root = str(Path.cwd())

    # Resolve the session file.
    session_file = args.session_file
    if not session_file:
        if not args.id:
            print("Provide --session-file or --id.", file=sys.stderr)
            sys.exit(2)
        session_file = str(Path(root) / ".team-process" / "sessions" / args.id / "session.json")

    if not Path(session_file).exists():
        print(f"Session record not found: {session_file}", file=sys.stderr)
        sys.exit(2)

    record = json.loads(Path(session_file).read_text(encoding="utf-8"))

    # Resolve the issue number (param wins, else the record's issue field).
    issue_ref = args.issue or str(record.get("issue") or "")
    issue_num = get_issue_number(issue_ref)
    if not issue_num:
        print(
            "No issue number — pass --issue, or set the session record's \"issue\" field "
            "(this run is not in issue mode).",
            file=sys.stderr,
        )
        sys.exit(2)

    body = convert_to_decision_markdown(record)

    if args.dry_run:
        sys.stdout.write(body)
        sys.exit(0)

    # Resolve owner/repo for the REST endpoints.
    repo = args.repo
    if not repo:
        r = subprocess.run(
            ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
            capture_output=True,
            text=True,
        )
        repo = r.stdout.strip().splitlines()[0].strip() if r.returncode == 0 and r.stdout.strip() else ""
    if not repo:
        print("Could not resolve owner/repo — pass --repo owner/name.", file=sys.stderr)
        sys.exit(3)

    # Fetch existing comments (REST → numeric ids usable by PATCH).
    r = subprocess.run(
        ["gh", "api", f"repos/{repo}/issues/{issue_num}/comments", "--paginate"],
        capture_output=True,
        text=True,
    )
    comments_json = r.stdout.strip() if r.returncode == 0 else ""
    comments: list[dict] = []
    if comments_json:
        try:
            comments = json.loads(comments_json)
        except (ValueError, TypeError):
            comments = []

    managed_id = find_managed_comment_id(comments)

    # Write the body via a temp file so gh api -F body=@file carries it verbatim.
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", encoding="utf-8", delete=False) as tmp:
        tmp.write(body)
        tmp_path = tmp.name

    try:
        if managed_id:
            subprocess.run(
                ["gh", "api", "-X", "PATCH", f"repos/{repo}/issues/comments/{managed_id}", "-F", f"body=@{tmp_path}"],
                check=True,
            )
            print(f"Updated decision-record comment on #{issue_num} (comment {managed_id}).")
        else:
            subprocess.run(
                ["gh", "api", "-X", "POST", f"repos/{repo}/issues/{issue_num}/comments", "-F", f"body=@{tmp_path}"],
                check=True,
            )
            print(f"Posted decision-record comment on #{issue_num}.")
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    sys.exit(0)


if __name__ == "__main__":
    main()
