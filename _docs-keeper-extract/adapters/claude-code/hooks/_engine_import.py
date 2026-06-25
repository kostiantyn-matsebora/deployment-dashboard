"""
Engine import shim for the Claude Code adapter entrypoints.

In an installed/assembled plugin the engine is vendored next to the hooks as
the `_engine` package (Claude Code plugins cannot reference files outside their
own root). In the source repo it lives at `core/engine`. Import works in both:
the assembled `_engine` package wins; otherwise we fall back to the repo copy.
"""

import os
import sys

try:  # assembled / installed plugin: vendored _engine package beside the hooks
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from _engine import capture, drift, gitio, session  # type: ignore
except ImportError:  # source repo: core/ at the repo root (…/adapters/claude-code/hooks)
    _repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    )
    sys.path.insert(0, _repo_root)
    from core.engine import capture, drift, gitio, session  # type: ignore

__all__ = ["drift", "session", "capture", "gitio"]
