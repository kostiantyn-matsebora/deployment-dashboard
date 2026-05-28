# Design Tokens

All colors are CSS custom properties on `:root`, scoped by `[data-theme]` attribute. Three modes: `dark` (default), `light`, `auto` (follows OS `prefers-color-scheme`). Colors are **never decorative** — the status palette is fixed semantic.

## Backgrounds & Washes

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--bg-0` | `#0b0d14` | `#f6f4f0` | Page background |
| `--bg-1` | `#0e1119` | `#efece6` | Linear gradient terminus |
| `--indigo-wash` | `rgba(98,92,220, 0.22)` | `rgba(98,92,220, 0.07)` | Top-left radial accent |
| `--teal-wash` | `rgba(36,200,196, 0.16)` | `rgba(36,160,156, 0.06)` | Bottom-right radial accent |

## Glass Surfaces

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--glass` | `rgba(22,26,38, 0.55)` | `rgba(255,255,255, 0.55)` | Primary surface fill (topbar, matrix shell, filter bar) |
| `--glass-strong` | `rgba(28,33,48, 0.70)` | `rgba(255,255,255, 0.72)` | Sticky service-column background |
| `--glass-edge` | `rgba(255,255,255, 0.06)` | `rgba(20,24,40, 0.08)` | Subtle border (default) |
| `--glass-edge-2` | `rgba(255,255,255, 0.10)` | `rgba(20,24,40, 0.14)` | Stronger border (hover / inset highlight) |

## Ink (Text)

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--ink-0` | `#e9ecf4` | `#1a1c28` | Primary text, version, service names |
| `--ink-1` | `#b8bdcc` | `#3a3f55` | Secondary text, field values (sha, actor, run_number) |
| `--ink-2` | `#7c829a` | `#6a7088` | Tertiary text, labels, glyph prefixes |
| `--ink-3` | `#555b73` | `#99a0b3` | Muted text, empty-mark dash, subtle glyphs |

## Status Palette

Each status has 5 tokens: primary, deep, wash (bg fill), glow (box-shadow), edge (border).

### Success (emerald)

| Token | Dark | Light | Role |
|-------|------|-------|------|
| `--emerald` | `#34d29a` | `#1ea676` | Primary green |
| `--emerald-deep` | `#1e8e66` | `#14704f` | Dark variant |
| `--emerald-wash` | `rgba(52,210,154, 0.18)` | `rgba(30,166,118, 0.13)` | Tile background gradient |
| `--emerald-glow` | `rgba(52,210,154, 0.35)` | `rgba(30,166,118, 0.28)` | Box-shadow glow |
| `--emerald-edge` | `rgba(52,210,154, 0.55)` | `rgba(30,166,118, 0.50)` | Border color |

### Running (amber)

| Token | Dark | Light | Role |
|-------|------|-------|------|
| `--amber` | `#f5a524` | `#b97400` | Primary orange |
| `--amber-deep` | `#b67100` | `#815100` | Dark variant |
| `--amber-wash` | `rgba(245,165,36, 0.20)` | `rgba(245,165,36, 0.16)` | Tile background gradient |
| `--amber-glow` | `rgba(245,165,36, 0.40)` | `rgba(245,165,36, 0.30)` | Box-shadow glow + breathe animation |
| `--amber-edge` | `rgba(245,165,36, 0.65)` | `rgba(245,165,36, 0.55)` | Border color |

### Failed (coral)

| Token | Dark | Light | Role |
|-------|------|-------|------|
| `--coral` | `#ff5d5d` | `#c83c3c` | Primary red |
| `--coral-deep` | `#b62a2a` | `#872626` | Dark variant |
| `--coral-wash` | `rgba(255,93,93, 0.20)` | `rgba(255,93,93, 0.13)` | Tile background gradient |
| `--coral-glow` | `rgba(255,93,93, 0.38)` | `rgba(255,93,93, 0.25)` | Box-shadow glow |
| `--coral-edge` | `rgba(255,93,93, 0.60)` | `rgba(255,93,93, 0.50)` | Border color |

## Structural Surfaces

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--slot-bg` | `rgba(20,24,36, 0.55)` | `rgba(255,255,255, 0.55)` | Matrix tile default background |
| `--slot-empty-bg` | `rgba(20,24,36, 0.30)` | `rgba(255,255,255, 0.30)` | Empty slot |
| `--vis-card-bg` | `rgba(20,24,36, 0.65)` | `rgba(255,255,255, 0.70)` | Swimlane node card |
| `--tabs-bg` | `rgba(10,12,20, 0.55)` | `rgba(255,255,255, 0.55)` | Segmented tab strip background |
| `--kpi-bg` | `rgba(10,12,20, 0.45)` | `rgba(255,255,255, 0.55)` | KPI card background |
| `--input-bg` | `rgba(10,12,20, 0.55)` | `rgba(255,255,255, 0.60)` | Inputs, icon buttons, theme switch |
| `--popover-bg` | `rgba(18,22,34, 0.78)` | `rgba(255,255,255, 0.82)` | Popover surface (fields picker, correlation) |
| `--drawer-bg` | `rgba(14,17,26, 0.85)` | `rgba(252,250,246, 0.85)` | Side drawer panel |
| `--drawer-overlay` | `rgba(6,8,14, 0.55)` | `rgba(60,50,80, 0.32)` | Drawer backdrop scrim |
| `--divider-dash` | `rgba(255,255,255, 0.18)` | `rgba(20,24,40, 0.20)` | Split-tile dashed divider |
| `--grid-line` | `rgba(255,255,255, 0.045)` | `rgba(20,24,40, 0.05)` | Background hairline grid |
| `--accent-rgb` | `120, 110, 255` | `98, 92, 220` | Indigo accent — use with `rgba(var(--accent-rgb), α)` |

## Typography

Two-family system: **Inter** for UI text, **JetBrains Mono** for data identifiers. Version and environment identifiers share the same font-size across views (11px).

| Context | Family | Size | Weight | Class / Token |
|---------|--------|------|--------|---------------|
| Version headline (Matrix) | JetBrains Mono | 11px | 600 | `.ver` |
| Environment headline (Swimlane) | Inter | 11px | 600 | `.vc-env` |
| Version secondary (Swimlane) | JetBrains Mono | 10.5px | 500 | `.vc-ver` |
| Field values (sha, actor, ref, etc.) | JetBrains Mono | 10.5px (tiles) / 9.5px (nodes) | 400 | `.fld-*` |
| Elapsed time | JetBrains Mono | 10px (tiles) / 9px (nodes) | 400 | `.fld-time` |
| KPI value | JetBrains Mono | 18px | 600 | `.kpi-value` |
| KPI label | Inter | 10.5px | 400 | `.kpi-label` — uppercase, 0.7px tracking |
| Service name (row header) | JetBrains Mono | 12.5px | — | `.row-head` |
| Environment tag (column header) | JetBrains Mono | 11px | — | `.env-tag` — lowercase |
| Brand name | Inter | 14.5px | 600 | `.brand-name` |
| Section labels / popover titles | Inter | 11px | 600 | Uppercase, 0.7px tracking |
| Tab label | Inter | 13px | 500 | `.tab` |
| Filter input value | JetBrains Mono | 12px | 400 | `.hdr-filter-input` |
| Drawer history entry | JetBrains Mono | 12.5px | 400–600 | `.hist-entry` |
| Inspector key/value | JetBrains Mono | 12px | 400–500 | `.insp-grid .k` / `.v` |

## Geometry

### Border Radii

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-lg` | 16px | Topbar, matrix shell, vis shell, drawer |
| `--radius-md` | 12px | Matrix tiles, vis-cards, popovers, filter bar |
| `--radius-sm` | 8px | Inputs, field toggles, code tags |
| 999px (pill) | — | Tabs, toggle pills, live indicator, theme switch |

### Backdrop Effects

Every glass surface applies `backdrop-filter: blur(Npx) saturate(M%)` plus a `-webkit-` prefix.

| Surface | Blur | Saturate |
|---------|------|----------|
| Topbar, vis-side, drawer | 18px | 135% |
| Matrix shell, vis-canvas, tiles | 14–20px | 130–140% |
| Popovers | 20px | 140% |

### Key Shadows

```css
/* Topbar / matrix-shell */
box-shadow:
  0 1px 0 var(--glass-edge-2) inset,           /* top-edge highlight */
  0 24px 64px -28px rgba(0,0,0,0.55);          /* drop shadow */

/* Status tiles — success example */
box-shadow:
  0 1px 0 var(--glass-edge-2) inset,
  0 0 0 1px rgba(52,210,154,0.10),             /* faint ring */
  0 12px 32px -16px var(--emerald-glow);        /* colored glow */

/* Running tiles — breathe animation (3.6s ease-in-out infinite) */
/* Alternates glow intensity between 28px and 40px spread */
```

### Background Canvas

Body has two layers behind content via `::before` / `::after` pseudo-elements:

1. **Radial washes:** indigo top-left (900×700 at 8%,−10%), teal bottom-right (1100×800 at 110%,110%), plus vertical gradient `--bg-0` → `--bg-1`.
2. **Hairline grid:** 56×56px lines at `--grid-line` opacity, masked to a soft center ellipse (80%×60%).
