"""
pytest suite for invoke_lane_guard.py.

Faithful translation of every Pester It block in Invoke-LaneGuard.Tests.ps1.
"""

import re

from invoke_lane_guard import (
    convert_from_lane_glob,
    get_active_lanes,
    get_lane_guard_decision,
    get_relative_path,
    path_has_dot_dot,
    path_in_lanes,
    path_is_outbox,
)

# ============================================================
# Describe: convert_from_lane_glob
# ============================================================

class DescribeConvertFromLaneGlob:
    def test_double_star_matches_across_path_segments(self):
        rx = convert_from_lane_glob("backend/fetcher/**")
        assert re.search(rx, "backend/fetcher/PollLoop.cs")
        assert re.search(rx, "backend/fetcher/Control/Stream.cs")

    def test_double_star_lane_does_not_match_sibling_directory(self):
        rx = convert_from_lane_glob("backend/fetcher/**")
        assert not re.search(rx, "backend/shared/Entities/X.cs")

    def test_single_star_stays_within_a_segment(self):
        rx = convert_from_lane_glob("backend/*/Program.cs")
        assert re.search(rx, "backend/api/Program.cs")
        assert not re.search(rx, "backend/api/sub/Program.cs")

    def test_exact_file_glob_matches_only_that_file(self):
        rx = convert_from_lane_glob("docs/api/openapi.yaml")
        assert re.search(rx, "docs/api/openapi.yaml")
        assert not re.search(rx, "docs/api/openapi.yaml.bak")

    def test_escapes_regex_metacharacters_in_literal_segments(self):
        rx = convert_from_lane_glob("a.b/c.d")
        assert re.search(rx, "a.b/c.d")
        assert not re.search(rx, "axb/cxd")


# ============================================================
# Describe: get_active_lanes
# ============================================================

class DescribeGetActiveLanes:
    def test_drops_blanks_and_comments_and_trims(self):
        lanes = get_active_lanes(
            ["# header", "", "  backend/fetcher/**  ", "   ", "backend/shared/**"]
        )
        assert lanes == ["backend/fetcher/**", "backend/shared/**"]

    def test_returns_empty_list_for_all_comment_input(self):
        assert get_active_lanes(["# a", "# b"]) == []


# ============================================================
# Describe: path_in_lanes
# ============================================================

class DescribeTestPathInLanes:
    def test_true_when_path_matches_one_of_several_lanes(self):
        lanes = ["backend/fetcher/**", "backend/fetcher-github/**"]
        assert path_in_lanes("backend/fetcher-github/GithubClient.cs", lanes) is True

    def test_false_when_path_matches_no_lane(self):
        lanes = ["backend/fetcher/**"]
        assert path_in_lanes("backend/control-api/X.cs", lanes) is False

    def test_normalizes_backslashes(self):
        assert path_in_lanes("backend\\fetcher\\PollLoop.cs", ["backend/fetcher/**"]) is True


# ============================================================
# Describe: get_relative_path
# ============================================================

class DescribeGetRelativePath:
    def test_strips_the_worktree_root_prefix(self):
        assert get_relative_path("/repo/backend/fetcher/X.cs", "/repo") == "backend/fetcher/X.cs"

    def test_handles_windows_style_paths_case_insensitively(self):
        assert get_relative_path("C:\\Repo\\Backend\\X.cs", "c:/repo") == "Backend/X.cs"

    def test_returns_the_absolute_path_when_outside_the_root(self):
        assert get_relative_path("/elsewhere/Y.cs", "/repo") == "/elsewhere/Y.cs"


# ============================================================
# Describe: get_lane_guard_decision
# ============================================================

class DescribeGetLaneGuardDecision:
    def test_allows_everything_when_no_active_lanes(self):
        assert get_lane_guard_decision("anything/at/all.cs", ["# only comments"])["block"] is False

    def test_allows_an_in_lane_path(self):
        assert get_lane_guard_decision("backend/fetcher/X.cs", ["backend/fetcher/**"])["block"] is False

    def test_blocks_an_out_of_lane_path_with_helpful_reason(self):
        d = get_lane_guard_decision("backend/control-api/X.cs", ["backend/fetcher/**"])
        assert d["block"] is True
        assert "Out of lane" in d["reason"]
        assert "backend/fetcher/**" in d["reason"]

    def test_blocks_an_out_of_worktree_absolute_path(self):
        assert get_lane_guard_decision("/elsewhere/Y.cs", ["backend/fetcher/**"])["block"] is True

    def test_allows_a_write_to_the_session_outbox_even_when_out_of_code_lane(self):
        d = get_lane_guard_decision(
            ".team-process/sessions/feat-1/outbox/backend.RESULT.json",
            ["backend/fetcher/**"],
        )
        assert d["block"] is False

    def test_allows_an_absolute_path_outbox_write_cross_worktree_handback(self):
        d = get_lane_guard_decision(
            "/tmp/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json",
            ["backend/fetcher/**"],
        )
        assert d["block"] is False

    def test_still_blocks_a_non_outbox_team_process_write_out_of_lane(self):
        d = get_lane_guard_decision(
            ".team-process/sessions/feat-1/session.json",
            ["backend/fetcher/**"],
        )
        assert d["block"] is True

    def test_blocks_a_dot_dot_traversal_that_escapes_the_outbox_exemption(self):
        d = get_lane_guard_decision(
            ".team-process/sessions/feat-1/outbox/../../../../backend/Program.cs",
            ["backend/fetcher/**"],
        )
        assert d["block"] is True
        assert "traversal" in d["reason"]

    def test_blocks_a_dot_dot_traversal_that_escapes_the_lane_glob(self):
        d = get_lane_guard_decision(
            "backend/fetcher/../control-api/X.cs",
            ["backend/fetcher/**"],
        )
        assert d["block"] is True
        assert "traversal" in d["reason"]


# ============================================================
# Describe: path_has_dot_dot
# ============================================================

class DescribeTestPathHasDotDot:
    def test_detects_a_dot_dot_segment(self):
        assert path_has_dot_dot("a/../b.cs") is True

    def test_detects_a_leading_dot_dot(self):
        assert path_has_dot_dot("../escape.cs") is True

    def test_does_not_flag_a_filename_that_merely_contains_dots(self):
        assert path_has_dot_dot("backend/My..Weird..Name.cs") is False

    def test_does_not_flag_an_ordinary_path(self):
        assert path_has_dot_dot("backend/fetcher/X.cs") is False


# ============================================================
# Describe: path_is_outbox
# ============================================================

class DescribeTestPathIsOutbox:
    def test_matches_a_relative_outbox_path(self):
        assert path_is_outbox(".team-process/sessions/feat-1/outbox/x.json") is True

    def test_matches_an_absolute_outbox_path(self):
        assert path_is_outbox("/wt/.team-process/sessions/feat-1/outbox/x.json") is True

    def test_does_not_match_the_session_record_itself(self):
        assert path_is_outbox(".team-process/sessions/feat-1/session.json") is False

    def test_does_not_match_an_ordinary_product_path(self):
        assert path_is_outbox("backend/fetcher/X.cs") is False
