# Libraries & Dependencies

## PrimeNG Unstyled Mode — Configuration

```typescript
// app.config.ts
import { providePrimeNG } from 'primeng/config';

export const appConfig = {
  providers: [
    providePrimeNG({
      unstyled: true,   // ← no default CSS emitted
    })
  ]
};
```

With `unstyled: true`, every PrimeNG component renders bare semantic markup. You attach the dashboard's glass styles via the `pt` (pass-through) prop on each component instance, or globally via a shared preset.

## Feature → PrimeNG Component Mapping

| Dashboard Feature | PrimeNG Component | Notes |
|-------------------|-------------------|-------|
| History drawer (slide-out panel) | `p-drawer` | 440px right-positioned. `[modal]="true"` for backdrop scrim. `[dismissible]="true"` + `[closeOnEscape]="true"`. Built-in focus trapping and slide animation. Apply glass tokens via `styleClass`. |
| Popover panels (fields picker, correlation) | `p-popover` | Anchored to icon buttons. `[dismissable]="true"` for click-outside. `appendTo="body"` escapes stacking contexts. Glass-styled content template. |
| Segmented tabs (Matrix / Swimlanes) | `p-selectButton` | 2 options, single-select, `[allowEmpty]="false"`. Pass-through classes for pill shape and accent gradient active state. |
| Toggle switch (failures-only) | `p-toggleSwitch` | Wrap in pill container for inline label. Pass-through for coral ON-state colors. |
| Field-picker checkboxes | `p-checkbox` | `[binary]="true"` per field. 2-column CSS grid layout. Pass-through for accent fill + glow. |
| Correlation radio picker | `p-radioButton` | Shared `ngModel` for single-select. 5 options. Disables time-window when "explicit parent" is chosen. |
| Filter text input | `pInputText` directive | Native `<input>` with PrimeNG directive. Styled with glass tokens. `debounceTime(200)` via RxJS. |
| Time-window select | `p-select` | 4 options. `[disabled]` bound to predicate signal. `appendTo="body"`. Glass-styled dropdown overlay. |
| Theme switcher (dark/light/auto) | `p-selectButton` | 3-state: ☀ / ☾ / Auto. Sets `[data-theme]` on `<html>`. Persists to `localStorage`. Pre-paint bootstrap script. |
| KPI strip | Custom component | Simple display — no PrimeNG component needed. 4 computed values, conditional `.is-warn` / `.is-bad` class. |
| SSE live indicator | Custom component | Simple display — pulse animation, reflects `EventSource.readyState`. |
| Matrix grid | Custom component + CSS Grid | `grid-template-columns: 180px repeat(N, minmax(140px, max-content))`. Sticky first column. Not tabular data — no data-grid library needed. |
| Matrix tile (6 box states) | Custom component | Status-driven template with conditional sections. Domain-specific. |
| Swimlane node card | Custom component (inside ngx-graph `#nodeTemplate`) | 2-column CSS grid inside `foreignObject`. Domain-specific rendering. |
| Inspector panel | Custom component | Static label/value grid. No PrimeNG component needed. |
| Analytics charts (8) | `ngx-echarts` (wraps `echarts`) | Frequency bars, CFR trend, duration histogram, funnel, status donut, heatmap, leaderboard, incidents list. ECharts option objects per chart; `NgxEchartsModule` provided once in app config. |

## Full Dependency Inventory

### External Packages (added to package.json)

| Package | Version | License | Role | Usage |
|---------|---------|---------|------|-------|
| `primeng` | ^4.x | MIT | UI component library (unstyled mode) | `p-drawer`, `p-popover`, `p-selectButton`, `p-toggleSwitch`, `p-select`, `p-checkbox`, `p-radioButton`, `pInputText`. Tree-shakes to only imported components. Configured with `unstyled: true`. |
| `@swimlane/ngx-graph` | ^9.x | MIT | Directed graph visualization | Swimlanes view — one `<ngx-graph>` instance per service lane. Dagre layout (`orientation: 'LR'`). Custom `#nodeTemplate`, `#linkTemplate`, `#defsTemplate`. Bundles its own D3 subset. |
| `lucide-angular` | ^0.x | ISC | Icon library | Mono-weight stroke icons for topbar controls (filter, fields, correlation, theme switch, close buttons). Tree-shakeable — import individual icons. |
| `date-fns` | ^4.x | MIT | Date/time formatting | `formatDistanceToNow()` for elapsed display ("3h ago") on tiles/nodes. `format()` for absolute UTC in drawer/inspector. Tree-shakeable. |
| `ngx-echarts` | ^21.0.0 | MIT | Apache ECharts wrapper for Angular | Analytics view — all 8 charts (frequency bars, CFR trend, duration histogram, funnel, status donut, heatmap, leaderboard, incidents list). Wraps `echarts` (peer dep). Chosen for Angular-21 compatibility (see note below). |
| `echarts` | ^5.x | Apache-2.0 | Apache ECharts core (peer dep of `ngx-echarts`) | Chart rendering engine. Tree-shakeable via `echarts/core` + per-chart imports. |

### Angular Built-in Modules

| Module | Import | Usage |
|--------|--------|-------|
| `@angular/core` — Signals | `signal`, `computed`, `effect` | Reactive state: `signal<string>('dark')` for theme, `signal<Set<string>>` for visible fields, `computed()` for KPI derivation, selected node ID, filter query. |
| `@angular/common/http` | `HttpClient`, `provideHttpClient` | REST calls to Read API: `GET /api/services` (discovery), `GET /api/deployments` (matrix + history). |
| `@angular/animations` | `provideAnimations`, `trigger`, `transition`, `style`, `animate` | Drawer slide-in/out, popover fade, breathing animation on running tiles. Required by PrimeNG's `p-drawer` and `p-popover` transitions. |
| `@angular/router` | `provideRouter` | SPA routing. Single route for the dashboard view. |
| `@angular/forms` | `FormsModule` | `[(ngModel)]` binding on PrimeNG form components (select, radio, toggle, input). |

### Browser-Native APIs (no package needed)

| API | Usage |
|-----|-------|
| `EventSource` | SSE connection to `/api/sse`. Wrapped in RxJS `Observable`. Reconnects via `Last-Event-ID`. Connection state reflected in live indicator. |
| `localStorage` | Persist user's theme selection (`'dark'` / `'light'` / `'auto'`) across reloads. Read in pre-paint bootstrap script. |
| `matchMedia` | `window.matchMedia('(prefers-color-scheme: light)')` — resolves the `auto` theme mode. CSS handles token swap; JS listener for future hooks. |
| RxJS (`rxjs`) | Bundled with Angular. `debounceTime(200)` on filter input. `Observable` wrapper for EventSource. `merge`, `filter`, `map` for stream composition. |

## package.json Summary

```json
{
  "primeng": "^4.x",
  "@swimlane/ngx-graph": "^9.x",
  "lucide-angular": "^0.x",
  "date-fns": "^4.x",
  "ngx-echarts": "^21.0.0",
  "echarts": "^5.x"
}
```

Total added dependencies: **6 packages**. No jQuery, no standalone D3, no state-management library, no CSS framework. PrimeNG tree-shakes to only the ~8 imported components. Angular built-ins (HttpClient, Signals, Animations, Router, Forms) and browser-native APIs (EventSource, localStorage, matchMedia, RxJS) complete the stack.

### Angular-21 Compatibility Note

**`ngx-echarts` was chosen over `@swimlane/ngx-charts`** because `@swimlane/ngx-charts` is not compatible with Angular 21 (last tested against Angular 15; the project is on Angular 21). `ngx-echarts` ^21.0.0 follows Angular's major-version numbering convention and targets Angular 21; compatibility is confirmed via peer-dep range. `echarts` ^5.x is stable and tree-shakeable via `echarts/core` imports.
