"""
pytest suite for build/assemble.py — core -> adapter vendoring + drift check.

Real filesystem against a synthetic mini-repo under tmp_path; no mocks.
"""

from pathlib import Path

from build.assemble import (
    ENGINE_DEST,
    SPEC_DEST,
    assemble,
    is_runtime_module,
    vendor_engine,
    vendor_spec,
)


def _make_repo(tmp_path):
    """Build a minimal repo layout with a couple of engine modules + spec files."""
    (tmp_path / "core" / "engine").mkdir(parents=True)
    (tmp_path / "core" / "engine" / "drift.py").write_text("VALUE = 1\n", encoding="utf-8")
    (tmp_path / "core" / "engine" / "drift_test.py").write_text("def test_x(): assert True\n", encoding="utf-8")
    (tmp_path / "core" / "spec").mkdir(parents=True)
    (tmp_path / "core" / "spec" / "role.md").write_text("# role\n", encoding="utf-8")
    (tmp_path / "core" / "spec" / "commands").mkdir()
    (tmp_path / "core" / "spec" / "commands" / "docs-index.md").write_text("# index\n", encoding="utf-8")
    for d in (ENGINE_DEST, SPEC_DEST):
        (tmp_path / Path(d).parent).mkdir(parents=True, exist_ok=True)


class DescribeIsRuntimeModule:
    def test_includes_plain_module(self):
        assert is_runtime_module("drift.py") is True

    def test_excludes_test_module(self):
        assert is_runtime_module("drift_test.py") is False

    def test_excludes_non_python(self):
        assert is_runtime_module("role.md") is False


class DescribeVendorEngine:
    def test_write_mode_copies_runtime_modules_and_skips_tests(self, tmp_path):
        _make_repo(tmp_path)
        vendor_engine(str(tmp_path), check=False)
        dest = tmp_path / ENGINE_DEST
        assert (dest / "drift.py").exists()
        assert (dest / "__init__.py").exists()
        assert not (dest / "drift_test.py").exists()

    def test_vendored_module_carries_generated_header(self, tmp_path):
        _make_repo(tmp_path)
        vendor_engine(str(tmp_path), check=False)
        assert (tmp_path / ENGINE_DEST / "drift.py").read_text().startswith("# GENERATED")

    def test_check_reports_drift_when_source_changes(self, tmp_path):
        _make_repo(tmp_path)
        vendor_engine(str(tmp_path), check=False)
        (tmp_path / "core" / "engine" / "drift.py").write_text("VALUE = 2\n", encoding="utf-8")
        drift = vendor_engine(str(tmp_path), check=True)
        assert any("out-of-sync" in d for d in drift)

    def test_check_is_clean_right_after_write(self, tmp_path):
        _make_repo(tmp_path)
        vendor_engine(str(tmp_path), check=False)
        assert vendor_engine(str(tmp_path), check=True) == []

    def test_check_reports_stale_vendored_module(self, tmp_path):
        _make_repo(tmp_path)
        vendor_engine(str(tmp_path), check=False)
        (tmp_path / ENGINE_DEST / "ghost.py").write_text("# stale\n", encoding="utf-8")
        assert any("stale" in d for d in vendor_engine(str(tmp_path), check=True))


class DescribeVendorSpec:
    def test_write_mode_copies_the_tree(self, tmp_path):
        _make_repo(tmp_path)
        vendor_spec(str(tmp_path), check=False)
        assert (tmp_path / SPEC_DEST / "role.md").exists()
        assert (tmp_path / SPEC_DEST / "commands" / "docs-index.md").exists()

    def test_check_reports_drift_when_a_spec_file_changes(self, tmp_path):
        _make_repo(tmp_path)
        vendor_spec(str(tmp_path), check=False)
        (tmp_path / "core" / "spec" / "role.md").write_text("# changed\n", encoding="utf-8")
        assert any("out-of-sync" in d for d in vendor_spec(str(tmp_path), check=True))

    def test_check_clean_after_write(self, tmp_path):
        _make_repo(tmp_path)
        vendor_spec(str(tmp_path), check=False)
        assert vendor_spec(str(tmp_path), check=True) == []


class DescribeAssemble:
    def test_full_assemble_then_check_is_in_sync(self, tmp_path):
        _make_repo(tmp_path)
        assemble(repo_root=str(tmp_path), check=False)
        assert assemble(repo_root=str(tmp_path), check=True) == []
