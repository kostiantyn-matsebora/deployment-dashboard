# UI theme — design note

The canonical mockup `./deployment-dashboard.html` is the single source of truth for the dashboard's visual + interactive contract. **Theme** ships as a **third orthogonal axis** alongside the existing View and Layout switchers: a header control with three values — `light / dark / auto`. The chosen design is the **Dim** palette (warm GitHub-style `#0d1117` body / `#161b22` cards), selected from three competing options (Slate / OLED / Dim), wired as the `dark` enum value behind a **gear icon + popover** affordance. The three earlier per-option HTML files (`deployment-dashboard-theme-slate.html`, `deployment-dashboard-theme-oled.html`, `deployment-dashboard-theme-dim.html`) have been merged into the canonical and deleted.

## Three orthogonal axes

| Axis | Control | Effect | Status |
|---|---|---|---|
| **View** | header segmented control | per-box density + which attributes appear | existing |
| **Layout** | header segmented control | overall arrangement of services and envs | existing |
| **Theme** | header gear icon → popover (Light / Dark / Auto) | colour palette only — no semantic change | **new — this cycle** |

Every (view × layout × theme) combination renders correctly. Theme controls **palette only**; it never controls layout, density, attribute selection, or the 6-box-state semantics.

## The chosen design — Dim, gear popover

| Aspect | Choice |
|---|---|
| Dark surface | `#0d1117` body / `#161b22` cards / `#30363d` borders (warm-tinted, GitHub-style) |
| Accent saturation | medium — status hues pushed to the ~300-band on dark surfaces |
| Switcher affordance | gear icon → popover with `Light / Dark / Auto` radios |
| Header footprint | smallest of the three options (~32 px) — frees header width for future axes |
| Default | `auto` (follows OS-reported `prefers-color-scheme`) |

## Persistence

Theme uses `dashboard.theme` ∈ `{light, dark, auto}`, default `'auto'`. The requirement is recorded in [CR-0006](../cr/CR-0006-light-dark-auto-theme.md); the persistence + FOIT-safe bootstrap architecture is recorded in [ADR-0003](../adr/ADR-0003-theme-persistence-and-foit-safe-bootstrap.md).

This-cycle extension: the effective theme on first paint is computed synchronously **before** Alpine.js initialises to avoid a flash of incorrect theme (FOIT). See "Auto resolution" below.

## Auto resolution

`auto` resolves at runtime in two stages:

1. **Initial paint** — an inline `<script>` block at the top of `<head>` (BEFORE the Tailwind CDN + Alpine.js script tags) reads `window.matchMedia('(prefers-color-scheme: dark)').matches` synchronously and sets `data-theme="dark"` (or `light`) on `<html>` immediately. No flash.
2. **Live OS-level changes** — the Alpine component registers a `change` listener on the `MediaQueryList` returned by `matchMedia('(prefers-color-scheme: dark)')`. When the OS theme flips and the user's stored preference is `'auto'`, it recomputes the effective theme and updates `data-theme` on `<html>`. No reload required.

The user's choice of `light` or `dark` overrides the OS preference; only `auto` listens.

## 6-box-state contract — palette mapping

The 6 box states (status colour, ⚠ prev-failed badge, dashed-divider last-successful split) render in **every theme**. The theme only changes the palette; box-state semantics are invariant. All four status hues remain perceptually distinct in the dark palette and reach ~4.5:1 contrast (WCAG AA) on text against the dark surface.

### Status colours — Light (canonical) vs. Dark (Dim)

| State | Light (canonical, unchanged) | Dark (Dim) |
|---|---|---|
| Success | bg `green-100` / border `green-200` / text `green-700` | bg `#0d2818` / border `#166534` / text `#86efac` |
| Failed | bg `red-100` / border `red-200` / text `red-700` | bg `#2a0e0e` / border `#991b1b` / text `#fca5a5` |
| Running (in-progress) | bg `orange-100` / border `orange-400` / text `orange-700` + pulse | bg `#2a1a0a` / border `#c2410c` / text `#fdba74` + pulse |
| ⚠ prev. failed badge | bg `amber-50` / border `amber-200` / text `amber-700` | bg `#2a1f0a` / border `#92400e` / text `#fcd34d` |
| Last-successful split | dashed-divider `gray-200` | dashed-divider `#484f58` |

### Surfaces — Light vs. Dark (Dim)

| Element | Light (canonical) | Dark (Dim) |
|---|---|---|
| Page body | `bg-gray-50` | `#0d1117` |
| Header / card | `bg-white` | `#161b22` |
| Secondary surface (stats, focus row expanded) | `bg-gray-50` | `#1c232b` |
| Default border | `border-gray-200` | `#30363d` |
| Strong border | `border-gray-300` | `#484f58` |
| Primary text | `text-gray-900` / `text-gray-800` | `#e6edf3` |
| Secondary text | `text-gray-700` / `text-gray-600` | `#c9d1d9` |
| Muted text | `text-gray-400` | `#7d8590` |
| Hover ring (highlighted version) | `ring-amber-400` | `ring-amber-400` (unchanged) |

## Implementation — CSS-only overlay

The dark palette is a CSS-only overlay: a single `[data-theme="dark"]` block in `<style>` remaps each Tailwind utility class (`bg-white`, `text-gray-900`, `bg-green-100`, …) to its Dim equivalent. NO leaf renderer DOM changes; NO Tailwind class string rewrites; NO geometric invariant (NFR-09) is touched. The only JS state added to the Alpine component is the `themePref / effectiveTheme / osDark / themePopoverOpen` quartet plus a single `MediaQueryList` listener registered in `bootstrapPersistence`.

## Switcher affordance — gear icon + popover

| Aspect | Choice |
|---|---|
| Affordance | settings-gear icon → click opens a popover with `Light / Dark / Auto` radios |
| Header footprint | ~32 px — smallest of the three considered designs |
| Current state at rest | hidden inside the popover; the gear has `title="Theme: {pref} · effective {eff}"` for hover-disclosure |
| Live indicators in popover | "Effective: {dark|light} · OS: {dark|light}" footer line that updates when the OS flips |

## Decision rationale

| Tradeoff | Decision |
|---|---|
| Pure-black (OLED) vs. soft-slate vs. warm-Dim dark surface | **Dim** — warmer than Slate and softer than OLED; matches the canonical's visual rhythm without being aggressive on the eye. |
| Switcher visibility at rest | Hidden behind a gear (one-extra-click cost) — chosen to **free header width** for future axes; the three values are easily disambiguated once the popover opens. |
| Header width budget | ~32 px (gear) leaves the most room for future fourth axes (e.g. density, time-window) vs. ~96 px (icon trio) or ~180 px (segmented control). |
| `prefers-contrast: more` integration | **Deferred** — out of scope this cycle. Flag for a follow-up if the Dim palette feels under-contrasty in practice. |

## Box-state contract — always on

The 6 box states (status colour, ⚠ prev-failed badge, dashed-divider last-successful split) render in **every view AND every layout AND every theme**. Theme is purely a palette swap. The attribute picker, View switcher, Layout switcher, drawer, filters, stats bar, and hover-highlight ring all continue to function unchanged under each theme.

## FR / NFR pointers

Theme is palette-only — no data shape, no behavioural change. Every FR/NFR is preserved or unaffected:

- **Unchanged behaviour** in every theme: FR-03 (6 box states render — status colour + badge + split), FR-04 (history drawer themed identically), FR-07 (filters), FR-08 (live updates — palette swap does not touch event flow), FR-12 (four views remain orthogonal to theme).
- **Unaffected.** NFR-03 (live update ≤ 5 s), NFR-05 (stateless backend; preference is per-browser `localStorage`), NFR-08 (no build step; `data-theme` drives palette via CSS only), NFR-09 (UX-RESPONSIVENESS — geometric invariants are independent of palette).

## Status

This document is a design note, not a contract. The canonical mockup is the contract. No SAD change required — colour palette is not part of the data contract; the SAD's "Visual layout" subsection cites the canonical mockup, which now carries the Theme axis.

## Deferred / open

| Item | Decision |
|---|---|
| `prefers-contrast: more` (high-contrast palette as a fourth value) | Deferred — would expand the enum to four values; revisit if any user reports the Dim palette feels under-contrasty. |
| Codifying the theme contract in the SAD as an NFR | Deferred — palette is below the SAD's contract surface today (visual concern only, no data shape). Reconsider when the third visual axis becomes a recurring spec target. |
