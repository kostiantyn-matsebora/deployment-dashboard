"""
pytest suite for invoke_tokensave_guard.py.

Faithful translation of every Pester It block in Invoke-TokensaveGuard.Tests.ps1.
"""

import subprocess
import sys
from pathlib import Path

import pytest
from invoke_tokensave_guard import (
    branch_tracked,
    get_tokensave_guard_decision,
    is_code_path,
)

SCRIPT_PATH = Path(__file__).parent / "invoke_tokensave_guard.py"


def _run_script(stdin_data: str, cwd: Path) -> subprocess.CompletedProcess:
    """Run the tokensave guard script as a subprocess."""
    return subprocess.run(
        [sys.executable, str(SCRIPT_PATH)],
        input=stdin_data,
        capture_output=True,
        text=True,
        cwd=str(cwd),
    )

# ============================================================
# Describe: get_tokensave_guard_decision
# ============================================================

class DescribeGetTokensaveGuardDecision:

    # Context: branch IS tokensave-tracked (tokensave can answer)

    @pytest.mark.parametrize("ext", [".cs", ".ts", ".tsx", ".js", ".jsx"])
    def test_blocks_read_on_a_source_file(self, ext):
        ti = {"file_path": f"backend/x/Foo{ext}"}
        d = get_tokensave_guard_decision("Read", ti, branch_tracked=True)
        assert d["block"] is True
        assert "tokensave" in d["reason"]

    @pytest.mark.parametrize("ext", [".json", ".csproj", ".yaml", ".md", ".ps1"])
    def test_allows_read_on_a_declarative_file(self, ext):
        ti = {"file_path": f"config/app{ext}"}
        d = get_tokensave_guard_decision("Read", ti, branch_tracked=True)
        assert d["block"] is False

    def test_blocks_grep_with_a_code_type(self):
        ti = {"pattern": "SplitRepo", "type": "cs"}
        assert get_tokensave_guard_decision("Grep", ti, branch_tracked=True)["block"] is True

    def test_blocks_grep_with_a_code_glob(self):
        ti = {"pattern": "SplitRepo", "glob": "backend/**/*.cs"}
        assert get_tokensave_guard_decision("Grep", ti, branch_tracked=True)["block"] is True

    def test_blocks_grep_targeting_a_code_file_path(self):
        ti = {"pattern": "x", "path": "backend/x/Foo.cs"}
        assert get_tokensave_guard_decision("Grep", ti, branch_tracked=True)["block"] is True

    def test_allows_grep_with_a_non_code_glob(self):
        ti = {"pattern": "foo", "glob": "**/*.md"}
        assert get_tokensave_guard_decision("Grep", ti, branch_tracked=True)["block"] is False

    def test_allows_a_broad_grep_with_no_explicit_code_target(self):
        ti = {"pattern": "TODO"}
        assert get_tokensave_guard_decision("Grep", ti, branch_tracked=True)["block"] is False

    def test_ignores_tools_other_than_read_grep(self):
        ti = {"file_path": "backend/x/Foo.cs"}
        assert get_tokensave_guard_decision("Edit", ti, branch_tracked=True)["block"] is False

    # Context: branch is NOT tracked (tokensave falls back — must not dead-end)

    def test_allows_read_on_a_cs_file_when_branch_not_tracked(self):
        ti = {"file_path": "backend/x/Foo.cs"}
        assert get_tokensave_guard_decision("Read", ti, branch_tracked=False)["block"] is False

    def test_allows_grep_with_code_type_when_branch_not_tracked(self):
        ti = {"pattern": "x", "type": "cs"}
        assert get_tokensave_guard_decision("Grep", ti, branch_tracked=False)["block"] is False


# ============================================================
# Describe: branch_tracked
# ============================================================

class DescribeBranchTracked:
    def test_returns_true_when_branch_is_a_key_in_branch_meta_json(self, tmp_path):
        meta = tmp_path / "branch-meta.json"
        meta.write_text(
            '{"default_branch":"main","branches":{"main":{},"refactor/x":{}}}',
            encoding="utf-8",
        )
        assert branch_tracked("refactor/x", str(meta)) is True

    def test_returns_false_when_branch_is_absent(self, tmp_path):
        meta = tmp_path / "branch-meta2.json"
        meta.write_text(
            '{"default_branch":"main","branches":{"main":{}}}',
            encoding="utf-8",
        )
        assert branch_tracked("feature/missing", str(meta)) is False

    def test_returns_false_when_the_meta_file_is_missing(self, tmp_path):
        assert branch_tracked("main", str(tmp_path / "nope.json")) is False

    def test_returns_false_on_malformed_meta_json(self, tmp_path):
        meta = tmp_path / "bad.json"
        meta.write_text("not json {", encoding="utf-8")
        assert branch_tracked("main", str(meta)) is False


# ============================================================
# Describe: is_code_path
# ============================================================

class DescribeIsCodePath:
    def test_detects_a_code_extension(self):
        assert is_code_path("a/B.cs", [".cs", ".ts"]) is True

    def test_rejects_a_non_code_extension(self):
        assert is_code_path("a/b.json", [".cs", ".ts"]) is False

    def test_returns_false_for_an_empty_path(self):
        assert is_code_path("", [".cs"]) is False


# ============================================================
# Describe: Entry block plumbing (subprocess) — parity tests
# ============================================================


class DescribeEntryBlockPlumbing:
    def test_empty_stdin_exits_0_with_no_output(self, tmp_path: Path):
        """Empty stdin is a no-op (exit 0, no stdout) — matches PowerShell original."""
        result = _run_script("", cwd=tmp_path)
        assert result.returncode == 0
        assert result.stdout.strip() == ""

    def test_json_array_stdin_exits_0_with_no_output(self, tmp_path: Path):
        """JSON array on stdin is a no-op — PowerShell $payload.tool_name yields $null,
        not a throw; the Python port must match (exit 0, no stdout)."""
        result = _run_script('["a","b"]', cwd=tmp_path)
        assert result.returncode == 0
        assert result.stdout.strip() == ""

    def test_json_scalar_stdin_exits_0_with_no_output(self, tmp_path: Path):
        """JSON scalar (non-dict) on stdin is a no-op — same PS null-access parity."""
        result = _run_script('"just-a-string"', cwd=tmp_path)
        assert result.returncode == 0
        assert result.stdout.strip() == ""

    def test_invalid_json_stdin_exits_0_with_no_output(self, tmp_path: Path):
        """Invalid JSON on stdin is a no-op (exit 0, no stdout)."""
        result = _run_script("not json {", cwd=tmp_path)
        assert result.returncode == 0
        assert result.stdout.strip() == ""
