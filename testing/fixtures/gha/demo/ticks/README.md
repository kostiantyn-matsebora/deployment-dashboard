# Demo-driver tick corpus

Per-tick mapping bundles applied by the demo-driver sidecar
([#46](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/46))
to advance the demo bundle through time without WireMock.Net Scenarios.
Sidecar wakes on 15 s, picks next subdir in lex order, applies via Admin API.

## Per-tick contract

```
<NNN>-<slug>/
├── list-deployments-<service>.json   # 1–2 per tick (one per touched service)
└── status-<dep-id>.json              # 0–N (one per new deployment id)
```

`<NNN>` is zero-padded (`000..009`); `<slug>` is opaque.

### `list-deployments-<service>.json` — cumulative body rule

Full WireMock.Net mapping; sidecar PUTs to
`PUT /__admin/mappings/{pinned-guid}` (in-place replace). `Guid` field
MUST equal the static-base pinned GUID (see § Pinned-GUID dependency).

> `BodyAsJson` = static-base entries + ALL prior-tick additions for
> this service + this-tick additions. PUT replaces whole — no merge.

### `status-<dep-id>.json`

Mirrors `../mappings/statuses/NNN-status-<dep-id>.json`. Sidecar POSTs
to `POST /__admin/mappings` (WireMock.Net assigns GUID).

## ID range — authored only

Each tick reserves 10 ids; window `tick-N → 11000 + 10·N..11000 + 10·N+9`.
Files contain **authored** ids only — sidecar applies
`effective_id = authored_id + (cycle_index × ID_STRIDE)` at apply-time.
**Do NOT pre-bake `cycle_index × ID_STRIDE` here.**

## Status mix — target 30 % `in_progress` / 55 % `success` / 15 % `failure`

Authored across the 30-dep cycle: 9 / 16 / 5. URL convention mirrors
`../mappings/statuses/`: `/job/<run_id*10>` → needs-recovery walk;
omit → per-env predecessor fallback.

## Pinned-GUID dependency

`Guid` on each list-deployments file equals the pinned GUID on
`../mappings/05-list-deployments-<service>.json`. Pinning lives in the
static-base file — **MUST NOT rotate.** Sidecar reads + caches the
service → GUID map at startup.

See [`../README.md`](../README.md) · [ADR-0004](../../../../docs/adr/ADR-0004-opaque-per-progress-reporter-cursor.md).
