"""
pytest suite for invoke_protocol_form_guard.py.

Faithful translation of every Pester It block in Invoke-ProtocolFormGuard.Tests.ps1.
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

# Ensure sibling directory is importable (needed when pytest runs from repo root).
_here = pathlib.Path(__file__).resolve().parent
if str(_here) not in sys.path:
    sys.path.insert(0, str(_here))

from format_protocol_form import get_protocol_schema_dir, save_protocol_form  # noqa: E402
from invoke_protocol_form_guard import (  # noqa: E402
    get_pointer_info,
    get_protocol_form_decision,
    get_render_recipe,
    get_send_message_text,
    get_session_box_write_decision,
    is_ref_in_session_box,
)

# ---------------------------------------------------------------------------
# Shared fixtures (mirrors BeforeAll)
# ---------------------------------------------------------------------------

SCHEMA_DIR = get_protocol_schema_dir()

VALID_RESULT = json.dumps({
    "type": "RESULT",
    "role": "backend",
    "changed": ["PollLoop.cs", "ControlStream.cs"],
    "gate": ["build ok", "264/264 tests"],
})

VALID_REVIEW_PASS = json.dumps({
    "type": "REVIEW",
    "role": "backend",
    "scope": ["backend/fetcher/**"],
    "checked": ["PollLoop x SOLID"],
    "verdict": "pass",
})

VALID_REVIEW_CHANGES = json.dumps({
    "type": "REVIEW",
    "role": "backend",
    "scope": ["backend/fetcher/**"],
    "checked": ["PollLoop x SOLID"],
    "verdict": "changes-requested",
    "remarks": [{"smell": "SRP", "location": "PollLoop.cs:42", "change": "extract polling loop"}],
    "block": "none",
})

VALID_BRIEF = json.dumps({
    "type": "BRIEF",
    "spec": {"path": "docs/api/openapi.yaml#deployments", "gate": "tile shows badge"},
    "lane": ["backend/fetcher-github/**"],
    "task": "decompose long methods",
    "gate": ["build ok", "264/264 tests"],
})

SCRIPT_PATH = str(pathlib.Path(__file__).parent / "invoke_protocol_form_guard.py")


# ---------------------------------------------------------------------------
# Describe: get_send_message_text
# ---------------------------------------------------------------------------

class DescribeGetSendMessageText:
    def test_returns_the_string_message_verbatim(self):
        ti = {"message": "hello", "to": "lead"}
        assert get_send_message_text(ti) == "hello"

    def test_returns_empty_for_an_object_legacy_protocol_response_message(self):
        ti = {"message": {"type": "shutdown_response", "approve": True}}
        assert get_send_message_text(ti) == ""

    def test_returns_empty_when_there_is_no_message(self):
        ti = {"to": "lead"}
        assert get_send_message_text(ti) == ""


# ---------------------------------------------------------------------------
# Describe: get_protocol_form_decision — valid forms pass
# ---------------------------------------------------------------------------

class DescribeGetProtocolFormDecisionValidFormPass:
    def test_passes_a_well_formed_result(self):
        d = get_protocol_form_decision(VALID_RESULT, schema_dir=SCHEMA_DIR)
        assert d["block"] is False

    def test_passes_a_review_with_pass_verdict(self):
        d = get_protocol_form_decision(VALID_REVIEW_PASS, schema_dir=SCHEMA_DIR)
        assert d["block"] is False

    def test_passes_a_review_with_changes_requested_verdict_and_remarks(self):
        d = get_protocol_form_decision(VALID_REVIEW_CHANGES, schema_dir=SCHEMA_DIR)
        assert d["block"] is False

    def test_passes_a_well_formed_brief_with_nested_spec(self):
        d = get_protocol_form_decision(VALID_BRIEF, schema_dir=SCHEMA_DIR)
        assert d["block"] is False

    def test_allows_an_empty_message(self):
        d = get_protocol_form_decision("", schema_dir=SCHEMA_DIR)
        assert d["block"] is False

    def test_passes_a_valid_but_unnormalized_form_key_order_is_not_enforced(self):
        messy = '{ "gate":["ok"], "type":"RESULT", "changed":["A.cs"], "role":"backend" }'
        d = get_protocol_form_decision(messy, schema_dir=SCHEMA_DIR)
        assert d["block"] is False


# ---------------------------------------------------------------------------
# Describe: get_protocol_form_decision — invalid forms block
# ---------------------------------------------------------------------------

class DescribeGetProtocolFormDecisionInvalidFormsBlock:
    def test_blocks_free_prose_not_json(self):
        d = get_protocol_form_decision("Please re-run iteration 2 when you can.", schema_dir=SCHEMA_DIR)
        assert d["block"] is True
        assert "JSON" in d["reason"]

    def test_blocks_an_unknown_type(self):
        d = get_protocol_form_decision('{ "type":"MEMO","x":1 }', schema_dir=SCHEMA_DIR)
        assert d["block"] is True
        assert "type" in d["reason"]

    def test_blocks_a_result_missing_a_mandatory_field_changed(self):
        d = get_protocol_form_decision(
            '{ "type":"RESULT","role":"backend","gate":["ok"] }', schema_dir=SCHEMA_DIR
        )
        assert d["block"] is True
        assert "RESULT" in d["reason"]

    def test_blocks_an_extra_renamed_field(self):
        d = get_protocol_form_decision(
            '{ "type":"FIX","failure":{"test":"t","expect":"e","actual":"a"},"suspect":"s","bogus":1 }',
            schema_dir=SCHEMA_DIR,
        )
        assert d["block"] is True
        assert "bogus" in d["reason"]

    def test_blocks_a_review_with_an_invalid_verdict(self):
        d = get_protocol_form_decision(
            '{ "type":"REVIEW","role":"backend","scope":["x"],"checked":["y"],"verdict":"maybe" }',
            schema_dir=SCHEMA_DIR,
        )
        assert d["block"] is True
        assert "REVIEW" in d["reason"]

    def test_blocks_a_review_pass_that_carries_remarks_cross_field_rule(self):
        bad = (
            '{ "type":"REVIEW","role":"backend","scope":["x"],"checked":["y"],'
            '"verdict":"pass","remarks":[{"smell":"a","location":"b","change":"c"}] }'
        )
        d = get_protocol_form_decision(bad, schema_dir=SCHEMA_DIR)
        assert d["block"] is True
        assert "zero remarks" in d["reason"]


# ---------------------------------------------------------------------------
# Describe: get_pointer_info
# ---------------------------------------------------------------------------

class DescribeGetPointerInfo:
    def test_detects_a_type_ref_pointer(self):
        p = get_pointer_info('{ "type":"RESULT","ref":"/tmp/x.json" }')
        assert p["is_pointer"] is True
        assert p["type"] == "RESULT"
        assert p["ref"] == "/tmp/x.json"
        assert len(p["extra_keys"]) == 0

    def test_flags_extra_keys_beyond_type_ref(self):
        p = get_pointer_info('{ "type":"RESULT","ref":"/tmp/x.json","role":"backend" }')
        assert "role" in p["extra_keys"]

    def test_is_not_a_pointer_when_ref_is_absent_a_full_form(self):
        p = get_pointer_info('{ "type":"RESULT","role":"backend" }')
        assert p["is_pointer"] is False

    def test_is_not_a_pointer_for_free_prose(self):
        p = get_pointer_info("just text")
        assert p["is_pointer"] is False


# ---------------------------------------------------------------------------
# Describe: is_ref_in_session_box
# ---------------------------------------------------------------------------

class DescribeTestRefInSessionBox:
    def test_accepts_a_path_inside_a_session_outbox(self):
        assert is_ref_in_session_box(
            "/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json"
        ) is True

    def test_accepts_a_path_inside_a_session_inbox_dispatch(self):
        assert is_ref_in_session_box(
            "/wt/.team-process/sessions/feat-1/inbox/backend.BRIEF.json"
        ) is True

    def test_accepts_a_windows_separator_outbox_path(self):
        assert is_ref_in_session_box(
            r"C:\wt\.team-process\sessions\feat-1\outbox\backend.RESULT.json"
        ) is True

    def test_accepts_a_windows_separator_inbox_path(self):
        assert is_ref_in_session_box(
            r"C:\wt\.team-process\sessions\feat-1\inbox\backend.BRIEF.json"
        ) is True

    def test_rejects_a_path_outside_any_box(self):
        assert is_ref_in_session_box("/wt/secret.txt") is False

    def test_rejects_the_session_record_itself_not_a_box(self):
        assert is_ref_in_session_box(
            "/wt/.team-process/sessions/feat-1/session.json"
        ) is False


# ---------------------------------------------------------------------------
# Describe: get_session_box_write_decision — write-time JSON enforcement
# ---------------------------------------------------------------------------

class DescribeGetSessionBoxWriteDecision:
    def test_allows_a_valid_typed_form_json_written_to_an_outbox_file(self):
        p = "/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json"
        d = get_session_box_write_decision(p, VALID_RESULT, schema_dir=SCHEMA_DIR)
        assert d["block"] is False

    def test_allows_a_valid_brief_written_to_an_inbox_file_dispatch(self):
        p = "/wt/.team-process/sessions/feat-1/inbox/backend.BRIEF.json"
        d = get_session_box_write_decision(p, VALID_BRIEF, schema_dir=SCHEMA_DIR)
        assert d["block"] is False

    def test_blocks_prose_written_to_an_outbox_file_the_cheat(self):
        p = "/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json"
        d = get_session_box_write_decision(
            p, "Done! Build passes, 264/264 tests green.", schema_dir=SCHEMA_DIR
        )
        assert d["block"] is True
        assert "typed-form JSON" in d["reason"]

    def test_blocks_prose_written_to_an_inbox_file_the_cheat_dispatch_side(self):
        p = "/wt/.team-process/sessions/feat-1/inbox/backend.BRIEF.json"
        d = get_session_box_write_decision(
            p, "Hey, go extract the HTTP adapter please.", schema_dir=SCHEMA_DIR
        )
        assert d["block"] is True
        assert "typed-form JSON" in d["reason"]

    def test_blocks_a_markdown_md_dump_written_to_an_outbox_file(self):
        p = "/wt/.team-process/sessions/feat-1/outbox/backend.result.md"
        d = get_session_box_write_decision(p, "# Result\n- changed X", schema_dir=SCHEMA_DIR)
        assert d["block"] is True

    def test_ignores_a_write_outside_any_box_not_this_guard_concern(self):
        d = get_session_box_write_decision(
            "backend/fetcher/X.cs", "whatever", schema_dir=SCHEMA_DIR, root="/repo"
        )
        assert d["block"] is False

    def test_ignores_a_write_with_no_content_body_edit_multiedit(self):
        p = "/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json"
        d = get_session_box_write_decision(p, None, schema_dir=SCHEMA_DIR)
        assert d["block"] is False

    def test_resolves_a_relative_inbox_file_path_against_root(self):
        rel = ".team-process/sessions/feat-1/inbox/backend.BRIEF.json"
        d = get_session_box_write_decision(rel, "just prose", schema_dir=SCHEMA_DIR, root="/repo")
        assert d["block"] is True


# ---------------------------------------------------------------------------
# Describe: get_protocol_form_decision — file-based hand-back pointers
# ---------------------------------------------------------------------------

class DescribeGetProtocolFormDecisionFileBasedPointers:
    def test_passes_a_pointer_to_a_valid_result_file_absolute_ref(self, tmp_path):
        outbox = tmp_path / ".team-process" / "sessions" / "feat-1" / "outbox"
        outbox.mkdir(parents=True)
        f = outbox / "backend.RESULT.json"
        f.write_text(VALID_RESULT, encoding="utf-8")
        ref = str(f).replace("\\", "/")
        d = get_protocol_form_decision(
            f'{{"type":"RESULT","ref":"{ref}"}}', schema_dir=SCHEMA_DIR
        )
        assert d["block"] is False

    def test_passes_a_pointer_produced_by_the_one_command_emit_mode(self, tmp_path):
        outbox = tmp_path / ".team-process" / "sessions" / "feat-1" / "outbox"
        outbox.mkdir(parents=True)
        ptr_str = save_protocol_form(VALID_RESULT, outbox_dir=str(outbox), schema_dir=SCHEMA_DIR)
        d = get_protocol_form_decision(ptr_str, schema_dir=SCHEMA_DIR)
        assert d["block"] is False

    def test_passes_a_pointer_to_a_valid_brief_file_in_the_inbox_dispatch(self, tmp_path):
        inbox = tmp_path / ".team-process" / "sessions" / "feat-1" / "inbox"
        inbox.mkdir(parents=True)
        f = inbox / "backend.BRIEF.json"
        f.write_text(VALID_BRIEF, encoding="utf-8")
        ref = str(f).replace("\\", "/")
        d = get_protocol_form_decision(
            f'{{"type":"BRIEF","ref":"{ref}"}}', schema_dir=SCHEMA_DIR
        )
        assert d["block"] is False

    def test_resolves_a_relative_ref_against_root(self, tmp_path):
        outbox = tmp_path / ".team-process" / "sessions" / "feat-1" / "outbox"
        outbox.mkdir(parents=True)
        f = outbox / "backend.RESULT.json"
        f.write_text(VALID_RESULT, encoding="utf-8")
        rel = ".team-process/sessions/feat-1/outbox/backend.RESULT.json"
        d = get_protocol_form_decision(
            f'{{"type":"RESULT","ref":"{rel}"}}',
            schema_dir=SCHEMA_DIR,
            root=str(tmp_path),
        )
        assert d["block"] is False

    def test_blocks_a_pointer_whose_in_outbox_ref_file_does_not_exist(self, tmp_path):
        outbox = tmp_path / ".team-process" / "sessions" / "feat-1" / "outbox"
        outbox.mkdir(parents=True)
        missing = str(outbox / "missing.RESULT.json").replace("\\", "/")
        d = get_protocol_form_decision(
            f'{{"type":"RESULT","ref":"{missing}"}}', schema_dir=SCHEMA_DIR
        )
        assert d["block"] is True
        assert "not found" in d["reason"]

    def test_blocks_a_pointer_whose_ref_is_outside_any_session_outbox(self, tmp_path):
        secret = tmp_path / "secret.txt"
        secret.write_text("TOPSECRET", encoding="utf-8")
        ref = str(secret).replace("\\", "/")
        d = get_protocol_form_decision(
            f'{{"type":"RESULT","ref":"{ref}"}}', schema_dir=SCHEMA_DIR
        )
        assert d["block"] is True
        assert "outbox" in d["reason"]
        assert "TOPSECRET" not in d["reason"]

    def test_blocks_a_pointer_whose_ref_uses_dotdot_to_escape_the_outbox(self, tmp_path):
        outbox = tmp_path / ".team-process" / "sessions" / "feat-1" / "outbox"
        outbox.mkdir(parents=True)
        outside = tmp_path / "evil.RESULT.json"
        outside.write_text(VALID_RESULT, encoding="utf-8")
        traverse = str(outbox).replace("\\", "/") + "/../../../../evil.RESULT.json"
        d = get_protocol_form_decision(
            f'{{"type":"RESULT","ref":"{traverse}"}}', schema_dir=SCHEMA_DIR
        )
        assert d["block"] is True
        assert "outbox" in d["reason"]

    def test_blocks_a_pointer_to_a_malformed_form_file(self, tmp_path):
        outbox = tmp_path / ".team-process" / "sessions" / "feat-1" / "outbox"
        outbox.mkdir(parents=True)
        f = outbox / "backend.RESULT.json"
        f.write_text('{ "type":"RESULT","role":"backend" }', encoding="utf-8")  # missing changed/gate
        ref = str(f).replace("\\", "/")
        d = get_protocol_form_decision(
            f'{{"type":"RESULT","ref":"{ref}"}}', schema_dir=SCHEMA_DIR
        )
        assert d["block"] is True
        assert "RESULT" in d["reason"]

    def test_blocks_a_pointer_with_extra_keys(self, tmp_path):
        outbox = tmp_path / ".team-process" / "sessions" / "feat-1" / "outbox"
        outbox.mkdir(parents=True)
        f = outbox / "backend.RESULT.json"
        f.write_text(VALID_RESULT, encoding="utf-8")
        ref = str(f).replace("\\", "/")
        d = get_protocol_form_decision(
            f'{{"type":"RESULT","ref":"{ref}","role":"backend"}}', schema_dir=SCHEMA_DIR
        )
        assert d["block"] is True
        assert "type, ref" in d["reason"]

    def test_blocks_when_the_pointer_type_disagrees_with_the_file_form(self, tmp_path):
        outbox = tmp_path / ".team-process" / "sessions" / "feat-1" / "outbox"
        outbox.mkdir(parents=True)
        f = outbox / "backend.RESULT.json"
        f.write_text(VALID_RESULT, encoding="utf-8")
        ref = str(f).replace("\\", "/")
        d = get_protocol_form_decision(
            f'{{"type":"REVIEW","ref":"{ref}"}}', schema_dir=SCHEMA_DIR
        )
        assert d["block"] is True
        assert "does not match" in d["reason"]


# ---------------------------------------------------------------------------
# Describe: get_render_recipe — block reasons carry the JSON recipe
# ---------------------------------------------------------------------------

class DescribeGetRenderRecipe:
    def test_recipe_names_the_six_forms_the_schema_location_and_the_normalizer_invocation(self):
        recipe = get_render_recipe()
        assert "REVIEW / RESULT / BRIEF / FINDING / FIX / ARTIFACT" in recipe
        assert "format_protocol_form.py" in recipe
        assert "--input-file" in recipe
        assert "--outbox-dir" in recipe
        assert "VERBATIM" in recipe

    def test_a_malformed_form_reason_embeds_the_recipe(self):
        d = get_protocol_form_decision(
            "Please re-run iteration 2 when you can.", schema_dir=SCHEMA_DIR
        )
        assert "--input-file" in d["reason"]
        assert "typed forms" in d["reason"]


# ---------------------------------------------------------------------------
# Describe: invoke_protocol_form_guard.py — real-process stdin entry point
# ---------------------------------------------------------------------------

class DescribeInvokeProtocolFormGuardRealProcess:
    def test_emits_a_block_decision_for_a_free_prose_message(self):
        payload = '{ "tool_input": { "to": "lead", "message": "hey can you re-run wave 2" } }'
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )
        assert re.search(r'"decision"\s*:\s*"block"', result.stdout)
        assert "not valid JSON" in result.stdout

    def test_emits_a_block_decision_for_a_schema_invalid_form(self):
        inner = r'{\"type\":\"RESULT\",\"role\":\"backend\"}'
        payload = f'{{ "tool_input": {{ "to": "lead", "message": "{inner}" }} }}'
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )
        assert re.search(r'"decision"\s*:\s*"block"', result.stdout)
        assert "RESULT" in result.stdout

    def test_stays_silent_allows_for_a_valid_form(self):
        inner = (
            r'{\"type\":\"RESULT\",\"role\":\"backend\",'
            r'\"changed\":[\"A.cs\"],\"gate\":[\"build ok\"]}'
        )
        payload = f'{{ "tool_input": {{ "to": "lead", "message": "{inner}" }} }}'
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )
        assert result.stdout.strip() == ""

    def test_stays_silent_allows_for_an_object_non_string_message(self):
        payload = (
            '{ "tool_input": { "to": "lead", '
            '"message": { "type": "shutdown_response", "approve": true } } }'
        )
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )
        assert result.stdout.strip() == ""

    def test_blocks_a_prose_write_into_a_session_outbox(self):
        payload = (
            '{ "tool_name": "Write", "tool_input": { '
            '"file_path": "/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json", '
            '"content": "Done, all 264 tests pass." } }'
        )
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )
        assert re.search(r'"decision"\s*:\s*"block"', result.stdout)
        assert "typed-form JSON" in result.stdout

    def test_allows_a_valid_form_write_into_a_session_outbox(self):
        valid = (
            r'{\"type\":\"RESULT\",\"role\":\"backend\",'
            r'\"changed\":[\"A.cs\"],\"gate\":[\"build ok\"]}'
        )
        payload = (
            '{ "tool_name": "Write", "tool_input": { '
            '"file_path": "/wt/.team-process/sessions/feat-1/outbox/backend.RESULT.json", '
            f'"content": "{valid}" }} }}'
        )
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )
        assert result.stdout.strip() == ""

    def test_ignores_a_write_outside_any_box(self):
        payload = (
            '{ "tool_name": "Write", "tool_input": { '
            '"file_path": "backend/fetcher/X.cs", "content": "// code" } }'
        )
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )
        assert result.stdout.strip() == ""

    def test_blocks_a_prose_write_into_a_session_inbox_dispatch(self):
        payload = (
            '{ "tool_name": "Write", "tool_input": { '
            '"file_path": "/wt/.team-process/sessions/feat-1/inbox/backend.BRIEF.json", '
            '"content": "Go extract the HTTP adapter." } }'
        )
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )
        assert re.search(r'"decision"\s*:\s*"block"', result.stdout)
        assert "typed-form JSON" in result.stdout

    def test_allows_a_valid_brief_write_into_a_session_inbox(self):
        valid = (
            r'{\"type\":\"BRIEF\",\"spec\":{\"path\":\"docs/x#y\",\"gate\":\"g\"},'
            r'\"lane\":[\"backend/**\"],\"task\":\"do it\",\"gate\":[\"build ok\"]}'
        )
        payload = (
            '{ "tool_name": "Write", "tool_input": { '
            '"file_path": "/wt/.team-process/sessions/feat-1/inbox/backend.BRIEF.json", '
            f'"content": "{valid}" }} }}'
        )
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH],
            input=payload,
            capture_output=True,
            text=True,
        )
        assert result.stdout.strip() == ""
