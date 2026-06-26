"""
Prepare a release: bump the CHANGELOG and open a release PR.

Computes the next version (explicit --version, or --bump against the highest
existing git tag), rewrites CHANGELOG.md (renames the [Unreleased] section to
the new version + date and inserts a fresh empty [Unreleased] above it),
then creates a release/vX.Y.Z branch, commits, pushes, and opens a PR.

This script does NOT create the git tag. After the PR merges, the maintainer
tags manually on main and pushes the tag, which triggers the release workflow:

    git checkout main && git pull
    git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z

Usage:
    python3 scripts/release/new_release.py (--version X.Y.Z | --bump major|minor|patch)
                                            [--dry-run]
"""

import argparse
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Pure functions (fully unit-tested)
# ---------------------------------------------------------------------------


def is_valid_semver(version: str) -> bool:
    """True for a SemVer string X.Y.Z or X.Y.Z-prerelease (no leading 'v')."""
    if not version or not version.strip():
        return False
    return bool(
        re.match(
            r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$",
            version,
        )
    )


def _parse_semver(version: str) -> tuple[int, int, int, str]:
    """Parse a validated SemVer string into (major, minor, patch, pre)."""
    core, *pre_parts = version.split("-", 1)
    pre = pre_parts[0] if pre_parts else ""
    nums = core.split(".")
    return int(nums[0]), int(nums[1]), int(nums[2]), pre


def _compare_semver(a: str, b: str) -> int:
    """Compare two SemVer strings. Returns -1, 0, or 1 (a vs b)."""
    ma, mi, pa, pre_a = _parse_semver(a)
    mb, mi_b, pb, pre_b = _parse_semver(b)
    for va, vb in [(ma, mb), (mi, mi_b), (pa, pb)]:
        if va < vb:
            return -1
        if va > vb:
            return 1
    # Core equal: a present pre-release is lower than no pre-release.
    if pre_a and not pre_b:
        return -1
    if not pre_a and pre_b:
        return 1
    if pre_a < pre_b:
        return -1
    if pre_a > pre_b:
        return 1
    return 0


def get_current_version(tags: list[str]) -> str:
    """Highest SemVer (without 'v') among the given tags, or '0.0.0' if none."""
    best: str | None = None
    for tag in tags:
        if tag is None:
            continue
        candidate = str(tag).strip()
        if candidate.startswith("v"):
            candidate = candidate[1:]
        if not is_valid_semver(candidate):
            continue
        if best is None or _compare_semver(candidate, best) > 0:
            best = candidate
    return best if best is not None else "0.0.0"


def get_next_version(current: str, bump: str) -> str:
    """Bump a SemVer string by major|minor|patch, resetting lower parts."""
    if not is_valid_semver(current):
        raise ValueError(f"Invalid current version: '{current}'.")
    major, minor, patch, _ = _parse_semver(current)
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    if bump == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError(f"Invalid bump: '{bump}'. Expected major, minor, or patch.")


def update_changelog(content: str, version: str, date: str) -> str:
    """
    Rename the [Unreleased] header to [<Version>] - <Date> and insert a
    fresh empty [Unreleased] section above it. Pure string transform.
    """
    newline = "\r\n" if "\r\n" in content else "\n"
    lines = re.split(r"\r?\n", content)

    idx = -1
    for i, line in enumerate(lines):
        if re.match(r"^##\s*\[Unreleased\]\s*$", line):
            idx = i
            break

    if idx < 0:
        raise ValueError('CHANGELOG has no "## [Unreleased]" section to release.')

    fresh = ["## [Unreleased]", "", ""]
    renamed = f"## [{version}] - {date}"

    before = lines[:idx] if idx > 0 else []
    after = lines[idx + 1 :] if idx < len(lines) - 1 else []

    result = before + fresh + [renamed] + after
    return newline.join(result)


def update_doc_version_examples(content: str, version: str) -> str:
    """
    Rewrite the release pin-version EXAMPLES in adopter docs to <version>.

    Pure string transform. Bumps the "pin to a published release" examples so
    the guide always demonstrates the latest tag. Idempotent.

    Covered examples (any SemVer -> <version>):
      - DASHBOARD_VERSION=<semver>                     (.env / inline)
      - published release (e.g. `<semver>`)            (configuration table)
      - the git tag `v<semver>` publishes images as `<semver>`
      - .../v<semver>/compose/...                      (pin-a-release URL)
      - compose-demo:<semver>                          (OCI demo artifact)
    """
    # SemVer pattern without leading 'v'. Uses a non-capturing group so it adds
    # no extra capture group numbers and backreferences stay predictable.
    sv = r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?"

    # Escape the replacement version string so it is safe in regex replacement.
    ver_repl = version.replace("\\", "\\\\")

    # 1. DASHBOARD_VERSION=<semver>
    content = re.sub(rf"DASHBOARD_VERSION={sv}", f"DASHBOARD_VERSION={ver_repl}", content)

    # 2. published release (e.g. `<semver>`)
    # Pattern: (prefix)semver(suffix) -> keep prefix + new version + suffix
    content = re.sub(
        rf"(published release \(e\.g\. `)(?:{sv})(`\))",
        lambda m: m.group(1) + version + m.group(2),
        content,
    )

    # 3. the git tag `v<semver>` publishes images as `<semver>`
    content = re.sub(
        rf"(the git tag `v)(?:{sv})(` publishes images as `)(?:{sv})(`)",
        lambda m: m.group(1) + version + m.group(2) + version + m.group(3),
        content,
    )

    # 4. .../v<semver>/compose/...
    content = re.sub(rf"/v{sv}/compose/", f"/v{ver_repl}/compose/", content)

    # 5. compose-demo:<semver>
    content = re.sub(rf"compose-demo:{sv}", f"compose-demo:{ver_repl}", content)

    return content


# ---------------------------------------------------------------------------
# Entry block (integration only — not unit-tested)
# ---------------------------------------------------------------------------


def _run_git(args: list[str], cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True, cwd=cwd)


def _run_gh(args: list[str], cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["gh", *args], capture_output=True, text=True, cwd=cwd)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare a release: bump the CHANGELOG and open a release PR."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--version",
        default="",
        help="Explicit target version WITHOUT a leading 'v' (e.g. 1.2.3).",
    )
    group.add_argument(
        "--bump",
        choices=["major", "minor", "patch"],
        help="Semantic bump applied to the highest existing tag.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview the CHANGELOG change and planned commands without mutating anything.",
    )
    args = parser.parse_args()

    result = _run_git(["rev-parse", "--show-toplevel"])
    if result.returncode != 0 or not result.stdout.strip():
        print("Not inside a git repository.", file=sys.stderr)
        sys.exit(1)
    repo_root = result.stdout.strip().splitlines()[0].strip()

    # Resolve target version.
    if args.version:
        if not is_valid_semver(args.version):
            print(
                f"Invalid --version '{args.version}'. "
                "Expected X.Y.Z or X.Y.Z-prerelease (no leading 'v').",
                file=sys.stderr,
            )
            sys.exit(1)
        target = args.version
    else:
        tags_result = _run_git(["tag", "--list", "v*"])
        tags = [t for t in tags_result.stdout.splitlines() if t.strip()]
        current = get_current_version(tags)
        target = get_next_version(current, args.bump)
        print(f"Current version: {current}  ->  next ({args.bump}): {target}", file=sys.stderr)

    tag_name = f"v{target}"
    branch_name = f"release/{tag_name}"

    # Guards.
    existing_tag = _run_git(["tag", "--list", tag_name])
    existing_tags = [t for t in existing_tag.stdout.splitlines() if t.strip()]
    if existing_tags:
        if args.dry_run:
            print(f"Warning: Tag '{tag_name}' already exists.", file=sys.stderr)
        else:
            print(f"Tag '{tag_name}' already exists.", file=sys.stderr)
            sys.exit(1)

    if not args.dry_run:
        porcelain = _run_git(["status", "--porcelain"])
        if porcelain.stdout.strip():
            print(
                "Working tree is not clean. Commit or stash changes before releasing.",
                file=sys.stderr,
            )
            sys.exit(1)

        branch_result = _run_git(["rev-parse", "--abbrev-ref", "HEAD"])
        branch = branch_result.stdout.strip().splitlines()[0].strip() if branch_result.stdout.strip() else ""
        if branch != "main":
            print(
                f"Releases must be cut from 'main' (current branch: '{branch}').",
                file=sys.stderr,
            )
            sys.exit(1)

    # CHANGELOG transform.
    changelog_path = Path(repo_root) / "CHANGELOG.md"
    if not changelog_path.exists():
        print(f"CHANGELOG.md not found at '{changelog_path}'.", file=sys.stderr)
        sys.exit(1)
    original = changelog_path.read_text(encoding="utf-8")
    today = datetime.now(tz=UTC).strftime("%Y-%m-%d")
    updated = update_changelog(original, version=target, date=today)

    # Doc pin-version examples.
    doc_rel_paths = [
        "docs/guide/install.md",
        "docs/guide/configuration.md",
        "docs/guide/quickstart.md",
    ]
    doc_updates: list[dict] = []
    for rel in doc_rel_paths:
        doc_path = Path(repo_root) / rel
        if not doc_path.exists():
            print(f"Warning: Doc not found, skipping pin-version bump: {rel}", file=sys.stderr)
            continue
        doc_original = doc_path.read_text(encoding="utf-8")
        doc_updated = update_doc_version_examples(doc_original, version=target)
        if doc_updated != doc_original:
            doc_updates.append({"rel": rel, "path": str(doc_path), "content": doc_updated})

    post_merge = [
        "git checkout main && git pull",
        f'git tag -a {tag_name} -m "{tag_name}" && git push origin {tag_name}',
    ]

    pr_body = (
        f"Release **{tag_name}**.\n\n"
        f"This PR bumps the CHANGELOG for `{tag_name}`. It does NOT create the git tag.\n\n"
        "After merging this PR, run on main:\n\n"
        "    " + "\n    ".join(post_merge) + "\n\n"
        "Pushing the tag triggers `.github/workflows/release.yml` to build + publish the\n"
        "six service images and draft the GitHub Release."
    )

    if args.dry_run:
        print("", file=sys.stderr)
        print(f"[DryRun] Target version : {target}", file=sys.stderr)
        print(f"[DryRun] Tag (post-merge): {tag_name}", file=sys.stderr)
        print(f"[DryRun] Release branch  : {branch_name}", file=sys.stderr)
        print("", file=sys.stderr)
        print("[DryRun] CHANGELOG.md preview:", file=sys.stderr)
        print("------------------------------------------------------------", file=sys.stderr)
        print(updated, file=sys.stderr)
        print("------------------------------------------------------------", file=sys.stderr)
        print("", file=sys.stderr)
        if doc_updates:
            print(f"[DryRun] Doc pin-version examples bumped to {target} in:", file=sys.stderr)
            for d in doc_updates:
                print(f"  {d['rel']}", file=sys.stderr)
        else:
            print(f"[DryRun] No doc pin-version examples needed updating (already {target}).", file=sys.stderr)
        print("", file=sys.stderr)
        print("[DryRun] Would run:", file=sys.stderr)
        print(f"  git checkout -b {branch_name}", file=sys.stderr)
        doc_files = " " + " ".join(d["rel"] for d in doc_updates) if doc_updates else ""
        print(f"  git add CHANGELOG.md{doc_files}", file=sys.stderr)
        print(f'  git commit -m "chore(release): {tag_name}"', file=sys.stderr)
        print(f"  git push -u origin {branch_name}", file=sys.stderr)
        print(f'  gh pr create --title "chore(release): {tag_name}" --body <post-merge instructions>', file=sys.stderr)
        print("", file=sys.stderr)
        print("[DryRun] No changes made.", file=sys.stderr)
        sys.exit(0)

    # Write files.
    changelog_path.write_text(updated, encoding="utf-8")
    for d in doc_updates:
        Path(d["path"]).write_text(d["content"], encoding="utf-8")
        print(f"Bumped pin-version examples to {target} in {d['rel']}.", file=sys.stderr)

    r = _run_git(["checkout", "-b", branch_name])
    if r.returncode != 0:
        print(f"git checkout -b {branch_name} failed.", file=sys.stderr)
        sys.exit(1)

    r = _run_git(["add", str(changelog_path)])
    if r.returncode != 0:
        print("git add CHANGELOG.md failed.", file=sys.stderr)
        sys.exit(1)

    for d in doc_updates:
        r = _run_git(["add", d["path"]])
        if r.returncode != 0:
            print(f"git add {d['rel']} failed.", file=sys.stderr)
            sys.exit(1)

    r = _run_git(["commit", "-m", f"chore(release): {tag_name}"])
    if r.returncode != 0:
        print("git commit failed.", file=sys.stderr)
        sys.exit(1)

    r = _run_git(["push", "-u", "origin", branch_name])
    if r.returncode != 0:
        print(f"git push failed for {branch_name}.", file=sys.stderr)
        sys.exit(1)

    r = _run_gh(["pr", "create", "--title", f"chore(release): {tag_name}", "--body", pr_body])
    if r.returncode != 0:
        print("gh pr create failed.", file=sys.stderr)
        sys.exit(1)

    print("", file=sys.stderr)
    print(f"Release PR opened for {tag_name}.", file=sys.stderr)
    print("After the PR merges, run on main:", file=sys.stderr)
    print("", file=sys.stderr)
    for cmd in post_merge:
        print(f"    {cmd}", file=sys.stderr)
    print("", file=sys.stderr)
    print("Pushing the tag triggers .github/workflows/release.yml to build + publish", file=sys.stderr)
    print("the six service images and draft the GitHub Release.", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
