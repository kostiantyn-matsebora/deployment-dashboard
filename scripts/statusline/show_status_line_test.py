"""
pytest suite for show_status_line.py.

Faithful translation of every Pester It block in Show-StatusLine.Tests.ps1.
"""

import json

from show_status_line import (
    format_agent_digest,
    get_active_sessions,
    get_status_line,
    limit_text,
)


# ============================================================
class DescribeGetStatusLine:
    def test_emits_nothing_when_no_sessions(self):
        result = get_status_line([])
        assert not result

    def test_emits_team_name_and_phase_for_one_session(self):
        session = {"id": "feat-1", "phase": "implement"}
        result = get_status_line([session])
        assert result == "team: feat-1 (implement)"

    def test_emits_question_mark_when_phase_absent(self):
        session = {"id": "feat-1"}
        result = get_status_line([session])
        assert result == "team: feat-1 (?)"

    def test_appends_the_team_summary_when_present(self):
        session = {"id": "feat-351", "phase": "implement", "summary": "service visibility glob filter"}
        result = get_status_line([session])
        assert result == "team: feat-351 - service visibility glob filter (implement)"

    def test_appends_the_agent_digest_when_a_roster_is_present(self):
        session = {
            "id": "feat-1",
            "phase": "implement",
            "roster": [
                {"role": "backend", "task": "extract adapter"},
                {"role": "frontend", "task": "glob widget"},
            ],
        }
        result = get_status_line([session])
        assert result == "team: feat-1 (implement) | backend: extract adapter, frontend: glob widget"

    def test_combines_summary_and_agent_digest(self):
        session = {
            "id": "feat-351",
            "phase": "implement",
            "summary": "glob filter",
            "roster": [{"role": "backend", "task": "extract adapter"}],
        }
        result = get_status_line([session])
        assert result == "team: feat-351 - glob filter (implement) | backend: extract adapter"

    def test_falls_back_to_the_bare_role_when_a_member_has_no_task(self):
        session = {
            "id": "feat-1",
            "phase": "plan",
            "roster": [
                {"role": "backend"},
                {"role": "docs", "task": "index"},
            ],
        }
        result = get_status_line([session])
        assert result == "team: feat-1 (plan) | backend, docs: index"

    def test_truncates_a_long_member_task(self):
        import re

        session = {
            "id": "feat-1",
            "phase": "implement",
            "roster": [{"role": "backend", "task": "this is a very long task description that should be cut"}],
        }
        result = get_status_line([session])
        assert re.search(r"backend: this is a very long .+\.$", result)
        assert len(result) < 65  # untruncated would be ~91

    def test_emits_count_for_multiple_sessions_when_no_branch_is_given(self):
        s1 = {"id": "feat-1", "phase": "plan", "summary": "a", "branch": "feat/1"}
        s2 = {"id": "feat-2", "phase": "implement", "branch": "feat/2"}
        s3 = {"id": "feat-3", "phase": "review", "branch": "feat/3"}
        result = get_status_line([s1, s2, s3])
        assert result == "teams (3 active)"

    def test_shows_the_current_run_matched_by_branch_plus_a_count_of_the_others(self):
        s1 = {"id": "feat-1", "phase": "plan", "branch": "feat/1"}
        s2 = {
            "id": "feat-351",
            "phase": "implement",
            "summary": "glob filter",
            "branch": "feat/351",
            "roster": [{"role": "backend", "task": "extract adapter"}],
        }
        s3 = {"id": "feat-3", "phase": "review", "branch": "feat/3"}
        result = get_status_line([s1, s2, s3], current_branch="feat/351")
        assert result == "team: feat-351 - glob filter (implement) | backend: extract adapter (+2 other)"

    def test_falls_back_to_the_count_when_the_branch_matches_no_record(self):
        s1 = {"id": "feat-1", "phase": "plan", "branch": "feat/1"}
        s2 = {"id": "feat-2", "phase": "implement", "branch": "feat/2"}
        result = get_status_line([s1, s2], current_branch="main")
        assert result == "teams (2 active)"

    def test_falls_back_to_the_count_when_the_branch_is_ambiguous(self):
        s1 = {"id": "feat-1a", "phase": "plan", "branch": "feat/dup"}
        s2 = {"id": "feat-1b", "phase": "implement", "branch": "feat/dup"}
        result = get_status_line([s1, s2], current_branch="feat/dup")
        assert result == "teams (2 active)"

    def test_resolves_the_current_run_by_claude_session_id_even_when_branch_is_shared(self):
        s1 = {"id": "feat-1a", "phase": "plan", "branch": "feat/dup", "claudeSessionId": "sess-A"}
        s2 = {"id": "feat-1b", "phase": "implement", "branch": "feat/dup", "claudeSessionId": "sess-B"}
        result = get_status_line([s1, s2], current_branch="feat/dup", current_session_id="sess-B")
        assert result == "team: feat-1b (implement) (+1 other)"

    def test_prefers_claude_session_id_over_branch_when_they_point_at_different_records(self):
        s1 = {"id": "owned", "phase": "implement", "branch": "feat/other", "claudeSessionId": "sess-X"}
        s2 = {"id": "on-branch", "phase": "plan", "branch": "feat/here"}
        result = get_status_line([s1, s2], current_branch="feat/here", current_session_id="sess-X")
        assert result == "team: owned (implement) (+1 other)"

    def test_falls_back_to_branch_when_the_session_id_matches_no_record(self):
        s1 = {"id": "feat-1", "phase": "plan", "branch": "feat/1"}
        s2 = {"id": "feat-2", "phase": "implement", "branch": "feat/2"}
        result = get_status_line([s1, s2], current_branch="feat/2", current_session_id="sess-unknown")
        assert result == "team: feat-2 (implement) (+1 other)"


# ============================================================
class DescribeLimitText:
    def test_returns_the_text_unchanged_when_within_the_limit(self):
        assert limit_text("short", 24) == "short"

    def test_truncates_and_appends_an_ellipsis_when_over_the_limit(self):
        assert limit_text("abcdefghij", 5) == "abcd."


# ============================================================
class DescribeFormatAgentDigest:
    def test_returns_empty_when_there_is_no_roster(self):
        assert format_agent_digest({"id": "x"}) == ""

    def test_renders_role_task_pairs(self):
        rec = {"roster": [{"role": "backend", "task": "do it"}]}
        assert format_agent_digest(rec) == "backend: do it"


# ============================================================
class DescribeGetActiveSessions:
    def test_reads_a_valid_session_json(self, tmp_path):
        sessions_dir = tmp_path / ".team-process" / "sessions" / "feat-1"
        sessions_dir.mkdir(parents=True)
        session_file = sessions_dir / "session.json"
        session_file.write_text(json.dumps({"id": "feat-1", "phase": "implement"}), encoding="utf-8")

        result = get_active_sessions(str(tmp_path))
        assert len(result) == 1
        assert result[0]["id"] == "feat-1"

    def test_ignores_malformed_json(self, tmp_path):
        sessions_dir = tmp_path / ".team-process" / "sessions" / "bad-session"
        sessions_dir.mkdir(parents=True)
        session_file = sessions_dir / "session.json"
        session_file.write_text("not valid json {{{", encoding="utf-8")

        result = get_active_sessions(str(tmp_path))
        assert len(result) == 0

    def test_returns_empty_when_sessions_dir_absent(self, tmp_path):
        # tmp_path exists but has no .team-process/sessions subdirectory
        result = get_active_sessions(str(tmp_path))
        assert len(result) == 0
