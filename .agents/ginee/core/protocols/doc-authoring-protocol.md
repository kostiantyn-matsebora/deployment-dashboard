---
audience: all-cardinals
load: on-demand
triggers: [doc-authoring, documentation, structure-over-prose, self-lint]
cap-bytes: 8192
reads-before-applying: []
---

# Doc-authoring protocol — adopter docs + ginee-authored GitHub artefacts + subagent returns

**Load-on-demand at Phase 5 / report-as-done** for any doc-touching task. Default shape rules + mandatory checks live in `core/process.md § Documentation style` (always-loaded); this file carries scope + enforcement + attestation.

Examples gallery: `core/protocols/doc-authoring-examples.md` (load on first-time authoring / explicit request).

## Scope

| Surface | Authored by |
|---|---|
| Architecture doc · ADRs · CRs · READMEs · runbooks · scenarios · API docs | adopter roles per `core/protocols/doc-roles.md` |
| Project-instruction file (`CLAUDE.md` / `AGENTS.md` / equivalent) | `team-lead` |
| Role definitions (`core/roles/`, `local/roles/`) · framework specs · skills | framework upstream / adopter `local/roles/` |
| **GitHub issue bodies** authored via `ginee-file-*` skills | `team-lead` (orchestrator drafts; user approves) |
| **Framework-authored GitHub comments** — Phase-transition · sticky `ginee:score` / `ginee:review-cycle` · audit comments · per-thread review-replies | `team-lead` + specialists per the comment-cadence procedures |
| **Subagent returns** — every cardinal-dispatch return per `core/templates/phase-report.md` schema | every cardinal role |
| **Release surfaces** — `docs/CHANGELOG.md` entries · `.github/release-notes/v*.md` sidecars — surface-specific voice + word cap per `core/protocols/changelog-protocol.md` | framework maintainers drafting release artefacts |

**The lint covers every section, including Summary.** No section-by-length exemption — a one-sentence Summary still trips the mandatory checks if it packs a comma-separated inventory into a parenthetical.

**Subagent-return surface adds a 7th check** — *no narrative preamble* (first non-Status line must be a `##` section header). The 6 standing checks apply unchanged. Full schema: `core/templates/phase-report.md`.

## Mandatory check — binding-strength signal

Authored markdown signals binding strength via RFC 2119 keywords:

- **MUST · MUST NOT · SHOULD · SHOULD NOT · MAY** — the only modifiers that carry normative weight.
- Do not use `always` / `never` / `binding` / `mandatory` / `required` as rule modifiers. They read as RFC 2119 synonyms without the precision; LLMs spend interpretation cycles disambiguating.
- Imperative voice alone is permitted inside numbered procedures where every step is implicitly MUST.

Single binding-strength convention removes the ambiguity from prior mixed signalling (bold-italic-caps for emphasis, `always` for MUST, `binding` for MUST NOT-bypass). The 6 standing checks (per `core/process.md § Documentation style § Mandatory checks before report-as-done`) gain this as check #6; the subagent-return surface's *no narrative preamble* becomes check #7.

## Enforcement via discovered stack

ginee does **not** ship a doc linter. Adopter projects already configure markdown / prose tooling — ginee discovers it and triggers it.

| Stage | Mechanism |
|---|---|
| Discovery | `team-lead` records the lint command in `local/index/commands.yaml § commands.lint.docs` via the existing `builtin:commands` recipe. Linter configs (markdownlint / vale / proselint / prettier-md) recorded in `local/index/conventions.yaml` via `builtin:conventions`. |
| Author | Role consults `core/process.md § Documentation style` (always-loaded) for shape rules + mandatory checks. |
| Enforce | Role runs `${commands.lint.docs}` at Phase 5 / report-as-done; lint output goes into the phase report's Verification log. |
| No tool detected | Discovery report recommends a baseline — markdownlint (structural) + vale (prose). Adopter decides — never auto-install. |

## Attestation

Phase-report Verification-log entry (one line):

```
Doc-style protocol — <linter command>: PASS / N findings (see <path>).
```

If no linter discovered: `Doc-style protocol — no linter configured; self-checked against core/process.md § Mandatory checks.`

## Bypass

Binding. Bypass only via explicit user direction recorded in the phase report. Never silent.

## Enforcement for ginee-authored GitHub artefacts

Different from adopter-doc enforcement (which piggybacks on the discovered linter). For issue bodies + ginee-authored comments:

| Stage | Mechanism |
|---|---|
| Author | `ginee-file-*` skill drafts the body. Specialist drafts a Phase-transition / sticky / review-reply comment. |
| Self-lint | Author role runs the `core/process.md § Mandatory checks` against the drafted text + the audience check below **before** publishing — every section, including Summary. |
| Violation | Surfaces as a suggestion in the user-approval prompt. User accepts the restructure / rejects / overrides. No silent publish. |
| Publish | Only after user approval of the linted draft. |

**No external linter.** The check is LLM self-review against the 6 mandatory rules used for adopter docs + the audience check.

### Audience check — humans + LLMs

ginee GitHub artefacts MUST serve two audiences — humans (contractors · future maintainers · cold reviewers) AND LLMs (next-session pickup · cardinal dispatch · triage scoring). LLM-only voice (`[6:frontend-engineer] Stage 1 forensic — confirm Bug C/D root cause (#92 iteration 1)`) is opaque to a cold human reader; human-only voice loses the framework hooks LLMs route by.

**Five binding checks** — applies to issue bodies (`core/templates/issues/*.md`) · sub-issue dispatches (`core/templates/sub-issue-dispatch.md`) · framework-authored issue comments · PR descriptions (`core/templates/pr-description.md § What`):

1. **Title — user-facing language.** Describes the problem / request / outcome a human can act on cold. Sub-issue framework prefix `[<phase>:<cardinal>]` stays; the `<task-one-liner>` is outcome-shaped, not investigation-shaped.
2. **First paragraph — 2-4 sentence human summary.** Restates the title for a cold reader. No jargon · no assumed prior context · no internal identifiers.
3. **Bug reports — numbered steps to reproduce.** Reader MUST be able to repro without loading the framework.
4. **Framework-internal sections AFTER the human summary.** Dispatch contract · investigation notes · forensic links · ADR amendments · root-cause hypotheses live in clearly-labelled later sections. MUST NOT lead with internals.
5. **Forbidden in title.** Internal bug identifiers (`Bug C` · `OV1` · `Stage 1 forensic`) · framework-internal phase / iteration tags beyond `[<phase>:<cardinal>]` (`(#92 iteration 1)` · `cycle 2-ter` · `Phase B`) · file paths · module names · code-level technical terms · references to root causes or fix mechanisms.

**Title-shape examples** (canonical — peers cite this table):

| LLM-only (forbidden) | Human + LLM (binding) |
|---|---|
| `[4:backend-engineer] Implement /v1/items pagination per ADR-0014-cursor-pagination` | `[4:backend-engineer] Add cursor-based pagination to the items list endpoint so SPAs can scroll past 1k results` |
| `[6:frontend-engineer] Stage 1 forensic — confirm Bug C/D root cause on demo-gha data (#92 iteration 1)` | `[6:frontend-engineer] Investigate why deployment tiles render as isolated nodes without connecting graph edges` |
| `[6:qa-engineer] Overlap-invariants regression spec — permanent CI gate (#83 framework hygiene)` | `[6:qa-engineer] Add automated tests that catch when deployment tiles overlap or leak past service-row boundaries` |
| `[6:solution-architect] Stage 2a: ADR-0012 amendment per iteration-1 forensic (§4 + §5 + §2)` | `[6:solution-architect] Update the ngx-graph layout contract so deployment tiles render as a DAG instead of stacked nodes` |
| `[7:solution-architect] Governance review of PR #142` | `[7:solution-architect] Review whether the new pagination endpoint preserves backward compatibility for v0 SPA clients` |
| `[Feature] Migrate frontend graph + connector rendering to @swimlane/ngx-graph` | `[Feature] Replace bespoke connector lines between deployment tiles with the ngx-graph library so branching pipelines render without crossing arrows` |

**Scope of binding.**

| Surface | In scope |
|---|---|
| Issue bodies via `ginee-file-*` | yes — titles + first paragraphs + section ordering |
| Sub-issue dispatches via team-lead | yes — title `<task-one-liner>` + first body paragraph |
| Framework-authored issue / PR comments | yes — first line per `core/templates/pr-comment-cadence.md` matches the audience principle |
| `core/templates/pr-description.md § What` | yes — adopter-visible change at line start; framework mechanics in later sections |
| User-response surface (orchestrator → user) | yes — `core/templates/user-response.md § Decision-led header` carries the same principle |
| Phase-report returns (cardinal → orchestrator) | no — internal surface; `core/templates/phase-report.md` governs |
| Dispatch-prompt payloads (orchestrator → cardinal) | no — internal surface; `core/protocols/dispatch-prompt-schema.md` governs |

**Out of scope.** Reporter-authored bodies + comments (MUST NOT auto-edit; `core/protocols/github-integration.md § Forbidden actions`). Discussion bodies (read-only context). Adopter docs governed by the discovered linter — adopter's own audience conventions apply.

## Enforcement for subagent returns

Returns are ephemeral (consumed by the orchestrator in-thread, not published), so the loop closes inside the dispatched role:

| Stage | Mechanism |
|---|---|
| Author | Dispatched cardinal drafts the return per `core/templates/phase-report.md` schema. |
| Self-lint | Role runs the 7 mandatory checks (6 standing + *no narrative preamble*) against the draft **before** returning. Violations → restructure; un-restructurable content → lift into capped `## Notes`. |
| Violation reaches orchestrator | `team-lead` surfaces a one-line advisory (`"Return missed self-lint: <violation>; consuming anyway"`), consumes the return, never re-dispatches purely for format, never auto-rewrites (analogous to the reporter-content forbidden rule in `core/protocols/github-integration.md § Forbidden actions`). |
| Iteration-protocol intermediate return | Same schema with sections marked `(in-progress)`; `## Stop-state` required; `Status: In-progress`. |
| Failed dispatch (forced handoff per `core/protocols/cross-agent-handoff.md`) | Same schema + required `## Hand-off` section embedding `core/templates/hand-off-note.md`. |

**No external linter.** LLM self-review against the schema; identical machinery to the adopter-doc enforcement loop. Forward-only — previously returns are not retroactively rewritten.
