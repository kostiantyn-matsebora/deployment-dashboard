"""
pytest suite for invoke_team_mode_guard.py.

Faithful translation of every Pester It block in Invoke-TeamModeGuard.Tests.ps1.

Tests use real filesystem operations under pytest tmp_path -- NO mocks.
Schema-conformance tests validate session.json against the JSON Schema file
at .claude/team-process/schemas/session.schema.json using jsonschema (stdlib
fallback: if jsonschema is absent, those tests are skipped).

Note on subprocess ("entry block dispatch") tests:
  The Pester suite uses Push-Location to a temp dir so `git rev-parse
  --show-toplevel` fails and the script falls back to CWD. We reproduce that
  by running the script as a subprocess with cwd=tmp_path.
"""

import json
import os
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
from invoke_team_mode_guard import (
    clear_team_session,
    convert_to_session_id,
    find_session_by_issue,
    format_decision_digest,
    format_roster_status,
    get_active_session_files,
    get_inbox_dir,
    get_lane_file_path,
    get_legacy_session_file_path,
    get_outbox_dir,
    get_payload_team_name,
    get_session_dir,
    get_session_file_path,
    get_session_reminder,
    get_session_start_context,
    get_sessions_dir,
    get_team_mode_decision,
    get_team_process_base_dir,
    is_any_session_active,
    is_safe_session_id,
    new_session_record,
    set_team_session,
    sync_lane_from_session,
)

# ---------------------------------------------------------------------------
# Shared fixture: fixed "now" timestamp (mirrors $script:FixedNow in Pester).
# ---------------------------------------------------------------------------

FIXED_NOW = datetime(2026, 6, 14, 12, 0, 0, tzinfo=UTC)
SCRIPT_PATH = Path(__file__).parent / "invoke_team_mode_guard.py"
SCHEMA_FILE = (
    Path(__file__).parent.parent.parent
    / ".claude"
    / "team-process"
    / "schemas"
    / "session.schema.json"
)

# ---------------------------------------------------------------------------
# Optional jsonschema import (for Schema conformance tests).
# ---------------------------------------------------------------------------

try:
    import jsonschema  # type: ignore

    _SCHEMA = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    HAS_JSONSCHEMA = True
except (ImportError, OSError):
    HAS_JSONSCHEMA = False
    _SCHEMA = {}

needs_jsonschema = pytest.mark.skipif(
    not HAS_JSONSCHEMA, reason="jsonschema not installed"
)


def validate_record(record: dict) -> bool:
    """Return True if the record is valid per the session schema."""
    try:
        jsonschema.validate(record, _SCHEMA)
        return True
    except jsonschema.ValidationError:
        return False


# ============================================================
# Describe: get_team_mode_decision
# ============================================================


class DescribeGetTeamModeDecision:
    def test_allows_subagent_caller_even_with_active_session(self):
        result = get_team_mode_decision(
            is_subagent=True, session_active=True, has_team_name=False
        )
        assert result["block"] is False

    def test_allows_when_no_session_is_active(self):
        result = get_team_mode_decision(
            is_subagent=False, session_active=False, has_team_name=False
        )
        assert result["block"] is False

    def test_allows_member_spawn_as_background_agent_session_active(self):
        result = get_team_mode_decision(
            is_subagent=False,
            session_active=True,
            has_team_name=False,
            is_background=True,
        )
        assert result["block"] is False

    def test_allows_member_spawn_with_team_name_back_compat_session_active(self):
        result = get_team_mode_decision(
            is_subagent=False,
            session_active=True,
            has_team_name=True,
            is_background=False,
        )
        assert result["block"] is False

    def test_blocks_foreground_in_session_subagent_when_session_is_active(self):
        result = get_team_mode_decision(
            is_subagent=False,
            session_active=True,
            has_team_name=False,
            is_background=False,
        )
        assert result["block"] is True
        assert "Team mode is active" in result["reason"]
        assert "background Agent" in result["reason"]
        assert "run_in_background" in result["reason"]
        assert "--end-session" in result["reason"]

    def test_allows_background_spawn_without_active_session_yet(self):
        result = get_team_mode_decision(
            is_subagent=False,
            session_active=False,
            has_team_name=False,
            is_background=True,
        )
        assert result["block"] is False

    def test_allows_team_name_present_without_active_session_yet(self):
        result = get_team_mode_decision(
            is_subagent=False,
            session_active=False,
            has_team_name=True,
            is_background=False,
        )
        assert result["block"] is False


# ============================================================
# Describe: Path helpers
# ============================================================


class DescribePathHelpers:
    def test_session_file_is_sessions_id_session_json(self):
        p = str(get_session_file_path("/r", "feat-9")).replace("\\", "/")
        assert re.search(r"/\.team-process/sessions/feat-9/session\.json$", p)

    def test_session_dir_is_sessions_id(self):
        p = str(get_session_dir("/r", "feat-9")).replace("\\", "/")
        assert re.search(r"/\.team-process/sessions/feat-9$", p)

    def test_outbox_dir_is_sessions_id_outbox(self):
        p = str(get_outbox_dir("/r", "feat-9")).replace("\\", "/")
        assert re.search(r"/\.team-process/sessions/feat-9/outbox$", p)

    def test_inbox_dir_is_sessions_id_inbox(self):
        p = str(get_inbox_dir("/r", "feat-9")).replace("\\", "/")
        assert re.search(r"/\.team-process/sessions/feat-9/inbox$", p)

    def test_sessions_dir_is_directly_under_team_process(self):
        p = str(get_sessions_dir("/r")).replace("\\", "/")
        assert re.search(r"/\.team-process/sessions$", p)

    def test_lane_file_is_directly_under_team_process(self):
        p = str(get_lane_file_path("/r")).replace("\\", "/")
        assert re.search(r"/\.team-process/lane$", p)

    def test_legacy_single_file_is_team_process_session_json(self):
        p = str(get_legacy_session_file_path("/r")).replace("\\", "/")
        assert re.search(r"/\.team-process/session\.json$", p)


# ============================================================
# Describe: convert_to_session_id
# ============================================================


class DescribeConvertToSessionId:
    def test_passes_through_already_safe_team_name(self):
        assert convert_to_session_id("feat-321") == "feat-321"

    def test_replaces_unsafe_characters_and_trims_separators(self):
        assert convert_to_session_id("feat/3 21!") == "feat-3-21"

    def test_falls_back_to_unknown_for_blank_input(self):
        assert convert_to_session_id("") == "unknown"

    def test_rejects_dot_only_traversal_ids_double_dot(self):
        assert convert_to_session_id("..") == "unknown"

    def test_rejects_dot_only_traversal_ids_single_dot(self):
        assert convert_to_session_id(".") == "unknown"

    def test_rejects_dot_only_traversal_ids_triple_dot(self):
        assert convert_to_session_id("...") == "unknown"

    def test_collapses_path_separators_so_traversal_cannot_survive(self):
        # '/' -> '-'; result is one safe segment with no bare '..' between separators.
        sid = convert_to_session_id("../../etc")
        assert sid == "..-..-etc"
        assert is_safe_session_id(sid) is True


# ============================================================
# Describe: is_safe_session_id
# ============================================================


class DescribeIsSafeSessionId:
    def test_accepts_a_normal_id(self):
        assert is_safe_session_id("feat-321") is True

    def test_rejects_double_dot(self):
        assert is_safe_session_id("..") is False

    def test_rejects_single_dot(self):
        assert is_safe_session_id(".") is False

    def test_rejects_a_separator(self):
        assert is_safe_session_id("../x") is False

    def test_rejects_a_backslash(self):
        assert is_safe_session_id("a\\b") is False

    def test_rejects_blank(self):
        assert is_safe_session_id("") is False


# ============================================================
# Describe: get_payload_team_name
# ============================================================


class DescribeGetPayloadTeamName:
    def test_reads_tool_input_team_name(self):
        payload = {"tool_input": {"team_name": "feat-9"}}
        assert get_payload_team_name(payload) == "feat-9"

    def test_falls_back_to_tool_input_name(self):
        payload = {"tool_input": {"name": "feat-x"}}
        assert get_payload_team_name(payload) == "feat-x"

    def test_reads_from_tool_response_when_tool_input_lacks_it(self):
        payload = {"tool_input": {}, "tool_response": {"team": "feat-r"}}
        assert get_payload_team_name(payload) == "feat-r"

    def test_returns_empty_when_no_name_is_present(self):
        payload = {"tool_input": {}}
        assert get_payload_team_name(payload) == ""


# ============================================================
# Describe: new_session_record
# ============================================================


class DescribeNewSessionRecord:
    def test_builds_fresh_record_with_id_phase_created_and_matching_timestamps(self):
        rec = new_session_record(
            session_id="feat-1",
            team="feat-1",
            branch="feat/x",
            now=FIXED_NOW,
            existing=None,
        )
        assert rec["id"] == "feat-1"
        assert rec["team"] == "feat-1"
        assert rec["branch"] == "feat/x"
        assert rec["phase"] == "created"
        assert rec["createdAt"] == rec["updatedAt"]

    def test_defaults_workflow_to_feature_team(self):
        rec = new_session_record(
            session_id="feat-1",
            team="feat-1",
            branch="feat/x",
            now=FIXED_NOW,
            existing=None,
        )
        assert rec["workflow"] == "feature-team"

    def test_derives_id_from_team_when_session_id_omitted(self):
        rec = new_session_record(
            session_id="",
            team="feat/9 a",
            branch="",
            now=FIXED_NOW,
            existing=None,
        )
        assert rec["id"] == "feat-9-a"

    def test_honors_an_explicit_workflow(self):
        rec = new_session_record(
            session_id="task-1",
            team="task-1",
            workflow="freeform",
            branch="",
            now=FIXED_NOW,
            existing=None,
        )
        assert rec["workflow"] == "freeform"

    def test_omits_roster_and_ledger_when_empty(self):
        rec = new_session_record(
            session_id="feat-1",
            team="feat-1",
            branch="feat/x",
            now=FIXED_NOW,
            existing=None,
        )
        assert "roster" not in rec
        assert "ledger" not in rec

    def test_falls_back_to_team_unknown_when_none_supplied(self):
        rec = new_session_record(
            session_id="unknown",
            team="",
            branch="",
            now=FIXED_NOW,
            existing=None,
        )
        assert rec["team"] == "unknown"

    def test_captures_the_owning_claude_session_id_when_supplied(self):
        rec = new_session_record(
            session_id="feat-1",
            team="feat-1",
            branch="feat/x",
            now=FIXED_NOW,
            claude_session_id="sess-A",
            existing=None,
        )
        assert rec["claudeSessionId"] == "sess-A"

    def test_omits_claude_session_id_when_neither_supplied_nor_existing(self):
        rec = new_session_record(
            session_id="feat-1",
            team="feat-1",
            branch="feat/x",
            now=FIXED_NOW,
            existing=None,
        )
        assert "claudeSessionId" not in rec

    def test_refreshes_claude_session_id_on_recreate_new_value_overrides_existing(self):
        existing = {
            "id": "feat-1",
            "workflow": "feature-team",
            "team": "feat-1",
            "phase": "implement",
            "createdAt": "2026-01-01T00:00:00Z",
            "claudeSessionId": "old-sess",
        }
        rec = new_session_record(
            session_id="feat-1",
            team="feat-1",
            branch="feat/x",
            now=FIXED_NOW,
            claude_session_id="new-sess",
            existing=existing,
        )
        assert rec["claudeSessionId"] == "new-sess"

    def test_preserves_existing_claude_session_id_when_no_new_one_supplied(self):
        existing = {
            "id": "feat-1",
            "workflow": "feature-team",
            "team": "feat-1",
            "phase": "implement",
            "createdAt": "2026-01-01T00:00:00Z",
            "claudeSessionId": "keep-sess",
        }
        rec = new_session_record(
            session_id="feat-1",
            team="feat-1",
            branch="feat/x",
            now=FIXED_NOW,
            existing=existing,
        )
        assert rec["claudeSessionId"] == "keep-sess"

    def test_preserves_id_workflow_created_at_ledger_roster_issue_task_on_recreate(self):
        existing = {
            "id": "feat-1",
            "workflow": "freeform",
            "team": "feat-1",
            "branch": "feat/x",
            "issue": "#42",
            "summary": "glob filter",
            "task": "do thing",
            "phase": "implement",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
            "roster": [{"role": "backend"}],
            "ledger": [{"wave": 1}],
        }
        rec = new_session_record(
            session_id="feat-1",
            team="feat-1",
            branch="feat/x",
            now=FIXED_NOW,
            existing=existing,
        )
        assert rec["id"] == "feat-1"
        assert rec["workflow"] == "freeform"
        assert rec["createdAt"] == "2026-01-01T00:00:00Z"
        assert rec["phase"] == "implement"
        assert rec["issue"] == "#42"
        assert rec["summary"] == "glob filter"
        assert rec["task"] == "do thing"
        assert len(rec["roster"]) == 1
        assert len(rec["ledger"]) == 1
        assert rec["updatedAt"] != rec["createdAt"]

    def test_preserves_acceptance_and_decisions_durable_resume_state_on_recreate(self):
        existing = {
            "id": "feat-1",
            "workflow": "feature-team",
            "team": "feat-1",
            "phase": "implement",
            "createdAt": "2026-01-01T00:00:00Z",
            "acceptance": ["chevron toggles the row"],
            "decisions": [
                {
                    "id": 1,
                    "decision": "glob widget",
                    "supersedes": "issue text",
                    "status": "locked",
                }
            ],
        }
        rec = new_session_record(
            session_id="feat-1",
            team="feat-1",
            branch="feat/x",
            now=FIXED_NOW,
            existing=existing,
        )
        assert len(rec["acceptance"]) == 1
        assert len(rec["decisions"]) == 1
        assert rec["decisions"][0]["decision"] == "glob widget"
        assert rec["decisions"][0]["supersedes"] == "issue text"


# ============================================================
# Describe: Schema conformance
# ============================================================


class DescribeSchemaConformance:
    @needs_jsonschema
    def test_accepts_a_feature_team_record_with_an_enum_phase(self):
        rec = new_session_record(
            session_id="feat-1",
            team="feat-1",
            branch="feat/x",
            now=FIXED_NOW,
            existing=None,
        )
        assert validate_record(rec) is True

    @needs_jsonschema
    def test_accepts_a_freeform_record_with_a_free_form_phase_string(self):
        existing = {"phase": "gathering"}
        rec = new_session_record(
            session_id="task-1",
            team="task-1",
            workflow="freeform",
            branch="feat/x",
            now=FIXED_NOW,
            existing=existing,
        )
        assert validate_record(rec) is True

    @needs_jsonschema
    def test_rejects_a_feature_team_record_with_a_non_enum_phase(self):
        bad = {
            "id": "feat-1",
            "workflow": "feature-team",
            "team": "feat-1",
            "phase": "gathering",
            "createdAt": "2026-01-01T00:00:00Z",
        }
        assert validate_record(bad) is False

    @needs_jsonschema
    def test_rejects_a_record_missing_the_required_workflow_field(self):
        bad = {"id": "feat-1", "team": "feat-1", "createdAt": "2026-01-01T00:00:00Z"}
        assert validate_record(bad) is False

    @needs_jsonschema
    def test_accepts_a_record_carrying_acceptance_decisions_and_roster_progress(self):
        rec = {
            "id": "feat-1",
            "workflow": "feature-team",
            "team": "feat-1",
            "phase": "implement",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-02T00:00:00Z",
            "roster": [
                {
                    "role": "backend",
                    "lane": "backend/**",
                    "status": "in-progress",
                    "progress": "adapter extracted, tests pending",
                }
            ],
            "acceptance": ["chevron toggles the row"],
            "decisions": [
                {
                    "id": 1,
                    "decision": "glob widget",
                    "why": "matches mockup",
                    "supersedes": "issue text",
                    "status": "locked",
                    "refs": ["docs/design/mockup/x"],
                }
            ],
        }
        assert validate_record(rec) is True

    @needs_jsonschema
    def test_rejects_a_decision_entry_with_an_unknown_field_additional_properties_false(
        self,
    ):
        bad = {
            "id": "feat-1",
            "workflow": "feature-team",
            "team": "feat-1",
            "phase": "implement",
            "createdAt": "2026-01-01T00:00:00Z",
            "decisions": [{"id": 1, "decision": "x", "bogus": "y"}],
        }
        assert validate_record(bad) is False

    @needs_jsonschema
    def test_rejects_a_decision_with_an_invalid_status_enum(self):
        bad = {
            "id": "feat-1",
            "workflow": "feature-team",
            "team": "feat-1",
            "phase": "implement",
            "createdAt": "2026-01-01T00:00:00Z",
            "decisions": [{"id": 1, "decision": "x", "status": "maybe"}],
        }
        assert validate_record(bad) is False


# ============================================================
# Describe: format_roster_status
# ============================================================


class DescribeFormatRosterStatus:
    def test_renders_role_status_pairs_from_the_roster(self):
        rec = {
            "roster": [
                {"role": "backend", "status": "in-progress"},
                {"role": "frontend", "status": "returned"},
            ]
        }
        assert format_roster_status(rec) == "backend=in-progress, frontend=returned"

    def test_defaults_a_missing_status_to_spawned(self):
        rec = {"roster": [{"role": "docs"}]}
        assert format_roster_status(rec) == "docs=spawned"

    def test_returns_empty_when_there_is_no_roster(self):
        assert format_roster_status({"id": "x"}) == ""


# ============================================================
# Describe: format_decision_digest
# ============================================================


class DescribeFormatDecisionDigest:
    def test_renders_id_and_decision_and_supersedes(self):
        rec = {
            "decisions": [
                {"id": 3, "decision": "glob widget", "supersedes": "issue text"}
            ]
        }
        d = format_decision_digest(rec)
        assert re.search(r"#3 glob widget", d)
        assert re.search(r"supersedes: issue text", d)

    def test_caps_the_list_and_notes_the_overflow_count(self):
        decisions = [{"id": i, "decision": f"d{i}"} for i in range(1, 9)]
        d = format_decision_digest({"decisions": decisions}, max_decisions=6)
        assert re.search(r"\(\+2 more\)", d)

    def test_returns_empty_when_there_are_no_decisions(self):
        assert format_decision_digest({"id": "x"}) == ""


# ============================================================
# Describe: find_session_by_issue
# ============================================================


class DescribeFindSessionByIssue:
    @pytest.fixture()
    def fbi_root(self, tmp_path: Path) -> Path:
        """Create two session records for issues #351 and #360."""
        for sid, issue in [("feat-351", "#351"), ("feat-360", "#360")]:
            d = tmp_path / ".team-process" / "sessions" / sid
            d.mkdir(parents=True)
            record = {
                "id": sid,
                "workflow": "feature-team",
                "team": sid,
                "issue": issue,
                "phase": "implement",
                "createdAt": "2026-01-01T00:00:00Z",
            }
            (d / "session.json").write_text(
                json.dumps(record), encoding="utf-8"
            )
        return tmp_path

    def test_matches_a_record_by_bare_issue_number(self, fbi_root: Path):
        hits = find_session_by_issue(str(fbi_root), "351")
        assert len(hits) == 1
        assert hits[0]["id"] == "feat-351"

    def test_matches_regardless_of_hash_or_gh_decoration(self, fbi_root: Path):
        assert find_session_by_issue(str(fbi_root), "#351")[0]["id"] == "feat-351"
        assert find_session_by_issue(str(fbi_root), "GH-360")[0]["id"] == "feat-360"

    def test_returns_empty_when_no_run_matches_the_issue(self, fbi_root: Path):
        assert find_session_by_issue(str(fbi_root), "999") == []

    def test_returns_empty_for_a_blank_issue(self, fbi_root: Path):
        assert find_session_by_issue(str(fbi_root), "") == []


# ============================================================
# Describe: get_session_reminder
# ============================================================


class DescribeGetSessionReminder:
    def test_lists_a_single_active_record_and_names_the_abandon_command(self):
        rec = {
            "id": "feat-1",
            "workflow": "feature-team",
            "branch": "feat/x",
            "phase": "implement",
            "createdAt": "2026-01-01T00:00:00Z",
        }
        msg = get_session_reminder([rec])
        assert "feat-1" in msg
        assert "feat/x" in msg
        assert "implement" in msg
        assert "--end-session" in msg
        assert "RESUME" in msg
        assert "1 run(s)" in msg

    def test_lists_every_active_record_when_multiple_sessions_are_present(self):
        a = {"id": "feat-1", "workflow": "feature-team", "branch": "b1", "phase": "implement"}
        b = {"id": "task-2", "workflow": "freeform", "branch": "b2", "phase": "running"}
        msg = get_session_reminder([a, b])
        assert "feat-1" in msg
        assert "task-2" in msg
        assert "freeform" in msg
        assert "2 run(s)" in msg

    def test_surfaces_agent_statuses_and_decision_digest_inline(self):
        rec = {
            "id": "feat-1",
            "workflow": "feature-team",
            "branch": "feat/x",
            "phase": "implement",
            "issue": "#351",
            "roster": [{"role": "backend", "status": "in-progress"}],
            "decisions": [
                {"id": 2, "decision": "glob widget", "supersedes": "issue text"}
            ],
        }
        msg = get_session_reminder([rec])
        assert "agents: backend=in-progress" in msg
        assert "decisions: #2 glob widget" in msg
        assert "issue: #351" in msg

    def test_states_the_record_is_authoritative_rule(self):
        rec = {
            "id": "feat-1",
            "workflow": "feature-team",
            "branch": "b",
            "phase": "implement",
        }
        msg = get_session_reminder([rec])
        assert "AUTHORITATIVE" in msg
        assert "OVERRIDES" in msg


# ============================================================
# Describe: set_team_session / clear_team_session / get_session_start_context
#           round-trip (temp root via tmp_path)
# ============================================================


class DescribeSetClearGetSessionRoundTrip:
    def test_set_team_session_writes_a_schema_valid_record(self, tmp_path: Path):
        set_team_session(
            str(tmp_path),
            team="feat-1",
            workflow="feature-team",
            branch="feat/x",
            now=FIXED_NOW,
        )
        fpath = get_session_file_path(str(tmp_path), "feat-1")
        assert fpath.exists()
        record = json.loads(fpath.read_text(encoding="utf-8"))
        if HAS_JSONSCHEMA:
            assert validate_record(record) is True

    def test_set_team_session_creates_the_outbox_dir_up_front(self, tmp_path: Path):
        set_team_session(
            str(tmp_path), team="feat-1", branch="feat/x", now=FIXED_NOW
        )
        assert get_outbox_dir(str(tmp_path), "feat-1").is_dir()

    def test_set_team_session_creates_the_inbox_dir_up_front(self, tmp_path: Path):
        set_team_session(
            str(tmp_path), team="feat-1", branch="feat/x", now=FIXED_NOW
        )
        assert get_inbox_dir(str(tmp_path), "feat-1").is_dir()

    def test_set_team_session_merges_preserves_created_at_advances_updated_at(
        self, tmp_path: Path
    ):
        rec1 = set_team_session(
            str(tmp_path),
            team="feat-1",
            branch="feat/x",
            now=datetime(2026, 1, 1, tzinfo=UTC),
        )
        rec2 = set_team_session(
            str(tmp_path), team="feat-1", branch="feat/x", now=FIXED_NOW
        )
        assert rec2["createdAt"] == rec1["createdAt"]
        assert rec2["updatedAt"] != rec1["updatedAt"]

    def test_supports_two_concurrent_sessions_in_one_root(self, tmp_path: Path):
        set_team_session(
            str(tmp_path), team="feat-1", branch="b1", now=FIXED_NOW
        )
        set_team_session(
            str(tmp_path),
            team="task-2",
            workflow="freeform",
            branch="b2",
            now=FIXED_NOW,
        )
        assert len(get_active_session_files(str(tmp_path))) == 2
        assert is_any_session_active(str(tmp_path)) is True
        ctx = get_session_start_context(str(tmp_path))
        assert "feat-1" in ctx
        assert "task-2" in ctx

    def test_get_session_start_context_yields_additional_context_when_active_empty_when_not(
        self, tmp_path: Path
    ):
        assert get_session_start_context(str(tmp_path)) == ""
        set_team_session(
            str(tmp_path), team="feat-1", branch="feat/x", now=FIXED_NOW
        )
        ctx = get_session_start_context(str(tmp_path))
        assert "additionalContext" in ctx
        assert "SessionStart" in ctx
        assert "feat-1" in ctx

    def test_clear_team_session_id_removes_that_session_dir_leaving_others(
        self, tmp_path: Path
    ):
        set_team_session(
            str(tmp_path), team="feat-1", branch="b1", now=FIXED_NOW
        )
        set_team_session(
            str(tmp_path),
            team="task-2",
            workflow="freeform",
            branch="b2",
            now=FIXED_NOW,
        )
        # Put a file in feat-1's outbox to confirm the directory is removed with it.
        outbox = get_outbox_dir(str(tmp_path), "feat-1")
        outbox.mkdir(parents=True, exist_ok=True)
        (outbox / "backend.RESULT.json").write_text("{}", encoding="utf-8")
        clear_team_session(str(tmp_path), "feat-1")
        assert not get_session_dir(str(tmp_path), "feat-1").exists()
        assert get_session_file_path(str(tmp_path), "task-2").exists()

    def test_clear_team_session_refuses_traversal_id_and_deletes_nothing_outside(
        self, tmp_path: Path
    ):
        set_team_session(
            str(tmp_path), team="feat-1", branch="b1", now=FIXED_NOW
        )
        base_dir = get_team_process_base_dir(str(tmp_path))
        # A '..' id would resolve to .team-process/ (parent of sessions/) under naive removal.
        clear_team_session(str(tmp_path), "..")
        assert base_dir.is_dir(), ".team-process/ must survive a .. id"
        assert get_session_file_path(str(tmp_path), "feat-1").exists()
        # also a no-op, no throw
        clear_team_session(str(tmp_path), "../../x")
        assert base_dir.is_dir()

    def test_set_team_session_preserves_existing_freeform_workflow_on_recreate_without_workflow(
        self, tmp_path: Path
    ):
        set_team_session(
            str(tmp_path),
            team="task-2",
            workflow="freeform",
            branch="b",
            now=FIXED_NOW,
        )
        # set_marker passes --workflow through raw (empty) on re-create.
        rec = set_team_session(
            str(tmp_path), team="task-2", branch="b", now=FIXED_NOW
        )
        assert rec["workflow"] == "freeform"

    def test_clear_team_session_no_id_removes_all_sessions_and_lane_and_is_idempotent(
        self, tmp_path: Path
    ):
        set_team_session(
            str(tmp_path), team="feat-1", branch="feat/x", now=FIXED_NOW
        )
        lane_file = get_lane_file_path(str(tmp_path))
        lane_file.parent.mkdir(parents=True, exist_ok=True)
        lane_file.write_text("backend/**", encoding="utf-8")
        clear_team_session(str(tmp_path))
        assert not get_session_file_path(str(tmp_path), "feat-1").exists()
        assert not lane_file.exists()
        # Idempotent -- must not raise.
        clear_team_session(str(tmp_path))


# ============================================================
# Describe: sync_lane_from_session
# ============================================================


class DescribeSyncLaneFromSession:
    def test_projects_a_role_lane_from_the_roster_into_the_lane_file(
        self, tmp_path: Path
    ):
        rec = set_team_session(
            str(tmp_path), team="feat-1", branch="feat/x", now=FIXED_NOW
        )
        # Enrich the record on disk with a roster (as the orchestrator would).
        rec["roster"] = [
            {"role": "backend", "lane": "backend/Dashboard.Api/**, backend/shared/**"}
        ]
        get_session_file_path(str(tmp_path), "feat-1").write_text(
            json.dumps(rec, indent=2), encoding="utf-8"
        )
        globs = sync_lane_from_session(str(tmp_path), "feat-1", "backend")
        assert globs is not None
        assert len(globs) == 2
        lane_content = get_lane_file_path(str(tmp_path)).read_text(encoding="utf-8")
        assert re.search(r"backend/Dashboard\.Api/\*\*", lane_content)
        assert re.search(r"backend/shared/\*\*", lane_content)

    def test_returns_none_and_does_not_write_lane_file_when_role_is_absent(
        self, tmp_path: Path
    ):
        set_team_session(
            str(tmp_path), team="feat-1", branch="feat/x", now=FIXED_NOW
        )
        result = sync_lane_from_session(str(tmp_path), "feat-1", "frontend")
        assert result is None
        assert not get_lane_file_path(str(tmp_path)).exists()

    def test_returns_none_for_an_unsafe_id_traversal_guard(self, tmp_path: Path):
        result = sync_lane_from_session(str(tmp_path), "..", "backend")
        assert result is None


# ============================================================
# Describe: Legacy single-file back-compat
# ============================================================


class DescribeLegacySingleFileBackCompat:
    def test_reads_legacy_team_process_session_json_as_one_active_session(
        self, tmp_path: Path
    ):
        base_dir = tmp_path / ".team-process"
        base_dir.mkdir(parents=True)
        legacy = {
            "id": "old-1",
            "workflow": "feature-team",
            "team": "old-1",
            "phase": "implement",
            "createdAt": "2026-01-01T00:00:00Z",
        }
        (base_dir / "session.json").write_text(
            json.dumps(legacy), encoding="utf-8"
        )
        assert is_any_session_active(str(tmp_path)) is True
        ctx = get_session_start_context(str(tmp_path))
        assert "old-1" in ctx


# ============================================================
# Describe: Entry block plumbing (subprocess)
# ============================================================


class DescribeEntryBlockPlumbing:
    def test_empty_stdin_exits_0_with_no_output(self, tmp_path: Path):
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            input="",
            capture_output=True,
            text=True,
            cwd=str(tmp_path),
        )
        assert result.returncode == 0
        assert result.stdout.strip() == ""

    def test_no_active_session_in_a_temp_dir_yields_no_block_json(self, tmp_path: Path):
        payload = json.dumps(
            {
                "tool_name": "Agent",
                "agent_type": "",
                "agent_id": "",
                "tool_input": {"team_name": ""},
            }
        )
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            input=payload,
            capture_output=True,
            text=True,
            cwd=str(tmp_path),
        )
        assert result.returncode == 0
        assert result.stdout.strip() == ""


# ============================================================
# Describe: Entry block dispatch (subprocess, temp root)
#
# The script's default_git_root() will return the real repo root when run from
# a git-worktree subdir. To isolate tests, we run the subprocess with cwd set
# to a temp dir that is NOT inside a git repo (mirrors Pester Push-Location to
# a System Temp path).
# We pre-populate session state directly in that temp dir and invoke the script
# there.
# ============================================================


def _run_script(
    args: list[str],
    *,
    cwd: Path,
    stdin_data: str = "",
    env: dict | None = None,
) -> subprocess.CompletedProcess:
    """Run the guard script as a subprocess with the given args and cwd."""
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(
        [sys.executable, str(SCRIPT_PATH), *args],
        input=stdin_data,
        capture_output=True,
        text=True,
        cwd=str(cwd),
        env=merged_env,
    )


class DescribeEntryBlockDispatch:
    def test_pre_tool_use_blocks_foreground_subagent_no_team_name_when_session_active(
        self, tmp_path: Path
    ):
        set_team_session(str(tmp_path), team="feat-1", branch="b", now=FIXED_NOW)
        payload = json.dumps(
            {
                "tool_name": "Agent",
                "agent_type": "",
                "agent_id": "",
                "tool_input": {"team_name": ""},
            }
        )
        result = _run_script([], cwd=tmp_path, stdin_data=payload)
        assert result.returncode == 0
        assert re.search(r'"decision"\s*:\s*"block"', result.stdout)

    def test_pre_tool_use_allows_member_spawn_team_name_set_when_session_active(
        self, tmp_path: Path
    ):
        set_team_session(str(tmp_path), team="feat-1", branch="b", now=FIXED_NOW)
        payload = json.dumps(
            {
                "tool_name": "Agent",
                "agent_type": "",
                "agent_id": "",
                "tool_input": {"team_name": "feat-1"},
            }
        )
        result = _run_script([], cwd=tmp_path, stdin_data=payload)
        assert result.returncode == 0
        assert result.stdout.strip() == ""

    def test_pre_tool_use_allows_background_agent_member_spawn_when_session_active(
        self, tmp_path: Path
    ):
        set_team_session(str(tmp_path), team="feat-1", branch="b", now=FIXED_NOW)
        payload = json.dumps(
            {
                "tool_name": "Agent",
                "agent_type": "",
                "agent_id": "",
                "tool_input": {"run_in_background": True},
            }
        )
        result = _run_script([], cwd=tmp_path, stdin_data=payload)
        assert result.returncode == 0
        assert result.stdout.strip() == ""

    def test_set_marker_team_writes_record_seeded_with_issue_and_summary(
        self, tmp_path: Path
    ):
        result = _run_script(
            [
                "--set-marker",
                "--team", "feat-7",
                "--workflow", "feature-team",
                "--issue", "#7",
                "--summary", "glob filter",
            ],
            cwd=tmp_path,
        )
        assert result.returncode == 0
        fpath = get_session_file_path(str(tmp_path), "feat-7")
        assert fpath.exists()
        rec = json.loads(fpath.read_text(encoding="utf-8"))
        assert rec["issue"] == "#7"
        assert rec["summary"] == "glob filter"
        assert get_inbox_dir(str(tmp_path), "feat-7").is_dir()
        assert get_outbox_dir(str(tmp_path), "feat-7").is_dir()

    def test_end_session_id_dot_dot_is_a_no_op_via_entry_block(self, tmp_path: Path):
        set_team_session(str(tmp_path), team="feat-1", branch="b", now=FIXED_NOW)
        base_dir = get_team_process_base_dir(str(tmp_path))
        result = _run_script(["--end-session", "--id", ".."], cwd=tmp_path)
        assert result.returncode == 0
        assert base_dir.is_dir()
        assert get_session_file_path(str(tmp_path), "feat-1").exists()

    def test_clear_marker_removes_only_the_named_team_session_via_entry_block(
        self, tmp_path: Path
    ):
        set_team_session(str(tmp_path), team="feat-1", branch="b", now=FIXED_NOW)
        set_team_session(
            str(tmp_path),
            team="task-2",
            workflow="freeform",
            branch="b",
            now=FIXED_NOW,
        )
        payload = json.dumps({"tool_input": {"team_name": "feat-1"}})
        result = _run_script(["--clear-marker"], cwd=tmp_path, stdin_data=payload)
        assert result.returncode == 0
        assert not get_session_file_path(str(tmp_path), "feat-1").exists()
        assert get_session_file_path(str(tmp_path), "task-2").exists()

    def test_sync_lane_projects_the_lane_file_from_the_roster_via_entry_block(
        self, tmp_path: Path
    ):
        rec = set_team_session(
            str(tmp_path), team="feat-1", branch="b", now=FIXED_NOW
        )
        rec["roster"] = [{"role": "backend", "lane": "backend/Dashboard.Api/**"}]
        get_session_file_path(str(tmp_path), "feat-1").write_text(
            json.dumps(rec, indent=2), encoding="utf-8"
        )
        result = _run_script(
            ["--sync-lane", "--id", "feat-1", "--role", "backend"], cwd=tmp_path
        )
        assert result.returncode == 0
        lane_content = get_lane_file_path(str(tmp_path)).read_text(encoding="utf-8")
        assert re.search(r"backend/Dashboard\.Api/\*\*", lane_content)
