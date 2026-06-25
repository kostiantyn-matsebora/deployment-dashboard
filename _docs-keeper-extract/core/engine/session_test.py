"""
pytest suite for core/engine/session.py — session tracker lifecycle.

Ported from the original invoke_docs_keeper_session tests. Fake collaborators
are plain Python callables; real filesystem operations use tmp_path.
"""

import json
import re
from pathlib import Path

from core.engine.session import (
    add_tracked_md_files,
    convert_from_git_porcelain,
    find_pending_capture_files,
    format_capture_proposal,
    format_capture_report,
    format_session_start_proposal,
    get_docs_capture_file_path,
    get_docs_keeper_session_path,
    get_session_edited_paths,
    invoke_session_snapshot,
    read_merged_docs_keeper_sessions,
    remove_docs_session_state,
    select_markdown_paths,
    set_tracked_md_revised,
    tracker_has_pending_work,
)


def make_dir_lister(files: dict):
    def lister(dir_path: str) -> list:
        return files.get(dir_path, [])

    return lister


def make_file_reader(files: dict):
    def reader(path: str) -> str:
        return files.get(path, "")

    return reader


class DescribeConvertFromGitPorcelain:
    def test_parses_a_modified_path(self):
        assert "docs/SAD.md" in convert_from_git_porcelain(" M docs/SAD.md")

    def test_parses_an_untracked_path(self):
        assert "notes/new.md" in convert_from_git_porcelain("?? notes/new.md")

    def test_resolves_a_rename_to_the_new_path(self):
        r = convert_from_git_porcelain("R  docs/old.md -> docs/new.md")
        assert "docs/new.md" in r
        assert "docs/old.md" not in r

    def test_parses_multiple_lines(self):
        assert len(convert_from_git_porcelain(" M a.md\n?? b.md")) == 2

    def test_returns_empty_on_empty_input(self):
        assert convert_from_git_porcelain("") == []


class DescribeGetSessionEditedPaths:
    def test_includes_files_committed_since_the_snapshot(self):
        assert "docs/a.md" in get_session_edited_paths(["docs/a.md"], [], [])

    def test_includes_files_newly_dirtied_during_the_session(self):
        assert "docs/b.md" in get_session_edited_paths([], ["docs/b.md"], [])

    def test_excludes_files_already_dirty_at_session_start(self):
        assert "docs/pre.md" not in get_session_edited_paths([], ["docs/pre.md"], ["docs/pre.md"])

    def test_deduplicates_a_committed_and_dirty_path(self):
        assert len(get_session_edited_paths(["docs/a.md"], ["docs/a.md"], [])) == 1

    def test_returns_empty_when_nothing_changed(self):
        assert get_session_edited_paths([], [], []) == []


class DescribeSelectMarkdownPaths:
    def test_keeps_only_md_paths(self):
        r = select_markdown_paths(["docs/a.md", "docs/b.yaml", "c.md"])
        assert len(r) == 2
        assert "docs/b.yaml" not in r

    def test_returns_empty_when_no_markdown(self):
        assert select_markdown_paths(["a.cs", "b.yaml"]) == []


class DescribeAddTrackedMdFiles:
    def test_adds_new_files_with_revised_false(self):
        result = add_tracked_md_files({"Head": "", "Dirty": [], "TrackedMd": {}}, ["docs/a.md"])
        assert result["TrackedMd"]["docs/a.md"]["revised"] is False

    def test_does_not_overwrite_an_existing_revised_true_entry(self):
        session = {"Head": "", "Dirty": [], "TrackedMd": {"docs/a.md": {"revised": True}}}
        assert add_tracked_md_files(session, ["docs/a.md"])["TrackedMd"]["docs/a.md"]["revised"] is True

    def test_handles_empty_paths_gracefully(self):
        assert len(add_tracked_md_files({"Head": "", "Dirty": [], "TrackedMd": {}}, [])["TrackedMd"]) == 0


class DescribeSetTrackedMdRevised:
    def test_marks_existing_file_revised_true(self):
        session = {"Head": "", "Dirty": [], "TrackedMd": {"docs/a.md": {"revised": False}}}
        assert set_tracked_md_revised(session, ["docs/a.md"])["TrackedMd"]["docs/a.md"]["revised"] is True

    def test_adds_file_with_revised_true_if_not_present(self):
        result = set_tracked_md_revised({"Head": "", "Dirty": [], "TrackedMd": {}}, ["docs/new.md"])
        assert result["TrackedMd"]["docs/new.md"]["revised"] is True

    def test_handles_multiple_paths(self):
        result = set_tracked_md_revised({"Head": "", "Dirty": [], "TrackedMd": {}}, ["a.md", "b.md"])
        assert result["TrackedMd"]["a.md"]["revised"] is True
        assert result["TrackedMd"]["b.md"]["revised"] is True


class DescribeFormatSessionStartProposal:
    def test_lists_tracker_file_and_unrevised_files(self):
        msg = format_session_start_proposal([[".docs-keeper/session.abc.json", "README.md", "docs/foo.md"]])
        assert "README.md" in msg
        assert "docs/foo.md" in msg
        assert "session.abc.json" in msg

    def test_mentions_revise_snooze_dismiss_options(self):
        msg = format_session_start_proposal([[".docs-keeper/session.abc.json", "README.md"]])
        assert "revise" in msg
        assert "snooze" in msg
        assert "dismiss" in msg


class DescribeTrackerHasPendingWork:
    def test_returns_false_when_tracked_md_is_empty(self):
        assert tracker_has_pending_work({"Head": "H", "Dirty": [], "TrackedMd": {}}, lambda argv: "") is False

    def test_returns_false_when_all_entries_are_revised_true_diff_non_empty(self):
        tracker = {"Head": "H", "Dirty": [], "TrackedMd": {"README.md": {"revised": True}}}
        assert tracker_has_pending_work(tracker, lambda argv: "diff line") is False

    def test_returns_true_when_revised_false_and_git_diff_is_non_empty(self):
        tracker = {"Head": "H", "Dirty": [], "TrackedMd": {"README.md": {"revised": False}}}
        assert tracker_has_pending_work(tracker, lambda argv: "diff line") is True

    def test_returns_false_when_revised_false_but_git_diff_is_empty(self):
        tracker = {"Head": "H", "Dirty": [], "TrackedMd": {"README.md": {"revised": False}}}
        assert tracker_has_pending_work(tracker, lambda argv: "") is False

    def test_returns_true_when_at_least_one_unrevised_path_still_diffs(self):
        tracker = {
            "Head": "H",
            "Dirty": [],
            "TrackedMd": {"README.md": {"revised": True}, "docs/a.md": {"revised": False}},
        }

        def runner(argv):
            return "diff line" if "docs/a.md" in argv else ""

        assert tracker_has_pending_work(tracker, runner) is True


class DescribeRemoveDocsSessionState:
    def _write(self, tmp_path, sid, tracked):
        dk = tmp_path / ".docs-keeper"
        dk.mkdir(exist_ok=True)
        f = Path(get_docs_keeper_session_path(str(tmp_path), sid))
        f.write_text(json.dumps({"Head": "H", "Dirty": [], "TrackedMd": tracked}), encoding="utf-8")
        return f

    def test_deletes_current_session_file_when_no_pending_work_empty_diff(self, tmp_path):
        f = self._write(tmp_path, "sx", {"README.md": {"revised": False}})
        remove_docs_session_state(str(tmp_path), "sx", lambda argv: "")
        assert not f.exists()

    def test_keeps_current_session_file_when_unrevised_entry_still_diffs(self, tmp_path):
        f = self._write(tmp_path, "sy", {"README.md": {"revised": False}})
        remove_docs_session_state(str(tmp_path), "sy", lambda argv: "diff line")
        assert f.exists()

    def test_deletes_current_session_file_when_tracked_md_is_empty(self, tmp_path):
        f = self._write(tmp_path, "sz", {})
        remove_docs_session_state(str(tmp_path), "sz", lambda argv: "")
        assert not f.exists()

    def test_deletes_current_session_file_when_all_entries_revised_true(self, tmp_path):
        f = self._write(tmp_path, "sa", {"README.md": {"revised": True}})
        remove_docs_session_state(str(tmp_path), "sa", lambda argv: "diff line")
        assert not f.exists()

    def test_gc_deletes_leftover_sessions_with_no_pending_work(self, tmp_path):
        self._write(tmp_path, "current", {})
        leftover_f = self._write(tmp_path, "leftover1", {"docs/a.md": {"revised": False}})
        remove_docs_session_state(str(tmp_path), "current", lambda argv: "")
        assert not leftover_f.exists()

    def test_keeps_leftover_sessions_that_still_have_pending_work(self, tmp_path):
        self._write(tmp_path, "current", {})
        leftover_f = self._write(tmp_path, "leftover2", {"docs/b.md": {"revised": False}})
        remove_docs_session_state(str(tmp_path), "current", lambda argv: "diff line")
        assert leftover_f.exists()

    def test_gc_handles_multiple_leftovers_deleting_clean_keeping_pending(self, tmp_path):
        self._write(tmp_path, "current", {})
        clean_f = self._write(tmp_path, "clean-leftover", {"docs/clean.md": {"revised": False}})
        pending_f = self._write(tmp_path, "pending-leftover", {"docs/pending.md": {"revised": False}})

        def runner(argv):
            return "diff line" if "docs/pending.md" in argv else ""

        remove_docs_session_state(str(tmp_path), "current", runner)
        assert not clean_f.exists()
        assert pending_f.exists()


class DescribeInvokeSessionSnapshot:
    def test_writes_snapshot_with_head_dirty_and_empty_tracked_md(self, tmp_path):
        captured = {}

        def runner(argv):
            if "rev-parse" in argv:
                return "abc123\n"
            if "diff" in argv:
                return ""
            return " M docs/pre.md\n"

        invoke_session_snapshot(str(tmp_path), "", runner, captured.update)
        assert captured["Head"] == "abc123"
        assert "docs/pre.md" in captured["Dirty"]
        assert len(captured["TrackedMd"]) == 0

    def test_returns_empty_string_when_no_leftover_unrevised_diffing_files(self, tmp_path):
        def runner(argv):
            return "abc\n" if "rev-parse" in argv else ""

        assert invoke_session_snapshot(str(tmp_path), "", runner, lambda snap: None) == ""


class DescribeGetDocsKeeperSessionPath:
    def test_uses_session_json_suffix_when_no_session_id(self):
        result = get_docs_keeper_session_path("/repo", "")
        assert re.search(r"session\.json$", result)
        assert not re.search(r"session\.\.", result)

    def test_namespaces_by_session_id_producing_session_sid_json(self):
        assert re.search(r"session\.abc\.json$", get_docs_keeper_session_path("/repo", "abc"))

    def test_path_is_inside_docs_keeper_not_claude(self):
        result = get_docs_keeper_session_path("/repo", "abc")
        assert ".docs-keeper" in result
        assert ".claude" not in result


class DescribeGetDocsCaptureFilePath:
    def test_no_sid_path_ends_in_capture_json(self):
        result = get_docs_capture_file_path("/repo", "")
        assert re.search(r"capture\.json$", result)
        assert not re.search(r"capture\.\.", result)

    def test_with_sid_abc_path_ends_in_capture_abc_json(self):
        assert re.search(r"capture\.abc\.json$", get_docs_capture_file_path("/repo", "abc"))


class DescribeFormatCaptureReport:
    def test_empty_captures_key_returns_empty_string(self):
        assert format_capture_report({"sessionId": "s", "captures": []}) == ""

    def test_null_absent_captures_returns_empty_string(self):
        assert format_capture_report({"sessionId": "s"}) == ""

    def test_one_manual_entry_with_suggested_doc(self):
        file = {
            "sessionId": "s",
            "captures": [{"content": "Update the auth section.", "suggestedDoc": "docs/SAD.md", "source": "manual", "capturedAt": "T"}],
        }
        result = format_capture_report(file)
        assert "[manual]" in result
        assert "->" in result
        assert "docs/SAD.md" in result

    def test_one_compaction_entry_no_suggested_doc(self):
        file = {
            "sessionId": "s",
            "captures": [{"content": "Session summary text.", "suggestedDoc": "", "source": "compaction", "capturedAt": "T"}],
        }
        result = format_capture_report(file)
        assert "[compaction]" in result
        assert "->" not in result

    def test_content_over_80_chars_truncated_with_ellipsis(self):
        file = {"sessionId": "s", "captures": [{"content": "A" * 90, "suggestedDoc": "", "source": "manual", "capturedAt": "T"}]}
        result = format_capture_report(file)
        assert "…" in result
        assert "A" * 90 not in result

    def test_n_in_header_matches_capture_count(self):
        file = {
            "sessionId": "s",
            "captures": [{"content": f"{i}.", "suggestedDoc": "", "source": "manual", "capturedAt": "T"} for i in range(3)],
        }
        assert re.search(r"this session \(3\)", format_capture_report(file))


class DescribeFormatCaptureProposal:
    def test_empty_array_returns_empty_string(self):
        assert format_capture_proposal([]) == ""

    def test_all_files_have_empty_captures_returns_empty_string(self):
        assert format_capture_proposal([{"sessionId": "s1", "captures": []}]) == ""

    def test_one_file_one_entry_contains_entry_details_and_reply_instructions(self):
        files = [{"sessionId": "s1", "captures": [{"content": "Auth flow change.", "suggestedDoc": "docs/SAD.md", "source": "manual", "capturedAt": "T"}]}]
        result = format_capture_proposal(files)
        assert "[manual]" in result
        assert "docs/SAD.md" in result
        assert "apply" in result
        assert "dismiss" in result

    def test_multiple_entries_across_files_all_listed_total_count_correct(self):
        files = [
            {"sessionId": "s1", "captures": [
                {"content": "Entry A.", "suggestedDoc": "", "source": "manual", "capturedAt": "T"},
                {"content": "Entry B.", "suggestedDoc": "", "source": "compaction", "capturedAt": "T"},
            ]},
            {"sessionId": "s2", "captures": [{"content": "Entry C.", "suggestedDoc": "docs/X.md", "source": "manual", "capturedAt": "T"}]},
        ]
        result = format_capture_proposal(files)
        assert re.search(r"3 total", result)
        assert "Entry A" in result and "Entry B" in result and "Entry C" in result


class DescribeFindPendingCaptureFiles:
    def test_skips_file_matching_current_session_id(self):
        dl = make_dir_lister({".docs-keeper": [{"Name": "capture.abc.json", "IsDir": False}]})
        fr = make_file_reader({".docs-keeper/capture.abc.json": '{"sessionId":"abc","captures":[{"content":"x","suggestedDoc":"","source":"manual","capturedAt":"T"}]}'})
        assert len(find_pending_capture_files("/repo", "abc", dl, fr)) == 0

    def test_returns_parsed_files_from_other_sessions_that_have_captures(self):
        dl = make_dir_lister({".docs-keeper": [{"Name": "capture.xyz.json", "IsDir": False}]})
        fr = make_file_reader({".docs-keeper/capture.xyz.json": '{"sessionId":"xyz","captures":[{"content":"y","suggestedDoc":"docs/A.md","source":"manual","capturedAt":"T"}]}'})
        result = find_pending_capture_files("/repo", "abc", dl, fr)
        assert len(result) == 1
        assert result[0]["captures"][0]["content"] == "y"

    def test_skips_files_with_empty_captures_array(self):
        dl = make_dir_lister({".docs-keeper": [{"Name": "capture.xyz.json", "IsDir": False}]})
        fr = make_file_reader({".docs-keeper/capture.xyz.json": '{"sessionId":"xyz","captures":[]}'})
        assert len(find_pending_capture_files("/repo", "abc", dl, fr)) == 0

    def test_returns_empty_when_no_matching_files(self):
        assert len(find_pending_capture_files("/repo", "abc", make_dir_lister({}), make_file_reader({}))) == 0

    def test_ignores_files_not_matching_capture_sid_json_naming(self):
        dl = make_dir_lister({".docs-keeper": [
            {"Name": "session.abc.json", "IsDir": False},
            {"Name": "attempts.abc.json", "IsDir": False},
            {"Name": "capture.xyz.json", "IsDir": False},
        ]})
        fr = make_file_reader({".docs-keeper/capture.xyz.json": '{"sessionId":"xyz","captures":[{"content":"z","suggestedDoc":"","source":"manual","capturedAt":"T"}]}'})
        result = find_pending_capture_files("/repo", "other", dl, fr)
        assert len(result) == 1
        assert result[0]["captures"][0]["content"] == "z"


class DescribeReadMergedDocsKeeperSessions:
    def test_returns_none_when_no_session_files_listed(self):
        assert read_merged_docs_keeper_sessions(current_head="abc", session_file_lister=lambda: [], session_file_reader=lambda p: "") is None

    def test_returns_none_when_no_session_matches_current_head(self):
        result = read_merged_docs_keeper_sessions(
            current_head="abc123",
            session_file_lister=lambda: ["/fake/s.json"],
            session_file_reader=lambda p: '{"Head":"different","Dirty":[],"TrackedMd":{"a.md":{"revised":true}}}',
        )
        assert result is None

    def test_returns_merged_tracked_md_for_a_single_matching_session(self):
        result = read_merged_docs_keeper_sessions(
            current_head="abc123",
            session_file_lister=lambda: ["/fake/s.json"],
            session_file_reader=lambda p: '{"Head":"abc123","Dirty":[],"TrackedMd":{"docs/a.md":{"revised":true}}}',
        )
        assert result["tracked_md"]["docs/a.md"]["revised"] is True

    def test_excludes_entry_where_revised_false(self):
        result = read_merged_docs_keeper_sessions(
            current_head="abc123",
            session_file_lister=lambda: ["/fake/s.json"],
            session_file_reader=lambda p: '{"Head":"abc123","Dirty":[],"TrackedMd":{"docs/a.md":{"revised":false}}}',
        )
        assert "docs/a.md" not in result["tracked_md"]

    def test_merges_tracked_md_from_two_sessions_with_the_same_head(self):
        files = {
            "/fake/s1.json": '{"Head":"abc123","Dirty":[],"TrackedMd":{"docs/a.md":{"revised":true}}}',
            "/fake/s2.json": '{"Head":"abc123","Dirty":[],"TrackedMd":{"docs/b.md":{"revised":true}}}',
        }
        result = read_merged_docs_keeper_sessions(
            current_head="abc123",
            session_file_lister=lambda: ["/fake/s1.json", "/fake/s2.json"],
            session_file_reader=lambda p: files[p],
        )
        assert result["tracked_md"]["docs/a.md"]["revised"] is True
        assert result["tracked_md"]["docs/b.md"]["revised"] is True

    def test_skips_malformed_json_without_throwing(self):
        files = {
            "/fake/bad.json": "not-json",
            "/fake/good.json": '{"Head":"abc123","Dirty":[],"TrackedMd":{"docs/a.md":{"revised":true}}}',
        }
        result = read_merged_docs_keeper_sessions(
            current_head="abc123",
            session_file_lister=lambda: ["/fake/bad.json", "/fake/good.json"],
            session_file_reader=lambda p: files[p],
        )
        assert result["tracked_md"]["docs/a.md"]["revised"] is True
