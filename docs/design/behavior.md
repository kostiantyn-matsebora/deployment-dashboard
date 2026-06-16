# Behavior

## Field Rendering System

Fields use **mixed visual treatment** — position, glyph prefix, and typography identify each field. No uniform label/value rows on tiles/nodes.

### Position Contract (Matrix Tiles)

| Field | Position | Treatment | Class |
|-------|----------|-----------|-------|
| `version` | Headline row, left | JetBrains Mono 11px 600, `--ink-0` | `.ver` |
| `actor` | Headline row, right | @ prefix, mono 10.5px, `--ink-1` | `.fld-actor` |
| `happened_at` | Headline row, far right | Elapsed ("3h ago"), mono 10px, `--ink-2` | `.fld-time` |
| `ref` | Mid-row left cluster | ⎇ prefix, mono 10.5px, `--ink-1` | `.fld-ref` |
| `sha` | Mid-row left cluster | Plain mono hex, 10.5px, `--ink-1` | `.fld-sha` |
| `run_url` | Mid-row right cluster | ↗ "run" dashed link, indigo (#a8a0ff) | `.fld-runurl` |
| `run_number` | Mid-row right cluster | # prefix, mono 10.5px | `.fld-runno` |
| `parrent_deployments` | Full-width tail row | ⟵ N parents, mono 10px, `--ink-2` | `.fld-parents` |
| Next badge (`nextStatus`) | `.ctx-row` below attrs | `.ctx-badge`: icon + status word + version; hue from next status. Present only when a `next` deployment exists. Never drives tile colour. | `.ctx-row` / `.ctx-badge` |
| Never-deployed chip | Replaces primary icon in headline | Status chip in context-status hue; tile surface is neutral (`s-never-deployed`). Present only when slot has no prior effective deployment. | `.status-chip` |

### Position Contract (Swimlane Nodes)

| Field | Grid Position | Treatment |
|-------|---------------|-----------|
| `version` | Top row, col 1 (left) | Mono 10.5px 500, `--ink-2` (demoted) |
| `happened_at` | Top row, col 2 (right) | Mono 9px, `--ink-2`, `margin-left: auto` |
| `ref` | Body col 1, row 1 | ⎇ prefix, 9.5px |
| `sha` | Bottom-left (env row, col 1) | Plain mono hex, 9.5px |
| `run_url` + `run_number` + `actor` | Body col 2 (right cluster) | Same glyphs as Matrix, 9.5px |
| `environment` | Bottom-right (env row, col 2) | Inter 11px 600, `--ink-0`, lowercase (PROMOTED) |
| Next badge (`nextStatus`) | `.ctx-row` below body | `.ctx-badge`: icon + status word + version; hue from next status. Present only when a `next` deployment exists. Never drives card colour. |
| Never-deployed chip | Replaces primary icon in top row | Status chip in context-status hue; card surface is neutral (`s-never-deployed`). Present only when node has no prior effective deployment. |

### Details Surfaces (Drawer & Inspector)

Use explicit **label/value** rows — every visible domain-model field rendered regardless of attribute-picker state. `happened_at` shows both elapsed and absolute UTC.

### Bottom-Section Fallback Chain (Split Tiles / Cards)

The split-bottom section shows a single identifier from the last-successful (`current`) deployment. Required on both matrix tiles and swimlane cards (S2–S4 states). The first non-empty field wins:

```
version → sha → ref → run_number
```

---

## Interactions

| Trigger | Target | Result |
|---------|--------|--------|
| Click tab | Segmented control | Switch Matrix ↔ Swimlanes view. Close popovers. Swap field picker content. Rebuild swimlane layout on switch-to-vis. |
| Type in filter input | Matrix rows | Hide rows whose component name doesn't include the query (case-insensitive substring). |
| Click failures toggle | Matrix rows | Toggle `.is-on`. When ON, hide rows with no failed states. |
| Hover `.ver` | All tiles | Amber-highlight all `.ver` spans and their parent `.slot`s that share the same version string. |
| Click Matrix tile | Drawer | Open history drawer for that (service, environment) slot. Overlay + slide-in animation. History shows all 8 statuses as distinct entries (pip in status hue); `next` deployment leads the list. |
| Click Swimlane node | Inspector | Select node (accent ring). Inspector shows effective deployment's fields first, dotted separator, then `next` group (if present). |
| Click chevron (›) | Swimlane lane | Toggle lane collapsed ↔ expanded. Collapsed shows vector (chain of real vis-cards ending at newest event). State persists to `localStorage`. |
| Click "Collapse/Expand all" | All swimlane lanes | Flip every lane simultaneously. Button label updates to reflect current state. |
| Click "Auto-scroll to change" toggle | Swimlane behavior | Toggle ON/OFF. When ON + lane off-screen: "Simulate event" scrolls lane into view after event fires — in both collapsed and expanded states. Persists to `localStorage`. |
| Click "Simulate event" | Lane tip card (any state) | Advance tip node's status, rebuild via the unified renderer, flash the tip card (`svFlash` animation) — collapsed = vector tip card, expanded = newest-event DAG node card. Scroll lane into view if auto-scroll ON and lane off-screen. |
| Click icon button | Popover | Toggle popover open/closed. Close any other open popover first. |
| Click field toggle | View content | Toggle field on/off in the active view. Tiles/nodes resize. Swimlanes recompute layout. |
| Click predicate radio | Correlation picker | Single-select. Disable time-window when "explicit parent" is selected. |
| Click theme option | `<html data-theme>` | Switch theme. Persist to `localStorage('theme')`. Rebuild swimlane SVG (baked colors). |
| Click outside popover | All popovers | Close all open popovers. |
| Escape key | Drawer / popovers | Close drawer and/or all popovers. |
| Click overlay / × button | Drawer | Close history drawer. |

---

## Theme System

### Implementation

1. **Pre-paint bootstrap:** inline `<script>` in `<head>` reads `localStorage.theme` and sets `data-theme` before any CSS evaluates — prevents flash of wrong theme.
2. **Token scoping:** dark tokens on `:root` / `:root[data-theme="dark"]`. Light tokens on `:root[data-theme="light"]`. Auto tokens inside `@media (prefers-color-scheme: light) { :root[data-theme="auto"] { ... } }`.
3. **Persistence:** `localStorage.setItem('theme', value)` on every switch. Default = `dark`.
4. **Rebuild:** theme switch invalidates swimlane SVG (status colors baked at build time) → `buildSwim()` must re-run.

---

## Extension Behavior

### Badge State Mapping

The toolbar badge reflects the highest-priority state across all watched deployments:

| Priority | Condition | Badge state |
|----------|-----------|-------------|
| 1 (highest) | ≥ 1 `failure` in watch scope | Coral + failure count |
| 2 | ≥ 1 `in-progress` in watch scope (no failures) | Amber + in-flight count |
| 3 | All watched deployments succeeded or no data | Idle (logo only, no overlay) |

- Count reflects the number of deployments in that state, not unique services.
- Watch scope = services × environments passing the current include/exclude filter.
- Badge clears immediately when Watching switch is turned OFF.

### Toast Click-to-Run

- Clicking anywhere on a notification toast navigates to `run_url` in a new browser tab.
- The "View run #NNN" inline link within the toast body navigates to the same `run_url`.
- Both paths open the CI/CD run directly — not the dashboard.

### Master Switch Gating

When the Watching switch is set to OFF:

1. SSE connection is closed (no `LISTEN/NOTIFY` consumption).
2. Toolbar badge is cleared to idle state.
3. No browser notifications are fired.
4. Filter controls (services, environments, mode) are visually dimmed and non-interactive.
5. State is persisted immediately to extension storage.

Turning the switch back ON re-opens the SSE connection and resumes all activity.

### Include/Exclude Watch Filter Semantics

The mode control determines how the service and environment checkbox selections are interpreted:

| Mode | Checked item behaviour | Unchecked item behaviour |
|------|----------------------|--------------------------|
| Watch all except (default) | Excluded from watch scope | Included in watch scope |
| Watch only | Included in watch scope | Excluded from watch scope |

An empty selection in "Watch only" mode results in an empty watch scope — no badge updates or notifications.

---

## Responsive Rules

- **Content-driven sizing:** tiles and node cards size to their currently visible content. Toggling fields off → elements shrink.
- **No truncation:** `version` (up to 50 chars) always renders fully, single-line. Columns/cards expand to fit.
- **Horizontal scroll:** both Matrix (`.matrix-shell`) and Swimlanes (`.vis-canvas`) scroll horizontally when content exceeds viewport.
- **Sticky service column:** `position: sticky; left: 0` on `.row-head`. Requires opaque background (`--glass-strong` + backdrop-filter).
- **No overlap:** deployment elements never overlap in either view. Swimlane per-rank column spacing = max card width in rank + fixed gap.
- **Tile vertical packing:** content distributes across available height with no large empty middle (`margin-top: auto` on attrs pushes them to bottom).
- **Swimlane recompute:** on every attribute toggle, lane heights, rank-column positions, and canvas size recompute via a measurement pass.
- **Dense packing:** swimlane lanes pack with minimal inter-lane (~8px) and inter-track (~8px) gaps.
- **Split-tile containment:** bottom content stays within cell bounds; never bleeds into adjacent rows.
