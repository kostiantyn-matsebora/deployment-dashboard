"""
pytest suite for format_protocol_form.py.

Faithful translation of every Pester It block in Format-ProtocolForm.Tests.ps1.

Real schema dir (computed from the module's __file__) is passed explicitly so each
test that needs schema validation gets it without knowing the repo layout.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest
from format_protocol_form import (
    check_protocol_json,
    format_protocol_form,
    get_form_file_name,
    get_protocol_schema_dir,
    is_empty_form_value,
    order_by_keys,
    resolve_form_text,
    save_protocol_form,
)

# ---------------------------------------------------------------------------
# Shared fixtures (mirrors BeforeAll)
# ---------------------------------------------------------------------------

SCHEMA_DIR = get_protocol_schema_dir()

RESULT_OBJ = {
    "type": "RESULT",
    "role": "backend",
    "changed": ["A.cs", "B.cs"],
    "gate": ["build ok", "264/264 tests"],
}

REVIEW_PASS_OBJ = {
    "type": "REVIEW",
    "role": "backend",
    "scope": ["B.cs"],
    "checked": ["Run() x SRP"],
    "verdict": "pass",
}

REVIEW_CHANGES_OBJ = {
    "type": "REVIEW",
    "role": "backend",
    "scope": ["B.cs"],
    "checked": ["Run() x SRP"],
    "verdict": "changes-requested",
    "remarks": [{"smell": "S1541", "location": "B.cs:42", "change": "extract"}],
}

BRIEF_OBJ = {
    "type": "BRIEF",
    "spec": {"path": "docs/x#y", "gate": "tile shows badge"},
    "lane": ["frontend/**"],
    "task": "do it",
    "gate": ["build", "unit"],
}

FINDING_OBJ = {
    "type": "FINDING",
    "where": "openapi.yaml#errors",
    "issue": "contradiction",
    "options": [{"id": "a", "path": "409"}, {"id": "b", "path": "422"}],
    "need": "which?",
}

FIX_OBJ = {
    "type": "FIX",
    "failure": {"test": "t", "expect": "e", "actual": "a"},
    "suspect": "s.cs",
}

ARTIFACT_OBJ = {
    "type": "ARTIFACT",
    "spec": "docs/api/openapi.yaml",
    "delta": ["GET /things"],
}


def form_json(obj: dict) -> str:
    return json.dumps(obj)


# ---------------------------------------------------------------------------
# Describe: Test-ProtocolJson — valid forms pass
# ---------------------------------------------------------------------------

class DescribeTestProtocolJsonValidFormPass:
    def test_accepts_a_well_formed_result(self):
        r = check_protocol_json(form_json(RESULT_OBJ), SCHEMA_DIR)
        assert r["ok"] is True

    def test_accepts_a_review_with_pass_verdict_and_no_remarks(self):
        r = check_protocol_json(form_json(REVIEW_PASS_OBJ), SCHEMA_DIR)
        assert r["ok"] is True

    def test_accepts_a_review_changes_requested_with_nested_remarks(self):
        r = check_protocol_json(form_json(REVIEW_CHANGES_OBJ), SCHEMA_DIR)
        assert r["ok"] is True

    def test_accepts_a_brief_with_nested_spec(self):
        r = check_protocol_json(form_json(BRIEF_OBJ), SCHEMA_DIR)
        assert r["ok"] is True

    def test_accepts_a_finding_with_nested_options(self):
        r = check_protocol_json(form_json(FINDING_OBJ), SCHEMA_DIR)
        assert r["ok"] is True

    def test_accepts_a_fix_with_nested_failure(self):
        r = check_protocol_json(form_json(FIX_OBJ), SCHEMA_DIR)
        assert r["ok"] is True

    def test_accepts_an_artifact(self):
        r = check_protocol_json(form_json(ARTIFACT_OBJ), SCHEMA_DIR)
        assert r["ok"] is True

    def test_normalizes_a_lowercase_type_discriminator(self):
        obj = {"type": "result", "role": "backend", "changed": ["A.cs"], "gate": ["ok"]}
        r = check_protocol_json(form_json(obj), SCHEMA_DIR)
        assert r["ok"] is True
        assert r["type"] == "RESULT"


# ---------------------------------------------------------------------------
# Describe: Test-ProtocolJson — invalid forms block
# ---------------------------------------------------------------------------

class DescribeTestProtocolJsonInvalidFormsBlock:
    def test_rejects_non_json_text(self):
        r = check_protocol_json("Please re-run iteration 2.", SCHEMA_DIR)
        assert r["ok"] is False
        assert "JSON" in " ".join(r["errors"])

    def test_rejects_a_json_array_at_top_level(self):
        r = check_protocol_json("[1,2,3]", SCHEMA_DIR)
        assert r["ok"] is False
        assert "single JSON object" in " ".join(r["errors"])

    def test_rejects_an_unknown_type(self):
        r = check_protocol_json('{ "type": "MEMO", "x": 1 }', SCHEMA_DIR)
        assert r["ok"] is False
        assert "type" in " ".join(r["errors"])

    def test_rejects_a_result_missing_a_mandatory_field_changed(self):
        obj = {"type": "RESULT", "role": "backend", "gate": ["ok"]}
        r = check_protocol_json(form_json(obj), SCHEMA_DIR)
        assert r["ok"] is False

    def test_rejects_an_extra_renamed_field_additionalproperties_false(self):
        obj = {
            "type": "FIX",
            "failure": {"test": "t", "expect": "e", "actual": "a"},
            "suspect": "s",
            "bogus": 1,
        }
        r = check_protocol_json(form_json(obj), SCHEMA_DIR)
        assert r["ok"] is False
        assert "bogus" in " ".join(r["errors"])

    def test_rejects_a_scalar_where_an_array_is_required(self):
        r = check_protocol_json(
            '{ "type":"RESULT","role":"backend","changed":"A.cs","gate":["ok"] }',
            SCHEMA_DIR,
        )
        assert r["ok"] is False

    def test_rejects_an_invalid_role_enum_value(self):
        obj = {"type": "RESULT", "role": "wizard", "changed": ["A.cs"], "gate": ["ok"]}
        r = check_protocol_json(form_json(obj), SCHEMA_DIR)
        assert r["ok"] is False

    def test_rejects_a_review_with_an_invalid_verdict(self):
        obj = {
            "type": "REVIEW",
            "role": "backend",
            "scope": ["B.cs"],
            "checked": ["x"],
            "verdict": "maybe",
        }
        r = check_protocol_json(form_json(obj), SCHEMA_DIR)
        assert r["ok"] is False

    def test_rejects_a_remark_missing_a_nested_key_change(self):
        obj = {
            "type": "REVIEW",
            "role": "backend",
            "scope": ["B.cs"],
            "checked": ["x"],
            "verdict": "changes-requested",
            "remarks": [{"smell": "S1541", "location": "B.cs:42"}],
        }
        r = check_protocol_json(form_json(obj), SCHEMA_DIR)
        assert r["ok"] is False
        assert "change" in " ".join(r["errors"])

    def test_rejects_a_finding_with_fewer_than_two_options(self):
        obj = {
            "type": "FINDING",
            "where": "x",
            "issue": "contradiction",
            "options": [{"id": "a", "path": "p"}],
            "need": "n",
        }
        r = check_protocol_json(form_json(obj), SCHEMA_DIR)
        assert r["ok"] is False


# ---------------------------------------------------------------------------
# Describe: Test-ProtocolJson — REVIEW cross-field rule (verdict vs remarks)
# ---------------------------------------------------------------------------

class DescribeTestProtocolJsonReviewCrossFieldRule:
    def test_rejects_verdict_pass_with_remarks_present(self):
        obj = {
            "type": "REVIEW",
            "role": "backend",
            "scope": ["B.cs"],
            "checked": ["x"],
            "verdict": "pass",
            "remarks": [{"smell": "a", "location": "b", "change": "c"}],
        }
        r = check_protocol_json(form_json(obj), SCHEMA_DIR)
        assert r["ok"] is False
        assert "zero remarks" in " ".join(r["errors"])

    def test_rejects_verdict_changes_requested_with_no_remarks(self):
        obj = {
            "type": "REVIEW",
            "role": "backend",
            "scope": ["B.cs"],
            "checked": ["x"],
            "verdict": "changes-requested",
        }
        r = check_protocol_json(form_json(obj), SCHEMA_DIR)
        assert r["ok"] is False
        assert "at least one remark" in " ".join(r["errors"])


# ---------------------------------------------------------------------------
# Describe: order_by_keys / is_empty_form_value
# ---------------------------------------------------------------------------

class DescribeOrderByKeysAndIsEmptyFormValue:
    def test_orders_known_keys_first_and_appends_unknown_keys(self):
        o = {"gate": "g", "type": "RESULT", "extra": "x", "role": "backend"}
        ordered = order_by_keys(o, ["type", "role", "gate"])
        assert list(ordered.keys()) == ["type", "role", "gate", "extra"]

    def test_treats_null_empty_string_and_empty_array_as_empty(self):
        assert is_empty_form_value(None) is True
        assert is_empty_form_value("") is True
        assert is_empty_form_value([]) is True

    def test_treats_non_empty_values_as_non_empty(self):
        assert is_empty_form_value("x") is False
        assert is_empty_form_value(["a"]) is False


# ---------------------------------------------------------------------------
# Describe: format_protocol_form — normalization
# ---------------------------------------------------------------------------

class DescribeFormatProtocolFormNormalization:
    def test_reorders_top_level_keys_to_canonical_order(self):
        messy = '{ "gate":["ok"], "type":"RESULT", "changed":["A.cs"], "role":"backend" }'
        out = format_protocol_form(messy, schema_dir=SCHEMA_DIR)
        obj = json.loads(out)
        assert list(obj.keys()) == ["type", "role", "changed", "gate"]

    def test_drops_empty_optional_array_fields_notes_follow(self):
        obj = {
            "type": "RESULT",
            "role": "backend",
            "changed": ["A.cs"],
            "gate": ["ok"],
            "notes": [],
            "follow": [],
        }
        out = format_protocol_form(form_json(obj), schema_dir=SCHEMA_DIR)
        names = list(json.loads(out).keys())
        assert "notes" not in names
        assert "follow" not in names

    def test_orders_nested_spec_keys_path_before_gate(self):
        obj = {
            "type": "BRIEF",
            "spec": {"gate": "g", "path": "p"},
            "lane": ["x/**"],
            "task": "t",
            "gate": ["build"],
        }
        out = format_protocol_form(form_json(obj), schema_dir=SCHEMA_DIR)
        spec = json.loads(out)["spec"]
        assert list(spec.keys()) == ["path", "gate"]

    def test_orders_nested_remark_keys_smell_location_change(self):
        obj = {
            "type": "REVIEW",
            "role": "backend",
            "scope": ["B.cs"],
            "checked": ["x"],
            "verdict": "changes-requested",
            "remarks": [{"change": "c", "location": "l", "smell": "s"}],
        }
        out = format_protocol_form(form_json(obj), schema_dir=SCHEMA_DIR)
        remark = json.loads(out)["remarks"][0]
        assert list(remark.keys()) == ["smell", "location", "change"]

    def test_throws_on_invalid_input_with_a_descriptive_message(self):
        with pytest.raises(ValueError, match="Invalid RESULT"):
            format_protocol_form('{ "type":"RESULT" }', schema_dir=SCHEMA_DIR)


# ---------------------------------------------------------------------------
# Describe: resolve_form_text — input source resolution
# ---------------------------------------------------------------------------

class DescribeResolveFormText:
    def test_prefers_text_over_input_file(self):
        result = resolve_form_text(text="inline", input_file="does-not-exist.json")
        assert result == "inline"

    def test_reads_from_input_file_when_text_is_empty(self, tmp_path):
        f = tmp_path / "form.json"
        f.write_text('{ "type":"RESULT" }', encoding="utf-8")
        result = resolve_form_text(text="", input_file=str(f))
        assert '"type":"RESULT"' in result or '"type": "RESULT"' in result

    def test_raises_clear_error_when_input_file_does_not_exist(self):
        with pytest.raises(FileNotFoundError, match="InputFile not found"):
            resolve_form_text(text="", input_file="/nope/missing-form.json")


# ---------------------------------------------------------------------------
# Describe: format_protocol_form.py — --input-file end to end (real process)
# ---------------------------------------------------------------------------

SCRIPT_PATH = str(pathlib.Path(__file__).parent / "format_protocol_form.py")


class DescribeFormatProtocolFormInputFileEndToEnd:
    def test_normalizes_a_valid_form_from_a_file_via_the_script_entry_point(self, tmp_path):
        f = tmp_path / "form.json"
        f.write_text(
            '{ "gate":["build ok"], "type":"result", "changed":["a.cs"], "role":"backend" }',
            encoding="utf-8",
        )
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH, "--input-file", str(f)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert '"type": "RESULT"' in result.stdout

    def test_exits_non_zero_and_writes_the_error_to_stderr_on_invalid_input(self, tmp_path):
        f = tmp_path / "form.json"
        f.write_text('{ "type":"RESULT" }', encoding="utf-8")
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH, "--input-file", str(f)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "Invalid RESULT" in result.stderr


# ---------------------------------------------------------------------------
# Describe: get_form_file_name
# ---------------------------------------------------------------------------

class DescribeGetFormFileName:
    def test_is_role_type_json_when_a_role_is_given(self):
        assert get_form_file_name("RESULT", "backend") == "backend.RESULT.json"

    def test_is_type_json_when_role_less(self):
        assert get_form_file_name("FINDING", "") == "FINDING.json"


# ---------------------------------------------------------------------------
# Describe: save_protocol_form — emit to outbox (one-command hand-back)
# ---------------------------------------------------------------------------

class DescribeSaveProtocolForm:
    def test_writes_role_type_json_and_returns_a_type_ref_pointer(self, tmp_path):
        ptr_str = save_protocol_form(form_json(RESULT_OBJ), outbox_dir=str(tmp_path), schema_dir=SCHEMA_DIR)
        p = json.loads(ptr_str)
        assert p["type"] == "RESULT"
        expected_ref = str((tmp_path / "backend.RESULT.json").resolve())
        assert p["ref"] == expected_ref
        assert pathlib.Path(p["ref"]).exists()

    def test_writes_a_file_that_is_itself_a_valid_typed_form(self, tmp_path):
        ptr_str = save_protocol_form(form_json(RESULT_OBJ), outbox_dir=str(tmp_path), schema_dir=SCHEMA_DIR)
        ref = json.loads(ptr_str)["ref"]
        content = pathlib.Path(ref).read_text(encoding="utf-8")
        r = check_protocol_json(content, SCHEMA_DIR)
        assert r["ok"] is True

    def test_returns_an_absolute_ref_path(self, tmp_path):
        ptr_str = save_protocol_form(form_json(RESULT_OBJ), outbox_dir=str(tmp_path), schema_dir=SCHEMA_DIR)
        ref = json.loads(ptr_str)["ref"]
        assert pathlib.Path(ref).is_absolute()

    def test_creates_the_outbox_directory_when_missing(self, tmp_path):
        box = tmp_path / "new_outbox"
        assert not box.exists()
        save_protocol_form(form_json(RESULT_OBJ), outbox_dir=str(box), schema_dir=SCHEMA_DIR)
        assert box.exists()

    def test_uses_the_form_role_for_the_filename_by_default(self, tmp_path):
        ptr_str = save_protocol_form(form_json(REVIEW_PASS_OBJ), outbox_dir=str(tmp_path), schema_dir=SCHEMA_DIR)
        ref = json.loads(ptr_str)["ref"]
        assert ref.endswith("backend.REVIEW.json")

    def test_role_overrides_the_filename_role(self, tmp_path):
        ptr_str = save_protocol_form(
            form_json(RESULT_OBJ), outbox_dir=str(tmp_path), role="frontend", schema_dir=SCHEMA_DIR
        )
        ref = json.loads(ptr_str)["ref"]
        assert ref.endswith("frontend.RESULT.json")

    def test_falls_back_to_type_json_for_a_role_less_form_finding(self, tmp_path):
        ptr_str = save_protocol_form(form_json(FINDING_OBJ), outbox_dir=str(tmp_path), schema_dir=SCHEMA_DIR)
        ref = json.loads(ptr_str)["ref"]
        assert ref.endswith("FINDING.json")

    def test_role_tags_an_otherwise_role_less_finding(self, tmp_path):
        ptr_str = save_protocol_form(
            form_json(FINDING_OBJ), outbox_dir=str(tmp_path), role="backend", schema_dir=SCHEMA_DIR
        )
        ref = json.loads(ptr_str)["ref"]
        assert ref.endswith("backend.FINDING.json")

    def test_normalizes_the_written_form_canonical_key_order_dropped_empty_optionals(self, tmp_path):
        messy = '{ "gate":["ok"], "type":"result", "changed":["A.cs"], "role":"backend", "notes":[] }'
        ptr_str = save_protocol_form(messy, outbox_dir=str(tmp_path), schema_dir=SCHEMA_DIR)
        ref = json.loads(ptr_str)["ref"]
        obj = json.loads(pathlib.Path(ref).read_text(encoding="utf-8"))
        assert list(obj.keys()) == ["type", "role", "changed", "gate"]

    def test_raises_on_invalid_input_and_writes_nothing(self, tmp_path):
        with pytest.raises(ValueError, match="Invalid RESULT"):
            save_protocol_form('{ "type":"RESULT" }', outbox_dir=str(tmp_path), schema_dir=SCHEMA_DIR)
        if tmp_path.exists():
            files = list(tmp_path.iterdir())
            assert len(files) == 0

    def test_raises_when_outbox_dir_is_empty(self):
        with pytest.raises(ValueError, match="OutboxDir is required"):
            save_protocol_form(form_json(RESULT_OBJ), outbox_dir="", schema_dir=SCHEMA_DIR)


# ---------------------------------------------------------------------------
# Describe: format_protocol_form.py — --outbox-dir end to end (real process)
# ---------------------------------------------------------------------------

class DescribeFormatProtocolFormOutboxDirEndToEnd:
    def test_writes_the_outbox_file_and_prints_the_pointer_via_the_script_entry_point(self, tmp_path):
        form_file = tmp_path / "form.json"
        form_file.write_text(
            '{ "gate":["build ok"], "type":"result", "changed":["a.cs"], "role":"backend" }',
            encoding="utf-8",
        )
        box = tmp_path / "outbox"
        result = subprocess.run(
            [
                sys.executable,
                SCRIPT_PATH,
                "--input-file",
                str(form_file),
                "--outbox-dir",
                str(box),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        p = json.loads(result.stdout.strip())
        assert p["type"] == "RESULT"
        assert pathlib.Path(p["ref"]).exists()
        assert (box / "backend.RESULT.json").exists()

    def test_exits_non_zero_on_invalid_input_and_writes_no_file(self, tmp_path):
        form_file = tmp_path / "form.json"
        form_file.write_text('{ "type":"RESULT" }', encoding="utf-8")
        box = tmp_path / "outbox"
        result = subprocess.run(
            [
                sys.executable,
                SCRIPT_PATH,
                "--input-file",
                str(form_file),
                "--outbox-dir",
                str(box),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        combined = result.stdout + result.stderr
        assert "Invalid RESULT" in combined
        if box.exists():
            assert len(list(box.iterdir())) == 0
