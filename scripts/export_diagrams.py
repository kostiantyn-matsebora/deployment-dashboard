"""
Export draw.io diagrams to SVG with a baked-in background.

Renders every *.drawio under --path (default: docs/diagrams) to a sibling
*.svg via the draw.io desktop CLI, then post-processes each SVG to bake in a
solid background colour.

NOTE: rendering needs the draw.io desktop app (an Electron binary), which is
a developer/local dependency — not present in typical CI runners, so this
script is run locally and the committed SVGs are reviewed in the PR. The
script's *logic* (SVG transform, executable resolution, argument building) is
pure and fully tested, which is the CI gate per CLAUDE.md §Scripts.

Usage:
    python3 scripts/export_diagrams.py [--path PATH] [--drawio-path DRAWIOPATH]
                                       [--background COLOR] [--border N]
                                       [--timeout-seconds N]
"""

import argparse
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Pure functions (fully unit-tested)
# ---------------------------------------------------------------------------


@dataclass
class SvgDimensions:
    x: str
    y: str
    width: str
    height: str


def get_svg_dimensions(content: str) -> SvgDimensions:
    """
    Extract the drawing rectangle from an SVG.

    Prefers viewBox ("minX minY width height"); falls back to the
    width/height attributes.
    """
    m = re.search(
        r'viewBox="\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*"',
        content,
    )
    if m:
        return SvgDimensions(x=m.group(1), y=m.group(2), width=m.group(3), height=m.group(4))

    wm = re.search(r'width="([\d.]+)(?:px)?"', content)
    hm = re.search(r'height="([\d.]+)(?:px)?"', content)
    w = wm.group(1) if wm else "100%"
    h = hm.group(1) if hm else "100%"
    return SvgDimensions(x="0", y="0", width=w, height=h)


def set_svg_white_background(content: str, color: str = "#ffffff") -> str:
    """
    Bake a solid background into a draw.io-exported SVG.

    Pure string transform; idempotent (re-running adds no second backing rect).
    Returns the content unchanged when color is 'transparent'.
    """
    if color == "transparent":
        return content

    svg = content

    # 1) Neutralise the transparent canvas + the UA dark-mode hint on the root.
    svg = re.sub(r"color-scheme:\s*light dark;?", "", svg)
    svg = re.sub(r"background-color:\s*transparent", f"background-color:{color}", svg)
    svg = re.sub(r"background:\s*transparent", f"background:{color}", svg)

    # 1b) draw.io renders every HTML label background as
    #     light-dark(#ffffff, var(--ge-dark-color, #121212)).  Pin those
    #     label backgrounds to the baked colour so labels read on either.
    svg = svg.replace(
        "light-dark(#ffffff, var(--ge-dark-color, #121212))",
        color,
    )

    # 2) Paint a backing rect as the first child so the colour is baked into
    #    the rendered image.
    if 'id="svg-bg"' not in svg:
        dims = get_svg_dimensions(svg)
        rect = (
            f'<rect id="svg-bg" x="{dims.x}" y="{dims.y}" '
            f'width="{dims.width}" height="{dims.height}" fill="{color}"/>'
        )
        svg = re.sub(r"(<svg\b[^>]*>)", r"\1" + rect, svg, count=1)

    return svg


def get_drawio_export_args(input_path: str, output_path: str, border: int = 12) -> list[str]:
    """
    Build the draw.io CLI argument list for a cropped SVG export.

    Kept pure so the exact invocation is verifiable without launching Electron.
    --embed-svg-images is required: without it shape-library images are NOT
    inlined and render as broken placeholders in the standalone SVG.
    """
    return ["-x", "-f", "svg", "--crop", "--embed-svg-images", "-b", str(border), "-o", output_path, input_path]


def get_drawio_candidate_paths(
    windows: bool | None = None,
    macos: bool | None = None,
    program_files: str = "",
    program_files_x86: str = "",
    local_app_data: str = "",
) -> list[str]:
    """
    Per-platform default install locations for the draw.io desktop binary.

    Platform + env bases are parameters so the selection is unit-testable.
    When windows/macos are None, detect from sys.platform.
    """
    import os

    if windows is None:
        windows = sys.platform == "win32"
    if macos is None:
        macos = sys.platform == "darwin"

    if windows:
        if not program_files:
            program_files = os.environ.get("ProgramFiles", "")
        if not program_files_x86:
            program_files_x86 = os.environ.get("ProgramFiles(x86)", "")
        if not local_app_data:
            local_app_data = os.environ.get("LOCALAPPDATA", "")

        paths = []
        if program_files:
            paths.append(str(Path(program_files) / "draw.io" / "draw.io.exe"))
        if program_files_x86:
            paths.append(str(Path(program_files_x86) / "draw.io" / "draw.io.exe"))
        if local_app_data:
            paths.append(str(Path(local_app_data) / "Programs" / "draw.io" / "draw.io.exe"))
        return paths

    if macos:
        return ["/Applications/draw.io.app/Contents/MacOS/draw.io"]

    return ["/usr/bin/drawio", "/usr/local/bin/drawio", "/snap/bin/drawio", "/opt/drawio/drawio"]


def resolve_drawio_executable(
    explicit_path: str = "",
    candidate_paths: list[str] | None = None,
    path_tester=None,
    command_resolver=None,
) -> str:
    """
    Resolve the draw.io executable.

    Precedence: explicit path > 'drawio' on PATH > known install locations.
    The filesystem + command lookups are injectable callables so the
    precedence logic is unit-testable.
    """
    import shutil

    if path_tester is None:
        path_tester = lambda p: Path(p).exists()  # noqa: E731
    if command_resolver is None:
        command_resolver = lambda n: shutil.which(n) or ""  # noqa: E731
    if candidate_paths is None:
        candidate_paths = get_drawio_candidate_paths()

    if explicit_path:
        if path_tester(explicit_path):
            return explicit_path
        raise FileNotFoundError(
            f"draw.io executable not found at --drawio-path '{explicit_path}'."
        )

    on_path = command_resolver("drawio")
    if on_path:
        return on_path

    for candidate in candidate_paths:
        if candidate and path_tester(candidate):
            return candidate

    raise FileNotFoundError(
        "draw.io CLI not found. Install draw.io desktop or pass --drawio-path. "
        "See https://github.com/jgraph/drawio-desktop/releases."
    )


# ---------------------------------------------------------------------------
# Entry block (integration only — not unit-tested)
# ---------------------------------------------------------------------------


def _wait_for_stable_file(path: Path, timeout_seconds: int) -> bool:
    """Wait until the file exists and its size has stabilised."""
    deadline = time.monotonic() + timeout_seconds
    last_size = -1
    while time.monotonic() < deadline:
        if path.exists():
            size = path.stat().st_size
            if size > 0 and size == last_size:
                return True
            last_size = size
        time.sleep(0.5)
    return path.exists()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export draw.io diagrams to SVG with a baked-in background."
    )
    parser.add_argument("--path", default="", help="A single .drawio file or directory (default: docs/diagrams).")
    parser.add_argument("--drawio-path", default="", help="Explicit path to the draw.io executable.")
    parser.add_argument("--background", default="#ffffff", help="Background colour baked into each SVG (default #ffffff). Pass 'transparent' to keep raw export.")
    parser.add_argument("--border", type=int, default=12, help="Padding (px) around the cropped content (default 12).")
    parser.add_argument("--timeout-seconds", type=int, default=60, help="Max seconds to wait for each SVG (default 60).")
    args = parser.parse_args()

    path_str = args.path

    if not path_str:
        result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
        if result.returncode != 0 or not result.stdout.strip():
            print("Not inside a git repository; pass --path explicitly.", file=sys.stderr)
            sys.exit(1)
        repo_root = result.stdout.strip().splitlines()[0].strip()
        path_str = str(Path(repo_root) / "docs" / "diagrams")

    target = Path(path_str)

    if target.is_file():
        inputs = [str(target.resolve())]
    elif target.is_dir():
        inputs = [str(p) for p in sorted(target.rglob("*.drawio")) if p.is_file()]
    else:
        print(f"Path not found: '{path_str}'.", file=sys.stderr)
        sys.exit(1)

    if not inputs:
        print(f"No .drawio files found under '{path_str}'.", file=sys.stderr)
        sys.exit(1)

    try:
        exe = resolve_drawio_executable(explicit_path=args.drawio_path)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    print(f"draw.io: {exe}", file=sys.stderr)

    exported = 0
    for input_file in inputs:
        output_file = str(Path(input_file).with_suffix(".svg"))
        out_path = Path(output_file)
        if out_path.exists():
            out_path.unlink()

        export_args = get_drawio_export_args(input_path=input_file, output_path=output_file, border=args.border)
        print(f"Exporting {input_file} -> {output_file}", file=sys.stderr)
        subprocess.run([exe, *export_args], capture_output=True)

        if not _wait_for_stable_file(out_path, args.timeout_seconds):
            print(
                f"Export produced no output for '{input_file}'. "
                "Is draw.io desktop installed and not already running?",
                file=sys.stderr,
            )
            sys.exit(1)

        if args.background != "transparent":
            svg = out_path.read_text(encoding="utf-8")
            svg = set_svg_white_background(svg, color=args.background)
            out_path.write_text(svg, encoding="utf-8")

        exported += 1

    print(f"Done. Exported {exported} diagram(s) with background '{args.background}'.", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
