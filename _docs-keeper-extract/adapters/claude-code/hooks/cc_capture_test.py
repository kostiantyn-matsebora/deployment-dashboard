"""
pytest suite for the Claude Code capture adapter (cc_capture.py).

End-to-end: run the real entrypoint as a subprocess with a CC payload on
stdin and assert the capture file it writes. No mocks; real filesystem.
"""

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = str(Path(__file__).with_name("cc_capture.py"))


def _run(args, payload):
    return subprocess.run(
        [sys.executable, SCRIPT, *args],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
    )


class DescribeAddCapture:
    def test_writes_a_manual_capture_entry(self, tmp_path):
        payload = {"session_id": "s1", "tool_input": {"content": "Document the auth flow.", "suggestedDoc": "docs/SAD.md"}}
        result = _run(["--add-capture", "--repo-root", str(tmp_path)], payload)
        assert result.returncode == 0
        capture_file = tmp_path / ".docs-keeper" / "capture.s1.json"
        assert capture_file.exists()
        data = json.loads(capture_file.read_text())
        assert data["captures"][0]["content"] == "Document the auth flow."
        assert data["captures"][0]["suggestedDoc"] == "docs/SAD.md"
        assert data["captures"][0]["source"] == "manual"

    def test_no_content_is_a_no_op(self, tmp_path):
        result = _run(["--add-capture", "--repo-root", str(tmp_path)], {"session_id": "s1", "tool_input": {}})
        assert result.returncode == 0
        assert not (tmp_path / ".docs-keeper" / "capture.s1.json").exists()


class DescribeCaptureFromSummary:
    def test_writes_a_compaction_capture_entry(self, tmp_path):
        payload = {"session_id": "s2", "summary": "We adopted the index-first doc convention."}
        result = _run(["--capture-from-summary", "--repo-root", str(tmp_path)], payload)
        assert result.returncode == 0
        data = json.loads((tmp_path / ".docs-keeper" / "capture.s2.json").read_text())
        assert data["captures"][0]["source"] == "compaction"
        assert "index-first" in data["captures"][0]["content"]
