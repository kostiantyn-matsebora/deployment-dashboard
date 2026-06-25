"""
pytest suite for the Claude Code maintenance adapter (cc_maintenance.py).

Exercises the CC payload -> git -> engine wiring (the glue), including
tool_input parsing, warn/block exit codes, and the default cross-session
reader. Engine decision logic is covered in core/engine/drift_test.py.
"""

import json

from cc_maintenance import invoke_docs_keeper_maintenance

# Reuse the engine test fixtures for a consistent fake tree.
from core.engine.drift_test import (
    get_consistent_files,
    get_consistent_tree,
    new_dir_lister,
    new_file_reader,
    new_index_md,
)

null_session_reader = lambda: None  # noqa: E731


class DescribeInvokeDocsKeeperMaintenanceIntegration:
    def setup_method(self):
        self.lister = new_dir_lister(get_consistent_tree())
        self.reader = new_file_reader(get_consistent_files())

    def test_exits_0_with_reason_no_payload_when_stdin_empty(self):
        result = invoke_docs_keeper_maintenance(
            hook_input_json="",
            repo_root=".",
            git_command_runner=lambda argv: [],
            dir_lister=self.lister,
            file_reader=self.reader,
            session_reader=null_session_reader,
        )
        assert result["exit_code"] == 0
        assert result["reason"] == "no-payload"

    def test_exits_0_not_git_commit_when_bash_is_unrelated(self):
        result = invoke_docs_keeper_maintenance(
            hook_input_json='{"tool_input":{"command":"npm test"}}',
            repo_root=".",
            git_command_runner=lambda argv: [],
            dir_lister=self.lister,
            file_reader=self.reader,
            session_reader=null_session_reader,
        )
        assert result["reason"] == "not-git-commit"

    def test_exits_0_no_docs_change_when_commit_avoids_md_files(self):
        result = invoke_docs_keeper_maintenance(
            hook_input_json='{"tool_input":{"command":"git commit -m foo"}}',
            repo_root=".",
            git_command_runner=lambda argv: ["M\tsrc/Program.cs"],
            dir_lister=self.lister,
            file_reader=self.reader,
            session_reader=null_session_reader,
        )
        assert result["reason"] == "no-docs-change"

    def test_queues_docs_revise_on_a_docs_commit(self):
        result = invoke_docs_keeper_maintenance(
            hook_input_json='{"tool_input":{"command":"git commit -m foo"}}',
            repo_root=".",
            git_command_runner=lambda argv: ["M\tdocs/SAD.md"],
            dir_lister=self.lister,
            file_reader=self.reader,
            session_reader=null_session_reader,
        )
        assert result["exit_code"] == 2
        assert result["reason"] == "docs-drift-detected"
        assert result["queue"][0]["command"] == "/docs-revise"
        assert "docs/SAD.md" in result["queue"][0]["args"]

    def test_skips_revise_for_staged_md_already_revised_true(self):
        session_reader = lambda: {"head": "H", "dirty": [], "tracked_md": {"docs/SAD.md": {"revised": True}}}  # noqa: E731
        result = invoke_docs_keeper_maintenance(
            hook_input_json='{"tool_input":{"command":"git commit -m foo"}}',
            repo_root=".",
            git_command_runner=lambda argv: ["M\tdocs/SAD.md"],
            dir_lister=self.lister,
            file_reader=self.reader,
            session_reader=session_reader,
        )
        assert result["exit_code"] == 0
        assert result["reason"] == "no-docs-drift"

    def test_warn_mode_exits_0_but_still_surfaces_the_queue(self):
        result = invoke_docs_keeper_maintenance(
            hook_input_json='{"tool_input":{"command":"git commit -m foo"}}',
            repo_root=".",
            git_command_runner=lambda argv: ["M\tdocs/SAD.md"],
            dir_lister=self.lister,
            file_reader=self.reader,
            enforcement_mode="warn",
            session_reader=null_session_reader,
        )
        assert result["exit_code"] == 0
        assert result["reason"] == "docs-action-suggested"
        assert len(result["queue"]) > 0

    def test_block_mode_message_uses_the_cc_binding_gates_footer(self):
        result = invoke_docs_keeper_maintenance(
            hook_input_json='{"tool_input":{"command":"git commit -m foo"}}',
            repo_root=".",
            git_command_runner=lambda argv: ["M\tdocs/SAD.md"],
            dir_lister=self.lister,
            file_reader=self.reader,
            session_reader=null_session_reader,
        )
        assert "docs-keeper agent" in result["message"]

    def test_exits_2_with_both_revise_and_index_entries_when_an_index_is_drifted(self):
        files = dict(get_consistent_files())
        files["docs/api/index.md"] = new_index_md(["/openapi.yaml"])
        result = invoke_docs_keeper_maintenance(
            hook_input_json='{"tool_input":{"command":"git commit -m foo"}}',
            repo_root=".",
            git_command_runner=lambda argv: ["M\tdocs/api/api-guidelines.md"],
            dir_lister=self.lister,
            file_reader=new_file_reader(files),
            session_reader=null_session_reader,
        )
        assert result["exit_code"] == 2
        assert result["queue"][0]["command"] == "/docs-revise"
        assert any(q["command"] == "/docs-index" and q["args"] == "docs/api/" for q in result["queue"])

    def test_default_session_reader_merges_revised_true_from_a_cross_session_file(self, tmp_path):
        docs_keeper_dir = tmp_path / ".docs-keeper"
        docs_keeper_dir.mkdir()
        head = "abc123deadbeef000"
        (docs_keeper_dir / "session.other-session.json").write_text(
            json.dumps({"Head": head, "Dirty": [], "TrackedMd": {"docs/SAD.md": {"revised": True}}}),
            encoding="utf-8",
        )

        def fake_git(argv):
            if argv[0] == "rev-parse":
                return [head]
            return ["M\tdocs/SAD.md"]

        result = invoke_docs_keeper_maintenance(
            hook_input_json='{"tool_input":{"command":"git commit -m foo"},"session_id":"main-session"}',
            repo_root=str(tmp_path),
            git_command_runner=fake_git,
            dir_lister=self.lister,
            file_reader=self.reader,
        )
        assert result["exit_code"] == 0
        assert result["reason"] == "no-docs-drift"
