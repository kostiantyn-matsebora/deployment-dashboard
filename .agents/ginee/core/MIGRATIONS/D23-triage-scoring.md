# D23 — Triage scoring (value × complexity)

**Date.** 2026-05-20.
**Closes.** [#46](https://github.com/kostiantyn-matsebora/ginee/issues/46).

## What changed

- `ginee-triage` ranks ready work by **score = value / complexity** (default WSJF) instead of age alone.
- Two new label namespaces — `value:high|medium|low` + `complexity:high|medium|low` — carry the data; labels are source-of-truth. ATAM / utility-tree convention.
- Score formula maps `H = 3`, `M = 2`, `L = 1`.
- TODO files gain `[v:H c:L]` inline markers (case-insensitive) with identical semantics.
- `team-lead` posts a sticky `<!-- ginee:score v=1 -->` comment on pickup (one per issue, updated in place) + immutable audit comments on key events (SA auto-estimate, value-prompt, score-recompute). Sticky table includes a `Reasoning` column populated only for ginee-set rows.
- New trigger `@team-lead recompute score #<N>` re-reads current labels (catches manual `gh issue edit` between sessions) and refreshes the sticky.

New artefacts:

- `core/triage-scoring.md` — spec (axes, formula, label provisioning, auto-estimate hook, TODO syntax, sort contract).
- New `triage:` block in `core/templates/framework.config.yaml`.

Modified:

- `core/process.md § Task model` — TODO marker syntax noted; new spec-section pointer.
- `core/github-integration.md § Triage` — sort key now score-based; `§ Label scheme` lists scoring labels; pickup adds sticky-comment write.
- `core/roles/team-lead.md` — pickup adds value-prompt + complexity-auto-estimate + sticky-comment write; new `recompute score #<N>` trigger; triage sorts by score.
- `core/skills/ginee-triage/SKILL.md` — score column + sort.
- `core/skills/ginee-pick-up/SKILL.md` — auto-estimate + sticky-comment hook.
- 4 × `core/templates/issues/*.md` — reporter note on the two label namespaces.

## Action required

### Adopters

After re-fetching framework files on upgrade:

1. **(Optional) Provision labels eagerly.** `team-lead` creates missing labels on first triage / pickup. Pre-create to set custom colors:
   ```
   gh label create value:high --color b60205 --description "ginee triage: ATAM importance — high"
   # ... see core/triage-scoring.md § Labels — first-use provisioning (6 labels total)
   ```
2. **(Optional) Override the scoring formula** in `local/framework.config.yaml`:
   ```yaml
   triage:
     scoring-formula: value-over-complexity   # | value-only | value-minus-complexity
   ```
3. **(Optional) Annotate existing TODOs** with `☐ [v:H c:L] Description` (H/M/L, case-insensitive). Untagged TODOs continue to work — they sort last as "unscored".

### Behavioural change to expect

- `ginee-triage` table gains `v` / `c` / `Score` columns; sort key becomes `Score DESC, Age DESC`.
- On pickup, if `complexity:*` is missing, `team-lead` dispatches `solution-architect` for an H / M / L estimate (recorded as a comment + label).
- On pickup, if `value:*` is missing, `team-lead` asks the user before Phase 2.
- Unscored items group at the bottom of the listing — pre-D23 order preserved for those.
- A sticky `<!-- ginee:score v=1 -->` comment lands on every issue ginee picks up. Auto-updated in place; never edit manually. Run `@team-lead recompute score #<N>` to refresh after a manual label change.

## Why labels (not body fields, not marker comments)

Option B (label namespace) chosen over A (body field) and C (sidecar marker comments):

| Option | Pro | Con |
|---|---|---|
| A — body sections | Zero infrastructure | Regex-on-body; mutation = body edit; no GH API filter |
| B — labels (chosen) | Queryable; structured; native GH UI; reuses `ginee:*` precedent (D14) | Provisions 10 labels per repo (auto-created) |
| C — marker comments | Audit trail; separates user vs auto | Most moving parts; noisy comment stream; new convention to spec |

Labels match the existing framework idiom; adopters already use `ginee:ready` / `:in-progress` / `:blocked`. Reuse > novelty.

## Tests — spec examples, not a runtime script

The issue's AC ("tests cover score computation + sort order + unscored fallback") is fulfilled by the **worked-sort fixture** in `core/triage-scoring.md § Examples`. No `.ps1` / `.sh` helper ships because:

- All other ginee skills are LLM-driven markdown specs; no skill ships runtime code.
- A helper would require pwsh / bash in every adopter environment for what is a one-line ratio.
- The spec fixture is the binding test contract; future change to sort order must keep the fixture passing.

## Cross-issue ordering

| Issue | State | Coupling |
|---|---|---|
| [#46](https://github.com/kostiantyn-matsebora/ginee/issues/46) | this PR | — |
| Future: per-team priority overrides | not filed | Out of scope; restart on demand if leverage proven. |

## Activation

Automatic on update. Adopters with no labels see "Unscored" listings identical to pre-D23 age-order.

## Rollback

- Delete the `triage:` block from `local/framework.config.yaml`.
- Pin `core/VERSION` to the pre-D23 release (or re-fetch the older `core/`).
- `value:*` / `complexity:*` labels are inert if `ginee-triage` no longer reads them — leave or delete at adopter's choice.
