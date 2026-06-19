"""
pytest suite for new_release.py.

Faithful translation of every Pester It block in New-Release.Tests.ps1.
"""

import pytest
from new_release import (
    get_current_version,
    get_next_version,
    is_valid_semver,
    update_changelog,
    update_doc_version_examples,
)


# ============================================================
class DescribeIsValidSemver:
    @pytest.mark.parametrize(
        "version",
        [
            "1.2.3",
            "0.1.0",
            "0.0.0",
            "10.20.30",
            "1.0.0-rc.1",
            "2.3.4-alpha.0",
            "0.10.0",
        ],
    )
    def test_true_for_valid_version(self, version):
        assert is_valid_semver(version) is True

    @pytest.mark.parametrize(
        "version",
        [
            "",
            "   ",
            "v1.2.3",
            "1.2",
            "1",
            "1.2.3.4",
            "a.b.c",
            "1.2.x",
            "01.2.3",
            "release",
        ],
    )
    def test_false_for_invalid_version(self, version):
        assert is_valid_semver(version) is False


# ============================================================
class DescribeGetCurrentVersion:
    def test_returns_0_0_0_for_an_empty_list(self):
        assert get_current_version([]) == "0.0.0"

    def test_returns_0_0_0_when_no_tag_is_valid_semver(self):
        assert get_current_version(["latest", "release-candidate", "foo"]) == "0.0.0"

    def test_strips_a_leading_v_and_returns_the_bare_version(self):
        assert get_current_version(["v1.2.3"]) == "1.2.3"

    def test_picks_the_highest_among_mixed_v_prefixed_and_bare_tags(self):
        assert get_current_version(["v1.0.0", "0.9.0", "v1.2.0"]) == "1.2.0"

    def test_orders_numerically_0_10_0_is_higher_than_0_9_0(self):
        assert get_current_version(["v0.9.0", "v0.10.0"]) == "0.10.0"

    def test_treats_a_pre_release_as_lower_than_its_release(self):
        assert get_current_version(["v1.0.0-rc.1", "v1.0.0"]) == "1.0.0"

    def test_returns_the_pre_release_when_it_is_the_highest_available(self):
        assert get_current_version(["v0.9.0", "v1.0.0-rc.1"]) == "1.0.0-rc.1"

    def test_ignores_junk_tags_interleaved_with_valid_ones(self):
        assert get_current_version(["nightly", "v1.4.2", "wip", "v1.4.0", "latest"]) == "1.4.2"

    def test_tolerates_none_entries_in_the_list(self):
        assert get_current_version([None, "v2.0.0", None]) == "2.0.0"


# ============================================================
class DescribeGetNextVersion:
    @pytest.mark.parametrize(
        "current,bump,expected",
        [
            ("0.3.5", "patch", "0.3.6"),
            ("0.3.5", "minor", "0.4.0"),
            ("0.3.5", "major", "1.0.0"),
            ("1.0.0", "patch", "1.0.1"),
            ("1.9.9", "minor", "1.10.0"),
            ("0.0.0", "major", "1.0.0"),
            ("2.5.7", "major", "3.0.0"),
        ],
    )
    def test_bumps_version(self, current, bump, expected):
        assert get_next_version(current, bump) == expected

    def test_throws_on_invalid_bump_keyword(self):
        with pytest.raises(ValueError):
            get_next_version("1.0.0", "huge")

    def test_throws_on_invalid_current_version(self):
        with pytest.raises(ValueError):
            get_next_version("v1.0.0", "patch")

    def test_throws_on_empty_current_version(self):
        with pytest.raises(ValueError):
            get_next_version("", "patch")


# ============================================================
SAMPLE_CHANGELOG = """\
# Changelog

All notable changes to this project will be documented here.

## [Unreleased]

### Added
- New release-preparation script.

### Fixed
- Off-by-one in the changelog parser.

## [0.1.0] - 2026-01-01

### Added
- Initial public release.
"""


class DescribeUpdateChangelog:
    def setup_method(self):
        self.result = update_changelog(SAMPLE_CHANGELOG, version="0.2.0", date="2026-06-01")

    def test_renames_the_old_unreleased_header_to_the_versioned_and_dated_header(self):
        import re

        assert re.search(r"(?m)^## \[0\.2\.0\] - 2026-06-01$", self.result)

    def test_leaves_a_fresh_empty_unreleased_section_in_place(self):
        import re

        assert re.search(r"(?m)^## \[Unreleased\]$", self.result)

    def test_places_the_new_unreleased_above_the_versioned_header(self):
        unreleased_idx = self.result.index("## [Unreleased]")
        versioned_idx = self.result.index("## [0.2.0] - 2026-06-01")
        assert unreleased_idx >= 0
        assert versioned_idx > unreleased_idx

    def test_retains_the_prior_unreleased_entries_under_the_new_versioned_header(self):
        assert "New release-preparation script." in self.result
        assert "Off-by-one in the changelog parser." in self.result

    def test_preserves_the_pre_existing_0_1_0_section(self):
        import re

        assert re.search(r"(?m)^## \[0\.1\.0\] - 2026-01-01$", self.result)
        assert "Initial public release." in self.result

    def test_keeps_the_document_preamble_intact(self):
        assert "# Changelog" in self.result
        assert "All notable changes to this project" in self.result

    def test_produces_exactly_one_versioned_0_2_0_header(self):
        import re

        assert len(re.findall(r"(?m)^## \[0\.2\.0\]", self.result)) == 1

    def test_works_with_placeholder_only_unreleased_body(self):
        import re

        minimal = "# Changelog\n\n## [Unreleased]\n\n(No tagged releases yet — see commit history.)\n"
        out = update_changelog(minimal, version="0.1.0", date="2026-06-01")
        assert re.search(r"(?m)^## \[0\.1\.0\] - 2026-06-01$", out)
        assert re.search(r"(?m)^## \[Unreleased\]$", out)
        assert "No tagged releases yet" in out

    def test_throws_when_there_is_no_unreleased_section(self):
        with pytest.raises((ValueError, Exception)):
            update_changelog(
                "# Changelog\n\n## [1.0.0] - 2026-01-01\n",
                version="1.1.0",
                date="2026-06-01",
            )


# ============================================================
class DescribeUpdateDocVersionExamples:
    def test_bumps_the_dashboard_version_pin_assignment(self):
        assert (
            update_doc_version_examples("DASHBOARD_VERSION=0.2.1", "0.5.0")
            == "DASHBOARD_VERSION=0.5.0"
        )

    def test_bumps_the_published_release_table_example(self):
        in_ = "For a reproducible deploy, pin to a published release (e.g. `0.2.1`). |"
        assert (
            update_doc_version_examples(in_, "0.5.0")
            == "For a reproducible deploy, pin to a published release (e.g. `0.5.0`). |"
        )

    def test_bumps_both_versions_in_the_git_tag_publishes_images_line(self):
        in_ = "the git tag `v0.2.1` publishes images as `0.2.1`."
        assert (
            update_doc_version_examples(in_, "0.5.0")
            == "the git tag `v0.5.0` publishes images as `0.5.0`."
        )

    def test_bumps_the_pin_a_release_compose_url_tag(self):
        assert (
            update_doc_version_examples("`.../v0.2.1/compose/...`", "0.5.0")
            == "`.../v0.5.0/compose/...`"
        )

    def test_bumps_the_oci_compose_demo_artifact_tag(self):
        in_ = "oci://ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose-demo:0.2.1"
        assert (
            update_doc_version_examples(in_, "0.5.0")
            == "oci://ghcr.io/kostiantyn-matsebora/deployment-dashboard-compose-demo:0.5.0"
        )

    def test_rewrites_every_pin_example_in_a_combined_document(self):
        import re

        doc = (
            "DASHBOARD_VERSION=0.2.1\n"
            "pin to a published release (e.g. `0.2.1`).\n"
            "the git tag `v0.2.1` publishes images as `0.2.1`.\n"
            "replace main with the tag (e.g. `.../v0.2.1/compose/...`)\n"
            "compose-demo:0.2.1 --profile demo up\n"
        )
        out = update_doc_version_examples(doc, "0.5.0")
        assert not re.search(r"0\.2\.1", out)
        assert len(re.findall(r"0\.5\.0", out)) == 6

    def test_leaves_the_first_release_historical_note_untouched(self):
        in_ = "The `:latest` tag exists once the first release (`v0.1.0`) is cut."
        assert update_doc_version_examples(in_, "0.5.0") == in_

    def test_leaves_demo_seed_versions_untouched(self):
        in_ = "version: 'v0.41.2', ref:'#7912'"
        assert update_doc_version_examples(in_, "0.5.0") == in_

    def test_is_idempotent_a_second_pass_is_a_no_op(self):
        in_ = "DASHBOARD_VERSION=0.5.0 and `.../v0.5.0/compose/...`"
        once = update_doc_version_examples(in_, "0.5.0")
        assert update_doc_version_examples(once, "0.5.0") == once
        assert once == in_

    def test_handles_a_pre_release_target_version(self):
        assert (
            update_doc_version_examples("DASHBOARD_VERSION=0.2.1", "1.0.0-rc.1")
            == "DASHBOARD_VERSION=1.0.0-rc.1"
        )
