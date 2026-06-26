"""
pytest suite for invoke_orchestrator_read_guard.py.

Covers the read whitelist, the session gate (the property that keeps solo
Claude Code unaffected), subagent passthrough, and the repo-wide-search case.
"""

from invoke_orchestrator_read_guard import (
    DEFAULT_ORCH_READ_GLOBS,
    get_orch_read_decision,
    get_orch_read_globs,
)

DEFAULT_GLOBS = list(DEFAULT_ORCH_READ_GLOBS)


# ============================================================
# Describe: get_orch_read_globs
# ============================================================

class DescribeGetOrchReadGlobs:
    def test_returns_default_whitelist_when_no_override_file_exists(self):
        globs = get_orch_read_globs("C:\\nonexistent-path-xyz", file_reader=lambda p: None)
        assert ".team-process/**" in globs
        assert ".claude/**" in globs
        assert "docs/**" in globs

    def test_returns_override_file_content_when_orch_read_lane_exists(self, tmp_path):
        tp_dir = tmp_path / ".team-process"
        tp_dir.mkdir()
        override = tp_dir / "orch-read-lane"
        override.write_text(
            "# custom read whitelist\n\ncustom/**\nspecs/*.md\n",
            encoding="utf-8",
        )

        globs = get_orch_read_globs(str(tmp_path))
        assert len(globs) == 2
        assert "custom/**" in globs
        assert "specs/*.md" in globs
        # Default entries must NOT appear when override is present.
        assert ".team-process/**" not in globs


# ============================================================
# Describe: get_orch_read_decision — session gate
# ============================================================

class DescribeGetOrchReadDecisionSessionGate:
    def test_allows_reading_source_when_no_session_active(self):
        # The safety property: solo Claude Code reads code freely.
        d = get_orch_read_decision(
            "backend/Dashboard.Api/Program.cs",
            is_subagent=False,
            session_active=False,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False

    def test_blocks_reading_source_when_session_active(self):
        d = get_orch_read_decision(
            "backend/Dashboard.Api/Program.cs",
            is_subagent=False,
            session_active=True,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is True
        assert "Delegate" in d["reason"]
        assert "backend/Dashboard.Api/Program.cs" in d["reason"]


# ============================================================
# Describe: get_orch_read_decision — subagent passthrough
# ============================================================

class DescribeGetOrchReadDecisionSubagent:
    def test_always_allows_even_source_under_active_session(self):
        d = get_orch_read_decision(
            "frontend/dashboard/src/app/app.component.ts",
            is_subagent=True,
            session_active=True,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False


# ============================================================
# Describe: get_orch_read_decision — lead, session active
# ============================================================

class DescribeGetOrchReadDecisionLead:
    def test_allows_reading_docs_owning_spec(self):
        d = get_orch_read_decision(
            "docs/api/openapi.yaml",
            is_subagent=False,
            session_active=True,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False

    def test_allows_reading_claude_orchestration_state(self):
        d = get_orch_read_decision(
            ".claude/team-process/process.md",
            is_subagent=False,
            session_active=True,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False

    def test_allows_reading_team_process_session_forms(self):
        d = get_orch_read_decision(
            ".team-process/sessions/run/outbox/backend.RESULT.json",
            is_subagent=False,
            session_active=True,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False

    def test_blocks_reading_frontend_source(self):
        d = get_orch_read_decision(
            "frontend/dashboard/src/app/app.component.ts",
            is_subagent=False,
            session_active=True,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is True

    def test_blocks_reading_scripts_source(self):
        d = get_orch_read_decision(
            "scripts/hooks/format_protocol_form.py",
            is_subagent=False,
            session_active=True,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is True

    def test_blocks_repo_wide_search_empty_path(self):
        # An unscoped Grep/Glob (no path) maps to rel_path="" + under_root=True.
        d = get_orch_read_decision(
            "",
            is_subagent=False,
            session_active=True,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is True
        assert "repo-wide search" in d["reason"]

    def test_allows_a_path_outside_the_repo_root(self):
        d = get_orch_read_decision(
            "/tmp/scratch/notes.md",
            is_subagent=False,
            session_active=True,
            under_root=False,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False
