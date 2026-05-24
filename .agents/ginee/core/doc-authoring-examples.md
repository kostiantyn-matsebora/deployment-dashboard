# Doc-authoring examples — paired bad / good (D22)

**Load-on-demand.** Fetched when:

- Role is authoring a doc class for the first time and unfamiliar with the default shape.
- User explicitly requests examples (`@<role> show doc-style examples`).
- `solution-architect` references during Review activity to point out a regression.

Default tasks do not load this file. The shape rules + mandatory checks (always-loaded in `core/process.md § Documentation style`) are sufficient once internalized.

Six paired examples cover the most common adopter doc classes: **component inventory · design properties · ADR rationale · runbook procedure · API endpoint table · scenario doc**.

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

## 7. Issue Summary (D26 — ginee-authored issue body)

**Bad** — parenthetical-soup sentence:

> GitHub issue bodies authored via ginee's `ginee-file-*` skills AND framework-authored comments (Phase-3/7/8 transitions · sticky `ginee:score` · `ginee:review-cycle` summary · audit comments · review-reply texts) bypass the structure-over-prose discipline that D22 binds for adopter markdown.

**Good** — bulleted scope statement + tight intro sentence:

**Apply D22 (doc-authoring protocol) to two surfaces it doesn't cover today:**

- Issue bodies authored via `ginee-file-*` skills.
- Framework-authored comments — Phase transitions · sticky scores · review-cycle summaries · audit comments · review-reply texts.

Both are markdown + load-bearing LLM context + human-read. Without D22, they end up as walls of path-soup.

---

## 8. Issue body section (D26 — Affected surface)

**Bad** — semicolon-chained file inventory:

> testing/integration/Dashboard.Integration.Tests/ (18 src files: TestEnvironment / MockGhaClient / ScenarioFixture / BoxStateOracle / SseListener / 6 box-state tests + 4 cross-cutting tests); testing/fixtures/gha/{mappings,scenarios/_cross-cutting,scenarios/<state-id>,demo}/ (26 WireMock JSON mappings); testing/config/integration.json; testing/integration/{run-tests.ps1,README.md}.

**Good** — table:

| Path | What |
|---|---|
| `testing/integration/Dashboard.Integration.Tests/` | 18 src files: TestEnvironment · MockGhaClient · ScenarioFixture · BoxStateOracle · SseListener + 6 box-state tests + 4 cross-cutting tests |
| `testing/fixtures/gha/{mappings,scenarios/_cross-cutting,scenarios/<state-id>,demo}/` | 26 WireMock JSON mappings |
| `testing/config/integration.json` | Integration test config |
| `testing/integration/{run-tests.ps1,README.md}` | Runner + docs |

Scannable; one row per concept; zero connectives to parse.

---

## 9. Phase-transition comment (D26 — framework-authored)

**Bad** — single dense paragraph:

> Phase 8 acceptance gate. Work is surfaced for user accept / feedback / reject. The PR is #61 on the `ginee/issue-37-classical-architect` branch (Mode 1 delivery). 29 files changed with +741 / -271. There are 3 new files and 1 rename and 25 edits. D25 (new): Classical-architect SA model. The new doc-ownership map is in PLAN.md and CLAUDE.md. All 7 open questions in the issue are resolved (4 user-decided, 3 reasonable-defaulted). Migration: adopters run `@team-lead rediscover` on next upgrade.

**Good** — structured Phase 8 transition:

**Phase 8 — acceptance gate.** Work surfaced for accept / feedback / reject.

- **PR:** #61 — `ginee/issue-37-classical-architect` branch (Mode 1).
- **Files:** 29 (+741 / -271). 1 rename + 3 new + 25 edits.
- **D25 (new):** Classical-architect SA model. Logged in `PLAN.md` + `CLAUDE.md`.
- **Open questions:** 7/7 resolved (4 user-decided · 3 reasonable-defaulted).
- **Migration:** Adopters run `@team-lead rediscover` on next upgrade.

Issue auto-closes on PR merge via `Closes #37`.

---

## 10. Subagent return — Phase-4 cardinal dispatch (D29)

**Bad** — narrative-padded return with restated dispatch context, verbose rationale, embedded code dump (3,603 chars — typical complex Phase-4 cardinal return per the D29 issue's measurements):

> The orchestrator dispatched me to add a `## Reporting` schema-bound pointer section to every cardinal role kernel that currently lacks one, while amending the two kernels that already have a `## Reporting` section so they cite the new schema instead of re-stating the template. I started by carefully reading `core/process.md § Reporting` (the new always-loaded section that landed in this same PR) to make sure I understood the binding rule — schema-bound per `core/templates/phase-report.md`, self-lint against the 6 mandatory checks before report-as-done. I then re-read `core/templates/phase-report.md` end-to-end to internalize the cardinality table (Files touched / Decisions made / Verification log / Open issues / Next dispatch needed are mandatory; Hand-off + Stop-state are conditional; Notes is the optional escape hatch with a 200-word cap). With that grounding in place, I opened `core/roles/team-lead.md` first because it already had a structured `## Reporting` block with five bullets restating the template's section list — those five bullets are now redundant because the schema lives in `core/templates/phase-report.md`. I replaced the block with a one-line pointer that cites the schema + the 6 mandatory checks + the hand-off cross-reference, which removes 10 lines from an always-loaded kernel (good for context economy under D21). Next I opened `core/roles/solution-architect.md` and applied the same treatment to its existing `## Reporting` block, but I kept the three Phase-1 design-mode bullets (resolved mode + ASR utility-tree summary + requirements register diff) because those are SA-specific obligations not captured by the generic schema — they now live under "Phase 1 design-mode report adds three rows to `## Decisions made`" as a single bullet with nested specifics. After that I turned to the five kernels that have no `## Reporting` section: `ai-engineer.md`, `frontend-engineer.md`, `backend-engineer.md`, `devops-engineer.md`, `qa-engineer.md`. For each of those I appended a new `## Reporting` section after `## Forbidden actions`. I kept every new section deliberately short — one to two lines — because the just-completed D18→D28 context-economy optimization pass left the kernels lean and I did not want to re-inflate them. The ai-engineer kernel section additionally calls out that the lossless-self-check sample goes in the Verification log as a row; the backend kernel section references D19 coverage attestation; the devops kernel section references both D18 script-quality and the post-step health check; the qa kernel section references test-run + manual-smoke outcomes. Frontend kernel only got the bare one-liner since it has no extra attestation obligation. Here's the exact text I added to backend-engineer.md so you can verify the shape:
>
> ```
> ## Reporting
>
> Schema-bound per `core/templates/phase-report.md` (D29); self-lint against the 6 mandatory checks before report-as-done. Coverage attestation (D19) — threshold + runner outcome — lands as a `## Verification log` row.
> ```
>
> All seven edits passed the lossless self-check — every prior Reporting-related rule in the two amended kernels (team-lead, SA) survives in the new structure, and the five new sections add zero new normative rules (they cite, not introduce). I then ran `git diff --stat core/roles/` and confirmed the net line change across the seven kernels is +20 / -17. No other files touched in this dispatch. The orchestrator should now be able to dispatch the doc-authoring-protocol § Scope extension + the doc-authoring-examples bad/good pair as the next batch.

**Good** — schema-bound return (1,136 chars, **68.5% reduction**):

```
Status: Done

## Files touched

| Path | Δ lines | Purpose |
|---|---|---|
| `core/roles/team-lead.md` | +1 / -10 | Replace verbose 5-bullet Reporting block with schema pointer |
| `core/roles/solution-architect.md` | +4 / -7 | Same — keep Phase-1 design-mode bullets |
| `core/roles/ai-engineer.md` | +3 / -0 | New Reporting section (1-line) |
| `core/roles/frontend-engineer.md` | +3 / -0 | New Reporting section (1-line) |
| `core/roles/backend-engineer.md` | +3 / -0 | New Reporting section — D19 coverage row noted |
| `core/roles/devops-engineer.md` | +3 / -0 | New Reporting section — D18 + health-check rows noted |
| `core/roles/qa-engineer.md` | +3 / -0 | New Reporting section — test + smoke rows noted |

## Decisions made

- Kernels with existing Reporting sections: amend in place — D29 schema pointer
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

**Measurement (honest).** Bad return = 3,603 chars (narrative preamble + restated dispatch context + verbose per-file rationale + embedded code snippet). Good return = 1,136 chars (Status + 4 tables + 2 bullet sections + 2 empty-case markers). **Reduction: (3603 − 1136) / 3603 = 68.5%** — within rounding of the issue's ~70% target.

**Why the ratio holds.** Bloat scales with task scope (narrative restatement + per-decision rationale paragraphs + code-snippet quotes); schema-bound size scales with file count + decision count. Simple cardinal dispatches reduce by similar ratios (1,500–3,000 char prose → 400–800 char schema). Sub-1,000-char dispatches don't reduce as far because the schema's table headers carry a fixed overhead — and that's fine: at those sizes the absolute saving is small either way and the parseability gain dominates.

---

## 11. Option list — adopt-vs-build (D30)

**Context.** Sub-task: add a content-compression layer for context payloads. Proposing role surfaces the option list as part of the iteration-protocol Propose step (or Phase 2 design output).

**Bad** — build-only, no adoption research surfaced:

> Options:
> - Build a custom dictionary-based compressor tuned to markdown.
> - Build a simple LZ-style compressor inline.

Tripped checks: **#1** (no adopt candidate, no `(none viable)` cite) · **#3** (candidates untagged).

**Bad** — adoption hand-waved:

> Options:
> - Use a charting library (it's mature).
> - Build our own.

Tripped checks: **#2** (no name · version · source link · license) · **#5** (`"mature"` isn't a concrete fit rationale) · **#3** (untagged).

**Good** — adopt candidates fully cited, build alternative explicit:

```
Options:
- adopt — zstd via `python-zstandard` v0.22 — BSD-3 — https://pypi.org/project/zstandard/
  — fit: streaming API; 4 ms/kB on <1 kB payloads (cite `runtime-facts.yaml`).
- adopt — brotli v1.1 — MIT — https://pypi.org/project/Brotli/
  — fit: better text ratios; +30 ms latency cost on small payloads.
- build — minimal in-house — rationale: surveyed adopt candidates above; both exceed
  the latency NFR on the <1 kB hot path. ADR draft below.
```

**Good** — empty research, explicit `(none viable)`:

```
Options:
- (none viable — surveyed 3 token-aware compressors; all require tokenizer-specific
  dictionaries the framework does not ship).
- build — minimal in-house — see ADR draft.
```

Passes all 5 checks: floor present · citations complete · tagging explicit · empty research documented · fit rationale concrete.

---

## 12. Phase-1 dispatch return — D29 marker enforcement (D33)

`team-lead` returns a Phase-1 grounding plan after `/ginee-pick-up`. Pre-D33 the 6 checks were aspirational; non-compliant returns slipped through silently. D33 adds the literal `<!-- D29 self-lint: pass -->` marker as the attestation line.

**Bad** — narrative preamble, no schema sections, no marker (failure mode from #86):

> I have full grounding now. Pre-dispatch staleness check before drafting the Phase 2 plan:
>
> - Read `core/process.md` end-to-end.
> - Read `core/roles/team-lead.md` + `core/roles/team-lead.details.md`.
> - SHA-256 cross-checked manifest entries — no drift.
>
> Files I'll touch: `core/templates/phase-report.md`, all 7 cardinal kernels, `core/process.md § Skill-runner`, new `core/MIGRATIONS/D33-*.md`, plus `CLAUDE.md`/`PLAN.md` cross-refs.
>
> Marker is `<!-- D29 self-lint: pass -->` literal; orchestrator surfaces advisory; skill-runner forbidden from cleaning up.

Tripped: **#1** (paragraph > 2 terminators) · **#4** (file inventory as prose) · **#6** (narrative preamble) · **D33 marker absent**.

**Good** — schema-bound + marker:

```
Status: Done

## Files touched

| Path | Δ lines | Purpose |
|---|---|---|
| `core/templates/phase-report.md` | +37 / -2 | Marker spec + advisory + carry-forward |
| `core/roles/{7 kernels}.md` | (×7) | One-liner marker addendum |
| `core/process.md § Skill-runner` | +2 / -0 | D29/D33 interaction |
| `core/MIGRATIONS/D33-*.md` | NEW | Migration |

## Decisions made

- Marker `<!-- D29 self-lint: pass -->` — last line of every return
- Orchestrator advisory on absence; no re-dispatch for format
- Skill-runner forbidden from cleanup (D28)

## Verification log

| Check | Outcome |
|---|---|
| Pre-dispatch staleness (D6 SHA-256) | no drift |
| 6 mandatory checks against draft | pass |

## Open issues

(none)

## Next dispatch needed

(none)

<!-- D29 self-lint: pass -->
```

---

## 13. Taxonomy identifier pairing (D34)

Cardinal outputs pair bare taxonomy IDs (D / ADR / CR / FR / NFR / ASR / index class) with their slug. Issue / PR / SHA refs stay bare.

**Bad** — bare IDs in a Phase-7 sign-off:

> Phase 7 sign-off. Implementation conforms to ADR-0001, ADR-0017, and CR-0010. NFR-02 budget respected. Touches FR-04 and the new ASR-03 derivation. Affected D-decisions: D17, D25, D28.

Reader can't tell what ADR-0001 / D17 / FR-04 *are* without opening each file. Tripped — D22 check #5 extension (D34).

**Good** — slug-glued:

> Phase 7 sign-off. Implementation conforms to `ADR-0001-topology-derivation-five-pass`, `ADR-0017-event-payload-canonical`, and `CR-0010-component-ci-pipeline`. `NFR-02-cost-cap` budget respected. Touches `FR-04-deploy-rollback` and the new `ASR-03-availability-budget` derivation. Affected D-decisions: `D17-delivery-modes`, `D25-classical-architect`, `D28-skill-runner-boundary`.

Reader knows every citation at a glance; `grep -r D28-skill-runner-boundary core/MIGRATIONS/` returns the spec.

**Issue refs stay bare.** `Closes #87`, `[PR #84](...)`, git SHAs are correct as-is — only internal taxonomy IDs are in scope.

**Lookup failure** — surface inline (`D28-?? (slug lookup failed)`); carry forward; never invent.

Full lookup table + self-lint regex: `core/protocols/doc-authoring-protocol.md § Taxonomy identifier pairing (D34)`.

---

## 14. Release-notes sidecar bullet (D40)

Sidecar bullets (`.github/release-notes/v*.md`) lead with adopter-visible benefit, stay ≤ 20 words, end with `(D<N>)` tag. Implementation jargon belongs in the migration spec, not the marketing layer.

**Bad** — dense framework-dev paragraph masquerading as a bullet:

> - D31 introduces three vendor-neutral tiers (reasoning · standard · fast) declared as role-kernel `default-tier:` with per-adapter `<tier> → <id>` map. Resolution: per-task prefix `model:<tier>` → Phase-3 answer → `local/framework.config.yaml § model-tier.per-role.<role>` → kernel `default-tier:`. Claude adapter writes `model: <id>` into `.claude/agents/<role>.md` frontmatter; non-Claude adapters emit install warning. Purely additive — absent `model-tier:` → defaults apply.

Trips checks 1 (75+ words), 2 (no adopter-visible benefit at line start; `default-tier:` jargon), 3 (D-tag buried), 4 (resolution chain + adapter writeback are migration-spec content).

**Good** — Pass-4 shape from v0.12.0 PR #80:

> - **Lower LLM bills** — cheaper models on execution work, capable ones stay on orchestration + architecture. Out of the box. (D31)
> - **Per-task model override** — prefix any dispatch with `model:reasoning` / `model:standard` / `model:fast`. (D31)

Each bullet: adopter-visible verb / outcome at start · concrete user benefit · ≤ 20 words · `(D<N>)` tag. The migration spec + verbose CHANGELOG entry carry the resolution chain + adapter writeback; sidecar carries only what an adopter needs to decide whether to bump.

Full surface topology + self-lint checks: `core/changelog-protocol.md`.
