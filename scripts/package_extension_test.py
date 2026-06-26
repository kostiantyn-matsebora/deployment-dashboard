"""
pytest suite for package_extension.py.

Faithful translation of every Pester It block in Package-Extension.Tests.ps1.
"""

import os

from package_extension import (
    get_browser_targets,
    get_extension_zip_name,
    new_extension_zip,
)


# ============================================================
class DescribeGetBrowserTargets:
    def test_returns_the_default_set_when_no_targets_are_requested(self):
        targets = get_browser_targets(requested=[])
        assert targets == ["chrome", "edge", "firefox"]

    def test_returns_the_default_set_when_requested_is_none(self):
        targets = get_browser_targets(requested=None)
        assert targets == ["chrome", "edge", "firefox"]

    def test_returns_the_explicit_list_unchanged_when_provided(self):
        targets = get_browser_targets(requested=["chrome", "edge"])
        assert targets == ["chrome", "edge"]

    def test_returns_a_single_target_when_only_one_is_requested(self):
        targets = get_browser_targets(requested=["firefox"])
        assert targets == ["firefox"]

    def test_honours_a_custom_default_set(self):
        targets = get_browser_targets(requested=[], default=["opera", "brave"])
        assert targets == ["opera", "brave"]


# ============================================================
class DescribeGetExtensionZipName:
    def test_returns_browser_zip_for_chrome(self):
        assert get_extension_zip_name("chrome") == "chrome.zip"

    def test_returns_browser_zip_for_edge(self):
        assert get_extension_zip_name("edge") == "edge.zip"

    def test_returns_browser_zip_for_firefox(self):
        assert get_extension_zip_name("firefox") == "firefox.zip"

    def test_returns_browser_zip_for_any_arbitrary_browser_name(self):
        assert get_extension_zip_name("opera") == "opera.zip"


# ============================================================
class DescribeNewExtensionZip:
    def test_calls_the_compress_function_with_the_dist_source_and_the_expected_destination_path(self):
        calls = []

        def mock_compress(source, dest):
            calls.append({"source": source, "dest": dest})

        new_extension_zip(
            dist_path="/dist",
            output_dir="/out",
            browser="chrome",
            compress_function=mock_compress,
        )

        assert len(calls) == 1
        assert calls[0]["source"] == "/dist"
        # Use os.path.join to match the platform path separator
        assert calls[0]["dest"] == os.path.join("/out", "chrome.zip")

    def test_returns_the_absolute_path_of_the_created_zip(self):
        def mock_compress(source, dest):
            pass

        result = new_extension_zip(
            dist_path="/dist",
            output_dir="/out",
            browser="firefox",
            compress_function=mock_compress,
        )

        assert result == os.path.join("/out", "firefox.zip")

    def test_constructs_the_zip_name_via_get_extension_zip_name(self):
        captured = []

        def mock_compress(source, dest):
            captured.append(dest)

        new_extension_zip(
            dist_path="src",
            output_dir="out",
            browser="edge",
            compress_function=mock_compress,
        )

        assert captured[0].endswith("edge.zip")

    def test_passes_the_exact_dist_path_to_the_compress_function_unchanged(self):
        captured = []

        def mock_compress(source, dest):
            captured.append(source)

        new_extension_zip(
            dist_path="/my/dist/dir",
            output_dir="out",
            browser="chrome",
            compress_function=mock_compress,
        )

        assert captured[0] == "/my/dist/dir"
