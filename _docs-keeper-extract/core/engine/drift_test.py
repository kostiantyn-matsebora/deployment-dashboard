"""
pytest suite for core/engine/drift.py — platform-neutral drift detection.

Ported from the original invoke_docs_keeper_maintenance pure-function tests.
Fake filesystem helpers (dir_lister / file_reader) are plain callables; no mocks.
"""

import re

from core.engine.drift import (
    check_registry_has_entry,
    check_registry_role_in_sync,
    convert_git_name_status,
    evaluate_commit_maintenance,
    expand_host_content,
    find_host_root_prompt_file,
    format_block_message,
    get_content_sha,
    get_declared_children,
    get_docs_drift_queue,
    get_expected_children,
    get_index_dirs,
    get_intro_from_front_matter,
    get_root_index_dirs,
    get_safe_session_id,
    get_session_id_from_payload,
    is_git_commit,
    is_hidden_name,
    is_markdown_path,
    read_hook_payload,
    resolve_command_queue,
    resolve_enforcement_mode,
    resolve_revise_queue,
    sets_equal,
    touches_indexed_content,
)

# ---------------------------------------------------------------------------
# Fake filesystem helpers
# ---------------------------------------------------------------------------


def new_index_md(children: list[str]) -> str:
    lines = ["---", "title: X", "intro: 'x'", "children:"]
    for c in children:
        lines.append(f"  - {c}")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def new_dir_lister(tree: dict):
    def dir_lister(rel_dir: str) -> list[dict]:
        return tree.get(rel_dir, [])

    return dir_lister


def new_file_reader(files: dict):
    def file_reader(path: str) -> str:
        return files.get(path, "")

    return file_reader


def get_consistent_tree() -> dict:
    return {
        ".": [
            {"name": "docs", "is_dir": True},
            {"name": "backend", "is_dir": True},
            {"name": "scripts", "is_dir": True},
            {"name": "node_modules", "is_dir": True},
        ],
        "backend": [],
        "scripts": [],
        "docs": [
            {"name": "SAD.md", "is_dir": False},
            {"name": "FRONTEND_REQUIREMENTS.md", "is_dir": False},
            {"name": "index.md", "is_dir": False},
            {"name": "api", "is_dir": True},
            {"name": "design", "is_dir": True},
        ],
        "docs/api": [
            {"name": "api-guidelines.md", "is_dir": False},
            {"name": "openapi.yaml", "is_dir": False},
            {"name": "index.md", "is_dir": False},
        ],
        "docs/design": [
            {"name": "behavior.md", "is_dir": False},
            {"name": "components.md", "is_dir": False},
            {"name": "data-model.md", "is_dir": False},
            {"name": "design-tokens.md", "is_dir": False},
            {"name": "libraries.md", "is_dir": False},
            {"name": "views.md", "is_dir": False},
            {"name": "README.md", "is_dir": False},
            {"name": "index.md", "is_dir": False},
            {"name": "mockup", "is_dir": True},
        ],
        "docs/design/mockup": [
            {"name": "index.html", "is_dir": False},
            {"name": "index.md", "is_dir": False},
        ],
    }


def get_consistent_files() -> dict:
    return {
        "docs/index.md": new_index_md(["/SAD", "/FRONTEND_REQUIREMENTS", "/api", "/design"]),
        "docs/api/index.md": new_index_md(["/openapi.yaml", "/api-guidelines"]),
        "docs/design/index.md": new_index_md(
            ["/README", "/design-tokens", "/components", "/views", "/behavior", "/data-model", "/libraries", "/mockup"]
        ),
        "docs/design/mockup/index.md": new_index_md(["/index.html"]),
        "CLAUDE.md": "# Project\n\n@.claude/team-process/conventions.md\n",
        ".claude/team-process/conventions.md": "## Sources of truth\n\n- [docs/](docs/) — x.\n\n## Other\n",
    }


# ---------------------------------------------------------------------------
# is_git_commit
# ---------------------------------------------------------------------------


class DescribeIsGitCommit:
    def test_matches_plain_git_commit(self):
        assert is_git_commit("git commit") is True

    def test_matches_git_commit_m_with_message(self):
        assert is_git_commit('git commit -m "foo"') is True

    def test_matches_git_c_path_commit(self):
        assert is_git_commit("git -C /repo commit -m foo") is True

    def test_matches_commit_after_ampersand_chain(self):
        assert is_git_commit("git add . && git commit -m foo") is True

    def test_matches_commit_after_semicolon_chain(self):
        assert is_git_commit("git add . ; git commit -m foo") is True

    def test_rejects_git_status(self):
        assert is_git_commit("git status") is False

    def test_rejects_git_commit_tree_substring_trap(self):
        assert is_git_commit("git commit-tree abc") is False

    def test_rejects_git_commit_graph(self):
        assert is_git_commit("git commit-graph write") is False

    def test_rejects_empty_string(self):
        assert is_git_commit("") is False

    def test_rejects_none(self):
        assert is_git_commit(None) is False


# ---------------------------------------------------------------------------
# convert_git_name_status
# ---------------------------------------------------------------------------


class DescribeConvertGitNameStatus:
    def test_parses_an_added_file(self):
        result = convert_git_name_status("A\tdocs/api/README.md")
        assert len(result) == 1
        assert result[0]["status"] == "A"
        assert result[0]["path"] == "docs/api/README.md"
        assert result[0]["old_path"] is None

    def test_parses_a_modified_file(self):
        result = convert_git_name_status("M\tdocs/api/openapi.yaml")
        assert result[0]["status"] == "M"
        assert result[0]["path"] == "docs/api/openapi.yaml"

    def test_parses_a_deleted_file(self):
        result = convert_git_name_status("D\tdocs/api/legacy.md")
        assert result[0]["status"] == "D"
        assert result[0]["path"] == "docs/api/legacy.md"

    def test_parses_a_renamed_file_with_similarity_score(self):
        result = convert_git_name_status("R100\tdocs/api/old.md\tdocs/api/new.md")
        assert result[0]["status"] == "R"
        assert result[0]["old_path"] == "docs/api/old.md"
        assert result[0]["path"] == "docs/api/new.md"

    def test_parses_a_copied_file_with_similarity_score(self):
        result = convert_git_name_status("C75\tdocs/api/a.md\tdocs/api/b.md")
        assert result[0]["status"] == "C"
        assert result[0]["old_path"] == "docs/api/a.md"
        assert result[0]["path"] == "docs/api/b.md"

    def test_parses_multiple_lines(self):
        inp = "A\tdocs/api/x.md\nM\tdocs/design/y.md\nD\tdocs/api/z.md"
        assert len(convert_git_name_status(inp)) == 3

    def test_handles_crlf_line_endings(self):
        inp = "A\tdocs/api/x.md\r\nM\tdocs/design/y.md"
        assert len(convert_git_name_status(inp)) == 2

    def test_returns_empty_array_on_empty_input(self):
        assert convert_git_name_status("") == []

    def test_returns_empty_array_on_whitespace_only_input(self):
        assert convert_git_name_status("   \n\n  ") == []


# ---------------------------------------------------------------------------
# is_markdown_path / touches_indexed_content
# ---------------------------------------------------------------------------


class DescribeIsMarkdownPath:
    def test_matches_any_md_file_in_docs(self):
        assert is_markdown_path("docs/api/README.md") is True

    def test_matches_nested_md_path(self):
        assert is_markdown_path("a/b/c/file.md") is True

    def test_rejects_cs_file(self):
        assert is_markdown_path("src/Program.cs") is False

    def test_rejects_yaml_file(self):
        assert is_markdown_path("docs/api/openapi.yaml") is False

    def test_rejects_empty_string(self):
        assert is_markdown_path("") is False

    def test_rejects_none(self):
        assert is_markdown_path(None) is False


class DescribeTouchesIndexedContent:
    def test_true_when_a_path_is_a_md_file(self):
        assert touches_indexed_content([{"status": "M", "path": "docs/SAD.md", "old_path": None}]) is True

    def test_true_when_old_path_is_a_md_file_rename_source(self):
        assert touches_indexed_content([{"status": "R", "path": "docs/api/new.md", "old_path": "docs/api/old.md"}]) is True

    def test_false_when_no_md_file_touched(self):
        assert touches_indexed_content([{"status": "M", "path": "src/foo.cs", "old_path": None}]) is False

    def test_false_when_only_non_markdown_docs_file_staged(self):
        assert touches_indexed_content([{"status": "M", "path": "docs/api/openapi.yaml", "old_path": None}]) is False

    def test_false_on_empty_change_set(self):
        assert touches_indexed_content([]) is False


# ---------------------------------------------------------------------------
# is_hidden_name / find_host_root_prompt_file
# ---------------------------------------------------------------------------


class DescribeIsHiddenName:
    def test_flags_dot_prefixed(self):
        assert is_hidden_name(".git") is True

    def test_flags_underscore_prefixed_jekyll(self):
        assert is_hidden_name("_drafts") is True

    def test_passes_a_normal_name(self):
        assert is_hidden_name("api") is False


class DescribeFindHostRootPromptFile:
    def test_returns_CLAUDE_md_when_present(self):
        reader = new_file_reader({"CLAUDE.md": "## Sources of truth"})
        assert find_host_root_prompt_file(reader) == "CLAUDE.md"

    def test_falls_back_to_AGENTS_md_when_CLAUDE_md_absent(self):
        reader = new_file_reader({"AGENTS.md": "## Sources of truth"})
        assert find_host_root_prompt_file(reader) == "AGENTS.md"

    def test_falls_back_to_agent_INDEX_md_when_both_absent(self):
        reader = new_file_reader({".agent/INDEX.md": "## Sources of truth"})
        assert find_host_root_prompt_file(reader) == ".agent/INDEX.md"

    def test_returns_empty_string_when_none_found(self):
        assert find_host_root_prompt_file(new_file_reader({})) == ""

    def test_prefers_CLAUDE_md_over_AGENTS_md_when_both_present(self):
        reader = new_file_reader({"CLAUDE.md": "x", "AGENTS.md": "y"})
        assert find_host_root_prompt_file(reader) == "CLAUDE.md"

    def test_skips_whitespace_only_files(self):
        reader = new_file_reader({"CLAUDE.md": "   \n\t  ", "AGENTS.md": "content"})
        assert find_host_root_prompt_file(reader) == "AGENTS.md"


# ---------------------------------------------------------------------------
# get_declared_children / sets_equal
# ---------------------------------------------------------------------------


class DescribeGetDeclaredChildren:
    def test_parses_a_block_list_of_children(self):
        result = get_declared_children(new_index_md(["/openapi.yaml", "/api-guidelines"]))
        assert "/openapi.yaml" in result
        assert "/api-guidelines" in result
        assert len(result) == 2

    def test_returns_empty_when_no_children_key(self):
        assert get_declared_children("---\ntitle: X\nintro: 'x'\n---\n\nbody") == []

    def test_stops_at_the_closing_front_matter_delimiter(self):
        result = get_declared_children("---\nchildren:\n  - /a\n---\n  - /not-a-child\n")
        assert len(result) == 1
        assert "/a" in result

    def test_stops_at_the_next_top_level_key(self):
        assert len(get_declared_children("---\nchildren:\n  - /a\ntitle: X\n---\n")) == 1

    def test_returns_empty_on_empty_content(self):
        assert get_declared_children("") == []


class DescribeSetsEqual:
    def test_true_for_same_members_different_order(self):
        assert sets_equal(["/a", "/b", "/c"], ["/c", "/a", "/b"]) is True

    def test_false_when_a_member_is_missing(self):
        assert sets_equal(["/a", "/b"], ["/a"]) is False

    def test_true_for_two_empty_sets(self):
        assert sets_equal([], []) is True


# ---------------------------------------------------------------------------
# get_expected_children / get_index_dirs / get_root_index_dirs
# ---------------------------------------------------------------------------


class DescribeGetExpectedChildren:
    def test_enumerates_direct_markdown_without_extension_and_yaml_with_extension(self):
        result = get_expected_children("docs/api", new_dir_lister(get_consistent_tree()))
        assert "/api-guidelines" in result
        assert "/openapi.yaml" in result
        assert "/index" not in result
        assert len(result) == 2

    def test_treats_a_sub_dir_holding_index_md_as_a_boundary_entry(self):
        result = get_expected_children("docs/design", new_dir_lister(get_consistent_tree()))
        assert "/mockup" in result
        assert "/README" in result

    def test_surfaces_top_level_docs_files_and_sub_dir_boundaries_from_the_root(self):
        result = get_expected_children("docs", new_dir_lister(get_consistent_tree()))
        assert "/SAD" in result
        assert "/api" in result
        assert "/design" in result
        assert len(result) == 4

    def test_descends_into_a_sub_dir_without_index_md_and_nests_the_entries(self):
        tree = {
            "docs": [{"name": "index.md", "is_dir": False}, {"name": "guides", "is_dir": True}],
            "docs/guides": [{"name": "intro.md", "is_dir": False}],
        }
        result = get_expected_children("docs", new_dir_lister(tree))
        assert "/guides/intro" in result

    def test_skips_hidden_and_underscore_entries(self):
        tree = {
            "docs": [
                {"name": ".hidden.md", "is_dir": False},
                {"name": "_draft.md", "is_dir": False},
                {"name": "real.md", "is_dir": False},
            ]
        }
        result = get_expected_children("docs", new_dir_lister(tree))
        assert len(result) == 1
        assert "/real" in result


class DescribeGetIndexDirs:
    def test_finds_every_directory_holding_an_index_md_under_docs(self):
        result = get_index_dirs("docs", new_dir_lister(get_consistent_tree()), exclude_dirs=set())
        assert set(result) == {"docs", "docs/api", "docs/design", "docs/design/mockup"}

    def test_finds_index_dirs_when_scanning_from_repo_root(self):
        result = get_index_dirs(".", new_dir_lister(get_consistent_tree()), exclude_dirs={"node_modules"})
        assert "docs" in result
        assert "backend" not in result
        assert len(result) == 4

    def test_does_not_recurse_into_excluded_directories(self):
        tree = {
            ".": [{"name": "docs", "is_dir": True}, {"name": "node_modules", "is_dir": True}],
            "docs": [{"name": "index.md", "is_dir": False}],
            "node_modules": [{"name": "index.md", "is_dir": False}],
        }
        result = get_index_dirs(".", new_dir_lister(tree), exclude_dirs={"node_modules"})
        assert "docs" in result
        assert "node_modules" not in result

    def test_returns_empty_when_root_has_no_index_md_anywhere(self):
        lister = new_dir_lister({"docs": [{"name": "loose.md", "is_dir": False}]})
        assert get_index_dirs("docs", lister, exclude_dirs=set()) == []


class DescribeGetRootIndexDirs:
    def test_returns_only_dirs_whose_parent_has_no_index_md(self):
        roots = get_root_index_dirs(["docs", "docs/api", "docs/design", "docs/design/mockup"])
        assert roots == ["docs"]

    def test_treats_two_independent_roots_as_both_root(self):
        assert len(get_root_index_dirs(["docs", "spec"])) == 2


# ---------------------------------------------------------------------------
# registry checks
# ---------------------------------------------------------------------------


class DescribeCheckRegistryHasEntry:
    def test_true_when_dir_is_referenced_in_sources_of_truth_section(self):
        assert check_registry_has_entry("## Sources of truth\n\n- [docs/](docs/) — root.\n", "docs") is True

    def test_false_when_section_omits_the_dir(self):
        assert check_registry_has_entry("## Sources of truth\n\n- [other/](other/) — x.\n", "docs") is False

    def test_ignores_matches_outside_the_sources_of_truth_section(self):
        content = "## Intro\n\ndocs/ mentioned here only\n\n## Sources of truth\n\n- nothing relevant\n"
        assert check_registry_has_entry(content, "docs") is False

    def test_accepts_a_dir_passed_with_a_trailing_slash(self):
        assert check_registry_has_entry("## Sources of truth\n\n- [docs/](docs/) — root.\n", "docs/") is True

    def test_false_on_empty_content(self):
        assert check_registry_has_entry("", "docs") is False


class DescribeCheckRegistryRoleInSync:
    def test_true_when_the_entry_line_contains_the_intro(self):
        c = "## Sources of truth\n\n- [docs/](docs/) — Fresh role text.\n"
        assert check_registry_role_in_sync(c, "docs", "Fresh role text") is True

    def test_false_when_the_entry_line_is_missing_the_intro(self):
        c = "## Sources of truth\n\n- [docs/](docs/) — Stale outdated.\n"
        assert check_registry_role_in_sync(c, "docs", "Fresh role text") is False

    def test_true_nothing_to_compare_when_intro_is_empty(self):
        c = "## Sources of truth\n\n- [docs/](docs/) — anything.\n"
        assert check_registry_role_in_sync(c, "docs", "") is True

    def test_false_when_the_entry_is_outside_the_sources_of_truth_section(self):
        c = "## Intro\n\n- [docs/](docs/) — Fresh role text.\n\n## Sources of truth\n\n- other\n"
        assert check_registry_role_in_sync(c, "docs", "Fresh role text") is False


# ---------------------------------------------------------------------------
# queue assembly
# ---------------------------------------------------------------------------


class DescribeResolveCommandQueue:
    def test_returns_empty_queue_with_no_drift(self):
        assert resolve_command_queue([], False) == []

    def test_queues_docs_index_per_drifted_dir_trailing_slashed(self):
        queue = resolve_command_queue(["docs/api"], False)
        assert queue[0]["command"] == "/docs-index"
        assert queue[0]["args"] == "docs/api/"

    def test_orders_drifted_dirs_lexically(self):
        queue = resolve_command_queue(["docs/design", "docs/api"], False)
        assert queue[0]["args"] == "docs/api/"
        assert queue[1]["args"] == "docs/design/"

    def test_appends_a_single_docs_registry_sync_last_on_registry_drift(self):
        queue = resolve_command_queue(["docs/api"], True)
        assert queue[-1]["command"] == "/docs-registry-sync"

    def test_can_queue_registry_sync_alone(self):
        queue = resolve_command_queue([], True)
        assert len(queue) == 1
        assert queue[0]["command"] == "/docs-registry-sync"


class DescribeResolveReviseQueue:
    def test_emits_one_docs_revise_entry_carrying_all_paths_sorted(self):
        q = resolve_revise_queue(["docs/b.md", "docs/a.md"])
        assert len(q) == 1
        assert q[0]["command"] == "/docs-revise"
        assert q[0]["args"] == "docs/a.md docs/b.md"

    def test_returns_empty_for_no_paths(self):
        assert resolve_revise_queue([]) == []


class DescribeResolveEnforcementMode:
    def test_defaults_to_block_when_unset(self):
        assert resolve_enforcement_mode("") == "block"

    def test_defaults_to_block_on_unknown_values(self):
        assert resolve_enforcement_mode("loud") == "block"

    def test_returns_warn_for_warn(self):
        assert resolve_enforcement_mode("warn") == "warn"

    def test_is_case_insensitive_for_warn(self):
        assert resolve_enforcement_mode("WARN") == "warn"

    def test_maps_the_retired_auto_value_to_block(self):
        assert resolve_enforcement_mode("auto") == "block"


# ---------------------------------------------------------------------------
# expand_host_content
# ---------------------------------------------------------------------------


class DescribeExpandHostContent:
    def test_returns_content_unchanged_when_no_import_lines_present(self):
        result = expand_host_content("# Title\n\n## Section\nsome content\n", new_file_reader({}))
        assert result == "# Title\n\n## Section\nsome content\n"

    def test_appends_the_imported_file_content_when_a_at_path_line_is_found(self):
        reader = new_file_reader({"extra.md": "## Sources of truth\n\n- entry"})
        result = expand_host_content("# Base\n\n@extra.md\n", reader)
        assert "## Sources of truth" in result
        assert "entry" in result

    def test_appends_multiple_imported_files_in_order(self):
        reader = new_file_reader({"a.md": "content-a", "b.md": "content-b"})
        result = expand_host_content("@a.md\n@b.md\n", reader)
        assert "content-a" in result
        assert "content-b" in result

    def test_silently_skips_an_import_path_that_returns_empty_content(self):
        reader = new_file_reader({"present.md": "real"})
        result = expand_host_content("@notfound.md\n@present.md\n", reader)
        assert "real" in result

    def test_does_not_recurse_into_import_lines_within_imported_content(self):
        reader = new_file_reader({"level1.md": "@level2.md\nfrom-level1", "level2.md": "from-level2"})
        result = expand_host_content("@level1.md\n", reader)
        assert "from-level1" in result
        assert "from-level2" not in result

    def test_ignores_at_reference_that_is_not_at_the_start_of_a_line(self):
        reader = new_file_reader({"nope.md": "should-not-appear"})
        result = expand_host_content("text @nope.md more\n", reader)
        assert "should-not-appear" not in result


# ---------------------------------------------------------------------------
# get_docs_drift_queue
# ---------------------------------------------------------------------------


class DescribeGetDocsDriftQueue:
    def test_returns_an_empty_queue_for_a_fully_consistent_tree(self):
        lister = new_dir_lister(get_consistent_tree())
        reader = new_file_reader(get_consistent_files())
        assert get_docs_drift_queue(lister, reader) == []

    def test_queues_docs_index_when_an_index_omits_a_present_file(self):
        files = dict(get_consistent_files())
        files["docs/api/index.md"] = new_index_md(["/openapi.yaml"])
        queue = get_docs_drift_queue(new_dir_lister(get_consistent_tree()), new_file_reader(files))
        assert any(q["command"] == "/docs-index" and q["args"] == "docs/api/" for q in queue)

    def test_queues_docs_index_when_an_index_lists_a_now_absent_file(self):
        files = dict(get_consistent_files())
        files["docs/api/index.md"] = new_index_md(["/openapi.yaml", "/api-guidelines", "/ghost"])
        queue = get_docs_drift_queue(new_dir_lister(get_consistent_tree()), new_file_reader(files))
        assert any(q["args"] == "docs/api/" for q in queue)

    def test_queues_docs_registry_sync_when_CLAUDE_md_omits_a_ROOT(self):
        files = dict(get_consistent_files())
        files["CLAUDE.md"] = "## Sources of truth\n\n- nothing here\n"
        queue = get_docs_drift_queue(new_dir_lister(get_consistent_tree()), new_file_reader(files))
        assert any(q["command"] == "/docs-registry-sync" for q in queue)

    def test_queues_docs_registry_sync_when_AGENTS_md_is_the_host_file_and_omits_a_ROOT(self):
        files = dict(get_consistent_files())
        del files["CLAUDE.md"]
        files["AGENTS.md"] = "## Sources of truth\n\n- nothing here\n"
        queue = get_docs_drift_queue(new_dir_lister(get_consistent_tree()), new_file_reader(files))
        assert any(q["command"] == "/docs-registry-sync" for q in queue)

    def test_returns_empty_when_nothing_under_the_scan_root_is_indexed(self):
        lister = new_dir_lister({".": [{"name": "docs", "is_dir": True}], "docs": [{"name": "loose.md", "is_dir": False}]})
        assert get_docs_drift_queue(lister, new_file_reader({})) == []

    def test_queues_registry_sync_when_a_present_ROOT_entry_has_stale_role_text(self):
        tree = {
            ".": [{"name": "docs", "is_dir": True}],
            "docs": [{"name": "page.md", "is_dir": False}, {"name": "index.md", "is_dir": False}],
        }
        files = {
            "docs/index.md": "---\ntitle: T\nintro: 'Fresh role text'\nchildren:\n  - /page\n---\n",
            "CLAUDE.md": "## Sources of truth\n\n- [docs/](docs/) — Stale outdated role.\n",
        }
        queue = get_docs_drift_queue(new_dir_lister(tree), new_file_reader(files))
        assert any(q["command"] == "/docs-registry-sync" for q in queue)
        assert not any(q["command"] == "/docs-index" for q in queue)

    def test_no_drift_when_the_ROOT_entry_role_text_contains_the_intro(self):
        tree = {
            ".": [{"name": "docs", "is_dir": True}],
            "docs": [{"name": "page.md", "is_dir": False}, {"name": "index.md", "is_dir": False}],
        }
        files = {
            "docs/index.md": "---\ntitle: T\nintro: 'Fresh role text'\nchildren:\n  - /page\n---\n",
            "CLAUDE.md": "## Sources of truth\n\n- [docs/](docs/) — Fresh role text.\n",
        }
        assert get_docs_drift_queue(new_dir_lister(tree), new_file_reader(files)) == []


# ---------------------------------------------------------------------------
# format_block_message
# ---------------------------------------------------------------------------


class DescribeFormatBlockMessage:
    def test_returns_empty_string_for_empty_queue(self):
        assert format_block_message([]) == ""

    def test_returns_empty_string_for_none_queue(self):
        assert format_block_message(None) == ""

    def test_formats_single_command_with_args(self):
        msg = format_block_message([{"command": "/docs-index", "args": "docs/api/"}])
        assert re.search(r"1\. /docs-index docs/api/", msg)

    def test_formats_single_command_without_args(self):
        msg = format_block_message([{"command": "/docs-registry-sync", "args": ""}])
        assert re.search(r"1\. /docs-registry-sync", msg)
        assert "/docs-registry-sync " not in msg

    def test_references_the_binding_gates_source(self):
        msg = format_block_message([{"command": "/docs-registry-sync", "args": ""}])
        assert "docs-keeper" in msg

    def test_uses_re_commit_language_in_pre_commit_mode(self):
        msg = format_block_message([{"command": "/docs-index", "args": "docs/"}], standalone=False)
        assert "re-commit" in msg

    def test_uses_fix_language_in_standalone_mode_no_re_commit_mention(self):
        msg = format_block_message([{"command": "/docs-index", "args": "docs/"}], standalone=True)
        assert "Run the following commands to fix" in msg
        assert "re-commit" not in msg

    def test_uses_non_blocking_language_in_warn_mode(self):
        msg = format_block_message([{"command": "/docs-revise", "args": "docs/a.md"}], mode="warn")
        assert "non-blocking" in msg
        assert "drift detected" not in msg

    def test_adapter_can_override_the_binding_gates_footer(self):
        msg = format_block_message(
            [{"command": "/docs-registry-sync", "args": ""}],
            binding_gates_ref="Binding gates: .claude/agents/docs-keeper.md",
        )
        assert ".claude/agents/docs-keeper.md" in msg


# ---------------------------------------------------------------------------
# misc helpers
# ---------------------------------------------------------------------------


class DescribeGetContentSha:
    def test_is_deterministic_for_identical_content(self):
        assert get_content_sha("abc") == get_content_sha("abc")

    def test_differs_when_content_differs(self):
        assert get_content_sha("abc") != get_content_sha("abd")

    def test_returns_a_64_char_lowercase_hex_string(self):
        assert re.match(r"^[0-9a-f]{64}$", get_content_sha("abc"))

    def test_hashes_empty_and_none_identically(self):
        assert get_content_sha("") == get_content_sha(None)


class DescribeGetIntroFromFrontMatter:
    def test_extracts_a_single_quoted_intro(self):
        assert get_intro_from_front_matter("---\ntitle: T\nintro: 'Hello world'\n---\n") == "Hello world"

    def test_extracts_a_double_quoted_intro(self):
        assert get_intro_from_front_matter('---\nintro: "Hi there"\n---\n') == "Hi there"

    def test_extracts_an_unquoted_intro(self):
        assert get_intro_from_front_matter("---\nintro: bare text\n---\n") == "bare text"

    def test_returns_empty_when_no_intro_key(self):
        assert get_intro_from_front_matter("---\ntitle: T\n---\n") == ""

    def test_ignores_an_intro_outside_the_front_matter_block(self):
        assert get_intro_from_front_matter("---\ntitle: T\n---\nintro: not-this\n") == ""


class DescribeReadHookPayload:
    def test_parses_a_valid_payload(self):
        assert read_hook_payload('{"a":{"command":"git status"}}')["a"]["command"] == "git status"

    def test_returns_none_on_empty_input(self):
        assert read_hook_payload("") is None

    def test_returns_none_on_invalid_json(self):
        assert read_hook_payload("not-json") is None


class DescribeGetSessionIdFromPayload:
    def test_extracts_session_id_from_a_payload(self):
        assert get_session_id_from_payload(read_hook_payload('{"session_id":"abc-123"}')) == "abc-123"

    def test_returns_empty_when_absent(self):
        assert get_session_id_from_payload(read_hook_payload('{"tool_name":"Bash"}')) == ""

    def test_returns_empty_for_none_payload(self):
        assert get_session_id_from_payload(None) == ""


class DescribeGetSafeSessionId:
    def test_passes_through_a_uuid_shaped_id(self):
        assert get_safe_session_id("a1b2-c3d4.e5") == "a1b2-c3d4.e5"

    def test_collapses_unsafe_characters_to_underscore(self):
        assert get_safe_session_id("a/b\\c:d e") == "a_b_c_d_e"

    def test_returns_empty_for_empty(self):
        assert get_safe_session_id("") == ""

    def test_returns_empty_for_whitespace(self):
        assert get_safe_session_id("   ") == ""


# ---------------------------------------------------------------------------
# evaluate_commit_maintenance (neutral decision core)
# ---------------------------------------------------------------------------


class DescribeEvaluateCommitMaintenance:
    def setup_method(self):
        self.lister = new_dir_lister(get_consistent_tree())
        self.reader = new_file_reader(get_consistent_files())

    def test_exits_0_not_git_commit_when_command_is_unrelated(self):
        result = evaluate_commit_maintenance("npm test", "", {}, self.lister, self.reader)
        assert result["exit_code"] == 0
        assert result["reason"] == "not-git-commit"

    def test_exits_0_no_docs_change_when_commit_avoids_md_files(self):
        result = evaluate_commit_maintenance("git commit -m foo", "M\tsrc/Program.cs", {}, self.lister, self.reader)
        assert result["exit_code"] == 0
        assert result["reason"] == "no-docs-change"

    def test_exits_0_no_docs_change_when_only_non_markdown_docs_file_staged(self):
        result = evaluate_commit_maintenance(
            "git commit -m foo", "M\tdocs/api/openapi.yaml", {}, self.lister, self.reader
        )
        assert result["reason"] == "no-docs-change"

    def test_queues_docs_revise_on_a_docs_commit_even_when_index_and_registry_consistent(self):
        result = evaluate_commit_maintenance("git commit -m foo", "M\tdocs/SAD.md", {}, self.lister, self.reader)
        assert result["exit_code"] == 2
        assert result["reason"] == "docs-drift-detected"
        assert result["queue"][0]["command"] == "/docs-revise"
        assert "docs/SAD.md" in result["queue"][0]["args"]

    def test_skips_revise_for_staged_md_already_marked_revised_true(self):
        result = evaluate_commit_maintenance(
            "git commit -m foo",
            "M\tdocs/SAD.md",
            {"docs/SAD.md": {"revised": True}},
            self.lister,
            self.reader,
        )
        assert result["exit_code"] == 0
        assert result["reason"] == "no-docs-drift"

    def test_warn_mode_exits_0_but_still_surfaces_the_queue(self):
        result = evaluate_commit_maintenance(
            "git commit -m foo", "M\tdocs/SAD.md", {}, self.lister, self.reader, enforcement_mode="warn"
        )
        assert result["exit_code"] == 0
        assert result["reason"] == "docs-action-suggested"
        assert len(result["queue"]) > 0

    def test_exits_2_with_both_revise_and_index_entries_when_an_index_is_drifted(self):
        files = dict(get_consistent_files())
        files["docs/api/index.md"] = new_index_md(["/openapi.yaml"])
        result = evaluate_commit_maintenance(
            "git commit -m foo", "M\tdocs/api/api-guidelines.md", {}, self.lister, new_file_reader(files)
        )
        assert result["exit_code"] == 2
        assert result["queue"][0]["command"] == "/docs-revise"
        assert any(q["command"] == "/docs-index" and q["args"] == "docs/api/" for q in result["queue"])

    def test_message_surfaces_the_queue_contents(self):
        files = dict(get_consistent_files())
        files["docs/design/index.md"] = new_index_md(["/README"])
        result = evaluate_commit_maintenance(
            "git commit -m foo", "A\tdocs/design/components.md", {}, self.lister, new_file_reader(files)
        )
        assert "/docs-index docs/design/" in result["message"]
