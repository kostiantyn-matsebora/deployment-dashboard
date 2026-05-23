#!/usr/bin/env python3
# demo-driver sidecar -- periodic JVM WireMock admin-API ticker (issue #46).
#
# Owner: devops-engineer.
#
# Lifecycle:
#   1. Walk /app/ticks/<NNN>-<slug>/ subdirectories in sorted order, indefinitely.
#      Per tick: for each JSON file in the subdir, identify intent by filename
#      prefix, rewrite numeric `id` / `run_id` fields under response.jsonBody
#      using cycle-anchored monotone stride, and PUT (list-deployments) or
#      POST (status) the body to demo-gha's admin API.
#   2. Sleep DEMO_DRIVER_PERIOD_SECONDS between ticks; SIGTERM aborts the
#      sleep but lets the current tick's IO finish (graceful <=10s).
#
# list-deployments tick files carry their own `id` field; the driver PUTs
# directly to /__admin/mappings/{id} each tick -- no startup GUID discovery.
# status tick files have no `id`; JVM WireMock assigns one on POST. The
# driver DELETEs the previous tick's status mappings before each new tick
# so the live-mapping count stays bounded.
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


# -------- ID rewriter ----------------------------------------------------------

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
    """Rewrite numeric id/run_id fields under response.jsonBody. Mutates in place."""
    response = mapping.get("response")
    if isinstance(response, dict):
        body = response.get("jsonBody")
        if body is not None:
            _walk_and_rewrite(body, offset)


# -------- Tick application -----------------------------------------------------

_LIST_DEPLOY_TICK_RE = re.compile(r"^list-deployments-")
_STATUS_TICK_RE = re.compile(r"^status-")

_prev_status_guids: set[str] = set()


def _apply_list_deployments(tick_file: pathlib.Path, offset: int) -> None:
    """PUT a list-deployments mapping using the `id` field baked into the file."""
    try:
        body = json.loads(tick_file.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("parse tick %s: %s", tick_file.name, exc)
        return
    rewrite_ids_in_mapping(body, offset)
    mapping_id = body.get("id")
    if not isinstance(mapping_id, str) or not mapping_id:
        log.warning("tick %s: no `id` field in mapping body; skipping", tick_file.name)
        return
    status, text = _admin_request("PUT", f"/__admin/mappings/{mapping_id}", body)
    if not (200 <= status < 300):
        log.warning("PUT /__admin/mappings/%s (tick %s) -> status %d body=%s", mapping_id, tick_file.name, status, text[:200])


def _apply_status(tick_file: pathlib.Path, offset: int) -> str | None:
    """POST a status mapping; return the JVM WireMock-assigned id (or None on failure)."""
    try:
        body = json.loads(tick_file.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("parse tick %s: %s", tick_file.name, exc)
        return None
    rewrite_ids_in_mapping(body, offset)
    http_status, text = _admin_request("POST", "/__admin/mappings", body)
    if not (200 <= http_status < 300):
        log.warning("POST /__admin/mappings (status tick %s) -> status %d body=%s", tick_file.name, http_status, text[:200])
        return None
    try:
        assigned_id = json.loads(text).get("id")
        if isinstance(assigned_id, str) and assigned_id:
            return assigned_id
    except Exception:
        pass
    log.warning("POST /__admin/mappings (status tick %s) succeeded but id missing in response; mapping will not be pruned", tick_file.name)
    return None


def _delete_prev_status_guids() -> None:
    """DELETE all status mappings posted in the previous tick (idempotent)."""
    global _prev_status_guids
    for guid in _prev_status_guids:
        del_status, _ = _admin_request("DELETE", f"/__admin/mappings/{guid}", None)
        if not (200 <= del_status < 300 or del_status == 404):
            log.warning("DELETE prior status mapping %s -> status %d", guid, del_status)
    _prev_status_guids = set()


def apply_tick(tick_dir: pathlib.Path, offset: int) -> None:
    global _prev_status_guids
    log.info("applying tick %s (id-offset=%d)", tick_dir.name, offset)
    _delete_prev_status_guids()
    new_status_guids: set[str] = set()
    for f in sorted(tick_dir.iterdir()):
        if not f.is_file() or not f.name.endswith(".json"):
            continue
        if _LIST_DEPLOY_TICK_RE.match(f.name):
            _apply_list_deployments(f, offset)
            continue
        if _STATUS_TICK_RE.match(f.name):
            guid = _apply_status(f, offset)
            if guid:
                new_status_guids.add(guid)
            continue
        log.info("tick %s: unrecognised filename %s; skipping", tick_dir.name, f.name)
    _prev_status_guids = new_status_guids


# -------- Cycle-index anchor ---------------------------------------------------


def cycle_index_for(now: float, total_cycles: int) -> int:
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
            apply_tick(tick_dir, offset)
        except Exception as exc:
            log.error("tick %s raised %s; continuing", tick_dir.name, exc)
        step += 1
        if _shutdown:
            break
        _sleep_interruptible(PERIOD_SECONDS)

    log.info("demo-driver exiting (graceful)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
