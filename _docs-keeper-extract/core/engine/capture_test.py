"""
pytest suite for core/engine/capture.py — doc-capture model + I/O.

Ported from the original invoke_docs_keeper_capture tests. No mocks — real
filesystem operations use tmp_path.
"""

import json
import re

from core.engine.capture import (
    add_docs_capture_entry,
    get_docs_capture_file_path,
    new_docs_capture_entry,
    read_docs_capture,
    write_docs_capture,
)


class DescribeGetDocsCaptureFilePath:
    def test_no_sid_path_ends_in_capture_json(self):
        result = get_docs_capture_file_path("/repo", "")
        assert re.search(r"capture\.json$", result)
        assert not re.search(r"capture\.\.", result)

    def test_with_sid_abc_path_ends_in_capture_abc_json(self):
        assert re.search(r"capture\.abc\.json$", get_docs_capture_file_path("/repo", "abc"))

    def test_path_is_inside_docs_keeper_not_claude(self):
        result = get_docs_capture_file_path("/repo", "abc")
        assert ".docs-keeper" in result
        assert ".claude" not in result


class DescribeNewDocsCaptureEntry:
    def test_returns_dict_with_correct_fields(self):
        e = new_docs_capture_entry("Fix the auth flow docs.", "docs/SAD.md", "manual", "2026-05-30T18:00:00Z")
        assert e["content"] == "Fix the auth flow docs."
        assert e["suggestedDoc"] == "docs/SAD.md"
        assert e["source"] == "manual"
        assert e["capturedAt"] == "2026-05-30T18:00:00Z"

    def test_unknown_source_defaults_to_manual(self):
        assert new_docs_capture_entry("x", "", "bogus", "T")["source"] == "manual"

    def test_valid_source_manual_passes_through(self):
        assert new_docs_capture_entry("x", "", "manual", "T")["source"] == "manual"

    def test_valid_source_compaction_passes_through(self):
        assert new_docs_capture_entry("x", "", "compaction", "T")["source"] == "compaction"


class DescribeAddDocsCaptureEntry:
    def test_appends_entry_to_existing_captures_array(self):
        file = {
            "sessionId": "s1",
            "captures": [{"content": "first", "suggestedDoc": "", "source": "manual", "capturedAt": "T1"}],
        }
        entry = {"content": "second", "suggestedDoc": "", "source": "compaction", "capturedAt": "T2"}
        result = add_docs_capture_entry(file, entry)
        assert len(result["captures"]) == 2
        assert result["captures"][1]["content"] == "second"

    def test_creates_captures_array_when_absent(self):
        result = add_docs_capture_entry({"sessionId": "s1"}, {"content": "only", "suggestedDoc": "", "source": "manual", "capturedAt": "T1"})
        assert len(result["captures"]) == 1

    def test_does_not_mutate_input(self):
        file = {"sessionId": "s1", "captures": []}
        _ = add_docs_capture_entry(file, {"content": "x", "suggestedDoc": "", "source": "manual", "capturedAt": "T1"})
        assert len(file["captures"]) == 0


class DescribeReadWriteRoundTrip:
    def test_write_then_read_returns_the_same_captures(self, tmp_path):
        path = str(tmp_path / ".docs-keeper" / "capture.s.json")
        cf = {"sessionId": "s", "captures": [new_docs_capture_entry("a", "docs/x.md", "manual", "T")]}
        write_docs_capture(path, cf)
        back = read_docs_capture(path)
        assert back["sessionId"] == "s"
        assert back["captures"][0]["content"] == "a"
        assert back["captures"][0]["suggestedDoc"] == "docs/x.md"

    def test_read_returns_none_for_missing_file(self, tmp_path):
        assert read_docs_capture(str(tmp_path / "nope.json")) is None

    def test_read_defaults_captures_to_empty_list(self, tmp_path):
        path = tmp_path / "c.json"
        path.write_text(json.dumps({"sessionId": "s"}), encoding="utf-8")
        assert read_docs_capture(str(path)) == {"sessionId": "s", "captures": []}
