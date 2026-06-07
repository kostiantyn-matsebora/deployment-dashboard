# Frontend — project binding

> Project stack, file lanes, and gate commands for the **frontend** role (`frontend-developer`).
> Generic role: [`../team-process/roles/frontend.md`](../team-process/roles/frontend.md). Shared tool-output-economy guardrail: `CLAUDE.md` § *Project bindings*.

- **Stack:** Angular (standalone), unit tests via `@angular/build:unit-test` (Vitest), Node 24. No `ng lint` configured.
- **Lanes:** `frontend/dashboard/**` (SPA) + `frontend/mock/**` (mock server).
- **Local surfaces:** SPA `ng serve` :4200; mock :3000 — real-app E2E needs **both** live (jsdom masks browser drag bugs).
- **Gates** (in `frontend/dashboard`; mirror `.github/workflows/frontend.yml`):
  - Test — `npm test` → surface failing specs only
  - Build — `npm run build -- --configuration production`
- **Reuse existing primitives** (rate-limit popover, inspector) / PrimeNG / native before bespoke CSS; one source of truth, no magic size math.
