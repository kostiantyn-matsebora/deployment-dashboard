"""
pytest suite for invoke_lead_edit_guard.py.

Faithful translation of every Pester It block in Invoke-LeadEditGuard.Tests.ps1.
"""

import re

from invoke_lead_edit_guard import (
    DEFAULT_LEAD_LANE_GLOBS,
    convert_from_lane_glob,
    get_lead_edit_decision,
    get_lead_lane_globs,
    get_relative_path,
    path_in_globs,
)

# ============================================================
# Describe: convert_from_lane_glob
# ============================================================

class DescribeConvertFromLaneGlob:
    def test_double_star_matches_across_path_segments(self):
        rx = convert_from_lane_glob(".claude/team-process/**")
        assert re.search(rx, ".claude/team-process/process.md")
        assert re.search(rx, ".claude/team-process/roles/backend.md")

    def test_double_star_does_not_match_sibling_directory(self):
        rx = convert_from_lane_glob(".claude/team-process/**")
        assert not re.search(rx, ".claude/bindings/backend.md")

    def test_single_star_stays_within_a_segment(self):
        rx = convert_from_lane_glob(".claude/*.md")
        assert re.search(rx, ".claude/CLAUDE.md")
        assert not re.search(rx, ".claude/sub/CLAUDE.md")

    def test_exact_file_glob_matches_only_that_file(self):
        rx = convert_from_lane_glob(".claude/settings.json")
        assert re.search(rx, ".claude/settings.json")
        assert not re.search(rx, ".claude/settings.json.bak")

    def test_escapes_regex_metacharacters_in_literal_segments(self):
        rx = convert_from_lane_glob("a.b/c.d")
        assert re.search(rx, "a.b/c.d")
        assert not re.search(rx, "axb/cxd")


# ============================================================
# Describe: path_in_globs
# ============================================================

class DescribeTestPathInGlobs:
    def test_true_when_path_matches_one_of_several_globs(self):
        globs = [".claude/team-process/**", ".claude/bindings/**"]
        assert path_in_globs(".claude/bindings/backend.md", globs) is True

    def test_false_when_path_matches_no_glob(self):
        globs = [".claude/team-process/**"]
        assert path_in_globs("backend/Dashboard.Api/Program.cs", globs) is False

    def test_normalizes_backslashes_before_matching(self):
        globs = [".claude\\team-process\\**"]
        assert path_in_globs(".claude\\team-process\\process.md", globs) is True

    def test_skips_blank_lines_and_comments_without_error(self):
        globs = ["# comment", "", ".team-process/run/**"]
        assert path_in_globs(".team-process/run/session.json", globs) is True


# ============================================================
# Describe: get_relative_path
# ============================================================

class DescribeGetRelativePath:
    def test_strips_the_repo_root_prefix(self):
        assert (
            get_relative_path("/repo/backend/Dashboard.Api/X.cs", "/repo")
            == "backend/Dashboard.Api/X.cs"
        )

    def test_handles_windows_style_paths_case_insensitively(self):
        assert get_relative_path("C:\\Repo\\Backend\\X.cs", "c:/repo") == "Backend/X.cs"

    def test_returns_normalized_absolute_path_when_outside_root(self):
        assert (
            get_relative_path("/tmp/scratch/typed-form.md", "/repo")
            == "/tmp/scratch/typed-form.md"
        )


# ============================================================
# Describe: get_lead_lane_globs
# ============================================================

class DescribeGetLeadLaneGlobs:
    def test_returns_default_whitelist_when_no_override_file_exists(self):
        # Pass a fake reader that always returns None (file not found).
        globs = get_lead_lane_globs("C:\\nonexistent-path-xyz", file_reader=lambda p: None)
        assert ".claude/team-process/**" in globs
        assert ".claude/settings.json" in globs
        assert ".team-process/**" in globs

    def test_returns_override_file_content_when_lead_lane_exists(self, tmp_path):
        tp_dir = tmp_path / ".team-process"
        tp_dir.mkdir()
        override = tp_dir / "lead-lane"
        override.write_text(
            "# my custom whitelist\n\ncustom/path/**\nanother/path/*.md\n",
            encoding="utf-8",
        )

        globs = get_lead_lane_globs(str(tmp_path))
        assert len(globs) == 2
        assert "custom/path/**" in globs
        assert "another/path/*.md" in globs
        # Default entries must NOT appear when override is present.
        assert ".claude/team-process/**" not in globs


# ============================================================
# Describe: get_lead_edit_decision
# ============================================================

DEFAULT_GLOBS = list(DEFAULT_LEAD_LANE_GLOBS)


class DescribeGetLeadEditDecisionSubagent:
    def test_always_allows_even_a_product_path(self):
        globs = [".claude/team-process/**"]
        d = get_lead_edit_decision(
            "backend/Dashboard.Api/Foo.cs",
            is_subagent=True,
            under_root=True,
            globs=globs,
        )
        assert d["block"] is False


class DescribeGetLeadEditDecisionLead:
    def test_blocks_editing_a_product_backend_file(self):
        d = get_lead_edit_decision(
            "backend/Dashboard.Api/Foo.cs",
            is_subagent=False,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is True
        assert "Delegate" in d["reason"]
        assert "backend/Dashboard.Api/Foo.cs" in d["reason"]

    def test_allows_editing_claude_team_process_process_md(self):
        d = get_lead_edit_decision(
            ".claude/team-process/process.md",
            is_subagent=False,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False

    def test_allows_editing_team_process_run_session_json(self):
        d = get_lead_edit_decision(
            ".team-process/run/session.json",
            is_subagent=False,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False

    def test_allows_editing_claude_settings_json(self):
        d = get_lead_edit_decision(
            ".claude/settings.json",
            is_subagent=False,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False

    def test_allows_editing_team_process_lead_lane_itself(self):
        d = get_lead_edit_decision(
            ".team-process/lead-lane",
            is_subagent=False,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False

    def test_allows_a_file_outside_the_repo_root(self):
        d = get_lead_edit_decision(
            "/tmp/scratch/typed-form.md",
            is_subagent=False,
            under_root=False,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is False

    def test_blocks_editing_frontend_files(self):
        d = get_lead_edit_decision(
            "frontend/dashboard/src/app/app.component.ts",
            is_subagent=False,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is True

    def test_blocks_editing_docs_files(self):
        d = get_lead_edit_decision(
            "docs/api/openapi.yaml",
            is_subagent=False,
            under_root=True,
            globs=DEFAULT_GLOBS,
        )
        assert d["block"] is True
