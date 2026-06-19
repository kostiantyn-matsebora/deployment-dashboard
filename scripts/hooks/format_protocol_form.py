"""
Validates and normalizes a typed protocol form (REVIEW / RESULT / BRIEF / FINDING /
FIX / ARTIFACT) as JSON per protocol.md.

Single source of validation truth — the SendMessage guard (invoke_protocol_form_guard.py)
imports pure functions from this module.

Hook / module contract:
  - Pure functions at module top level (usable by the guard without side effects).
  - Entry-point logic lives in main(), guarded by if __name__ == "__main__".
  - Tests import this module and call the pure functions directly.

CLI surface (mirrors the PowerShell param block):
  --text TEXT        : form JSON inline string
  --input-file FILE  : path to a file holding the form JSON
  --schema-dir DIR   : override the schema directory (for tests)
  --outbox-dir DIR   : emit-to-box mode (writes + prints pointer)
  --role ROLE        : filename disambiguator for --outbox-dir
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from collections import OrderedDict
from typing import Any

# ---------------------------------------------------------------------------
# Form metadata tables (mirrors the PowerShell $script:Form* hashtables)
# ---------------------------------------------------------------------------

FORM_KEY_ORDER: dict[str, list[str]] = {
    "BRIEF":    ["type", "spec", "lane", "task", "gate", "seed"],
    "RESULT":   ["type", "role", "changed", "gate", "notes", "follow", "block"],
    "REVIEW":   ["type", "role", "scope", "checked", "verdict", "remarks", "block"],
    "FINDING":  ["type", "where", "issue", "options", "need"],
    "FIX":      ["type", "failure", "suspect"],
    "ARTIFACT": ["type", "spec", "delta", "open"],
}

FORM_OPTIONAL_KEYS: dict[str, list[str]] = {
    "BRIEF":    ["seed"],
    "RESULT":   ["notes", "follow", "block"],
    "REVIEW":   ["remarks", "block"],
    "FINDING":  [],
    "FIX":      [],
    "ARTIFACT": ["open"],
}

NESTED_KEY_ORDER: dict[str, list[str]] = {
    "spec":    ["path", "gate"],           # BRIEF.spec
    "failure": ["test", "expect", "actual"],  # FIX.failure
    "remark":  ["smell", "location", "change"],  # REVIEW.remarks[] item
    "option":  ["id", "path"],             # FINDING.options[] item
}


# ---------------------------------------------------------------------------
# Minimal JSON Schema validator (draft-07 subset used by our schemas).
# stdlib-only; covers: type, enum, required, additionalProperties, properties,
# minItems, items (object schema), minLength.
# Returns a list of error strings (empty = valid).
# ---------------------------------------------------------------------------

def _validate_schema(value: Any, schema: dict, path: str = "") -> list[str]:  # noqa: C901
    """Recursively validate *value* against *schema*; return list of error strings."""
    errors: list[str] = []

    # --- type constraint ---
    schema_type = schema.get("type")
    if schema_type == "object":
        if not isinstance(value, dict):
            errors.append(f"{'Value' if not path else path} must be an object (got {type(value).__name__})")
            return errors
        # required
        for req in schema.get("required", []):
            if req not in value:
                label = f"'{req}'" if not path else f"'{path}.{req}'"
                errors.append(f"Required property {label} is missing")
        # additionalProperties: false
        if schema.get("additionalProperties") is False:
            allowed = set(schema.get("properties", {}).keys())
            for key in value:
                if key not in allowed:
                    errors.append(f"Additional property '{key}' is not allowed")
        # properties
        for prop, prop_schema in schema.get("properties", {}).items():
            if prop in value:
                child_path = f"{path}.{prop}" if path else prop
                errors.extend(_validate_schema(value[prop], prop_schema, child_path))

    elif schema_type == "array":
        if not isinstance(value, list):
            errors.append(f"{'Value' if not path else path} must be an array (got {type(value).__name__})")
            return errors
        min_items = schema.get("minItems")
        if min_items is not None and len(value) < min_items:
            errors.append(
                f"{'Value' if not path else path} must have at least {min_items} item(s) "
                f"(got {len(value)})"
            )
        items_schema = schema.get("items")
        if items_schema:
            for i, item in enumerate(value):
                child_path = f"{path}[{i}]" if path else f"[{i}]"
                errors.extend(_validate_schema(item, items_schema, child_path))

    elif schema_type == "string":
        if not isinstance(value, str):
            errors.append(f"{'Value' if not path else path} must be a string (got {type(value).__name__})")
            return errors
        min_length = schema.get("minLength")
        if min_length is not None and len(value) < min_length:
            errors.append(
                f"{'Value' if not path else path} must have at least {min_length} character(s)"
            )

    # --- enum constraint (can appear without type on its own) ---
    if "enum" in schema:
        if value not in schema["enum"]:
            errors.append(
                f"{'Value' if not path else path} must be one of "
                f"{schema['enum']!r} (got {value!r})"
            )

    return errors


def _load_schema(schema_dir: str, form_type: str) -> dict | None:
    """Load the JSON schema file for *form_type*; return None if not found."""
    path = pathlib.Path(schema_dir) / f"{form_type.lower()}.schema.json"
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# get_protocol_schema_dir
# ---------------------------------------------------------------------------

def get_protocol_schema_dir(override: str = "") -> str:
    """Return the schema directory path, honouring an explicit override."""
    if override and override.strip():
        return override
    # scripts/hooks/../../.claude/team-process/schemas
    here = pathlib.Path(__file__).resolve().parent
    return str(here.parent.parent / ".claude" / "team-process" / "schemas")


# ---------------------------------------------------------------------------
# order_by_keys — mirrors ConvertTo-OrderedByKeys
# ---------------------------------------------------------------------------

def order_by_keys(obj: dict, keys: list[str]) -> OrderedDict:
    """
    Reorder *obj* so that *keys* come first (in order), then any remaining
    keys in their original order. Returns an OrderedDict.
    """
    result: OrderedDict = OrderedDict()
    present = list(obj.keys())
    for k in keys:
        if k in obj:
            result[k] = obj[k]
    for k in present:
        if k not in result:
            result[k] = obj[k]
    return result


# ---------------------------------------------------------------------------
# is_empty_form_value — mirrors Test-EmptyFormValue
# ---------------------------------------------------------------------------

def is_empty_form_value(value: Any) -> bool:
    """Return True when value counts as empty for the drop-optional rule."""
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len(value) == 0
    return False


# ---------------------------------------------------------------------------
# check_protocol_json — mirrors Test-ProtocolJson
# Returns dict: {ok: bool, type: str|None, obj: dict|None, errors: list[str]}
# ---------------------------------------------------------------------------

def check_protocol_json(json_text: str, schema_dir: str = "") -> dict:
    """
    Parse and validate a form JSON string.

    Returns:
        {"ok": bool, "type": str | None, "obj": dict | None, "errors": list[str]}
    """
    result: dict = {"ok": False, "type": None, "obj": None, "errors": []}

    if not json_text or not json_text.strip():
        result["errors"] = ["empty message"]
        return result

    # 1. Parse.
    try:
        obj = json.loads(json_text)
    except (ValueError, TypeError) as exc:
        result["errors"] = [f"not valid JSON: {exc}"]
        return result

    if not isinstance(obj, dict):
        result["errors"] = ["top level must be a single JSON object"]
        return result

    result["obj"] = obj

    # 2. Discriminator.
    raw_type = obj.get("type", "")
    form_type = str(raw_type).upper() if raw_type else ""
    if form_type not in FORM_KEY_ORDER:
        valid = " / ".join(sorted(FORM_KEY_ORDER.keys()))
        result["errors"] = [
            f"missing or unknown \"type\" (got '{raw_type}') - must be one of: {valid}"
        ]
        return result

    result["type"] = form_type
    # Canonicalize discriminator casing on the dict.
    obj["type"] = form_type

    # 3. Schema validation.
    schema_directory = get_protocol_schema_dir(schema_dir)
    schema = _load_schema(schema_directory, form_type)
    if schema is None:
        schema_path = pathlib.Path(schema_directory) / f"{form_type.lower()}.schema.json"
        result["errors"] = [f"schema not found for {form_type} at {schema_path}"]
        return result

    schema_errors = _validate_schema(obj, schema)
    if schema_errors:
        result["errors"] = schema_errors
        return result

    # 4. Cross-field rule — REVIEW verdict <-> remarks.
    if form_type == "REVIEW":
        remarks = obj.get("remarks", [])
        remark_count = len(remarks) if isinstance(remarks, list) else 0
        if obj.get("verdict") == "pass" and remark_count > 0:
            result["errors"] = [
                f"verdict 'pass' requires zero remarks (found {remark_count})"
                " - use 'changes-requested'"
            ]
            return result
        if obj.get("verdict") == "changes-requested" and remark_count == 0:
            result["errors"] = ["verdict 'changes-requested' requires at least one remark"]
            return result

    result["ok"] = True
    return result


# ---------------------------------------------------------------------------
# normalize_nested — order a nested dict value given its parent key name
# ---------------------------------------------------------------------------

def _normalize_nested_obj(obj: Any, key_name: str) -> Any:
    """Order a nested dict using NESTED_KEY_ORDER[key_name]; passthrough otherwise."""
    if key_name in NESTED_KEY_ORDER and isinstance(obj, dict):
        return order_by_keys(obj, NESTED_KEY_ORDER[key_name])
    return obj


# ---------------------------------------------------------------------------
# normalize_form — mirrors ConvertTo-NormalizedForm
# ---------------------------------------------------------------------------

def normalize_form(obj: dict, form_type: str) -> OrderedDict:
    """
    Normalize a validated form object: canonical key order, drop empty optionals,
    order nested objects/arrays. Returns an OrderedDict ready for json.dumps.
    """
    optional = FORM_OPTIONAL_KEYS[form_type]
    ordered = order_by_keys(obj, FORM_KEY_ORDER[form_type])

    final: OrderedDict = OrderedDict()
    for key, val in ordered.items():
        # Drop empty optional fields.
        if key in optional and is_empty_form_value(val):
            continue

        if key == "spec":
            # BRIEF.spec is a nested object; ARTIFACT.spec is a plain string.
            if isinstance(val, dict):
                val = order_by_keys(val, NESTED_KEY_ORDER["spec"])
        elif key == "failure":
            if isinstance(val, dict):
                val = order_by_keys(val, NESTED_KEY_ORDER["failure"])
        elif key == "remarks":
            if isinstance(val, list):
                val = [
                    order_by_keys(item, NESTED_KEY_ORDER["remark"])
                    if isinstance(item, dict) else item
                    for item in val
                ]
        elif key == "options":
            if isinstance(val, list):
                val = [
                    order_by_keys(item, NESTED_KEY_ORDER["option"])
                    if isinstance(item, dict) else item
                    for item in val
                ]

        final[key] = val

    return final


# ---------------------------------------------------------------------------
# format_protocol_form — mirrors Format-ProtocolForm function
# ---------------------------------------------------------------------------

def format_protocol_form(text: str, schema_dir: str = "") -> str:
    """
    Validate then normalize a form JSON string.

    Returns pretty-printed canonical JSON on success.
    Raises ValueError with a descriptive message on invalid input.
    """
    check = check_protocol_json(text, schema_dir)
    if not check["ok"]:
        label = check["type"] if check["type"] else "form"
        errors = "; ".join(check["errors"])
        raise ValueError(f"Invalid {label}: {errors}")

    normalized = normalize_form(check["obj"], check["type"])
    return json.dumps(normalized, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# get_form_file_name — mirrors Get-FormFileName
# ---------------------------------------------------------------------------

def get_form_file_name(form_type: str, role: str = "") -> str:
    """Return the session-box filename for a form: <role>.<TYPE>.json or <TYPE>.json."""
    if role and role.strip():
        return f"{role}.{form_type}.json"
    return f"{form_type}.json"


# ---------------------------------------------------------------------------
# save_protocol_form — mirrors Save-ProtocolForm
# ---------------------------------------------------------------------------

def save_protocol_form(
    text: str,
    outbox_dir: str,
    role: str = "",
    schema_dir: str = "",
) -> str:
    """
    Validate + normalize a form, write it to *outbox_dir* as <role>.<TYPE>.json,
    and return the exact compact { "type": ..., "ref": ... } pointer JSON string.

    Raises ValueError on invalid input (nothing is written).
    Raises ValueError when outbox_dir is empty.
    """
    if not outbox_dir or not outbox_dir.strip():
        raise ValueError("OutboxDir is required to save a form.")

    check = check_protocol_json(text, schema_dir)
    if not check["ok"]:
        label = check["type"] if check["type"] else "form"
        errors = "; ".join(check["errors"])
        raise ValueError(f"Invalid {label}: {errors}")

    form_type = check["type"]
    normalized_str = json.dumps(normalize_form(check["obj"], form_type), indent=2, ensure_ascii=False)

    # Filename role: explicit role wins, else the form's own role field.
    resolved_role = role.strip() if role else ""
    if not resolved_role:
        form_role = check["obj"].get("role", "")
        if isinstance(form_role, str) and form_role.strip():
            resolved_role = form_role.strip()

    file_name = get_form_file_name(form_type, resolved_role)

    outbox_path = pathlib.Path(outbox_dir)
    outbox_path.mkdir(parents=True, exist_ok=True)
    full_path = (outbox_path / file_name).resolve()
    full_path.write_text(normalized_str, encoding="utf-8")

    pointer = OrderedDict([("type", form_type), ("ref", str(full_path))])
    return json.dumps(pointer, separators=(",", ":"))


# ---------------------------------------------------------------------------
# resolve_form_text — mirrors Resolve-FormText
# ---------------------------------------------------------------------------

def resolve_form_text(text: str = "", input_file: str = "") -> str:
    """
    Resolve the form text from: text inline > input_file > redirected stdin.
    Raises FileNotFoundError when --input-file is given but does not exist.
    """
    if text and text.strip():
        return text
    if input_file and input_file.strip():
        p = pathlib.Path(input_file)
        if not p.exists():
            raise FileNotFoundError(f"InputFile not found: {input_file}")
        return p.read_text(encoding="utf-8")
    if not sys.stdin.isatty():
        return sys.stdin.read()
    return ""


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate and normalize a typed protocol form JSON."
    )
    parser.add_argument("--text", default="", help="Form JSON inline string")
    parser.add_argument("--input-file", default="", help="Path to a file holding the form JSON")
    parser.add_argument("--schema-dir", default="", help="Override the schema directory")
    parser.add_argument("--outbox-dir", default="", help="Emit-to-box: write + print pointer")
    parser.add_argument("--role", default="", help="Filename disambiguator for --outbox-dir")
    args = parser.parse_args()

    try:
        form_text = resolve_form_text(text=args.text, input_file=args.input_file)
    except FileNotFoundError as exc:
        sys.stderr.write(str(exc) + "\n")
        sys.exit(1)

    if not form_text or not form_text.strip():
        sys.exit(0)

    try:
        if args.outbox_dir:
            output = save_protocol_form(
                form_text,
                outbox_dir=args.outbox_dir,
                role=args.role,
                schema_dir=args.schema_dir,
            )
            print(output)
        else:
            output = format_protocol_form(form_text, schema_dir=args.schema_dir)
            print(output)
    except (ValueError, FileNotFoundError) as exc:
        sys.stderr.write(str(exc) + "\n")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
