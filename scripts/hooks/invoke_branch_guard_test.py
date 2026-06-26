"""
pytest suite for invoke_branch_guard.py.

Faithful translation of every Pester It block in Invoke-BranchGuard.Tests.ps1.

Fake git runner mirrors the Pester New-GitRunner helper:
  make_git_runner(responses) -> callable(argv) -> str
  where responses maps an argv-join substring to a canned return value.
  Matching: exact equality first, then substring containment (mirrors the
  Pester `$key -match [regex]::Escape($k) -or $key -eq $k` logic).
"""

import re

from invoke_branch_guard import (
    get_branch_guard_decision,
    is_detached_head,
    is_git_commit_command,
    is_git_push_command,
    is_linked_worktree,
    is_pr_create_command,
)

# ---------------------------------------------------------------------------
# Fake git runner — mirrors New-GitRunner from the Pester BeforeAll block.
# ---------------------------------------------------------------------------

def make_git_runner(responses: dict):
    """
    Return a callable(argv) -> str that looks up canned output.

    Matching order (mirrors Pester):
      1. key == joined argv (exact)
      2. key is a substring of joined argv (regex-escaped match)
    Returns "" when no key matches (mirrors Pester returning @()).
    """

    def runner(argv: list[str]) -> str:
        key = " ".join(argv)
        for k, v in responses.items():
            if key == k or re.search(re.escape(k), key):
                return str(v) if v else ""
        return ""

    return runner


# ---------------------------------------------------------------------------
# Describe: is_git_commit_command
# ---------------------------------------------------------------------------

class DescribeIsGitCommitCommand:
    def test_true_for_git_commit_m_msg(self):
        assert is_git_commit_command('git commit -m "msg"') is True

    def test_true_for_git_commit_amend(self):
        assert is_git_commit_command("git commit --amend") is True

    def test_true_with_extra_whitespace_between_git_and_commit(self):
        assert is_git_commit_command("  git   commit  ") is True

    def test_false_for_git_push(self):
        assert is_git_commit_command("git push") is False

    def test_false_for_git_status(self):
        assert is_git_commit_command("git status") is False

    def test_false_for_git_log(self):
        assert is_git_commit_command("git log") is False


# ---------------------------------------------------------------------------
# Describe: is_detached_head
# ---------------------------------------------------------------------------

class DescribeIsDetachedHead:
    def test_true_when_runner_returns_HEAD(self):
        runner = make_git_runner({"rev-parse --abbrev-ref HEAD": "HEAD"})
        assert is_detached_head(runner) is True

    def test_false_when_runner_returns_main(self):
        runner = make_git_runner({"rev-parse --abbrev-ref HEAD": "main"})
        assert is_detached_head(runner) is False

    def test_false_when_runner_returns_feature_branch(self):
        runner = make_git_runner({"rev-parse --abbrev-ref HEAD": "feat/something"})
        assert is_detached_head(runner) is False

    def test_false_when_runner_returns_empty_string(self):
        runner = make_git_runner({"rev-parse --abbrev-ref HEAD": ""})
        assert is_detached_head(runner) is False


# ---------------------------------------------------------------------------
# Describe: get_branch_guard_decision (detached HEAD / lazy branching)
# ---------------------------------------------------------------------------

class DescribeGetBranchGuardDecision:
    def test_block_false_for_non_commit_command_without_checking_head(self):
        runner = make_git_runner({})
        result = get_branch_guard_decision("git push", runner)
        # Note: git push IS an integration command, so it checks worktree.
        # The Pester test uses an empty runner (no worktree mismatch -> not linked).
        # Empty runner returns "" for both git-dir and common-dir -> not linked -> block=False.
        assert result["block"] is False

    def test_block_false_for_commit_when_head_is_not_detached(self):
        runner = make_git_runner({"rev-parse --abbrev-ref HEAD": "main"})
        result = get_branch_guard_decision('git commit -m "fix"', runner)
        assert result["block"] is False

    def test_block_true_for_commit_when_head_is_detached(self):
        runner = make_git_runner({"rev-parse --abbrev-ref HEAD": "HEAD"})
        result = get_branch_guard_decision('git commit -m "fix"', runner)
        assert result["block"] is True

    def test_reason_mentions_git_checkout_b_when_blocking(self):
        runner = make_git_runner({"rev-parse --abbrev-ref HEAD": "HEAD"})
        result = get_branch_guard_decision("git commit --amend", runner)
        assert "git checkout -b" in result["reason"]


# ---------------------------------------------------------------------------
# Describe: is_git_push_command
# ---------------------------------------------------------------------------

class DescribeIsGitPushCommand:
    def test_true_for_git_push(self):
        assert is_git_push_command("git push") is True

    def test_true_for_git_push_force_origin_feat(self):
        assert is_git_push_command("git push --force origin feat") is True

    def test_false_for_git_pull(self):
        assert is_git_push_command("git pull") is False

    def test_false_for_git_commit(self):
        assert is_git_push_command("git commit -m x") is False


# ---------------------------------------------------------------------------
# Describe: is_pr_create_command
# ---------------------------------------------------------------------------

class DescribeIsPrCreateCommand:
    def test_true_for_gh_pr_create(self):
        assert is_pr_create_command("gh pr create --base main --head feat") is True

    def test_false_for_gh_pr_view(self):
        assert is_pr_create_command("gh pr view 5") is False

    def test_false_for_gh_run_list(self):
        assert is_pr_create_command("gh run list") is False


# ---------------------------------------------------------------------------
# Describe: is_linked_worktree
# ---------------------------------------------------------------------------

class DescribeIsLinkedWorktree:
    def test_true_when_git_dir_differs_from_common_dir(self):
        runner = make_git_runner(
            {
                "rev-parse --git-dir": "/repo/.git/worktrees/member-1",
                "rev-parse --git-common-dir": "/repo/.git",
            }
        )
        assert is_linked_worktree(runner) is True

    def test_false_when_git_dir_equals_common_dir(self):
        runner = make_git_runner(
            {
                "rev-parse --git-dir": ".git",
                "rev-parse --git-common-dir": ".git",
            }
        )
        assert is_linked_worktree(runner) is False

    def test_false_when_runner_returns_nothing(self):
        runner = make_git_runner({})
        assert is_linked_worktree(runner) is False


# ---------------------------------------------------------------------------
# Describe: get_branch_guard_decision (single-integrator / worktree)
# ---------------------------------------------------------------------------

LINKED_WORKTREE_RESPONSES = {
    "rev-parse --git-dir": "/repo/.git/worktrees/m1",
    "rev-parse --git-common-dir": "/repo/.git",
}


class DescribeGetBranchGuardDecisionSingleIntegrator:
    def test_blocks_git_commit_from_linked_worktree(self):
        runner = make_git_runner(LINKED_WORKTREE_RESPONSES)
        r = get_branch_guard_decision("git commit -m x", runner)
        assert r["block"] is True
        assert "Single-integrator" in r["reason"]

    def test_blocks_git_push_from_linked_worktree(self):
        runner = make_git_runner(LINKED_WORKTREE_RESPONSES)
        r = get_branch_guard_decision("git push origin feat", runner)
        assert r["block"] is True
        assert "Single-integrator" in r["reason"]

    def test_blocks_gh_pr_create_from_linked_worktree(self):
        runner = make_git_runner(LINKED_WORKTREE_RESPONSES)
        r = get_branch_guard_decision("gh pr create --base main", runner)
        assert r["block"] is True
        assert "Single-integrator" in r["reason"]

    def test_does_not_block_git_commit_from_main_worktree_on_branch(self):
        runner = make_git_runner(
            {
                "rev-parse --git-dir": ".git",
                "rev-parse --git-common-dir": ".git",
                "rev-parse --abbrev-ref HEAD": "feat/x",
            }
        )
        r = get_branch_guard_decision("git commit -m x", runner)
        assert r["block"] is False

    def test_does_not_block_non_integration_command_from_linked_worktree(self):
        runner = make_git_runner(LINKED_WORKTREE_RESPONSES)
        r = get_branch_guard_decision("git status", runner)
        assert r["block"] is False
