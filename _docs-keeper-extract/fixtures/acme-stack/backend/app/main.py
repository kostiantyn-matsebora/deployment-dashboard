"""Acme Stack backend — fixture entrypoint (token, not exercised)."""


def health() -> dict:
    return {"status": "ok"}
