#!/usr/bin/env python3
# demo-driver sidecar -- periodic WireMock.Net admin-API ticker (issue #46).
#
# Owner: devops-engineer.
# Contract: Phase 3 design lock on #46 (extension to CR-0013 demo profile).
#
# Lifecycle:
#   1. Discover pinned GUIDs from /app/static-base/05-list-deployments-*.json
#      (each file's top-level `Guid` field is the WireMock.Net mapping id the
#      sidecar will PUT against to replace that mapping's response body).
#   2. Walk /app/ticks/<NNN>-<slug>/ subdirectories in sorted order, indefinitely.
#      Per tick: for each JSON file in the subdir, identify intent by filename
#      prefix, rewrite numeric `id` / `run_id` fields under Response.BodyAsJson
#      using cycle-anchored monotone stride, and PUT (list-deployments) or
#      POST (status) the body to demo-gha's admin API.
#   3. Sleep DEMO_DRIVER_PERIOD_SECONDS between ticks; SIGTERM aborts the
#      sleep but lets the current tick's IO finish (graceful <=10s).
#
# Error handling: every admin-API call is best-effort; 4xx/5xx is logged at
# WARNING and the loop continues. The driver never crashes -- on uncaught
# exceptions in tick processing, it logs at ERROR and proceeds to the next tick.
#
# Stdlib only: http.client, json, os, pathlib, time, signal, logging.

import http.client
import json
import logging
import os
import pathlib
import re
import signal
import sys
import time
import urllib.parse
from typing import Any

# -------- Configuration (env-driven, defaults from Dockerfile) -----------------

GHA_URL = os.environ.get("DEMO_DRIVER_GHA_URL", "http://demo-gha:80")
PERIOD_SECONDS = int(os.environ.get("DEMO_DRIVER_PERIOD_SECONDS", "15"))
ID_STRIDE = int(os.environ.get("DEMO_DRIVER_ID_STRIDE", "100"))
BUILD_EPOCH = int(os.environ.get("DEMO_DRIVER_BUILD_EPOCH", "0"))
STATIC_BASE_DIR = pathlib.Path("/app/static-base")
TICKS_DIR = pathlib.Path("/app/ticks")

# -------- Logging --------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s demo-driver %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("demo-driver")

# -------- SIGTERM handling -----------------------------------------------------

_shutdown = False


def _on_signal(signum: int, _frame: Any) -> None:
    global _shutdown
    _shutdown = True
    log.info("received signal %s; will exit after current tick finishes", signum)


signal.signal(signal.SIGTERM, _on_signal)
signal.signal(signal.SIGINT, _on_signal)

# -------- HTTP helpers (stdlib http.client; no requests/urllib3) ---------------


def _parse_url(url: str) -> tuple[str, int]:
    p = urllib.parse.urlparse(url)
    host = p.hostname or "demo-gha"
    port = p.port or (443 if p.scheme == "https" else 80)
    return host, port


_HOST, _PORT = _parse_url(GHA_URL)


def _admin_request(method: str, path: str, body: dict | None) -> tuple[int, str]:
    """Single-shot admin API call. Returns (status, body_text). Never raises."""
    conn = http.client.HTTPConnection(_HOST, _PORT, timeout=10)
    try:
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Content-Type": "application/json"} if payload else {}
        conn.request(method, path, body=payload, headers=headers)
        resp = conn.getresponse()
        text = resp.read().decode("utf-8", errors="replace")
        return resp.status, text
    except Exception as exc:
        log.warning("admin %s %s failed: %s", method, path, exc)
        return 0, str(exc)
    finally:
        conn.close()


# -------- GUID discovery -------------------------------------------------------

_LIST_DEPLOY_FILE_RE = re.compile(r"^05-list-deployments-(?P<slug>[^/]+?)\.json$")


def discover_guid_map() -> dict[str, str]:
    """Read /app/static-base/05-list-deployments-*.json files; return slug->Guid.

    Files without a top-level `Guid` field are skipped (qa-engineer pins those
    in parallel). Logged once at startup at INFO.
    """
    out: dict[str, str] = {}
    if not STATIC_BASE_DIR.is_dir():
        log.warning("static-base dir missing: %s", STATIC_BASE_DIR)
        return out
    for f in sorted(STATIC_BASE_DIR.iterdir()):
        m = _LIST_DEPLOY_FILE_RE.match(f.name)
        if not m:
            continue
        slug = m.group("slug")
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except Exception as exc:
            log.warning("parse static-base %s: %s", f.name, exc)
            continue
        guid = doc.get("Guid")
        if not isinstance(guid, str) or not guid:
            log.info("static-base %s: no `Guid` pinned -- service skipped at tick-time", f.name)
            continue
        out[slug] = guid
    log.info("guid-map discovered: %d services -> %s", len(out), sorted(out.keys()))
    return out


# -------- ID rewriter ----------------------------------------------------------

# WireMock.Net mapping JSON has two shapes the driver must rewrite under:
#   - Response.BodyAsJson is the literal response body the mock returns. For
#     list-deployments + status / runs etc. this is a JSON array of objects
#     with numeric `id` / `run_id` fields.
#   - Some authoring conventions wrap one more layer (BodyAsJson.Response.
#     BodyAsJson); we walk both to be tolerant of bundle-author choice.
#
# Numeric id rewrite: effective = authored + cycle_index * ID_STRIDE. Only
# fields named exactly `id` or `run_id` whose value is an int are rewritten.
# `sha` (string) + `created_at` (timestamp) are NOT touched -- they're
# authored verbatim by qa and intentional.

_ID_FIELDS = ("id", "run_id")


def _walk_and_rewrite(node: Any, offset: int) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if k in _ID_FIELDS and isinstance(v, int) and not isinstance(v, bool):
                node[k] = v + offset
            else:
                _walk_and_rewrite(v, offset)
    elif isinstance(node, list):
        for item in node:
            _walk_and_rewrite(item, offset)


def rewrite_ids_in_mapping(mapping: dict, offset: int) -> None:
    """Rewrite numeric id/run_id fields under the response body. Mutates in place.

    Walks Response.BodyAsJson regardless of nesting depth -- handles both
    `mapping.Response.BodyAsJson` (the WireMock.Net default authoring shape)
    and `mapping.BodyAsJson.Response.BodyAsJson` (alternate wrapper). Mapping
    `Guid` is NEVER rewritten (it identifies the mapping itself).
    """
    response = mapping.get("Response")
    if isinstance(response, dict):
        body = response.get("BodyAsJson")
        if body is not None:
            _walk_and_rewrite(body, offset)
    nested = mapping.get("BodyAsJson")
    if isinstance(nested, dict):
        inner = nested.get("Response")
        if isinstance(inner, dict):
            body2 = inner.get("BodyAsJson")
            if body2 is not None:
                _walk_and_rewrite(body2, offset)


# -------- Tick application -----------------------------------------------------

_LIST_DEPLOY_TICK_RE = re.compile(r"^list-deployments-(?P<slug>[^/]+?)\.json$")
_STATUS_TICK_RE = re.compile(r"^status-")

# Trips once per process when the PUT-then-fallback path activates so we
# don't spam the log on every tick. Per-service so each service's first
# fallback is noted once.
_put_fallback_announced: set[str] = set()


def _apply_list_deployments(tick_file: pathlib.Path, slug: str, offset: int, guid_map: dict[str, str]) -> None:
    pinned = guid_map.get(slug)
    if not pinned:
        log.info("tick %s: no pinned Guid for service %s; skipping", tick_file.name, slug)
        return
    try:
        body = json.loads(tick_file.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("parse tick %s: %s", tick_file.name, exc)
        return
    rewrite_ids_in_mapping(body, offset)
    # Preserve the pinned Guid in the PUT body so admin keeps mapping identity.
    body["Guid"] = pinned
    status, text = _admin_request("PUT", f"/__admin/mappings/{pinned}", body)
    if 200 <= status < 300:
        return
    # 4xx fallback path -- DELETE then POST (full body), once-per-service notice.
    if 400 <= status < 500:
        if slug not in _put_fallback_announced:
            log.info("PUT /__admin/mappings/%s returned %d for service %s; using DELETE+POST fallback", pinned, status, slug)
            _put_fallback_announced.add(slug)
        del_status, _ = _admin_request("DELETE", f"/__admin/mappings/{pinned}", None)
        if not (200 <= del_status < 300 or del_status == 404):
            log.warning("DELETE fallback for %s -> status %d", pinned, del_status)
        post_status, post_text = _admin_request("POST", "/__admin/mappings", body)
        if not (200 <= post_status < 300):
            log.warning("POST fallback for %s -> status %d body=%s", pinned, post_status, post_text[:200])
        return
    log.warning("PUT /__admin/mappings/%s -> status %d body=%s", pinned, status, text[:200])


def _apply_status(tick_file: pathlib.Path, offset: int) -> None:
    try:
        body = json.loads(tick_file.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("parse tick %s: %s", tick_file.name, exc)
        return
    rewrite_ids_in_mapping(body, offset)
    status, text = _admin_request("POST", "/__admin/mappings", body)
    if not (200 <= status < 300):
        log.warning("POST /__admin/mappings (status tick %s) -> status %d body=%s", tick_file.name, status, text[:200])


def apply_tick(tick_dir: pathlib.Path, offset: int, guid_map: dict[str, str]) -> None:
    log.info("applying tick %s (id-offset=%d)", tick_dir.name, offset)
    for f in sorted(tick_dir.iterdir()):
        if not f.is_file() or not f.name.endswith(".json"):
            continue
        m_list = _LIST_DEPLOY_TICK_RE.match(f.name)
        if m_list:
            _apply_list_deployments(f, m_list.group("slug"), offset, guid_map)
            continue
        if _STATUS_TICK_RE.match(f.name):
            _apply_status(f, offset)
            continue
        log.info("tick %s: unrecognised filename %s; skipping", tick_dir.name, f.name)


# -------- Cycle-index anchor ---------------------------------------------------


def cycle_index_for(now: float, total_cycles: int) -> int:
    """Returns the current cycle index since BUILD_EPOCH (mod total_cycles).

    cycle_length = total_cycles * PERIOD_SECONDS. With BUILD_EPOCH=0 we fall
    back to PROCESS_START_EPOCH so the index is still monotone within the
    process lifetime (may reset across restarts; documented in Dockerfile).
    """
    if total_cycles <= 0:
        return 0
    anchor = BUILD_EPOCH if BUILD_EPOCH > 0 else _PROCESS_START_EPOCH
    elapsed = max(0.0, now - anchor)
    return int(elapsed // (total_cycles * PERIOD_SECONDS))


_PROCESS_START_EPOCH = int(time.time())


# -------- Main loop ------------------------------------------------------------


def _sleep_interruptible(seconds: int) -> None:
    end = time.time() + seconds
    while not _shutdown and time.time() < end:
        time.sleep(min(1.0, end - time.time()))


def main() -> int:
    log.info(
        "demo-driver starting -- url=%s period=%ds id-stride=%d build-epoch=%d",
        GHA_URL, PERIOD_SECONDS, ID_STRIDE, BUILD_EPOCH,
    )
    guid_map = discover_guid_map()

    if not TICKS_DIR.is_dir():
        log.error("ticks dir missing: %s; exiting", TICKS_DIR)
        return 1
    tick_dirs = sorted([p for p in TICKS_DIR.iterdir() if p.is_dir()])
    if not tick_dirs:
        log.error("no tick subdirectories in %s; exiting", TICKS_DIR)
        return 1
    log.info("discovered %d tick(s): %s", len(tick_dirs), [d.name for d in tick_dirs])

    total = len(tick_dirs)
    step = 0
    while not _shutdown:
        cycle = cycle_index_for(time.time(), total)
        tick_dir = tick_dirs[step % total]
        offset = cycle * ID_STRIDE
        try:
            apply_tick(tick_dir, offset, guid_map)
        except Exception as exc:  # never crash the loop
            log.error("tick %s raised %s; continuing", tick_dir.name, exc)
        step += 1
        if _shutdown:
            break
        _sleep_interruptible(PERIOD_SECONDS)

    log.info("demo-driver exiting (graceful)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
