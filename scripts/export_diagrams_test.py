"""
pytest suite for export_diagrams.py.

Faithful translation of every Pester It block in Export-Diagrams.Tests.ps1.
"""

import re

from export_diagrams import (
    get_drawio_candidate_paths,
    get_drawio_export_args,
    get_svg_dimensions,
    resolve_drawio_executable,
    set_svg_white_background,
)

# A minimal stand-in for a draw.io SVG export header (mirrors the Pester $SampleSvg).
SAMPLE_SVG = (
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" '
    'style="background: transparent; background-color: transparent; color-scheme: light dark;" '
    'version="1.1" width="701px" height="954px" viewBox="0 0 701 954"><defs/><g><rect/></g></svg>'
)


# ============================================================
class DescribeGetSvgDimensions:
    def test_parses_the_viewbox_rectangle(self):
        d = get_svg_dimensions('<svg viewBox="0 0 701 954">')
        assert d.x == "0"
        assert d.y == "0"
        assert d.width == "701"
        assert d.height == "954"

    def test_parses_a_non_zero_viewbox_origin(self):
        d = get_svg_dimensions('<svg viewBox="-10 -20 300 400">')
        assert d.x == "-10"
        assert d.y == "-20"
        assert d.width == "300"
        assert d.height == "400"

    def test_falls_back_to_width_height_attributes_stripping_px_when_no_viewbox(self):
        d = get_svg_dimensions('<svg width="640px" height="480px">')
        assert d.x == "0"
        assert d.y == "0"
        assert d.width == "640"
        assert d.height == "480"

    def test_falls_back_to_100_percent_when_neither_viewbox_nor_dimensions_are_present(self):
        d = get_svg_dimensions('<svg foo="bar">')
        assert d.width == "100%"
        assert d.height == "100%"


# ============================================================
class DescribeSetSvgWhiteBackground:
    def test_returns_the_content_unchanged_when_color_is_transparent(self):
        assert set_svg_white_background(SAMPLE_SVG, color="transparent") == SAMPLE_SVG

    def test_replaces_the_transparent_background_with_the_colour(self):
        out = set_svg_white_background(SAMPLE_SVG, color="#ffffff")
        assert re.search(r"background:#ffffff", out)
        assert re.search(r"background-color:#ffffff", out)
        assert "transparent" not in out

    def test_removes_the_color_scheme_dark_hint(self):
        out = set_svg_white_background(SAMPLE_SVG)
        assert "color-scheme" not in out

    def test_inserts_a_backing_rect_as_the_first_child_of_svg(self):
        out = set_svg_white_background(SAMPLE_SVG, color="#ffffff")
        assert re.search(r'<rect id="svg-bg" x="0" y="0" width="701" height="954" fill="#ffffff"/>', out)
        # The rect must come before the original content group.
        assert out.index('id="svg-bg"') < out.index("<g>")

    def test_honours_a_custom_colour(self):
        out = set_svg_white_background(SAMPLE_SVG, color="#101014")
        assert re.search(r'fill="#101014"', out)
        assert re.search(r"background:#101014", out)

    def test_is_idempotent_running_twice_adds_only_one_backing_rect(self):
        once = set_svg_white_background(SAMPLE_SVG)
        twice = set_svg_white_background(once)
        assert len(re.findall(r'id="svg-bg"', twice)) == 1

    def test_flattens_draw_io_light_dark_label_backgrounds_to_the_baked_colour(self):
        svg = (
            '<svg viewBox="0 0 10 10"><g><text style="background-color: '
            "light-dark(#ffffff, var(--ge-dark-color, #121212));\">x</text></g></svg>"
        )
        out = set_svg_white_background(svg, color="#161b22")
        assert re.search(r"background-color: #161b22", out)
        assert not re.search(r"light-dark\(#ffffff", out)


# ============================================================
class DescribeGetDrawioExportArgs:
    def test_builds_the_cropped_svg_export_argument_array_in_order(self):
        a = get_drawio_export_args("in.drawio", "out.svg", border=12)
        assert a == ["-x", "-f", "svg", "--crop", "--embed-svg-images", "-b", "12", "-o", "out.svg", "in.drawio"]

    def test_always_embeds_shape_library_images(self):
        a = get_drawio_export_args("i", "o")
        assert "--embed-svg-images" in a

    def test_threads_a_custom_border_through_as_a_string(self):
        a = get_drawio_export_args("i", "o", border=0)
        b_idx = a.index("-b")
        assert a[b_idx + 1] == "0"


# ============================================================
class DescribeGetDrawioCandidatePaths:
    def test_returns_windows_install_locations_including_program_files(self):
        paths = get_drawio_candidate_paths(
            windows=True,
            macos=False,
            program_files="C:\\Program Files",
            program_files_x86="C:\\Program Files (x86)",
            local_app_data="C:\\Users\\x\\AppData\\Local",
        )
        assert len(paths) == 3
        assert any("Program Files" in p and "draw.io" in p and "draw.io.exe" in p for p in paths)

    def test_skips_null_env_bases_on_windows(self):
        paths = get_drawio_candidate_paths(
            windows=True,
            macos=False,
            program_files="C:\\Program Files",
            program_files_x86="",
            local_app_data="",
        )
        assert len(paths) == 1

    def test_returns_the_app_bundle_path_on_macos(self):
        paths = get_drawio_candidate_paths(windows=False, macos=True)
        assert "/Applications/draw.io.app/Contents/MacOS/draw.io" in paths

    def test_returns_drawio_binary_paths_on_linux(self):
        paths = get_drawio_candidate_paths(windows=False, macos=False)
        assert "/usr/bin/drawio" in paths


# ============================================================
class DescribeResolveDrawioExecutable:
    def test_returns_the_explicit_path_when_it_exists(self):
        exe = resolve_drawio_executable(
            explicit_path="/opt/drawio",
            path_tester=lambda p: True,
            command_resolver=lambda n: None,
        )
        assert exe == "/opt/drawio"

    def test_throws_when_the_explicit_path_is_missing(self):
        import pytest

        with pytest.raises(FileNotFoundError, match="not found at --drawio-path"):
            resolve_drawio_executable(
                explicit_path="/nope",
                path_tester=lambda p: False,
                command_resolver=lambda n: None,
            )

    def test_prefers_a_drawio_binary_found_on_path(self):
        exe = resolve_drawio_executable(
            candidate_paths=["/never/used"],
            path_tester=lambda p: True,
            command_resolver=lambda n: "/usr/local/bin/drawio",
        )
        assert exe == "/usr/local/bin/drawio"

    def test_falls_back_to_the_first_existing_candidate_when_path_lookup_fails(self):
        exe = resolve_drawio_executable(
            candidate_paths=["/missing/one", "/present/two"],
            path_tester=lambda p: p == "/present/two",
            command_resolver=lambda n: None,
        )
        assert exe == "/present/two"

    def test_throws_a_helpful_message_when_nothing_is_found(self):
        import pytest

        with pytest.raises(FileNotFoundError, match="draw.io CLI not found"):
            resolve_drawio_executable(
                candidate_paths=["/missing"],
                path_tester=lambda p: False,
                command_resolver=lambda n: None,
            )
