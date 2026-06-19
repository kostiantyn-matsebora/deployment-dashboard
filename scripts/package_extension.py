"""
Package a built browser extension into per-browser zip archives.

Takes the Vite-built dist directory from frontend/extension and packages it
into one zip per browser target under an output directory. The resulting zips
are ready for upload to each browser's extension store or for use as CI
artifacts.

Usage:
    python3 scripts/package_extension.py [--dist-path PATH] [--output-dir DIR]
                                          [--browsers chrome edge firefox]
"""

import argparse
import subprocess
import sys
import zipfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Pure functions (fully unit-tested)
# ---------------------------------------------------------------------------


def get_browser_targets(
    requested: list[str] | None = None,
    default: list[str] | None = None,
) -> list[str]:
    """
    Return the canonical set of browser targets.

    When an explicit list is provided it is returned as-is; otherwise the
    default set is used. Pure: no filesystem access, injectable for testing.
    """
    if default is None:
        default = ["chrome", "edge", "firefox"]
    if requested:
        return list(requested)
    return list(default)


def get_extension_zip_name(browser: str) -> str:
    """Return the output zip filename for a given browser target."""
    return f"{browser}.zip"


def new_extension_zip(
    dist_path: str,
    output_dir: str,
    browser: str,
    compress_function=None,
) -> str:
    """
    Create a zip archive of all files in a dist directory for one browser target.

    Returns the absolute path of the created zip.

    The compress function is injectable so the filesystem side-effect is
    replaceable in tests. Real default uses zipfile.ZipFile.

    output_dir must exist before calling this function.
    """
    if compress_function is None:

        def compress_function(source: str, dest: str) -> None:
            src = Path(source)
            with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
                for f in sorted(src.rglob("*")):
                    if f.is_file():
                        zf.write(f, f.relative_to(src))

    zip_name = get_extension_zip_name(browser)
    dest_path = str(Path(output_dir) / zip_name)
    compress_function(dist_path, dest_path)
    return dest_path


# ---------------------------------------------------------------------------
# Entry block (integration only — not unit-tested)
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Package a built browser extension into per-browser zip archives."
    )
    parser.add_argument("--dist-path", default="", help="Path to the built extension dist directory.")
    parser.add_argument("--output-dir", default="", help="Directory to write the zip files into.")
    parser.add_argument(
        "--browsers",
        nargs="+",
        default=None,
        help="Browser targets to package (default: chrome edge firefox).",
    )
    args = parser.parse_args()

    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if result.returncode != 0 or not result.stdout.strip():
        print(
            "Not inside a git repository; pass --dist-path and --output-dir explicitly.",
            file=sys.stderr,
        )
        sys.exit(1)
    repo_root = result.stdout.strip().splitlines()[0].strip()

    dist_path = args.dist_path or str(Path(repo_root) / "frontend" / "extension" / "dist")
    output_dir = args.output_dir or str(Path(repo_root) / "frontend" / "extension" / "dist-zips")

    if not Path(dist_path).is_dir():
        print(f"Dist directory not found: '{dist_path}'. Run 'npm run build' first.", file=sys.stderr)
        sys.exit(1)

    targets = get_browser_targets(requested=args.browsers)

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    packed = 0
    for browser in targets:
        zip_path = new_extension_zip(dist_path=dist_path, output_dir=output_dir, browser=browser)
        print(f"Packaged {browser} -> {zip_path}", file=sys.stderr)
        packed += 1

    print(f"Done. Packaged {packed} browser extension(s) to '{output_dir}'.", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
