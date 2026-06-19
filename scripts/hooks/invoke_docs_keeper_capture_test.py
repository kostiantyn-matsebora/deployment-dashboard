"""
pytest suite for invoke_docs_keeper_capture.py.

Faithful translation of every Pester It block in
Invoke-DocsKeeperCapture.Tests.ps1.

No mocks — real filesystem operations use tmp_path.
"""

import re

from invoke_docs_keeper_capture import (
    add_docs_capture_entry,
    get_docs_capture_file_path,
    new_docs_capture_entry,
)

# ---------------------------------------------------------------------------
# Describe: get_docs_capture_file_path
# ---------------------------------------------------------------------------


class DescribeGetDocsCaptureFilePath:
    def test_no_sid_path_ends_in_capture_json(self):
        result = get_docs_capture_file_path("/repo", "")
        assert re.search(r"capture\.json$", result)
        assert not re.search(r"capture\.\.", result)

    def test_with_sid_abc_path_ends_in_capture_abc_json(self):
        result = get_docs_capture_file_path("/repo", "abc")
        assert re.search(r"capture\.abc\.json$", result)

    def test_path_is_inside_docs_keeper_not_claude(self):
        result = get_docs_capture_file_path("/repo", "abc")
        assert ".docs-keeper" in result
        assert ".claude" not in result


# ---------------------------------------------------------------------------
# Describe: new_docs_capture_entry
# ---------------------------------------------------------------------------


class DescribeNewDocsCaptureEntry:
    def test_returns_dict_with_correct_fields(self):
        e = new_docs_capture_entry(
            "Fix the auth flow docs.",
            "docs/SAD.md",
            "manual",
            "2026-05-30T18:00:00Z",
        )
        assert e["content"] == "Fix the auth flow docs."
        assert e["suggestedDoc"] == "docs/SAD.md"
        assert e["source"] == "manual"
        assert e["capturedAt"] == "2026-05-30T18:00:00Z"

    def test_unknown_source_defaults_to_manual(self):
        e = new_docs_capture_entry("x", "", "bogus", "2026-01-01T00:00:00Z")
        assert e["source"] == "manual"

    def test_valid_source_manual_passes_through(self):
        e = new_docs_capture_entry("x", "", "manual", "2026-01-01T00:00:00Z")
        assert e["source"] == "manual"

    def test_valid_source_compaction_passes_through(self):
        e = new_docs_capture_entry("x", "", "compaction", "2026-01-01T00:00:00Z")
        assert e["source"] == "compaction"


# ---------------------------------------------------------------------------
# Describe: add_docs_capture_entry
# ---------------------------------------------------------------------------


class DescribeAddDocsCaptureEntry:
    def test_appends_entry_to_existing_captures_array(self):
        file = {
            "sessionId": "s1",
            "captures": [
                {"content": "first", "suggestedDoc": "", "source": "manual", "capturedAt": "T1"}
            ],
        }
        entry = {"content": "second", "suggestedDoc": "", "source": "compaction", "capturedAt": "T2"}
        result = add_docs_capture_entry(file, entry)
        assert len(result["captures"]) == 2
        assert result["captures"][1]["content"] == "second"

    def test_creates_captures_array_when_absent(self):
        file = {"sessionId": "s1"}
        entry = {"content": "only", "suggestedDoc": "", "source": "manual", "capturedAt": "T1"}
        result = add_docs_capture_entry(file, entry)
        assert len(result["captures"]) == 1

    def test_does_not_mutate_input(self):
        file = {"sessionId": "s1", "captures": []}
        entry = {"content": "x", "suggestedDoc": "", "source": "manual", "capturedAt": "T1"}
        _ = add_docs_capture_entry(file, entry)
        assert len(file["captures"]) == 0
