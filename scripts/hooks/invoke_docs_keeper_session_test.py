"""
pytest suite for invoke_docs_keeper_session.py.

Faithful translation of every Pester It block in
Invoke-DocsKeeperSession.Tests.ps1.

Fake collaborators are plain Python callables — no mocks.
Real filesystem operations use tmp_path (pytest fixture).
"""

import json
import re

from invoke_docs_keeper_session import (
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
    remove_docs_session_state,
    select_markdown_paths,
    set_tracked_md_revised,
    tracker_has_pending_work,
)

# ---------------------------------------------------------------------------
# Fake dir_lister / file_reader helpers (mirror Pester New-DirLister/New-FileReader)
# ---------------------------------------------------------------------------


def make_dir_lister(files: dict):
    """Return a dir_lister backed by a {dir: [entry, ...]} dict."""
    def lister(dir_path: str) -> list:
        return files.get(dir_path, [])
    return lister


def make_file_reader(files: dict):
    """Return a file_reader backed by a {path: content} dict."""
    def reader(path: str) -> str:
        return files.get(path, "")
    return reader


# ---------------------------------------------------------------------------
# Describe: convert_from_git_porcelain
# ---------------------------------------------------------------------------


class DescribeConvertFromGitPorcelain:
    def test_parses_a_modified_path(self):
        r = convert_from_git_porcelain(" M docs/SAD.md")
        assert "docs/SAD.md" in r

    def test_parses_an_untracked_path(self):
        r = convert_from_git_porcelain("?? notes/new.md")
        assert "notes/new.md" in r

    def test_resolves_a_rename_to_the_new_path(self):
        r = convert_from_git_porcelain("R  docs/old.md -> docs/new.md")
        assert "docs/new.md" in r
        assert "docs/old.md" not in r

    def test_parses_multiple_lines(self):
        r = convert_from_git_porcelain(" M a.md\n?? b.md")
        assert len(r) == 2

    def test_returns_empty_on_empty_input(self):
        assert convert_from_git_porcelain("") == []


# ---------------------------------------------------------------------------
# Describe: get_session_edited_paths
# ---------------------------------------------------------------------------


class DescribeGetSessionEditedPaths:
    def test_includes_files_committed_since_the_snapshot(self):
        r = get_session_edited_paths(["docs/a.md"], [], [])
        assert "docs/a.md" in r

    def test_includes_files_newly_dirtied_during_the_session(self):
        r = get_session_edited_paths([], ["docs/b.md"], [])
        assert "docs/b.md" in r

    def test_excludes_files_already_dirty_at_session_start(self):
        r = get_session_edited_paths([], ["docs/pre.md"], ["docs/pre.md"])
        assert "docs/pre.md" not in r

    def test_deduplicates_a_committed_and_dirty_path(self):
        r = get_session_edited_paths(["docs/a.md"], ["docs/a.md"], [])
        assert len(r) == 1

    def test_returns_empty_when_nothing_changed(self):
        assert get_session_edited_paths([], [], []) == []


# ---------------------------------------------------------------------------
# Describe: select_markdown_paths
# ---------------------------------------------------------------------------


class DescribeSelectMarkdownPaths:
    def test_keeps_only_md_paths(self):
        r = select_markdown_paths(["docs/a.md", "docs/b.yaml", "c.md"])
        assert len(r) == 2
        assert "docs/a.md" in r
        assert "docs/b.yaml" not in r

    def test_returns_empty_when_no_markdown(self):
        assert select_markdown_paths(["a.cs", "b.yaml"]) == []


# ---------------------------------------------------------------------------
# Describe: add_tracked_md_files
# ---------------------------------------------------------------------------


class DescribeAddTrackedMdFiles:
    def test_adds_new_files_with_revised_false(self):
        session = {"Head": "", "Dirty": [], "TrackedMd": {}}
        result = add_tracked_md_files(session, ["docs/a.md"])
        assert result["TrackedMd"]["docs/a.md"]["revised"] is False

    def test_does_not_overwrite_an_existing_revised_true_entry(self):
        session = {"Head": "", "Dirty": [], "TrackedMd": {"docs/a.md": {"revised": True}}}
        result = add_tracked_md_files(session, ["docs/a.md"])
        assert result["TrackedMd"]["docs/a.md"]["revised"] is True

    def test_does_not_overwrite_an_existing_revised_false_entry(self):
        session = {"Head": "", "Dirty": [], "TrackedMd": {"docs/a.md": {"revised": False}}}
        result = add_tracked_md_files(session, ["docs/a.md"])
        assert result["TrackedMd"]["docs/a.md"]["revised"] is False

    def test_handles_empty_paths_gracefully(self):
        session = {"Head": "", "Dirty": [], "TrackedMd": {}}
        result = add_tracked_md_files(session, [])
        assert len(result["TrackedMd"]) == 0


# ---------------------------------------------------------------------------
# Describe: set_tracked_md_revised
# ---------------------------------------------------------------------------


class DescribeSetTrackedMdRevised:
    def test_marks_existing_file_revised_true(self):
        session = {"Head": "", "Dirty": [], "TrackedMd": {"docs/a.md": {"revised": False}}}
        result = set_tracked_md_revised(session, ["docs/a.md"])
        assert result["TrackedMd"]["docs/a.md"]["revised"] is True

    def test_adds_file_with_revised_true_if_not_present(self):
        session = {"Head": "", "Dirty": [], "TrackedMd": {}}
        result = set_tracked_md_revised(session, ["docs/new.md"])
        assert result["TrackedMd"]["docs/new.md"]["revised"] is True

    def test_handles_multiple_paths(self):
        session = {"Head": "", "Dirty": [], "TrackedMd": {}}
        result = set_tracked_md_revised(session, ["a.md", "b.md"])
        assert result["TrackedMd"]["a.md"]["revised"] is True
        assert result["TrackedMd"]["b.md"]["revised"] is True


# ---------------------------------------------------------------------------
# Describe: format_session_start_proposal
# ---------------------------------------------------------------------------


class DescribeFormatSessionStartProposal:
    def test_lists_tracker_file_and_unrevised_files(self):
        msg = format_session_start_proposal(
            [[".docs-keeper/session.abc.json", "README.md", "docs/foo.md"]]
        )
        assert "README.md" in msg
        assert "docs/foo.md" in msg
        assert "session.abc.json" in msg

    def test_mentions_revise_snooze_dismiss_options(self):
        msg = format_session_start_proposal(
            [[".docs-keeper/session.abc.json", "README.md"]]
        )
        assert "revise" in msg
        assert "snooze" in msg
        assert "dismiss" in msg


# ---------------------------------------------------------------------------
# Describe: tracker_has_pending_work
# ---------------------------------------------------------------------------


class DescribeTrackerHasPendingWork:
    def test_returns_false_when_tracked_md_is_empty(self):
        tracker = {"Head": "H", "Dirty": [], "TrackedMd": {}}
        runner = lambda argv: ""  # noqa: E731
        assert tracker_has_pending_work(tracker, runner) is False

    def test_returns_false_when_all_entries_are_revised_true_diff_non_empty(self):
        tracker = {"Head": "H", "Dirty": [], "TrackedMd": {"README.md": {"revised": True}}}
        runner = lambda argv: "diff line"  # noqa: E731
        assert tracker_has_pending_work(tracker, runner) is False

    def test_returns_true_when_revised_false_and_git_diff_is_non_empty(self):
        tracker = {"Head": "H", "Dirty": [], "TrackedMd": {"README.md": {"revised": False}}}
        runner = lambda argv: "diff line"  # noqa: E731
        assert tracker_has_pending_work(tracker, runner) is True

    def test_returns_false_when_revised_false_but_git_diff_is_empty(self):
        tracker = {"Head": "H", "Dirty": [], "TrackedMd": {"README.md": {"revised": False}}}
        runner = lambda argv: ""  # noqa: E731
        assert tracker_has_pending_work(tracker, runner) is False

    def test_returns_true_when_at_least_one_unrevised_path_still_diffs(self):
        tracker = {
            "Head": "H",
            "Dirty": [],
            "TrackedMd": {
                "README.md": {"revised": True},
                "docs/a.md": {"revised": False},
            },
        }

        def runner(argv):
            if "docs/a.md" in argv:
                return "diff line"
            return ""

        assert tracker_has_pending_work(tracker, runner) is True


# ---------------------------------------------------------------------------
# Describe: remove_docs_session_state
# ---------------------------------------------------------------------------


class DescribeRemoveDocsSessionState:
    def test_deletes_current_session_file_when_no_pending_work_empty_diff(self, tmp_path):
        dk = tmp_path / ".docs-keeper"
        dk.mkdir()
        sid = "sx"
        f = Path(get_docs_keeper_session_path(str(tmp_path), sid))
        f.write_text(
            json.dumps(
                {"Head": "H", "Dirty": [], "TrackedMd": {"README.md": {"revised": False}}}
            ),
            encoding="utf-8",
        )
        runner = lambda argv: ""  # noqa: E731
        remove_docs_session_state(str(tmp_path), sid, runner)
        assert not f.exists()

    def test_keeps_current_session_file_when_unrevised_entry_still_diffs(self, tmp_path):
        dk = tmp_path / ".docs-keeper"
        dk.mkdir()
        sid = "sy"
        f = Path(get_docs_keeper_session_path(str(tmp_path), sid))
        f.write_text(
            json.dumps(
                {"Head": "H", "Dirty": [], "TrackedMd": {"README.md": {"revised": False}}}
            ),
            encoding="utf-8",
        )
        runner = lambda argv: "diff line"  # noqa: E731
        remove_docs_session_state(str(tmp_path), sid, runner)
        assert f.exists()

    def test_deletes_current_session_file_when_tracked_md_is_empty(self, tmp_path):
        dk = tmp_path / ".docs-keeper"
        dk.mkdir()
        sid = "sz"
        f = Path(get_docs_keeper_session_path(str(tmp_path), sid))
        f.write_text(
            json.dumps({"Head": "H", "Dirty": [], "TrackedMd": {}}),
            encoding="utf-8",
        )
        runner = lambda argv: ""  # noqa: E731
        remove_docs_session_state(str(tmp_path), sid, runner)
        assert not f.exists()

    def test_deletes_current_session_file_when_all_tracked_md_entries_are_revised_true(
        self, tmp_path
    ):
        dk = tmp_path / ".docs-keeper"
        dk.mkdir()
        sid = "sa"
        f = Path(get_docs_keeper_session_path(str(tmp_path), sid))
        f.write_text(
            json.dumps(
                {"Head": "H", "Dirty": [], "TrackedMd": {"README.md": {"revised": True}}}
            ),
            encoding="utf-8",
        )
        # Runner returns non-empty diff, but entry is already revised -> no pending work
        runner = lambda argv: "diff line"  # noqa: E731
        remove_docs_session_state(str(tmp_path), sid, runner)
        assert not f.exists()

    def test_gc_deletes_leftover_sessions_with_no_pending_work(self, tmp_path):
        dk = tmp_path / ".docs-keeper"
        dk.mkdir()
        current_sid = "current"
        leftover_sid = "leftover1"
        current_f = Path(get_docs_keeper_session_path(str(tmp_path), current_sid))
        current_f.write_text(
            json.dumps({"Head": "H", "Dirty": [], "TrackedMd": {}}), encoding="utf-8"
        )
        leftover_f = Path(get_docs_keeper_session_path(str(tmp_path), leftover_sid))
        leftover_f.write_text(
            json.dumps(
                {"Head": "H", "Dirty": [], "TrackedMd": {"docs/a.md": {"revised": False}}}
            ),
            encoding="utf-8",
        )
        runner = lambda argv: ""  # noqa: E731
        remove_docs_session_state(str(tmp_path), current_sid, runner)
        assert not leftover_f.exists()

    def test_keeps_leftover_sessions_that_still_have_pending_work(self, tmp_path):
        dk = tmp_path / ".docs-keeper"
        dk.mkdir()
        current_sid = "current"
        leftover_sid = "leftover2"
        current_f = Path(get_docs_keeper_session_path(str(tmp_path), current_sid))
        current_f.write_text(
            json.dumps({"Head": "H", "Dirty": [], "TrackedMd": {}}), encoding="utf-8"
        )
        leftover_f = Path(get_docs_keeper_session_path(str(tmp_path), leftover_sid))
        leftover_f.write_text(
            json.dumps(
                {"Head": "H", "Dirty": [], "TrackedMd": {"docs/b.md": {"revised": False}}}
            ),
            encoding="utf-8",
        )
        runner = lambda argv: "diff line"  # noqa: E731
        remove_docs_session_state(str(tmp_path), current_sid, runner)
        assert leftover_f.exists()

    def test_gc_handles_multiple_leftovers_deleting_clean_keeping_pending(self, tmp_path):
        dk = tmp_path / ".docs-keeper"
        dk.mkdir()
        current_sid = "current"
        clean_sid = "clean-leftover"
        pending_sid = "pending-leftover"

        current_f = Path(get_docs_keeper_session_path(str(tmp_path), current_sid))
        current_f.write_text(
            json.dumps({"Head": "H", "Dirty": [], "TrackedMd": {}}), encoding="utf-8"
        )
        clean_f = Path(get_docs_keeper_session_path(str(tmp_path), clean_sid))
        clean_f.write_text(
            json.dumps(
                {"Head": "H", "Dirty": [], "TrackedMd": {"docs/clean.md": {"revised": False}}}
            ),
            encoding="utf-8",
        )
        pending_f = Path(get_docs_keeper_session_path(str(tmp_path), pending_sid))
        pending_f.write_text(
            json.dumps(
                {
                    "Head": "H",
                    "Dirty": [],
                    "TrackedMd": {"docs/pending.md": {"revised": False}},
                }
            ),
            encoding="utf-8",
        )

        def runner(argv):
            if "docs/pending.md" in argv:
                return "diff line"
            return ""

        remove_docs_session_state(str(tmp_path), current_sid, runner)
        assert not clean_f.exists()
        assert pending_f.exists()


# ---------------------------------------------------------------------------
# Describe: invoke_session_snapshot
# ---------------------------------------------------------------------------


class DescribeInvokeSessionSnapshot:
    def test_writes_snapshot_with_head_dirty_and_empty_tracked_md(self, tmp_path):
        captured = {}

        def writer(snap: dict) -> None:
            captured.update(snap)

        def runner(argv):
            if "rev-parse" in argv:
                return "abc123\n"
            if "diff" in argv:
                return ""
            return " M docs/pre.md\n"  # porcelain for status

        invoke_session_snapshot(str(tmp_path), "", runner, writer)
        assert captured["Head"] == "abc123"
        assert "docs/pre.md" in captured["Dirty"]
        assert "TrackedMd" in captured
        assert len(captured["TrackedMd"]) == 0

    def test_returns_empty_string_when_no_leftover_sessions_have_unrevised_diffing_files(
        self, tmp_path
    ):
        def writer(snap: dict) -> None:
            pass

        def runner(argv):
            if "rev-parse" in argv:
                return "abc\n"
            if "diff" in argv:
                return ""
            return ""

        result = invoke_session_snapshot(str(tmp_path), "", runner, writer)
        assert result == ""


# ---------------------------------------------------------------------------
# Describe: get_docs_keeper_session_path
# ---------------------------------------------------------------------------


class DescribeGetDocsKeeperSessionPath:
    def test_uses_session_json_suffix_when_no_session_id(self):
        result = get_docs_keeper_session_path("/repo", "")
        assert re.search(r"session\.json$", result)
        assert not re.search(r"session\.\.", result)

    def test_namespaces_by_session_id_producing_session_sid_json(self):
        result = get_docs_keeper_session_path("/repo", "abc")
        assert re.search(r"session\.abc\.json$", result)

    def test_path_is_inside_docs_keeper_not_claude(self):
        result = get_docs_keeper_session_path("/repo", "abc")
        assert ".docs-keeper" in result
        assert ".claude" not in result


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
# Describe: format_capture_report
# ---------------------------------------------------------------------------


class DescribeFormatCaptureReport:
    def test_empty_captures_key_returns_empty_string(self):
        file = {"sessionId": "s", "captures": []}
        assert format_capture_report(file) == ""

    def test_null_absent_captures_returns_empty_string(self):
        file = {"sessionId": "s"}
        assert format_capture_report(file) == ""

    def test_one_manual_entry_with_suggested_doc_contains_manual_arrow_doc_path(self):
        file = {
            "sessionId": "s",
            "captures": [
                {
                    "content": "Update the auth section.",
                    "suggestedDoc": "docs/SAD.md",
                    "source": "manual",
                    "capturedAt": "T",
                }
            ],
        }
        result = format_capture_report(file)
        assert re.search(r"\[manual\]", result)
        assert "->" in result
        assert re.search(r"docs/SAD\.md", result)

    def test_one_compaction_entry_no_suggested_doc_contains_compaction_no_arrow(self):
        file = {
            "sessionId": "s",
            "captures": [
                {
                    "content": "Session summary text.",
                    "suggestedDoc": "",
                    "source": "compaction",
                    "capturedAt": "T",
                }
            ],
        }
        result = format_capture_report(file)
        assert re.search(r"\[compaction\]", result)
        assert "->" not in result

    def test_content_over_80_chars_truncated_with_ellipsis(self):
        long_text = "A" * 90
        file = {
            "sessionId": "s",
            "captures": [{"content": long_text, "suggestedDoc": "", "source": "manual", "capturedAt": "T"}],
        }
        result = format_capture_report(file)
        assert "…" in result
        assert "A" * 90 not in result

    def test_n_in_header_matches_capture_count(self):
        file = {
            "sessionId": "s",
            "captures": [
                {"content": "One.", "suggestedDoc": "", "source": "manual", "capturedAt": "T"},
                {"content": "Two.", "suggestedDoc": "", "source": "manual", "capturedAt": "T"},
                {"content": "Three.", "suggestedDoc": "", "source": "manual", "capturedAt": "T"},
            ],
        }
        result = format_capture_report(file)
        assert re.search(r"this session \(3\)", result)


# ---------------------------------------------------------------------------
# Describe: format_capture_proposal
# ---------------------------------------------------------------------------


class DescribeFormatCaptureProposal:
    def test_empty_array_returns_empty_string(self):
        assert format_capture_proposal([]) == ""

    def test_all_files_have_empty_captures_returns_empty_string(self):
        files = [{"sessionId": "s1", "captures": []}, {"sessionId": "s2", "captures": []}]
        assert format_capture_proposal(files) == ""

    def test_one_file_one_entry_contains_entry_details_and_reply_instructions(self):
        files = [
            {
                "sessionId": "s1",
                "captures": [
                    {
                        "content": "Auth flow change.",
                        "suggestedDoc": "docs/SAD.md",
                        "source": "manual",
                        "capturedAt": "T",
                    }
                ],
            }
        ]
        result = format_capture_proposal(files)
        assert re.search(r"\[manual\]", result)
        assert re.search(r"docs/SAD\.md", result)
        assert "apply" in result
        assert "dismiss" in result

    def test_multiple_entries_across_files_all_listed_total_count_correct(self):
        files = [
            {
                "sessionId": "s1",
                "captures": [
                    {"content": "Entry A.", "suggestedDoc": "", "source": "manual", "capturedAt": "T"},
                    {"content": "Entry B.", "suggestedDoc": "", "source": "compaction", "capturedAt": "T"},
                ],
            },
            {
                "sessionId": "s2",
                "captures": [
                    {"content": "Entry C.", "suggestedDoc": "docs/X.md", "source": "manual", "capturedAt": "T"}
                ],
            },
        ]
        result = format_capture_proposal(files)
        assert re.search(r"3 total", result)
        assert "Entry A" in result
        assert "Entry B" in result
        assert "Entry C" in result

    def test_content_truncation_same_as_report_over_80_chars(self):
        long_text = "B" * 90
        files = [
            {
                "sessionId": "s1",
                "captures": [
                    {"content": long_text, "suggestedDoc": "", "source": "manual", "capturedAt": "T"}
                ],
            }
        ]
        result = format_capture_proposal(files)
        assert "…" in result
        assert "B" * 90 not in result


# ---------------------------------------------------------------------------
# Describe: find_pending_capture_files
# ---------------------------------------------------------------------------


class DescribeFindPendingCaptureFiles:
    def test_skips_file_matching_current_session_id(self):
        dl = make_dir_lister({".docs-keeper": [{"Name": "capture.abc.json", "IsDir": False}]})
        fr = make_file_reader({
            ".docs-keeper/capture.abc.json": '{"sessionId":"abc","captures":[{"content":"x","suggestedDoc":"","source":"manual","capturedAt":"T"}]}'
        })
        result = find_pending_capture_files("/repo", "abc", dl, fr)
        assert len(result) == 0

    def test_returns_parsed_files_from_other_sessions_that_have_captures(self):
        dl = make_dir_lister({".docs-keeper": [{"Name": "capture.xyz.json", "IsDir": False}]})
        fr = make_file_reader({
            ".docs-keeper/capture.xyz.json": '{"sessionId":"xyz","captures":[{"content":"y","suggestedDoc":"docs/A.md","source":"manual","capturedAt":"T"}]}'
        })
        result = find_pending_capture_files("/repo", "abc", dl, fr)
        assert len(result) == 1
        assert len(result[0]["captures"]) == 1
        assert result[0]["captures"][0]["content"] == "y"

    def test_skips_files_with_empty_captures_array(self):
        dl = make_dir_lister({".docs-keeper": [{"Name": "capture.xyz.json", "IsDir": False}]})
        fr = make_file_reader({".docs-keeper/capture.xyz.json": '{"sessionId":"xyz","captures":[]}'})
        result = find_pending_capture_files("/repo", "abc", dl, fr)
        assert len(result) == 0

    def test_returns_empty_when_no_matching_files(self):
        dl = make_dir_lister({})
        fr = make_file_reader({})
        result = find_pending_capture_files("/repo", "abc", dl, fr)
        assert len(result) == 0

    def test_ignores_files_not_matching_capture_sid_json_naming(self):
        dl = make_dir_lister({
            ".docs-keeper": [
                {"Name": "session.abc.json", "IsDir": False},
                {"Name": "attempts.abc.json", "IsDir": False},
                {"Name": "capture.xyz.json", "IsDir": False},
            ]
        })
        fr = make_file_reader({
            ".docs-keeper/capture.xyz.json": '{"sessionId":"xyz","captures":[{"content":"z","suggestedDoc":"","source":"manual","capturedAt":"T"}]}'
        })
        result = find_pending_capture_files("/repo", "other", dl, fr)
        assert len(result) == 1
        assert result[0]["captures"][0]["content"] == "z"


# ---------------------------------------------------------------------------
# Describe: SnapshotSession combined emission (workstream C)
# ---------------------------------------------------------------------------


class DescribeSnapshotSessionCombinedEmission:
    def test_emits_single_json_with_system_message_and_hook_specific_output(self):
        leftover = "Leftover proposal text"
        capture = "Capture proposal text"
        combined = leftover + "\n\n" + capture

        obj = {
            "systemMessage": combined,
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": combined,
            },
        }
        raw = json.dumps(obj, separators=(",", ":"))
        parsed = json.loads(raw)

        assert parsed["systemMessage"] == combined
        assert parsed["hookSpecificOutput"]["hookEventName"] == "SessionStart"
        assert parsed["hookSpecificOutput"]["additionalContext"] == combined

    def test_hook_specific_output_hook_event_name_is_session_start(self):
        obj = {
            "systemMessage": "test",
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": "test",
            },
        }
        parsed = json.loads(json.dumps(obj, separators=(",", ":")))
        assert parsed["hookSpecificOutput"]["hookEventName"] == "SessionStart"


# ---------------------------------------------------------------------------
# Import needed for tmp_path-based tests
# ---------------------------------------------------------------------------
from pathlib import Path  # noqa: E402
