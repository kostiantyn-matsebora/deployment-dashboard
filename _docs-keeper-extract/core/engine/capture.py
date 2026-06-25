"""
docs-keeper core engine — doc-capture model + I/O (platform-neutral).

Pure entry construction plus read/write of the per-session capture file
(`.docs-keeper/capture.<sid>.json`). Surfacing (SessionStart proposal /
SessionEnd report) lives in session.py alongside the session lifecycle.
"""

import json
from pathlib import Path

from .drift import get_safe_session_id


def get_docs_capture_file_path(repo_root: str, session_id: str) -> str:
    """Return the path to the capture.<sid>.json file."""
    base = repo_root if repo_root else "."
    sid = get_safe_session_id(session_id)
    name = f"capture.{sid}.json" if sid else "capture.json"
    return str(Path(base) / ".docs-keeper" / name)


# ---------------------------------------------------------------------------
# Pure functions
# ---------------------------------------------------------------------------


def new_docs_capture_entry(content: str, suggested_doc: str, source: str, captured_at: str) -> dict:
    """
    Create a new capture entry dict. Source is validated to 'manual' or
    'compaction'; unknown values default to 'manual'.
    """
    safe_source = source if source in ("manual", "compaction") else "manual"
    return {
        "content": content,
        "suggestedDoc": suggested_doc,
        "source": safe_source,
        "capturedAt": captured_at,
    }


def add_docs_capture_entry(capture_file: dict, entry: dict) -> dict:
    """
    Pure. Returns updated capture dict with entry appended to captures.
    Does not mutate the input.
    """
    result = dict(capture_file)
    existing = list(result.get("captures") or [])
    existing.append(entry)
    result["captures"] = existing
    return result


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------


def read_docs_capture(path: str) -> dict | None:
    """
    Reads and parses the capture JSON file. Returns None on missing/error.
    Guarantees captures key defaults to [] if absent.
    """
    p = Path(path)
    if not p.exists():
        return None
    try:
        obj = json.loads(p.read_text(encoding="utf-8"))
        captures = []
        for c in obj.get("captures") or []:
            captures.append({
                "content": str(c.get("content", "")),
                "suggestedDoc": str(c.get("suggestedDoc", "")),
                "source": str(c.get("source", "")),
                "capturedAt": str(c.get("capturedAt", "")),
            })
        return {"sessionId": str(obj.get("sessionId", "")), "captures": captures}
    except (OSError, ValueError, TypeError):
        return None


def write_docs_capture(path: str, capture_file: dict) -> None:
    """Writes the capture dict as JSON. Creates .docs-keeper/ dir if absent."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(capture_file, separators=(",", ":")), encoding="utf-8")
