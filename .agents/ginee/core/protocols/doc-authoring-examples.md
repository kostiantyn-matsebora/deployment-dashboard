---
audience: all-cardinals
load: on-demand
triggers: [doc-authoring-examples, examples, structure-over-prose]
cap-bytes: 24000
reads-before-applying: [core/protocols/doc-authoring-protocol.md]
---

# Doc-authoring examples — paired bad / good

Loaded when a role authors a doc class for the first time, user requests examples, or SA cites a Review-activity regression. Default tasks do not load — shape rules + mandatory checks in `core/process.md § Documentation style` (always-loaded) suffice once internalized.

Adopter doc classes: component inventory · design properties · ADR rationale · runbook · API table · scenario. Plus subagent-return (§ 10) · marker enforcement (§ 12) · release-notes sidecar (§ 13) · RFC 2119 (§ 14) · sub-issue fast-path (§ 15) · heavy-role bypass (§ 16, cite-only) · pixel-check (§ 17, cite-only).

---

## 1. Component inventory

**Bad** — prose paragraph:

> The system is a microservices architecture with container co-location of the Write + Read API services. Four container images: deployment-dashboard-api, deployment-dashboard-fetcher (optional pull-mode worker), deployment-dashboard-frontend (Angular SPA on nginx), and deployment-dashboard-gateway (nginx routing + SSE pass-through, the only host-published service).

**Good** — table:

| Image | Tier | Role | Host-published |
|---|---|---|---|
| `deployment-dashboard-api` | service | Write + Read API (co-located per ADR-0002) | no |
| `deployment-dashboard-fetcher` | worker | Optional pull-mode adapter | no |
| `deployment-dashboard-frontend` | client | Angular SPA on nginx | no |
| `deployment-dashboard-gateway` | edge | nginx routing + SSE pass-through | **yes** |

Framing decision in ADR-0006; co-location mechanics in ADR-0002.

---

## 2. Design properties (README intro)

**Bad** — paragraph stating 3 design rules:

> The system is read-only / notification-only: it tracks deployments, it does not trigger them. Tool-agnostic by design — the backend never talks to a CI/CD tool directly; integrators POST to `/api/deployments` from a pipeline step. An optional Dashboard.Fetcher worker can translate pull → push for tools without notify steps.

**Good** — bullets:

- **Read-only / notification-only** — tracks deployments; never triggers them.
- **Tool-agnostic** — backend never talks to CI/CD directly. Integrators POST `/api/deployments` from a pipeline step.
- **Pull→push adapter** — optional `Dashboard.Fetcher` worker for tools without notify steps.

---

## 3. ADR rationale

**Bad** — comma-joined drivers:

> We chose Postgres over MySQL because we need rich JSONB support for the events table, we already operate Postgres in production for the auth service, and the team is more familiar with Postgres tooling, plus the cost difference is negligible at our scale.

**Good** — driver-comparison table:

| Driver | Postgres | MySQL |
|---|---|---|
| JSONB ergonomics | native, indexable | bolt-on |
| Existing ops experience | auth service already on PG | new operational surface |
| Team familiarity | high | low |
| Cost at our scale | negligible delta | negligible delta |

**Decision:** Postgres. Drivers 1–3 dominate; driver 4 is neutral.

---

## 4. Runbook procedure

**Bad** — comma-chained steps:

> If the deployment fails, first check the logs in CloudWatch, then look at the recent deploys in the dashboard, then if you see a pattern of timeouts you should roll back via the deploy CLI, otherwise file an incident in PagerDuty.

**Good** — numbered steps + explicit decision:

1. Read failing-deploy logs — `awslogs get /ecs/<service> --start='-15m'`.
2. Open the deploys dashboard — `<dashboard-url>`.
3. **Decision.**
   - Timeout pattern (≥ 3 of last 5 deploys) → roll back: `deploy rollback <service> <prev-rev>`.
   - Other → file PagerDuty incident with the log link.

---

## 5. API endpoint table

**Bad** — endpoint described in prose:

> The `/api/deployments` endpoint accepts POST with a JSON body containing service, environment, version, status (succeeded/failed), and an optional commit SHA, returning 202 on accept or 422 on validation failure.

**Good** — endpoint contract table:

| Method + Path | `POST /api/deployments` |
|---|---|
| Request | `{ service, environment, version, status, commitSha? }` |
| Response 202 | `{ id, receivedAt }` |
| Response 422 | `{ field, error }[]` |
| Auth | bearer (`X-Integrator-Token`) |

---

## 6. Scenario doc

**Bad** — long conditional sentence:

> When the user clicks the deploy button, if they are authenticated and have the deploy role and the target environment is not locked, then the system should create a new deployment, log the event, and update the dashboard in real time; otherwise it should show an error.

**Good** — Given/When/Then bullets + explicit negatives:

- **Given** authenticated user with `role:deploy`.
- **And** target environment is not locked.
- **When** user clicks `Deploy`.
- **Then** new deployment created.
- **And** event logged to audit-trail.
- **And** dashboard updates within 500 ms (NFR-04).

Negative paths:

- Missing role → 403, no deployment created.
- Locked environment → 409, no deployment created.

---

## 7. Issue Summary

**Bad** (parenthetical-soup):

> GitHub issue bodies authored via ginee's `ginee-file-*` skills AND framework-authored comments (Phase-3/7/8 transitions · sticky `ginee:score` · `ginee:review-cycle` summary · audit comments · review-reply texts) bypass the structure-over-prose discipline that the doc-authoring protocol binds for adopter markdown.

**Good** (bulleted scope + tight intro):

**Apply the doc-authoring protocol to two surfaces it doesn't cover today:**

- Issue bodies authored via `ginee-file-*` skills.
- Framework-authored comments — Phase transitions · sticky scores · review-cycle summaries · audit comments · review-replies.

Both markdown + load-bearing LLM context + human-read; without protocol they become walls of path-soup.

---

## 8. Issue body section

**Bad** (semicolon-chain):

> testing/integration/Dashboard.Integration.Tests/ (18 src files: TestEnvironment / MockGhaClient / ScenarioFixture / BoxStateOracle / SseListener / 6 box-state tests + 4 cross-cutting tests); testing/fixtures/gha/{mappings,scenarios/_cross-cutting,scenarios/<state-id>,demo}/ (26 WireMock JSON mappings); testing/config/integration.json; testing/integration/{run-tests.ps1,README.md}.

**Good** (table — scannable · one row per concept · zero connectives):

| Path | What |
|---|---|
| `testing/integration/Dashboard.Integration.Tests/` | 18 src files: TestEnvironment · MockGhaClient · ScenarioFixture · BoxStateOracle · SseListener + 6 box-state tests + 4 cross-cutting tests |
| `testing/fixtures/gha/{mappings,scenarios/…,demo}/` | 26 WireMock JSON mappings |
| `testing/config/integration.json` | Integration test config |
| `testing/integration/{run-tests.ps1,README.md}` | Runner + docs |

---

## 9. Phase-transition comment

**Bad** (single dense paragraph):

> Phase 8 acceptance gate. Work is surfaced for user accept / feedback / reject. The PR is #61 on the `ginee/issue-37-classical-architect` branch (Mode 1 delivery). 29 files changed with +741 / -271. New classical-architect SA model. Doc-ownership map in PLAN.md and CLAUDE.md. All 7 open questions resolved (4 user-decided, 3 reasonable-defaulted). Migration: adopters run rediscover on next upgrade.

**Good** (structured):

**Phase 8 — acceptance gate.** Work surfaced for accept / feedback / reject.

- **PR:** #61 — `ginee/issue-37-classical-architect` branch (Mode 1).
- **Files:** 29 (+741 / -271) · 1 rename · 3 new · 25 edits.
- **New:** Classical-architect SA model. Logged in `PLAN.md` + `CLAUDE.md`.
- **Open questions:** 7/7 resolved (4 user-decided · 3 reasonable-defaulted).
- **Migration:** Adopters run `@team-lead rediscover` on next upgrade.

Issue auto-closes on PR merge via `Closes #37`.

---

## 10. Subagent return — Phase-4 cardinal dispatch

**Bad** — 3,603-char return opening *"The orchestrator dispatched me to add… I started by reading… I then re-read… With that grounding I opened… Here's the exact text I added so you can verify…"* — preamble · restated dispatch · verbose per-decision rationale · embedded code · trailing summary.

**Good** — schema-bound return (1,136 chars, **68.5% reduction**):

```
Status: Done

## Files touched

| Path | Δ lines | Purpose |
|---|---|---|
| `core/roles/team-lead.md` | +1 / -10 | Replace verbose Reporting block with schema pointer |
| `core/roles/solution-architect.md` | +4 / -7 | Same — keep Phase-1 design-mode bullets |
| `core/roles/{ai,frontend,backend,devops,qa}-engineer.md` | +3 / -0 each | New Reporting section (1-line per kernel) |

## Decisions made
- Kernels with existing Reporting: amend in place — schema pointer
- Kernels without: insert one-line section after `## Forbidden actions`

## Verification log

| Command | Outcome |
|---|---|
| `git diff --stat core/roles/` | +20 / -17 net across 7 files |
| Lossless self-check | 6 prior rules sampled, all present |

## Open issues
(none)

## Next dispatch needed
(none)
```

Bloat scales with task scope (narrative restatement + per-decision rationale + code-snippet quotes); schema-bound size scales with file + decision counts. Simple cardinal dispatches reduce by similar ratios (1,500–3,000 char prose → 400–800 char schema). Sub-1,000-char dispatches reduce less — schema table headers carry fixed overhead, but parseability gain dominates.

---

## 11. Option list — adopt-vs-build

See `core/protocols/options-protocol.md § Worked example` (canonical bad/good pair + the 5-check pass rationale).

---

## 12. Phase-1 dispatch return — self-lint marker enforcement

Without `<!-- self-lint: pass -->` marker the 6 checks are aspirational — non-compliant returns slip through silently.

**Bad** — preamble + file inventory as prose, no marker:

> I have full grounding now. Pre-dispatch staleness check before drafting the Phase 2 plan… Files I'll touch: `core/templates/phase-report.md`, all 7 cardinal kernels, `core/process.md § Skill-runner`, plus `CLAUDE.md`/`PLAN.md` cross-refs.

**Good** — schema-bound + marker. Same structure as §10's good case, ending with literal `<!-- self-lint: pass -->` as the last line.

---

## 13. Release-notes sidecar bullet

Sidecar bullets (`.github/release-notes/v*.md`) lead with adopter-visible benefit; ≤ 20 words. Implementation jargon belongs in CHANGELOG, not sidecar.

**Bad:**

> - Introduces three vendor-neutral tiers (reasoning · standard · fast) declared as role-kernel `default-tier:` with per-adapter `<tier> → <id>` map. Resolution: per-task prefix → Phase-3 answer → `local/framework.config.yaml § model-tier.per-role.<role>` → kernel `default-tier:`. Claude writes `model: <id>` into frontmatter; non-Claude adapters emit warning. Purely additive…

Trips checks 1 (75+ words) · 2 (no adopter benefit at line start; `default-tier:` jargon) · 3 (resolution + adapter writeback are CHANGELOG content).

**Good:**

> - **Lower LLM bills** — cheaper models on execution work; capable ones stay on orchestration + architecture. Out of the box.
> - **Per-task model override** — prefix any dispatch with `model:reasoning` / `model:standard` / `model:fast`.

Adopter-visible verb at line start · concrete benefit · ≤ 20 words. Full topology + self-lint: `core/protocols/changelog-protocol.md`.

---

## 14. Binding-strength signal — RFC 2119 keywords

**Bad** (mixed signalling):

> Cardinals **always** include the `## Source reads` section when raw sources were read.

**Good** (RFC 2119):

> Cardinals MUST include the `## Source reads` section when raw sources were read.

Keyword IS the binding signal; LLM no longer disambiguates emphasis (`**bold**`) from normative weight.

---

## 15. Sub-issue pickup — fast-path vs re-route decision

**Bad** — narrative reasoning with soft "if … we'd":

> Issue #M is a sub-issue of #K because parent_issue is set, and it has `ginee:role:backend-engineer` with a dispatch contract, so I think we can skip team-lead. If backend-engineer comes back blocked we'd dispatch team-lead…

**Good** — schema-bound gate decision:

```
Sub-issue check (gh api .../issues/M) — parent_issue = #K · ginee:role:backend-engineer · body has Scope/Acceptance/Spec/Phase/Estimate.
Fast-path gate — 4 of 4 pass → dispatch @backend-engineer.
Inbound payload — parsed body + scoring labels + label-swap + branch (issue-M-<slug>).
Re-entry — re-load @team-lead if `## Open issues` non-empty OR `## Hand-off` set OR `Status: In-progress` OR cross-domain bug surfaced.
```

Re-route case — multiple role labels → `Hand-off — @team-lead (routing ambiguous)`. Every failure path routes through `@team-lead`: parent unresolved · no role label · dispatch contract incomplete · multiple role labels.

---

## 16. Heavy-role bypass — TL fast-path vs SA dip decision

See `core/protocols/heavy-role-bypass.md § Transcript-grep recipes` + § Per-phase track tables — schema-bound gate decision shape (TL1–TL4 / SA1–SA3) + transcript-grep advisories. Pattern: cite the matching row from the persistence-artefact table OR re-entry trigger table; never narrate.

---

## 17. Pixel-check outcome — true-positive routing vs false-positive mask

See `core/protocols/pixel-check-protocol.md § Drift routing` (4-row routing table) + § Tolerance + masks (oracle discipline: every tolerance bump cites the specific diff it would have masked; every mask carries `# why:`). Pattern: viewport table → drift classification → route OR mask-with-justification. Never narrative.
