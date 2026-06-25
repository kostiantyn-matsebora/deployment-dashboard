"""
Pairing test — run docs-keeper against this example host repo.

This repo is the docs-keeper pair-repo. The test locates a docs-keeper checkout
(DOCS_KEEPER_DIR env, or a sibling ../docs-keeper / ../_docs-keeper-extract),
imports its core engine, and asserts this repo is a clean docs baseline and that
drift is detected on a mutated copy. Skips with a clear message when docs-keeper
is not available alongside — no hard dependency. Real filesystem, no mocks.
"""

import os
import shutil
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))


def _find_docs_keeper() -> str | None:
    parent = os.path.dirname(HERE)
    candidates = [
        os.environ.get("DOCS_KEEPER_DIR", ""),
        os.path.join(parent, "docs-keeper"),
        os.path.join(parent, "_docs-keeper-extract"),
    ]
    for c in candidates:
        if c and os.path.isfile(os.path.join(c, "core", "engine", "drift.py")):
            return c
    return None


_DK = _find_docs_keeper()
if _DK and _DK not in sys.path:
    sys.path.insert(0, _DK)

pytestmark = pytest.mark.skipif(
    _DK is None,
    reason="docs-keeper checkout not found alongside (set DOCS_KEEPER_DIR or place ../docs-keeper)",
)


def _queue(root: str):
    from core.engine.drift import get_docs_drift_queue
    from core.engine.gitio import make_dir_lister, make_file_reader

    return get_docs_drift_queue(make_dir_lister(root), make_file_reader(root))


def _copy(tmp_path):
    dest = tmp_path / "copy"
    shutil.copytree(HERE, dest, ignore=shutil.ignore_patterns(".git", "__pycache__", ".pytest_cache", ".ruff_cache"))
    return dest


class DescribePairing:
    def test_this_repo_is_a_clean_docs_baseline(self):
        assert _queue(HERE) == []

    def test_neutral_cli_block_mode_passes_on_baseline(self):
        from core.engine.cli import run_drift_only

        assert run_drift_only(HERE, "block") == 0

    def test_removing_a_listed_doc_queues_docs_index(self, tmp_path):
        repo = _copy(tmp_path)
        (repo / "docs" / "getting-started.md").unlink()
        assert any(q["command"] == "/docs-index" and q["args"] == "docs/" for q in _queue(str(repo)))

    def test_adding_an_unlisted_doc_queues_docs_index(self, tmp_path):
        repo = _copy(tmp_path)
        (repo / "docs" / "api" / "errors.md").write_text("# Errors\n", encoding="utf-8")
        assert any(q["command"] == "/docs-index" and q["args"] == "docs/api/" for q in _queue(str(repo)))

    def test_breaking_the_registry_role_queues_registry_sync(self, tmp_path):
        repo = _copy(tmp_path)
        claude = repo / "CLAUDE.md"
        claude.write_text(
            claude.read_text(encoding="utf-8").replace(
                "Acme Stack documentation hub: architecture, API reference, and operations guides.",
                "stale role text",
            ),
            encoding="utf-8",
        )
        assert any(q["command"] == "/docs-registry-sync" for q in _queue(str(repo)))
