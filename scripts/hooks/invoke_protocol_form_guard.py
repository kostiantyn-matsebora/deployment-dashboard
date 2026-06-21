"""
PreToolUse(SendMessage | Edit | Write | MultiEdit) hook — enforces the JSON
Communication protocol (protocol.md).

A cross-role message must be one of the seven typed forms:
    REVIEW / RESULT / BRIEF / FINDING / FIX / ARTIFACT / RESEARCH
serialized as a JSON object carrying a "type" discriminator.

Hook I/O contract:
  - Reads a JSON payload from stdin (tool_input.message or tool_input.file_path /
    tool_input.content for Write tool).
  - On a block decision, prints compact JSON {"decision": "block", "reason": ...}
    to stdout and exits 0.
  - On no-op, exits 0 silently.
  - Invalid / missing stdin is a no-op (exit 0).

Validation is single-sourced: imports check_protocol_json / save_protocol_form from
format_protocol_form (sibling module).
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys

# ---------------------------------------------------------------------------
# Import the single source of validation truth (Format-ProtocolForm equivalent).
# This module lives in the same directory; the guard imports pure functions only.
# ---------------------------------------------------------------------------

# Ensure the sibling directory is importable when this hook is invoked by
# absolute path (e.g. by Claude Code's hook runner).
_here = pathlib.Path(__file__).resolve().parent
if str(_here) not in sys.path:
    sys.path.insert(0, str(_here))

from format_protocol_form import (  # noqa: E402
    check_protocol_json,
    get_protocol_schema_dir,
)

# ---------------------------------------------------------------------------
# get_render_recipe — copy-pasteable recipe appended to every block reason
# ---------------------------------------------------------------------------

def get_render_recipe() -> str:
    """Return the normalizer invocation recipe for block reason messages."""
    script = "scripts/hooks/format_protocol_form.py"
    return (
        'Every cross-role message MUST be one of the seven typed forms as a JSON object with a "type" field: '
        "REVIEW / RESULT / BRIEF / FINDING / FIX / ARTIFACT / RESEARCH "
        "(fields + examples in .claude/team-process/protocol.md; schemas in .claude/team-process/schemas/). "
        "HAND BACK in one step: "
        "(1) write the rough form JSON to a temp file. "
        f"(2) python3 {script} --input-file <file> --outbox-dir <your outbox path> "
        "— it validates, writes <role>.<TYPE>.json to your outbox, and prints the exact "
        '{ "type", "ref" } pointer. '
        "(3) Send that stdout VERBATIM as the message. "
        "(Omit --outbox-dir to just normalize a form to stdout.) "
        "Free prose is returned UNREAD."
    )


# ---------------------------------------------------------------------------
# get_send_message_text — extract the SendMessage text payload
# ---------------------------------------------------------------------------

def get_send_message_text(tool_input: dict | None) -> str:
    """
    Extract the SendMessage text payload from tool_input.

    Object messages (legacy protocol responses, shutdown signals) flatten to ''
    (not validated).
    """
    if tool_input is None:
        return ""
    m = tool_input.get("message")
    if m is None:
        return ""
    if isinstance(m, str):
        return m
    return ""


# ---------------------------------------------------------------------------
# get_pointer_info — detect a {type, ref} pointer message
# ---------------------------------------------------------------------------

def get_pointer_info(text: str) -> dict:
    """
    Parse *text* and detect whether it is a {type, ref} pointer.

    Returns:
        {
            "is_pointer": bool,
            "type": str,
            "ref": str,
            "extra_keys": list[str],
        }
    """
    info: dict = {"is_pointer": False, "type": "", "ref": "", "extra_keys": []}
    if not text or not text.strip():
        return info
    try:
        o = json.loads(text)
    except (ValueError, TypeError):
        return info
    if not isinstance(o, dict):
        return info
    if "ref" not in o:
        return info
    info["is_pointer"] = True
    info["type"] = str(o.get("type", ""))
    info["ref"] = str(o.get("ref", ""))
    info["extra_keys"] = [k for k in o if k not in ("type", "ref")]
    return info


# ---------------------------------------------------------------------------
# is_ref_in_session_box — verify a ref lives inside a session inbox/outbox
# ---------------------------------------------------------------------------

def is_ref_in_session_box(path: str) -> bool:
    """
    Return True when *path* (after normalizing separators) resolves inside a
    session inbox or outbox:
        .team-process/sessions/<id>/{inbox,outbox}/<file>
    """
    normalized = path.replace("\\", "/")
    return bool(re.search(r"/\.team-process/sessions/[^/]+/(inbox|outbox)/[^/]", normalized))


# ---------------------------------------------------------------------------
# get_repo_root — mirrors `git rev-parse --show-toplevel`
# ---------------------------------------------------------------------------

def _get_repo_root() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
        )
        first = result.stdout.splitlines()[0] if result.stdout.strip() else ""
        return first.strip()
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# get_protocol_form_decision — mirrors Get-ProtocolFormDecision
# ---------------------------------------------------------------------------

def get_protocol_form_decision(text: str, schema_dir: str = "", root: str = "") -> dict:
    """
    Evaluate the SendMessage text and return a decision dict:
        {"block": False}
        {"block": True, "reason": str}
    """
    # Empty / whitespace — object protocol-response messages flattened to ''.
    if not text or not text.strip():
        return {"block": False}

    # Pointer message: validate the REFERENCED inbox/outbox file, not the message.
    ptr = get_pointer_info(text)
    if ptr["is_pointer"]:
        if ptr["extra_keys"]:
            extra = ", ".join(ptr["extra_keys"])
            return {
                "block": True,
                "reason": (
                    f"A file-based pointer must be exactly {{ type, ref }} - remove: {extra}. "
                    + get_render_recipe()
                ),
            }
        if not ptr["ref"] or not ptr["ref"].strip():
            return {
                "block": True,
                "reason": (
                    "Pointer 'ref' is empty - set it to the absolute path of the inbox/outbox "
                    "form file. " + get_render_recipe()
                ),
            }
        path = ptr["ref"]
        if not pathlib.PurePosixPath(path).is_absolute() and not pathlib.Path(path).is_absolute():
            if root:
                path = str(pathlib.Path(root) / path)
        # Canonicalize (collapses ..) and require the result to live inside a session box.
        try:
            full = str(pathlib.Path(path).resolve())
        except Exception:
            full = ""
        if not full or not is_ref_in_session_box(full):
            return {
                "block": True,
                "reason": (
                    f"Pointer 'ref' must resolve to a file under "
                    f".team-process/sessions/<id>/{{inbox,outbox}}/ - got '{ptr['ref']}'. "
                    + get_render_recipe()
                ),
            }
        if not pathlib.Path(full).exists():
            return {
                "block": True,
                "reason": (
                    f"Pointer 'ref' not found: '{ptr['ref']}'. "
                    "Write the typed form to the session box first, then point at it. "
                    + get_render_recipe()
                ),
            }
        content = pathlib.Path(full).read_text(encoding="utf-8")
        fcheck = check_protocol_json(content, schema_dir)
        if not fcheck["ok"]:
            label = fcheck["type"] if fcheck["type"] else "referenced form"
            errors = "; ".join(fcheck["errors"])
            return {
                "block": True,
                "reason": (
                    f"Malformed {label} at '{ptr['ref']}' - {errors}. "
                    + get_render_recipe()
                ),
            }
        ptr_type = ptr["type"].upper() if ptr["type"] else ""
        file_type = fcheck["type"].upper() if fcheck["type"] else ""
        if ptr_type and file_type and ptr_type != file_type:
            return {
                "block": True,
                "reason": (
                    f"Pointer type '{ptr['type']}' does not match the referenced form "
                    f"'{fcheck['type']}'. " + get_render_recipe()
                ),
            }
        return {"block": False}

    check = check_protocol_json(text, schema_dir)
    if check["ok"]:
        return {"block": False}

    label = check["type"] if check["type"] else "cross-role message"
    errors = "; ".join(check["errors"])
    return {
        "block": True,
        "reason": f"Malformed {label} - {errors}. " + get_render_recipe(),
    }


# ---------------------------------------------------------------------------
# get_session_box_write_decision — mirrors Get-SessionBoxWriteDecision
# ---------------------------------------------------------------------------

def get_session_box_write_decision(
    file_path: str,
    content: str | None,
    schema_dir: str = "",
    root: str = "",
) -> dict:
    """
    Check a Write-tool call whose target might be a session inbox/outbox file.

    Returns {"block": False} when:
      - file_path is empty / not a box path
      - content is None (Edit/MultiEdit — no full body to validate)

    Returns {"block": True, "reason": ...} when:
      - a box write carries non-typed-form content
    """
    if not file_path or not file_path.strip():
        return {"block": False}
    path = file_path
    if not pathlib.Path(path).is_absolute():
        if root:
            path = str(pathlib.Path(root) / path)
    try:
        full = str(pathlib.Path(path).resolve())
    except Exception:
        full = ""
    # Not a box write — not this guard's concern.
    if not full or not is_ref_in_session_box(full):
        return {"block": False}
    # No content body (Edit / MultiEdit) — can't validate pre-write.
    if content is None or not isinstance(content, str):
        return {"block": False}
    check = check_protocol_json(content, schema_dir)
    if check["ok"]:
        return {"block": False}
    label = check["type"] if check["type"] else "session box form"
    errors = "; ".join(check["errors"])
    return {
        "block": True,
        "reason": (
            "A session inbox/outbox file must be a valid typed-form JSON, not "
            f"prose/markdown/text. Malformed {label} - {errors}. "
            + get_render_recipe()
        ),
    }


# ---------------------------------------------------------------------------
# Hook stdin helpers
# ---------------------------------------------------------------------------

def read_payload() -> dict:
    """Read stdin JSON payload; return {} on empty / non-redirected / invalid."""
    if sys.stdin.isatty():
        return {}
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {}


# ---------------------------------------------------------------------------
# Hook entry point
# ---------------------------------------------------------------------------

def main() -> None:
    payload = read_payload()

    tool_name = ""
    try:
        tool_name = str(payload.get("tool_name") or "")
    except (AttributeError, TypeError):
        tool_name = ""

    # Root resolves relative pointer 'ref' / file_path (absolute refs are cross-worktree).
    root = _get_repo_root()
    if not root:
        try:
            root = os.getcwd()
        except Exception:
            root = ""

    schema_dir = get_protocol_schema_dir()

    tool_input: dict | None = None
    try:
        tool_input = payload.get("tool_input") or {}
        if not isinstance(tool_input, dict):
            tool_input = {}
    except (AttributeError, TypeError):
        tool_input = {}

    # Two enforcement points keyed on the tool name.
    if tool_name in ("Write", "Edit", "MultiEdit") and tool_input:
        file_path = str(tool_input.get("file_path") or "")
        content = tool_input.get("content")
        # content must be str or None for the write-guard; other types treated as None.
        if not isinstance(content, str):
            content = None
        decision = get_session_box_write_decision(
            file_path=file_path,
            content=content,
            schema_dir=schema_dir,
            root=root,
        )
    else:
        text = get_send_message_text(tool_input) if tool_input else ""
        decision = get_protocol_form_decision(text=text, schema_dir=schema_dir, root=root)

    if decision["block"]:
        print(
            json.dumps(
                {"decision": "block", "reason": decision["reason"]},
                separators=(",", ":"),
            )
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
