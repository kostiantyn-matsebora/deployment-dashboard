# Doc roles — all-roles authorship + ai-engineer shape

**Load-on-demand.**

- Fetched when:
  - A new role-owned doc lands.
  - A doc grows past size threshold or exhibits duplication.
  - A cross-reference repair is needed across multiple docs.
  - A structure dispute surfaces between authoring role and `ai-engineer`.
- Default tasks do not load this file.

**Renamed from `core/doc-co-ownership.md` per D25.** Pre-D25 model was SA ↔ ai-engineer two-role co-ownership. D25 generalizes — every role authors content in its domain; `ai-engineer` owns shape + load topology across the whole set.

## Authorship — per role, per doc class

| Doc class | Author |
|---|---|
| Architecture doc · ADRs · diagrams · requirements register (`local/requirements.md`) · ASR utility tree (`local/asr-utility-tree.md`) | `solution-architect` |
| CRs · project-instruction file (`CLAUDE.md` / `AGENTS.md` / equivalent) · work-breakdown doc | `team-lead` |
| CI/CD guide · infrastructure runbooks · deployment guides | `devops-engineer` |
| Backend READMEs · API docs · service docs | `backend-engineer` |
| Frontend READMEs · component docs · style guides | `frontend-engineer` |
| Test plans · scenario docs · QA reports | `qa-engineer` |
| Mockup | mockup-owning role (default `frontend-engineer`) |
| Role definitions (`core/roles/*.md`) · process spec (`core/process.md`) · skills (`core/skills/`) | upstream framework (this repo); adopter authors `local/roles/` only |

## Ownership split — semantics vs shape

- **Author owns semantics** — the rules, invariants, requirements, routing entries, gates the doc carries. Adding / removing / rewording any is the author's call.
- **`ai-engineer` owns shape + load topology** — structure (tables vs prose), file splits, cross-reference integrity, byte / line discipline. Never changes semantics.
- Neither overrides the other's invariants.

Runs under `core/iteration-protocol.md`.

## Routing — who edits when

| Scenario | Routing |
|---|---|
| New rule / invariant / routing entry / governance decision → write content | **Owning role** (per the table above). `ai-engineer` may run a structural pass after. |
| Existing doc grows past size threshold OR exhibits duplication | `ai-engineer` compacts / splits. Author post-reviews to verify no rule lost. |
| Cross-references break from a split or move | `ai-engineer` updates references. Author verifies semantic continuity. |
| Doc edit needed AND scope is unclear (which role owns?) | `team-lead` resolves via `local/bindings.md § Source-of-truth ownership`. |
| Doc edit needed AND scope is clear, but spans semantics + shape | Pair-dispatch in one phase — author edits content; `ai-engineer` edits shape. Author first. |
| Author wants prose for clarity; `ai-engineer` wants table for compactness | Author wins on semantics. `ai-engineer` may propose alternative structure that preserves clarity. |
| Architectural coherence concern raised on a non-SA-owned doc | `solution-architect` reviews per `core/roles/solution-architect.md § Review`. APPROVE / REJECT / REQUEST-CHANGES; never edits the doc. |

## SA architectural-coherence review

Per D25, every non-SA-owned doc edit is **SA-reviewed for architectural coherence** before merge. This folds into the SA Review activity (`core/roles/solution-architect.md § Review`):

- **Trigger.** Engineer / team-lead / mockup-owning role proposes a doc edit that touches an architectural concern (component name · contract · stack reference · NFR-bearing claim · invariant).
- **Outcome.** APPROVE / REJECT / REQUEST-CHANGES. No edits to the engineer's doc.
- **Out of scope for review.** Pure-engineering wording inside a doc that does not touch architectural concerns (e.g. a code snippet's example value, a phrasing nuance in a README). Author judgment.

## Hard rule — `ai-engineer`'s edits are lossless

- Before completing any optimization pass, `ai-engineer` must spot-check every rule, invariant, routing entry, and gate in the diff.
- Each must appear (verbatim or semantically identical) in the new structure.
- Any miss → revert and re-plan.

Same rule as pre-D25. Applies across the whole doc set now, not just SA-owned docs.

## Dispatch trigger

`ai-engineer` is not part of the standard Phase 1–8 lifecycle. Invoked between phases when:

- User explicitly targets AI-asset or doc optimization.
- An authoring role flags *"this doc is getting unwieldy"* in their final report.
- Periodic maintenance (release cadence, post-large-feature cleanup).
- Phase 8 post-acceptance doc-optimization hook fires (see `core/process.md § Phase 8`).
