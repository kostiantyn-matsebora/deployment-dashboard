# Migration — D25: Classical-architect SA model + doc-ownership redistribution

**Target release:** next minor after 2026-05-22.
**Affected adopters:** every adopter project (doc-ownership map changes for ALL adopters).

## What changed

`solution-architect` redefined from central-scribe + Phase-7-only sign-off to a **classical architect** with three activities across the lifecycle:

| Activity | When | What |
|---|---|---|
| **Design** | Phase 1 elicit + Phase 2 target architecture | Authors `local/requirements.md` (FRs / NFRs / Constraints) + `local/asr-utility-tree.md` (ASRs derived via ATAM) + architecture doc + ADRs + diagrams |
| **Review** | Any phase | APPROVE / REJECT / REQUEST-CHANGES on engineer-proposed architectural changes; no code edits |
| **Governance** | Continuous, scoped to PRs touching SA-owned files | Spot-check engineer deltas against architecture invariants; flag drift; dispatch back to owning engineer |

**Doc-ownership redistribution.** SA no longer the scribe for everything:

| Doc class | Pre-D25 owner | D25 owner |
|---|---|---|
| Architecture doc · ADRs · diagrams | `solution-architect` | `solution-architect` (unchanged) |
| **Requirements register (`local/requirements.md`)** | implicit in architecture doc | `solution-architect` (D25 — new explicit file) |
| **ASR utility tree (`local/asr-utility-tree.md`)** | not modelled | `solution-architect` (D25 — new explicit file) |
| **CRs** | `solution-architect` | **`team-lead`** |
| **Project-instruction file** | `solution-architect` | **`team-lead`** |
| **Work-breakdown doc** | `solution-architect` | **`team-lead`** |
| **CI/CD guide · infra runbooks** | `solution-architect` | **`devops-engineer`** |
| **Backend READMEs · API docs · service docs** | `solution-architect` | **`backend-engineer`** |
| **Frontend READMEs · component docs** | `solution-architect` | **`frontend-engineer`** |
| **Test plans · scenario docs · QA reports** | `solution-architect` | **`qa-engineer`** |
| Mockup | mockup-owning role | mockup-owning role (unchanged) |

**`ai-engineer` counterpart generalized.** Was SA ↔ ai-engineer two-role co-ownership; now all-roles ↔ ai-engineer. `core/doc-co-ownership.md` **renamed** to `core/doc-roles.md` + rewritten.

**Phase hooks added** to `core/process.md`:

- Phase 1 → SA design dip (elicit + ASR derivation).
- Phase 2 → SA authors target architecture.
- Phase 4 → SA governance dip (scoped — only on PRs touching SA-owned files).
- Phase 5 → SA governance dip (if test surfaces architectural concerns).
- Phase 6 → SA review (if a fix proposes an architectural change).
- Phase 7 → unchanged in spirit; **lighter** because governance ran continuously.

**SA Phase 7 review** gains an additional check: ASR coverage — every ASR touched by the change is addressed by ≥ 1 ADR or architecture-doc section.

## Action required — re-attribution sweep on rediscovery

**Per the user-confirmed migration choice (Q6 — force re-attribution sweep).** Adopters MUST run `@team-lead rediscover` (or `/ginee-rediscover`) on next framework upgrade. Discovery:

1. **Re-attributes** existing adopter docs to the new owners per the table above.
2. **Greenfield-flag detection** — if no architecture doc detected, flags the project as greenfield in `local/project-profile.md`; SA enters greenfield design mode on first non-trivial task.
3. **Multi-architect slot** — adds optional `local/bindings.md § Architects` section (single-architect default; populate only for multi-architect projects).
4. **New templates land in `local/`** — `local/requirements.md` + `local/asr-utility-tree.md` populated from the discovered architecture doc + NFR / Constraint sections; SA verifies on Phase 1 of next task.

The sweep is adopter-initiated (never automatic). Until `rediscover` runs, existing docs continue to work under the old ownership map — but SA dispatches that previously authored CRs / per-tier docs will now route to `team-lead` / tier engineers per the new spec.

## Files affected (framework upstream)

**Renamed:**

- `core/doc-co-ownership.md` → `core/doc-roles.md`

**Rewritten:**

- `core/roles/solution-architect.md`
- `core/roles/solution-architect.details.md` (CR template removed; change-request flow renamed)
- `core/roles/team-lead.md` (added "What you author" section)
- `core/roles/team-lead.details.md` (added CR template)
- `core/roles/ai-engineer.md` (generalized counterpart)
- `core/roles/backend-engineer.md` (added doc-authorship + propose-arch-change)
- `core/roles/frontend-engineer.md` (same)
- `core/roles/devops-engineer.md` (same)
- `core/roles/qa-engineer.md` (same)

**Updated:**

- `core/process.md` — Phase 1 / 2 / 4 / 5 / 6 / 7 hooks + Doc-roles section retitled
- `core/iteration-protocol.md` — refs generalized
- `core/templates/bindings.md` — ownership table extended

**New:**

- `core/templates/requirements-register.md` → `local/requirements.md` (FR / NFR / Constraints)
- `core/templates/asr-utility-tree.md` → `local/asr-utility-tree.md` (ASR utility tree)

**Adapter pointers refreshed (7 files):**

- `adapters/_shared/agents/{solution-architect,team-lead,ai-engineer,backend-engineer,frontend-engineer,devops-engineer,qa-engineer}.md`

## Backward compatibility

- **No `local/` schema break.** Adopters' existing `local/bindings.md` continues to work; the ownership-table extension is additive.
- **Existing CRs / project-instruction files / per-tier docs** continue under the new owners on next edit. team-lead picks up where SA left off for CRs; tier engineers pick up READMEs / API docs / etc.
- **Old `core/doc-co-ownership.md` references** in adopter-authored `local/roles/*.md` → manual update needed to point at `core/doc-roles.md`. Adopters who haven't authored custom roles aren't affected.

## Rollback

Not recommended. The classical-architect model is the larger-scope framing of the SA role; rolling back would re-couple unrelated authoring concerns to SA. If a project genuinely needs the old model:

1. Restore `core/doc-co-ownership.md` from pre-D25 framework version.
2. Revert all 7 role kernels under `core/roles/`.
3. Revert `core/process.md § Doc roles` section.
4. Adopter re-authors `local/bindings.md` ownership table to the old map.

## Issue reference

Implemented per [issue #37](https://github.com/kostiantyn-matsebora/ginee/issues/37) — "Redefine solution-architect role — classical design + review + governance across the lifecycle".
