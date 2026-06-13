# Deployment Dashboard — Frontend Design Specification

**Version:** 1.0  
**Status:** Approved  
**Date:** May 2026  
**Stack:** Angular 21 · PrimeNG (unstyled) · ngx-graph · TypeScript

---

## Purpose

This specification is the **source of truth** for frontend engineers implementing the Deployment Dashboard. It covers every design token, component state, layout rule, interaction pattern, and dependency needed for implementation.

## Document Relationships

| Document | Scope |
|----------|-------|
| [`../SAD.md`](../SAD.md) | System architecture, API contract, domain model, 6-box-state definitions |
| [`../FRONTEND_REQUIREMENTS.md`](../FRONTEND_REQUIREMENTS.md) | Functional, visual, behavioral, and data requirements |
| [`mockup/prototype.html`](mockup/prototype.html) | Interactive visual reference — static fixture data, full UI fidelity |
| This directory | Engineering spec — tokens, components, states, layouts, interactions |

## Technology Stack

- **Framework:** Angular 21 (standalone components)
- **UI Components:** PrimeNG v4+ (unstyled mode) — `p-drawer`, `p-popover`, `p-selectButton`, `p-toggleSwitch`, `p-select`, `p-checkbox`, `p-radioButton`, `pInputText`
- **Graph Engine:** `@swimlane/ngx-graph` — dagre layout, custom node/link/defs templates
- **Icons:** `lucide-angular` — tree-shakeable mono-weight stroke icons
- **Date/Time:** `date-fns` — `formatDistanceToNow()`, `format()`
- **State:** Angular Signals (`signal`, `computed`, `effect`)
- **Data Transport:** REST (`HttpClient`) + SSE (native `EventSource` + RxJS)
- **Hosting:** Static build served by nginx container behind App Gateway
- **Aesthetic:** "Glassy Dark Monitoring" — translucent surfaces with `backdrop-filter`, semantic status color-coding

## Specification Index

| File | Contents |
|------|----------|
| [design-tokens.md](design-tokens.md) | Color tokens (dark/light/auto), typography, geometry, effects |
| [components.md](components.md) | Topbar, matrix tile, 6 box states, swimlane node, drawer, inspector, popovers |
| [views.md](views.md) | Matrix view layout, swimlanes view layout, ngx-graph integration |
| [libraries.md](libraries.md) | Full dependency inventory, PrimeNG unstyled config, component mapping |
| [behavior.md](behavior.md) | Field rendering system, interactions, theming, responsive rules |
| [data-model.md](data-model.md) | Domain model (11 fields), KPIs, field whitelist, derived values |
