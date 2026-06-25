"""
pytest suite for the Claude Code session adapter (cc_session.py).

End-to-end: run the real entrypoint as a subprocess against a temp git repo
and assert the session tracker state it writes. No mocks; real git + fs.
"""

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = str(Path(__file__).with_name("cc_session.py"))


def _git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True)


def _init_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    (repo / "README.md").write_text("# seed\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "seed")
    return repo


def _run(args, payload):
    return subprocess.run(
        [sys.executable, SCRIPT, *args],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
    )


class DescribeSnapshotThenTrack:
    def test_snapshot_then_edit_then_track_records_the_md_file(self, tmp_path):
        repo = _init_repo(tmp_path)
        sid = "abc"
        # SessionStart snapshot — baseline HEAD + dirty set.
        snap = _run(["--snapshot-session", "--repo-root", str(repo), "--session-id", sid], {"session_id": sid})
        assert snap.returncode == 0
        session_file = repo / ".docs-keeper" / f"session.{sid}.json"
        assert session_file.exists()

        # Edit a markdown file this "session".
        (repo / "docs.md").write_text("# new doc\n")

        # Stop hook track.
        track = _run(["--track", "--repo-root", str(repo), "--session-id", sid], {"session_id": sid})
        assert track.returncode == 0
        data = json.loads(session_file.read_text())
        assert "docs.md" in data["TrackedMd"]
        assert data["TrackedMd"]["docs.md"]["revised"] is False


class DescribeMarkRevised:
    def test_mark_revised_sets_the_flag_true(self, tmp_path):
        repo = _init_repo(tmp_path)
        sid = "rev"
        _run(["--snapshot-session", "--repo-root", str(repo), "--session-id", sid], {"session_id": sid})
        (repo / "docs.md").write_text("# new doc\n")
        _run(["--track", "--repo-root", str(repo), "--session-id", sid], {"session_id": sid})

        payload = {"session_id": sid, "tool_input": {"skill": "docs-revise", "args": "docs.md"}}
        result = _run(["--mark-revised", "--repo-root", str(repo), "--session-id", sid], payload)
        assert result.returncode == 0
        data = json.loads((repo / ".docs-keeper" / f"session.{sid}.json").read_text())
        assert data["TrackedMd"]["docs.md"]["revised"] is True
