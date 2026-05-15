# Mockup Visual Harness

Mockup-only Playwright harness. Loads `docs/deployment-dashboard.html`
directly via `file://` in a real Chromium browser and asserts eight
invariants (six geometric + two picker-related) for each of the 12
(view × layout) combinations.

This harness exists because mental dry-runs about the mockup's visual
correctness have repeatedly failed. It is the **oracle** the team
develops against.

## Run

```
pwsh -NoProfile -File testing/mockup-visual/run-tests.ps1
```

Zero arguments. No `dev_env` stack required. No Read API / Write API /
Postgres. The harness loads the mockup HTML directly.

Optional flags:

| Flag      | Effect                                               |
|-----------|------------------------------------------------------|
| `-Filter` | Playwright `--grep` (e.g. `-Filter 'detailed'`)      |
| `-Headed` | Run with a visible browser window                    |

## What it tests

For each of `{detailed, compact, glance, focus} x {matrix, swim-lane, workflow-rows}`:

| Invariant | Assertion |
|-----------|-----------|
| I1 | No `.env-tag` rect intersects any `[data-testid^="stage-box-"]` rect — including its paired box (CSS Grid columns must not overlap). |
| I2 | Every `.env-tag` has `scrollWidth <= clientWidth + 1` (no horizontal clipping). |
| I3 | Every connector (`.arrow-line` + 6 px arrowhead, OR SVG `path.edge` terminus) lands within ±2 px of its target box's left edge. |
| I4 | Every connector starts within ±2 px of its source box's right edge — never in empty space. |
| I5 | No connector segment intersects any `.env-tag` rect. |
| I6 | Every text element inside a deployment box stays inside the box rect (±2 px for borders). |
| I7 | Display picker exposes exactly seven `<input type=checkbox>` elements (one per FR-02 attribute) and the counter denominator matches the SAD §7 cap for the view (Detailed 7, Compact 5, Glance 1, Focus 5). |
| I8 | After programmatically selecting `ref` then `sha` via the Alpine store, no stage box's text content contains the literal token `null` / `undefined` (SAD §7 "Null-render invariant for nullable attributes"). |

All knobs (combination matrix, viewport, tolerances, selectors) live in
`harness.config.json` — per CLAUDE.md "Configuration vs. data".

## Inspecting failures

| Output                                                | Use                                                                                              |
|-------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| `__screenshots__/<view>-<layout>.png`                 | Full-page deterministic screenshot for that combination. Open in any image viewer.               |
| `__screenshots__/_report.json`                        | Per-combination structured report — every violation has element rects and intersection amounts.  |
| `__screenshots__/_playwright-report.json`             | Raw Playwright JSON reporter output (backstop only — the harness's own report is richer).        |
| Console table (printed by `run-tests.ps1`)            | One row per combination: `view × layout    STATUS    first two violations`.                      |

The harness uses `expect.soft()` so every combination runs even when
earlier ones fail — you always get the full 12-row table in one run.

## What it does NOT test

- Live data from the Read / Write APIs (out of scope this round — see
  `testing/e2e/` for the running-stack E2E suite).
- Visual-similarity / pixel-diff snapshots (would produce false flags on
  first run; numeric geometric assertions are deterministic).
- Mockup interactive flows (drawer open, hover highlight, search filter)
  — those live in `testing/e2e/scenarios/` against the real SPA.
