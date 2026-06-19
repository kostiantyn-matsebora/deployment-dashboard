"""
pytest suite for update_issue_decision_record.py.

Faithful translation of every Pester It block in
Update-IssueDecisionRecord.Tests.ps1.
"""

from update_issue_decision_record import (
    convert_to_decision_markdown,
    find_managed_comment_id,
    format_cell,
    get_decision_marker,
    get_issue_number,
)

# Full test record matching Pester $script:FullRecord
FULL_RECORD = {
    "id": "feat-351",
    "workflow": "feature-team",
    "team": "feat-351",
    "branch": "feat/351-svc-visibility",
    "issue": "#351",
    "phase": "ship",
    "updatedAt": "2026-06-19T12:00:00Z",
    "acceptance": ["services board filters by glob", "notification prefs share the widget"],
    "roster": [{"role": "frontend", "status": "done"}],
    "ledger": [
        {"wave": 1, "deferred": "E2E coverage"},
        {"wave": 2},
    ],
    "decisions": [
        {
            "id": 1,
            "decision": "glob include/exclude widget, not checkbox",
            "why": "matches a1675d8 mockup; user-confirmed",
            "supersedes": "original issue text",
            "status": "locked",
            "refs": ["docs/design/mockup/a1675d8"],
        },
        {
            "id": 2,
            "decision": "notif upgrade exact-match -> glob",
            "why": "shared widget",
            "status": "locked",
            "refs": ["docs/design/mockup/a1675d8"],
        },
    ],
}


# ============================================================
class DescribeGetDecisionMarker:
    def test_is_a_stable_hidden_html_marker(self):
        assert get_decision_marker() == "<!-- team-process:decision-record -->"


# ============================================================
class DescribeGetIssueNumber:
    def test_strips_a_leading_hash(self):
        assert get_issue_number("#351") == "351"

    def test_passes_a_bare_number(self):
        assert get_issue_number("351") == "351"

    def test_handles_a_gh_prefix(self):
        assert get_issue_number("GH-42") == "42"

    def test_returns_empty_for_no_number(self):
        assert get_issue_number("none") == ""

    def test_returns_empty_for_blank(self):
        assert get_issue_number("") == ""


# ============================================================
class DescribeFormatCell:
    def test_escapes_pipes_so_the_table_is_not_broken(self):
        assert format_cell("a | b") == r"a \| b"

    def test_collapses_newlines_to_spaces(self):
        assert format_cell("line1\nline2") == "line1 line2"


# ============================================================
class DescribeConvertToDecisionMarkdown:
    def test_leads_with_the_managed_marker(self):
        md = convert_to_decision_markdown(FULL_RECORD)
        assert md.lstrip().startswith("<!-- team-process:decision-record -->")

    def test_titles_with_the_issue_and_branch(self):
        md = convert_to_decision_markdown(FULL_RECORD)
        assert "Decision record — #351" in md
        assert "feat/351-svc-visibility" in md

    def test_renders_acceptance_criteria_as_a_list(self):
        md = convert_to_decision_markdown(FULL_RECORD)
        assert "### Acceptance criteria (locked)" in md
        assert "- services board filters by glob" in md

    def test_renders_the_decisions_table_with_the_supersedes_column(self):
        import re

        md = convert_to_decision_markdown(FULL_RECORD)
        assert re.search(r"\| # \| Decision \| Why \| Supersedes \| Status \|", md)
        assert re.search(r"\| 1 \| glob include/exclude widget, not checkbox \|", md)
        assert "original issue text" in md

    def test_aggregates_deferred_items_from_the_ledger_with_their_wave(self):
        md = convert_to_decision_markdown(FULL_RECORD)
        assert "### Deferred / follow-ups" in md
        assert "- wave 1: E2E coverage" in md

    def test_dedupes_artifact_refs_across_decisions(self):
        import re

        md = convert_to_decision_markdown(FULL_RECORD)
        assert "### Artifacts (source of truth)" in md
        assert len(re.findall("docs/design/mockup/a1675d8", md)) == 1

    def test_defaults_a_decision_status_to_locked_when_unset(self):
        import re

        rec = {"decisions": [{"id": 1, "decision": "x"}]}
        md = convert_to_decision_markdown(rec)
        assert re.search(r"\| 1 \| x \|  \|  \| locked \|", md)

    def test_shows_a_placeholder_when_there_are_no_decisions_yet(self):
        md = convert_to_decision_markdown({"issue": "#9", "branch": "b"})
        assert "_No decisions recorded yet._" in md

    def test_omits_empty_sections_no_acceptance_deferred_artifacts(self):
        rec = {
            "issue": "#9",
            "branch": "b",
            "decisions": [{"id": 1, "decision": "x"}],
        }
        md = convert_to_decision_markdown(rec)
        assert "Acceptance criteria" not in md
        assert "Deferred" not in md
        assert "Artifacts" not in md


# ============================================================
class DescribeFindManagedCommentId:
    def test_returns_the_id_of_the_comment_carrying_the_marker(self):
        comments = [
            {"id": 100, "body": "unrelated chatter"},
            {"id": 200, "body": f"{get_decision_marker()}\n## Decision record"},
        ]
        assert find_managed_comment_id(comments) == 200

    def test_returns_none_when_no_comment_is_managed(self):
        comments = [{"id": 100, "body": "nope"}]
        assert find_managed_comment_id(comments) is None

    def test_returns_none_for_an_empty_comment_list(self):
        assert find_managed_comment_id([]) is None


# ============================================================
class DescribeRoundTrip:
    def test_a_body_produced_by_convert_is_matched_by_find(self):
        body = convert_to_decision_markdown(FULL_RECORD)
        comments = [{"id": 42, "body": body}]
        assert find_managed_comment_id(comments) == 42
