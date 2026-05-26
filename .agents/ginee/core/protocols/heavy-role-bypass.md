---
audience: team-lead-only
load: on-demand
triggers: [heavy-role-bypass, team-lead-bypass, sa-bypass, fast-path]
cap-bytes: 12000
reads-before-applying: []
---

# Heavy-role bypass

**Load-on-demand.** Fetched by `team-lead` when resolving Phase 4–7 dispatch and the persistence-artefact gate may elide its own or `solution-architect`'s presence. Loaded once per task; cardinals never load it.

## Principle

**Heavy roles are invocation-gated, not phase-gated.** Default is *skip*; dispatch only when the relevant persistence artefact is absent OR a re-entry trigger fires. Presence requires affirmative justification.

**Scope (in).** Phase 4 (Implementation) · 5 (Testing) · 6 (Bug fixing) · 7 (SA review).

**Scope (out — heavy role stays load-bearing).**

| Phase | `team-lead` | `solution-architect` |
|---|---|---|
| 1 — Analysis | always | always (design dip) |
| 2 — Design | always | always (architecture / ADRs) |
| 3 — Design review | always (synchronous user gate) | n/a |
| 8 — User approval | always (delivery finalize) | n/a |

## Persistence-artefact table — bypass valid when artefact present

| Heavy role | Persistence artefact | Bypass valid when ALL hold |
|---|---|---|
| `team-lead` | `ginee:role:*` label + dispatch-contract body (`core/templates/sub-issue-dispatch.md`) | Single role label · dispatch contract present · acceptance criteria unambiguous |
| `solution-architect` | Blueprint + ADRs + acceptance criteria at Phase 2 | AC unambiguous on design intent · no `local/bindings.md`-SA-owned-file edit in diff · no NFR-oracle red |

Absence of the artefact (or any condition unmet) → heavy role dispatched normally.

## Universal re-entry trigger table — heavy role MUST be re-loaded when

| Trigger | Re-loads | Source |
|---|---|---|
| Role label missing or conflicting on sub-issue | `team-lead` | `core/skills/ginee-pick-up/SKILL.md § Step 2.5` |
| Returned `## Open issues` non-empty | `team-lead` | cross-cardinal synthesis needed |
| Returned `## Hand-off` set | `team-lead` | routing change |
| Returned `Status: In-progress` | `team-lead` | stop-state re-decision |
| Cross-domain bug surfaced | `team-lead` | `core/protocols/cross-domain-bugs.md` |
| Multi-cardinal PR (≥ 2 owned-path sets) | `team-lead` | Phase 7 lead-elision — see § Phase 7 |
| PR touches `local/bindings.md` SA-owned path | `solution-architect` | `core/process/phase-4-implementation.md § governance dip` |
| NFR-oracle red | `solution-architect` | `core/process/phase-5-testing.md § governance dip` |
| Fix proposal crosses blueprint-diff threshold | `solution-architect` | `core/protocols/blueprint-diff-protocol.md` |
| Engineer proposes architectural change mid-phase | `solution-architect` | `core/process/phase-4-implementation.md § review on in-flight proposals` |

## Per-phase track tables

### Team-lead track

| # | Fast-path | Phase | Default behaviour | First instance |
|---|---|---|---|---|
| TL1 | Sub-issue pickup | 4 (entry) | Direct cardinal dispatch; `@team-lead` not re-routed | [#152](https://github.com/kostiantyn-matsebora/ginee/issues/152) — `migrations/sub-issue-fast-path.md` |
| TL2 | Single-cardinal verification | 5 | `qa-engineer` runs against AC, returns to owning cardinal; `@team-lead` skipped | This protocol |
| TL3 | Intra-domain bug-fix | 6 | Owning engineer fixes; `@team-lead` re-entered only on cross-domain bug | This protocol |
| TL4 | Phase 7 lead-elision | 7 | Single-cardinal PR → SA → user; `@team-lead` re-entered only on multi-cardinal PR or REJECT | This protocol |

### SA track

| # | Fast-path | Phase | Default behaviour |
|---|---|---|---|
| SA1 | Phase 4 SA-default-skip | 4 | No SA dispatch unless owned-file edit present in diff |
| SA2 | Phase 5 SA-default-skip on green NFR | 5 | All-green NFR run skips SA; SA fires only on red oracle |
| SA3 | Phase 6 SA-default-skip on local fix | 6 | Engineer → engineer for non-architectural fixes; SA fires only when proposal touches blueprint-diff threshold |

## Phase 7 — lead-elision detail (TL4)

Single-cardinal PR (exactly one owned-path set per `local/bindings.md`) — Phase 7 collapses to `solution-architect` → user. `team-lead` re-enters only when:

| Condition | Action |
|---|---|
| Multi-cardinal PR (≥ 2 owned-path sets) | `team-lead` re-enters as gate surface |
| SA returns REJECT or REQUEST-CHANGES | `team-lead` re-enters to dispatch Phase 6 |
| Cross-domain bug surfaced during sign-off | `team-lead` re-enters per `core/protocols/cross-domain-bugs.md` |
| Phase 8 finalize handback in auto mode | `team-lead` re-enters at Phase 8 (separate invariant) |

## Forbiddens — bypass does NOT mean orchestration-free

- **Skill-runner.** Never synthesizes returns, reads `local/bindings.md` to settle routing, or proposes defaults. Same boundary as `core/process/dispatch.md § Skill-runner — surface boundary`.
- **Cardinals under bypass.** Author phase-reports per `core/templates/phase-report.md` schema; `## Open issues` / `## Hand-off` / `Status` fields ARE the re-entry signal — never omit when set.
- **Default-skip is the default.** Habitual `@team-lead` / `@solution-architect` dispatch with no trigger is the failure mode. Self-check before each Phase 4–7 heavy-role dispatch: *"Which row of the persistence-artefact table OR re-entry trigger table justifies this load?"* No match → skip.

## Transcript-grep recipes

| Grep | Purpose |
|---|---|
| `@team-lead` invocations in Phase 4–6 windows | Match each against re-entry trigger table. Unmatched → defensive — log advisory. |
| `@solution-architect` dispatches outside Phase 1 / 2 / 7 | Match each against persistence-artefact table OR SA-track triggers. Unmatched → defensive. |
| `## Open issues\n(none)` next to `@team-lead` re-dispatch | Dispatch after a clean return — defensive. |
| `Status: Done` + `## Hand-off` empty + `@team-lead` immediate re-entry | Same — no trigger fired. |

Advisories surface one-line; never auto-rewrite. Aim is to retrain orchestrators, not to gate post-hoc.

