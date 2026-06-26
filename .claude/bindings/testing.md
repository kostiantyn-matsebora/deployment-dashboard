# Testing — project binding

> Project test levels, file lanes, and gate commands for the **testing** role (`testing-specialist`).
> Generic role: [`../team-process/roles/testing.md`](../team-process/roles/testing.md). Shared tool-output-economy guardrail: `CLAUDE.md` § *Project bindings*.

**NO MOCKS.** Owns the wider net; unit tests belong to each implementer.

| Level | Lane | Command (mirrors CI) | On fail → surface |
|---|---|---|---|
| Backend (.NET/xUnit) | `backend/tests/**` | `dotnet test Dashboard.slnx --settings Dashboard.runsettings --nologo -c Release` (from `backend/`) | `Select-String 'error|\bFailed\b|\[xUnit'` |
| Frontend (Angular/Vitest) | `frontend/dashboard/**/*.spec.ts` | `npm test` (in `frontend/dashboard`) | failing specs only |
| Demo driver (Jest) | `demo/driver/**/*.spec.ts` | `npm test` (in `demo/driver`) | `✕` / `FAIL` lines |
| API integration | `testing/api/**` | `docker compose up -d --build --wait` → `npm run test:integration` | failing requests + `docker compose logs --no-color` slice |
| E2E (Playwright) | `testing/e2e/**` | `npx playwright test` | failing test + trace |
| Scripts (pytest) | `*_test.py` (sibling) | `pytest -q` | failed test only |

- **Overlap invariants:** every new UI combo MUST add a row to `testing/e2e/tests/overlap-invariants.spec.ts` (`COMBOS_UNDER_TEST`).
- **api-tests CI triggers main-only;** `gh run watch | tail` masks the exit code — check run status explicitly.
