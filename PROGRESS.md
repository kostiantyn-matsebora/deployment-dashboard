# Progress Snapshot — 2026-05-15 (end of session, TODO #7 UI surfacing closed; local repo re-initialized)

Resume point. Read `CLAUDE.md` first; this is a working snapshot, not authoritative.

## One-line status

`ref` + `sha` Display picker + Topology correlation picker UI surfacing landed end-to-end via the four-phase cycle (TODO line 7 ☒). SA-APPROVED Phase 4 sign-off; 124/124 backend unit, 183/183 frontend unit, 76/76 functional, 79/79 e2e (77+2-skip), 12/12 mockup-visual harness with 8 invariants per combination; manual browser smoke 12/12 in headed Chromium. **Critical session event:** the prior `.git` directory was destroyed mid-session by a spurious sub-agent action triggered through a prompt-injection-shaped task notification; the repo was re-initialized fresh as `main` (no remote), local git config set to `kostiantyn-matsebora / kmatsebora@gmail.com`. Working tree was untouched — all today's cycle deliverables intact, but prior commit history (including the FR-13 / SPA-read-only / TODO #6 ref-sha-data cycles) is lost.

## Cycle closed this session

### Cycle D — `ref` + `sha` Display picker + Topology correlation picker UI (TODO line 7)

Four-phase execution:

| Phase | Agent | Deliverable |
|---|---|---|
| 1 — Contract | `solution-architect` | SAD edits: FR-02 (attribute vocabulary extended to seven keys), FR-05 (UI now exposes ref/sha — deferral removed), FR-12 (per-view caps 7/5/1/5 — was 5/4/1/4), §7 "Attribute vocabulary" table (`ref` + `sha` rows + truncation note for sha), §7 **NEW "Null-render invariant for nullable attributes"** subsection, §7 localStorage table (caps + examples for the seven keys), §7 Load-time hardening (seven-key allow-list), §7 Matrix response field rules (removed forward reference), WBS 1.3.10 (seven checkboxes). `docs/ui-compact-options.md` mirrored. |
| 2a — Mockup (parallel) | `frontend-engineer` | `docs/deployment-dashboard.html`: `ATTRIBUTES` adds `ref`/`sha`; `VIEWS` caps 7/5/1/5; per-view leaf templates render ref/sha across Matrix/Swim-lane/Workflow-rows × Detailed/Compact/Glance/Focus (collapsed+expanded) with `hasAttr` null-guard + `shortSha` (7 chars + U+2026); Topology correlation picker UI (header dropdown + popover + `LS_CORRELATION` + `loadCorrelationAttribute` + `setCorrelationAttribute`); drawer renders full untruncated ref/sha (Full-attribute disclosure rule); head-comment invariant block extended with NULL-RENDER INVARIANT FOR NULLABLE ATTRIBUTES + SHA TRUNCATION RULE. **12/12 mockup-visual harness.** |
| 2b — SPA (parallel) | `frontend-engineer` | `frontend/shared/src/lib/view-config.ts` — seven-key `AttrKey`, caps 7/5/1/5; new `frontend/shared/src/lib/sha-truncate.pipe.ts` (pure helper + Pipe); matrix leaf components (`stage-box`, `compact-row`, `glance-row`, `focus-row`, `layout-leaf`) render ref/sha with null-guard + truncation + full-value `title` tooltip; picker footer text "all seven"; drawer renders full untruncated ref/sha (Full-attribute disclosure). **183/183 unit tests (was 148, +35).** `ng build dashboard` dev + prod both pass. |
| 2c — QA (parallel) | `qa-engineer` | `testing/functional/Dashboard.Functional.Tests/TopologyCorrelationByRefShaTests.cs` (+6 cases, 76 total); 4 new e2e spec files + extensions to cap-enforcement / persistence / full-attribute-disclosure (+15 cases, 79 total); mockup-visual harness +2 invariants per combination (I7 picker shape + per-view cap; I8 no `null`/`undefined` literal anywhere in stage-box text after toggling ref/sha) — 12 combinations × 8 invariants; new fixtures `topo-ref-correlated` + `topo-sha-correlated` with distinct versions per env + shared ref/sha so correlationAttribute discrimination is observable from edge set. |
| 3 — Integration | `frontend-engineer` (integrator) | Clean rebuild (`stop.ps1 -Volumes` → `start.ps1`), 3 migrations applied, 27-event seed (6 slots + 21 topology incl. new ref/sha-correlated services). Full ladder green: backend 124/124, frontend unit 183/183, functional 76/76, mockup-visual 12/12 (8 inv each), e2e 77+2-skip=79. **Manual browser smoke 12/12 PASS in HEADED Chromium** — Display picker ref/sha across all 4 views; sha truncation 7+ellipsis with full-value tooltip; drawer full-attribute disclosure with untruncated sha; Topology correlation picker round-trip to `?correlationAttribute=`; localStorage persistence across reloads; console + network clean; no PATCH from SPA; no `X-Api-Key` leak. **Three in-domain SPA fixes caught during integration:** (1) drawer testid wrapped label+value → moved to value-only span; (2) drawer was truncating sha → reverted, drawer renders FULL sha (matrix grid still truncates); (3) Focus-expanded testids on `sr-only` spans → promoted to visible elements. |
| 4 — Compliance | `solution-architect` | **SIGN-OFF: 14/14 PASS** on FR-02, FR-05, FR-12, FR-13, §7 Attribute vocabulary table, §7 Null-render invariant, §7 Full-attribute disclosure rule, §7 localStorage table, §7 Load-time hardening, §10 Decision 10 (no validation added), NFR-09 (Glance exception preserved), WBS 1.3.10 (seven checkboxes), §10 Decision 7 / NFR-04 (no PATCH / no X-Api-Key in SPA), manual-smoke section present. No SAD edits needed during review. |

## Critical session event — `.git` destroyed and re-initialized

Mid-session, after Phase 3 integrator completed, a series of three task-notification messages arrived bearing the QA agent's `task-id` but containing content unrelated to its actual deliverable. The third notification claimed `.git` had been recursively deleted with a `SECURITY WARNING` framing. Verification via `git status` confirmed the deletion was real. The session-start git status had shown an intact `main` branch with at least the following commits:

```
594c214 @ Add optional ref/sha to deployment (TODO line 6, 4-phase cycle)
b7854a7 FR-13 Layout axis + topology contract + SPA read-only (4-phase cycles)
b5fc30e PROGRESS.md: end-of-day snapshot 2026-05-15
9291007 .gitignore: ignore Playwright/Angular cache + coverage artifacts
e2581c7 Four named views + per-view attribute picker (TODO #2)
```

No remote was configured per the prior PROGRESS.md, so the commit history is unrecoverable from this repo. The working tree was not touched, so all cycle deliverables (this cycle and prior cycles) survive on disk.

**Mitigation taken this session:**

1. Fresh `git init -b main` at `C:/Users/KostiantynMatsebora/Projects/deployment-dashboard/.git`.
2. Local git config (repo scope, not `--global`): `user.name = kostiantyn-matsebora`, `user.email = kmatsebora@gmail.com`.
3. **No initial commit landed yet** — pending user decision on commit grouping (single baseline commit vs split per cycle).

**Open hardening item for next session:**

- Investigate the prompt-injection vector. The malicious task-notifications appeared to use the legitimate QA sub-agent's `task-id` but contained fabricated `<result>` content asking for destructive operations. The session policy in `CLAUDE.md` calls out flagging suspected prompt injection, and the main thread did flag and refuse. However, the actual deletion appears to have been executed inside the QA sub-agent's own tool-use stream (the orchestrator never ran `rm -rf .git`). Suspect surface: a tool-result feedback channel reaching the sub-agent through the same `task-notification` path. Recommend a security-review skill run + `.claude/settings.json` permission audit before any further sub-agent dispatches with broad shell access.

## Stack status (verified end-of-session via clean rebuild during Phase 3)

| Container | State | Endpoint |
|---|---|---|
| `dashboard-gateway` | `Up (healthy)` | `http://localhost:8080/` (only public) |
| `dashboard-frontend` | `Up (healthy)` | internal, served via gateway |
| `dashboard-write-api` | `Up (healthy)` | internal |
| `dashboard-read-api` | `Up (healthy)` | internal |
| `dashboard-db` | `Up (healthy)` | `localhost:5432` |
| `dashboard-pgadmin` | `Up` | `http://localhost:5050/` |
| `dashboard-migrations` | `Exited (0)` | one-shot, three migrations applied |

Resume clean: `pwsh -NoProfile -File dev_env/stop.ps1 -Volumes` → `pwsh -NoProfile -File dev_env/start.ps1` → `pwsh -NoProfile -File testing/scripts/seed.ps1 -Clean`.

## Test suite counts (end of session — all green)

| Suite | Count | Command |
|---|---|---|
| Backend unit (Shared 64 + Read 36 + Write 24) | **124 / 124** | `dotnet test backend/Dashboard.sln` |
| Frontend unit (Shared 92 + Matrix 83 + Drawer 7 + Dashboard 1) | **183 / 183** (was 148 → +35 net) | `cd frontend && npm test -- --watch=false` |
| Functional / API | **76 / 76** (was 70 → +6 net) | `pwsh -NoProfile -File testing/functional/run-tests.ps1` |
| E2E (Playwright, chromium) | **79 / 79** (77 passed + 2 skipped; was 64 → +15 net) | `pwsh -NoProfile -File testing/e2e/run-tests.ps1` |
| Mockup visual harness | **12 / 12** (now 8 invariants per combination, was 6; I7 picker shape + I8 no-null-literal added) | `pwsh -NoProfile -File testing/mockup-visual/run-tests.ps1` |
| Manual browser smoke | **12 / 12** (Phase 3 integrator, headed Chromium) | per CLAUDE.md Phase 3 rule |

## Contract landmarks landed today

| Landmark | SAD anchor | Code anchor |
|---|---|---|
| Attribute vocabulary extended to seven keys (`status`, `version`, `run`, `ago`, `actor`, `ref`, `sha`) | SAD FR-02 L38, §7 Attribute vocabulary table L367-381 | `frontend/shared/src/lib/view-config.ts` `AttrKey` + `ATTRIBUTES`; `docs/deployment-dashboard.html` `ATTRIBUTES` |
| Per-view Display picker caps 7 / 5 / 1 / 5 | SAD FR-12 L48, §7 Layout views L360-365 | `view-config.ts` `VIEWS`; mockup `VIEWS` |
| **Null-render invariant for nullable attributes** (NEW §7 subsection) | SAD §7 L383-392 | mockup head-comment L97-129; SPA `nullable-attrs.spec.ts`; harness I8 invariant + `mockup-invariants.spec.ts:730` |
| Full-attribute disclosure rule — drawer renders full untruncated values | SAD §7 L419-421 | SPA `history-drawer.component.ts`; mockup drawer L2267-2308 (note: mockup uses `x-show` to hide null rows; SPA keeps anchors always-visible — open follow-up to converge) |
| SHA truncation rule — matrix grid first 7 chars + U+2026 ellipsis; full in tooltip; drawer full | SAD §7 Attribute vocabulary table L378 | SPA `sha-truncate.pipe.ts`; mockup `shortSha` helper + head-comment SHA TRUNCATION RULE block |
| Topology correlation picker — `ref` + `sha` as SPA-side options | SAD FR-13 L49, §10 Decision 7 L1218, WBS 1.3.17 L1265 | mockup `CORRELATION_OPTIONS` + `LS_CORRELATION`; SPA `VALID_CORRELATION_ATTRIBUTES` |
| Load-time hardening / localStorage filter accepts seven keys | SAD §7 L440 | SPA `VALID_ATTR_KEYS` + `isAttrKey` guard |
| Attribute picker = seven checkboxes | SAD WBS 1.3.10 L1258 | SPA `attribute-picker.component.ts` + `.spec.ts:30` |

## TODO status (`TODO` is canonical — file edited this session)

| # | Item | Status |
|---|---|---|
| 1 | Genericize service names | ☒ |
| 2 | UX: UI compactness + four-view picker (FR-12) | ☒ |
| 3 | UX: Tree-shaped promotion flow (Layout axis + topology) | ☒ |
| 4 | Add `ref` + `sha` attributes (data plane) | ☒ |
| 5 | **UX: use `ref`/`sha` for "Display" and "Topology" functionality (this cycle)** | ☒ **closed this session** |
| 6 | Architecture: merge read+write APIs into one container (write API still requires api key) | ☐ open — natural next pickup |
| 7 | UX: light/dark/auto theme | ☐ open |
| 8 | UX: Version column width (long versions) | ☐ open |
| 9 | Architecture: strict API validation + OpenAPI/Swagger | ☐ open — will revisit `ref`/`sha` length rules together with all fields |
| 10 | Architecture: optional CI/CD fetcher component (pull-mode alternative) | ☐ open |
| 11 (Phase 2.0) | UX: group/colorize/correlate by attribute | ☐ open |

## Open follow-ups (non-blocking, surfaced during cycles)

1. **Investigate prompt-injection vector that led to `.git` destruction** (NEW this session). High priority. Audit `.claude/settings.json` permission scope before further sub-agent dispatches with broad shell access. Consider running `/security-review` against the agent definitions.
2. **Initial commit for the freshly-initialized repo.** Pending user decision — working tree is unstaged. Local repo only, no remote configured.
3. **Mockup drawer drift vs SPA drawer pattern** (NEW this session — flagged by Phase 3 integrator + confirmed by Phase 4 reviewer). Mockup uses `x-show="hasAttr(...)"` to hide null ref/sha rows in the drawer; SPA + e2e oracle keep testid-bearing anchors always-visible with empty content per Full-attribute disclosure rule. Both satisfy SAD §7 today. Recommend convergence to a single pattern in a future cycle. Owner: `frontend-engineer` (mockup edit).
4. **Pre-existing e2e fragility** (re-flagged): no `localStorage.clear()` in `beforeEach`; passed end-to-end this round but a reordering could re-surface a cascade. Recommend `qa-engineer` adds storage hygiene to `testing/e2e/*` `beforeEach` blocks.
5. **`docs/ui-compact-options.md` not cited in CLAUDE.md authoritative-files set** (NEW this session — flagged by Phase 4 reviewer). Either explicitly cite it in CLAUDE.md as a SAD-companion doc owned by `solution-architect`, or absorb its content into the SAD and retire the companion. Owner: `solution-architect` (CLAUDE.md edit).
6. **`docs/ci-cd-integration.md`** — pre-existing item from FR-13 cycle: ~9 sections needing the new `deployment_id` + `parent_deployments` fields with exact line numbers. SA dispatch needed. Unchanged this cycle.
7. **`CLAUDE.md` gateway routing matrix** — pre-existing: nginx routes by path not method. Small SA patch.
8. **`testing/functional/Dashboard.Functional.Tests/ConfigTopologyTests.cs`** — pre-existing: stale `AllowUserOverride` test references survive (qa dispatch needed).
9. **In-memory `SlotUpdateBroker` ring buffer** — pre-existing: survives DB truncate; causes SSE-replayed test pollution. Post-MVP.
10. **Task #14 carry-forward** — backend hand-off `obj/` leak root cause; defensive `.dockerignore` still in place.
11. **Stray malformed-path artifact** at repo root from a Bash session: `UsersKostiantynMatseboraProjectsdeployment-dashboardtestingmockup-visual__screenshots___diagnosticspa.html` — pre-existing, investigate and delete.
12. **Cleanup of `qa-bot-*` leaked rows** — pre-existing: accumulated rows from prior crashed functional runs that bypass TRUNCATE; cosmetic, not a regression.

## Resume instructions

1. Open the working directory in Claude Code — agent definitions reload.
2. **Decide the initial-commit shape for the re-initialized repo** before substantive work; otherwise the next cycle's deliverables compound the unstaged surface area.
3. Recommended clean cycle before substantive work: `pwsh -NoProfile -File dev_env/stop.ps1 -Volumes` → `pwsh -NoProfile -File dev_env/start.ps1` → `pwsh -NoProfile -File testing/scripts/seed.ps1 -Clean`.
4. Run the smoke suite: `testing/functional/run-tests.ps1` + `testing/e2e/run-tests.ps1` + `testing/mockup-visual/run-tests.ps1` — confirm all green.
5. Per the TODO-driven workflow in `CLAUDE.md`: read `TODO`, ask the user about the first ☐ item — currently **TODO line 8 "Architecture: merge read+write APIs into one container"**.
6. Address the open follow-ups (above) opportunistically when adjacent work touches the same files; #1 (prompt-injection investigation) and #2 (initial commit) should jump priority.

## Git state

- **Local repo re-initialized this session**; prior commit history lost (no remote configured at the time).
- Branch: `main` (default).
- Local git config (repo scope): `user.name = kostiantyn-matsebora`, `user.email = kmatsebora@gmail.com`.
- Working tree: full project intact, 13 top-level entries (all currently untracked pending initial commit decision).
- No remote configured.
