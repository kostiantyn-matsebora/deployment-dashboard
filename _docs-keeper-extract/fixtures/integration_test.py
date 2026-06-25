"""
Integration tests for the acme-stack pair-repo fixture.

Run the real engine against the real fixture tree (no mocks): the shipped fixture
is a clean baseline, and mutating a tmp copy must surface drift.
"""

import os
import shutil

from core.engine.cli import run_drift_only
from core.engine.drift import get_docs_drift_queue
from core.engine.gitio import make_dir_lister, make_file_reader

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "acme-stack")


def _queue(root):
    return get_docs_drift_queue(make_dir_lister(root), make_file_reader(root))


class DescribeAcmeStackBaseline:
    def test_shipped_fixture_has_no_drift(self):
        assert _queue(FIXTURE) == []

    def test_neutral_cli_block_mode_passes_on_baseline(self):
        assert run_drift_only(FIXTURE, "block") == 0


class DescribeAcmeStackDriftDetection:
    def test_removing_a_listed_doc_queues_docs_index(self, tmp_path):
        repo = tmp_path / "acme-stack"
        shutil.copytree(FIXTURE, repo)
        (repo / "docs" / "getting-started.md").unlink()
        queue = _queue(str(repo))
        assert any(q["command"] == "/docs-index" and q["args"] == "docs/" for q in queue)
        assert run_drift_only(str(repo), "block") == 2

    def test_adding_an_unlisted_doc_queues_docs_index(self, tmp_path):
        repo = tmp_path / "acme-stack"
        shutil.copytree(FIXTURE, repo)
        (repo / "docs" / "api" / "errors.md").write_text("# Errors\n", encoding="utf-8")
        queue = _queue(str(repo))
        assert any(q["command"] == "/docs-index" and q["args"] == "docs/api/" for q in queue)

    def test_breaking_the_registry_role_queues_registry_sync(self, tmp_path):
        repo = tmp_path / "acme-stack"
        shutil.copytree(FIXTURE, repo)
        claude = repo / "CLAUDE.md"
        text = claude.read_text(encoding="utf-8").replace(
            "Acme Stack documentation hub: architecture, API reference, and operations guides.",
            "stale role text",
        )
        claude.write_text(text, encoding="utf-8")
        assert any(q["command"] == "/docs-registry-sync" for q in _queue(str(repo)))

    def test_warn_mode_does_not_fail_the_gate_even_with_drift(self, tmp_path):
        repo = tmp_path / "acme-stack"
        shutil.copytree(FIXTURE, repo)
        (repo / "docs" / "getting-started.md").unlink()
        assert run_drift_only(str(repo), "warn") == 0
