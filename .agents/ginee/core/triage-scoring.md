# Triage scoring (D23) — value × complexity priority

**Load-on-demand.** Fetched when:

- `team-lead` runs the `triage` workflow and needs to compute pickup-order.
- `team-lead` picks up an issue and needs to evaluate / record value + complexity.
- `ginee-triage` / `ginee-pick-up` skills sort or estimate.

Default tasks (freeform, TODOs without `[v:N c:M]` markers) skip this file.

## Why

- Pre-D23 `ginee-triage` ranked by age only — ignored leverage.
- D23 adds two axes — **value** + **complexity** — and a derived **score**.
- Goal: highest-leverage ready work surfaces first.

## Axes + scale

ATAM / utility-tree convention — H/M/L on both axes (Bass / Clements / Kazman, *Software Architecture in Practice*; ATAM ASR scenarios).

| Axis | Source-of-truth | Scale | Meaning |
|---|---|---|---|
| `value` | label `value:high` / `value:medium` / `value:low` | H / M / L | User / business impact once shipped (ATAM "Importance"). Reporter-defined. Framework never auto-guesses. |
| `complexity` | label `complexity:high` / `complexity:medium` / `complexity:low` | H / M / L | Estimated implementation cost (ATAM "Difficulty" — touched files × roles × novel concepts). Reporter or `solution-architect` (auto-estimate on pickup). |

Numeric mapping for the score formula:

| Label | Numeric |
|---|---|
| `high` | 3 |
| `medium` | 2 |
| `low` | 1 |

Both axes optional. Missing axis → "unscored on that axis".

## Score formula

Default — **WSJF-style cost-of-delay over job-size**, with H/M/L mapped to 3/2/1:

```
score = value / complexity            # H=3, M=2, L=1
```

9-cell matrix (rounded to 2 decimals):

| value \ complexity | H | M | L |
|---|---|---|---|
| **H** | 1.00 | 1.50 | 3.00 |
| **M** | 0.67 | 1.00 | 2.00 |
| **L** | 0.33 | 0.50 | 1.00 |

Edge cases:

| Condition | Score | Sort position |
|---|---|---|
| Both axes present | `value / complexity` | Sorted descending; ties broken by age (older first). |
| Only `value` | `value` (imputed `complexity = L = 1`) | Sorted into the main scored list. |
| Only `complexity` | `0` | Unscored — grouped at bottom. |
| Neither | `0` | Unscored — grouped at bottom. |

**Adopter override.** Set `triage.scoring-formula` in `local/framework.config.yaml`:

| Value | Formula |
|---|---|
| `value-over-complexity` (default) | `value / complexity` |
| `value-only` | `value` |
| `value-minus-complexity` | `value - complexity` |

## Source-of-truth = labels

- **Reason:** queryable via `gh api`, mutable via `gh issue edit --add-label`, visible in GitHub UI, consistent with the `ginee:*` namespace from D14.
- **Body fields are not parsed.** Issue templates include a reporter-note comment; only labels bind.
- **Mutation:**
  - Reporter sets at file-time via the issue template (label-picker) or `gh issue create --label value:high --label complexity:low`.
  - `team-lead` adds / replaces via `gh issue edit <N> --remove-label complexity:<old> --add-label complexity:<new>` when auto-estimating.

## Auto-estimation on pickup

**Trigger.** `team-lead` picks up an issue and `complexity:*` is absent.

1. `team-lead` dispatches `solution-architect` with the issue body + repo context.
2. `solution-architect` returns an `H` / `M` / `L` estimate using ATAM-style signals:

   | Signal | Weight | Drives toward |
   |---|---|---|
   | Touched-file count (1 vs many) | high | many → H |
   | Role count (1 vs N domains) | high | N domains → H |
   | Novel concepts (new spec / new role / new ADR needed) | high | novel → H |
   | Existing pattern reuse | reduces estimate | reuse → L |

3. `team-lead` posts a comment recording the estimate (`<!-- ginee:complexity-estimate by=solution-architect value=H -->`) and adds `complexity:high` / `:medium` / `:low` label.
4. Continues normal Phase 1–8 flow.

**Value is never auto-estimated.** Missing `value:*` → `team-lead` asks the user (H / M / L) before proceeding past Phase 1. User answer → label added.

## TODO-line equivalent

Inline marker after the glyph (case-insensitive):

```
☐ [v:H c:L] Implement retry policy for upstream calls    # quick win
☐ [v:H] Investigate flaky pipeline                       # complexity unknown
☐ Refactor logger                                        # both unknown
```

Parser rules:

- Marker is optional. Missing → score 0, sorts last.
- `[v:X]`, `[c:Y]`, or `[v:X c:Y]` — any order.
- `X`, `Y` ∈ `H` / `M` / `L` (case-insensitive). Anything else → ignored, parsed as missing.
- Marker appears between glyph and description; whitespace flexible.

## Ranked listing — `ginee-triage` behaviour

`ginee-triage` displays:

| Source | Ref | Title | v | c | Score | Age |
|---|---|---|---|---|---|---|
| `todo` | `TODO:42` | Bump dep | H | L | 3.00 | — |
| `issue:primary` | `#17` | Fix retry storm | H | M | 1.50 | 4d |
| `issue:primary` | `#21` | New dashboard widget | M | M | 1.00 | 2d |
| `issue:framework` | `#46` | Triage scoring | M | H | 0.67 | 1d |
| `issue:primary` | `#22` | Add feature flag | — | L | 0.00 | 3d |
| `issue:primary` | `#23` | Investigate latency | — | — | 0.00 | 1d |

- Sort key: `Score DESC, Age DESC`.
- Unscored items grouped at the bottom with a one-line header: *"Unscored — leverage unknown; ask reporter or auto-estimate on pickup."*
- Scores rendered to 2 decimals; bytes minimal.

## Examples — worked sort (fixture)

Input:

```yaml
- ref: issue:primary#10  value: H  complexity: L  age-days: 7    # score 3.00
- ref: issue:primary#11  value: H  complexity: M  age-days: 1    # score 1.50
- ref: issue:primary#12  value: H  complexity: H  age-days: 14   # score 1.00
- ref: issue:primary#13  value: ~  complexity: M  age-days: 30   # score 0    (unscored)
- ref: issue:primary#14  value: M  complexity: ~  age-days: 5    # score 2.00 (imputed c=L=1)
- ref: todo:TODO:5       value: L  complexity: L  age-days: ~    # score 1.00
```

Expected sort (test contract for skill + spec compliance):

```
1. #10    (3.00, scored)
2. #14    (2.00, imputed c=L)
3. #11    (1.50, scored)
4. #12    (1.00, scored, older)
5. TODO:5 (1.00, scored, no age)
6. #13    (0.00, unscored — value missing)
```

## Score comment + audit trail

Hybrid topology — **one sticky "current score" comment** maintained by `team-lead` + **immutable audit comments** preserved on key events.

### Sticky comment — current score

- **One per issue.** First posted on pickup (after value-prompt + complexity auto-estimate complete); updated in place on every ginee-driven label change or `@team-lead recompute score #N`.
- **Find / update via the marker header line:** `<!-- ginee:score v=1 -->`. `team-lead` searches issue comments for this marker; updates if found, posts if not. Adopters MUST NOT edit the comment body manually.
- **Strict format:**

  ```
  <!-- ginee:score v=1 -->
  ## Triage score: <combo> = <number>

  | Axis | Label | Numeric | Set by | Reasoning |
  |---|---|---|---|---|
  | value | `<high|medium|low|unscored>` | <3|2|1|—> | <@handle (source)> | <one-line | —> |
  | complexity | `<high|medium|low|unscored>` | <3|2|1|—> | <@handle (source)> | <one-line | —> |

  - Formula: `<formula>` (`<scoring-formula key>`)
  - Last updated: <ISO 8601 UTC> by ginee team-lead
  - Recomputed live by `ginee-triage` from labels — see audit trail below.
  ```

- **`Reasoning` column rules — populated only when ginee set the label:**

  | Row state | `Reasoning` content |
  |---|---|
  | Most-recent change was a ginee auto-estimate | One-line digest (e.g. `1 file · 1 role · pattern reuse → L`) |
  | Most-recent change was the reporter or a user `gh issue edit` | `—` |
  | Axis not yet set | `unscored` |

- **`Set by` column values:**
  - User-set → `@<handle> (reporter)` or `@<handle> (manual edit)`.
  - ginee-set → `@solution-architect (auto-estimate)` (complexity), `@team-lead (imputed c=L)` (missing-axis rule), `@<handle> (user reply to ginee prompt)` (value-prompt at pickup).

- **`<combo>` notation:** `<value-letter><complexity-letter>` (e.g. `HL`, `MH`, `MM`). Unscored rows render as `—` in place of the letter.

### Immutable audit comments — key-event trail

Preserved alongside the sticky comment; never deleted, never edited.

| Event | Marker | Body |
|---|---|---|
| SA auto-estimate of complexity | `<!-- ginee:complexity-estimate by=solution-architect value=<H|M|L> at=<ISO> -->` | One-line outcome + SA signals digest. |
| User reply to ginee's value-prompt at pickup | `<!-- ginee:value-prompt by=<@handle> value=<H|M|L> at=<ISO> -->` | One-line outcome ("user set value=high during pickup of #N"). |
| Score recomputed on demand | `<!-- ginee:score-recompute by=<@handle> at=<ISO> -->` | Reason + delta from previous sticky state. |

User-driven label changes via `gh issue edit` do NOT produce an audit comment (GitHub's own activity log already records them).

### Triggers — when `team-lead` writes / updates the sticky

1. **Pickup** — after value-prompt + complexity auto-estimate complete, before the `ready` → `in-progress` label swap.
2. **Any ginee-driven label change** during a task (e.g. SA revising complexity after Phase 2 design widens scope — requires Phase-3-style user surface per `§ Forbidden`).
3. **`@team-lead recompute score #<N>`** — explicit user invocation; re-reads current labels (catches manual `gh issue edit` changes that ginee did not see), updates the sticky, posts a `ginee:score-recompute` audit comment.

### Forbidden

- Never post a second sticky-score comment — always update via the marker.
- Never edit or delete an immutable audit comment.
- Never auto-detect manual `gh issue edit` changes between sessions — the sticky reflects the last ginee-driven update; users must invoke `recompute score #N` to refresh it. `ginee-triage` always sorts from live labels regardless of sticky staleness.
- Never include adopter-secret data in the comment (issue body / labels only — never local repo paths, never SHA-256 fingerprints, never user PII).

## Labels — first-use provisioning

`team-lead` creates missing labels on first triage / pickup:

```
gh label create value:high   --color b60205 --description "ginee triage: ATAM importance — high"
gh label create value:medium --color d4a017 --description "ginee triage: ATAM importance — medium"
gh label create value:low    --color 0e8a16 --description "ginee triage: ATAM importance — low"
gh label create complexity:high   --color 1f5081 --description "ginee triage: ATAM difficulty — high"
gh label create complexity:medium --color 6195c0 --description "ginee triage: ATAM difficulty — medium"
gh label create complexity:low    --color c2e0c6 --description "ginee triage: ATAM difficulty — low"
```

Colors are advisory — adopter may recolor. `team-lead` does NOT recreate or overwrite existing labels.

## Forbidden

- **Never auto-set `value`.** Reporter or user input only. Auto-guessing user-impact is out of scope.
- **Never overwrite an existing `complexity:*` label without surfacing.** Auto-estimate only fills a missing label; revising an existing estimate requires a Phase-3-style surface to the user.
- **Never use any other scale than H/M/L.** No 1–5 / XS/S/M/L/XL / "critical" aliases — keeps the score formula deterministic and matches ATAM utility-tree convention.
- **Never gate pickup on score.** Low-scored issues are still pickable on user request; score informs order, not eligibility.

## Backward compatibility

- Adopters with no scoring labels: `ginee-triage` shows everything in the "Unscored" bucket; sort behaviour matches pre-D23 age-order.
- Existing issues without `value:*` / `complexity:*` labels are unaffected — adopter applies labels at their own pace.
- TODO files without `[v:N c:M]` markers continue to work unchanged.

## Out of scope

- Multi-dimensional scoring (ICE, RICE, full WSJF) — restart on demand if leverage proven.
- Auto-estimating `value`.
- Per-team / per-role priority overrides.
- Cross-repo prioritization.
- Issue-state-transition automation (auto-bump priority on stale issues).
