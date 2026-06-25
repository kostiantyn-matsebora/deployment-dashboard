"""
docs-keeper core engine — platform-neutral documentation maintenance.

Pure drift detection, session tracking, and capture modelling, plus the
filesystem/git collaborators they consume. Adapters (Claude Code, future
platforms) translate their host's hook payload into these calls; the neutral
`cli` gates drift on any repo with no platform host.
"""

from . import capture, drift, gitio, session

__all__ = ["drift", "session", "capture", "gitio"]
