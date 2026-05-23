# Migration — D30: adopt-existing-solution as a first-class Phase-2 option

**Target release:** next minor after 2026-05-23.
**Affected adopters:** every adopter on every adapter — opt-in; no breaking change.

## What changed

D30 binds every Phase-2 design proposal **and** every iteration-protocol Propose step (Phase 4–7 sub-tasks > 15 min) to include **≥ 1 adopt-existing-solution candidate** — or an explicit `(none viable — <reason>)` cite. Pre-D30 the framework had no rule binding proposers to surface adoption candidates; specialists defaulted to authoring novel implementations when no rule forced them to look outward first.

Same machinery as D22 / D26 / D29 — LLM self-review against a small mandatory-checks list; no external linter; reviewer surfaces a one-line advisory on violation but never auto-rewrites.

## Schema · floor · tagging · checks · forbidden patterns

Full canonical spec: `core/options-protocol.md`. Summary:

- **Candidate types** — `adopt` (name · version · source · license · fit) · `build` (scope · rejection rationale) · `hybrid` (adopt + build + boundary) · `(none viable — <reason>)`.
- **Floor** — Hard: ≥ 1 `adopt` OR `(none viable)`. Soft: 2–3 candidates for non-trivial scope.
- **Tagging** — explicit `adopt` / `build` / `hybrid` per candidate; no silent mixing.
- **5 mandatory checks** — adopt floor · citations complete · tagging explicit · empty research documented · fit rationale concrete (`core/options-protocol.md § 5 mandatory checks`).
- **Forbidden** — silent skip · build-only on a live axis · hand-waved candidate · silent mix · citation without fit (`core/options-protocol.md § Forbidden patterns`).

## Open-question picks

| Question | Resolution |
|---|---|
| Phase scope | Phase 2 + iteration-protocol Propose (Phase 4–7 > 15-min sub-tasks where adopt-vs-build is a live axis). |
| Candidate-count floor | Hard ≥ 1; soft 2–3 for non-trivial scope. |
| Empty-research documentation | `(none viable — <reason>)` cite. Mirrors D29 `(none)` empty-section convention. |
| License + supply-chain stance | Defer to adopter `local/`. Framework requires citation only. |
| Research depth | Cite-only baseline (name · version · source · license · fit). SBOM / full-ADR are escalations the proposer MAY adopt. |
| Spec topology | New load-on-demand `core/options-protocol.md`; tiny pointer in always-loaded `process.md § Phase 2` + `iteration-protocol.md § Propose`. |
| `ai-engineer` byte cap | None on the option list; bounded by iteration-protocol estimation + D29 `## Notes` carve-out (≤ 200 words) if it appears in a return. |
| D-number | D30 (D29 just landed). |

## Enforcement

LLM self-review against the schema **before surfacing**. No external linter.

| Stage | Mechanism |
|---|---|
| Author | Drafts option list as part of Phase 2 / Propose output. |
| Self-lint | Runs the 5 checks before surfacing. Violations → restructure; un-fixable gap → escalate to user. |
| Orchestrator on non-compliance | One-line advisory (`"Option list missed: <check>; consuming anyway"`), consumes proposal, never re-dispatches purely for format, never auto-rewrites (analogous to D14 reporter-content forbidden + D29 self-lint). |

## Action required — none (adopter-side)

**Purely additive.** No `local/` schema change · no new commands · no adapter re-install. Closed-task proposals unaffected — forward-only. The next Phase 2 design dispatch (or Phase 4–7 > 15-min iteration Propose step) under any cardinal kernel runs the self-lint automatically.

## Files changed (framework upstream)

| Path | Change |
|---|---|
| `core/options-protocol.md` | **NEW** — load-on-demand spec (scope · schema · 5 checks · forbidden patterns · enforcement · worked example) |
| `core/process.md § Phase 2 — Design & architecture` | New 1-line option-shape rule + pointer |
| `core/iteration-protocol.md § Each iteration § Propose` | New bullet — surface adopt-vs-build axis where applicable; cite |
| `core/roles/solution-architect.md § Design § Phase 2` | Adopt-vs-build as a first-class design axis; pointer |
| `core/roles/{backend,frontend,devops,qa,ai}-engineer.md` | 1-line "Adoption research before authoring" pointer above `## Forbidden actions` (×5) |
| `core/doc-authoring-examples.md § 11` | New bad / good example pair — option-list shape |
| `docs/CONCEPTS.md` · `docs/CHEATSHEET.md` · `docs/CHANGELOG.md` | D30 entries |
| `CLAUDE.md` · `PLAN.md` | D30 row |
| `core/MIGRATIONS/D30-adopt-existing-solution.md` | This file (**NEW**) |

## Backward compatibility

- **Adopter `local/*`** — no schema change.
- **Closed-task proposals** — NOT retroactively rewritten. Forward-only.
- **Cardinal role kernels** — 5 engineers + SA gain a 1–2 line pointer; no other surface change.
- **`framework.config.yaml`** — no new keys.
- **Adapter renderings** — none required; spec lives in `core/`.

## Rollback

Not recommended — D30 closes the "LLMs default to authoring novel implementations" failure mode. To revert:

1. Delete `core/options-protocol.md`.
2. Remove option-shape pointer from `core/process.md § Phase 2`.
3. Remove Propose-step bullet from `core/iteration-protocol.md`.
4. Remove adopt-vs-build axis from `core/roles/solution-architect.md § Design § Phase 2`.
5. Remove "Adoption research before authoring" pointer from the 5 engineer kernels.
6. Remove `core/doc-authoring-examples.md § 11`.

Framework still functions; Phase-2 / iteration-protocol proposals return to free-form shape and the failure mode returns.

## Issue reference

Closes [#75](https://github.com/kostiantyn-matsebora/ginee/issues/75) — *"[Framework Feature] Adopt-existing-solution as a first-class Phase-2 option."* Issue body provisionally numbered this decision D30; no later D-decisions landed before pickup — final number **D30**.
