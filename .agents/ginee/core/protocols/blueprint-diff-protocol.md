# Blueprint-diff protocol — pre-implementation gate for visual source-of-truth (D41)

**Load-on-demand at Phase 4 dispatch entry** for any task touching the configured `visual-source-of-truth` artefact. Runs **before any edit**; 4 mandatory checks pass + diff surfaces to team-lead, then edits proceed.

## Why

- Visual source-of-truth (mockup · Figma file · design baselines) defines client contract per `local/bindings.md § Source-of-truth ownership`.
- Pre-D41 the framework named the artefact as canonical but had no pre-edit step asserting *what already changed* before the dispatch added more.
- Adopter incident (`deployment-dashboard#54`) — Phase 4 rewrote a mockup section from scratch; chrome elements (badges · version-block · timestamps · prev-failed warnings) silently vanished. Phase 5/6 geometry oracles ran green; SPA's reused component carried fidelity the mockup lost. User caught it via manual screenshot comparison only.
- Blueprint diff catches this **before** edits begin — surfaces unexpected deltas vs the configured reference for explicit user resolution.

## Activation cues

- Phase 4 dispatch where the task touches the configured `visual-source-of-truth.path`.
- Iteration-protocol Propose step inside Phase 4 sub-tasks that touch the same path.
- Mode-aware — applies in both greenfield (mockup-create) and delta (mockup-edit) work.

**Inapplicable when** the dispatch carries no edit on the configured visual SoT path (backend-only · CI tweak · doc-only · non-visual config change). Dispatching role cites `"visual-SoT untouched — protocol n/a"` in `## Verification log` and skips.

## Configuration

`local/framework.config.yaml § visual-source-of-truth` — block; all keys optional; framework defaults derive from existing `mockup:` key when present:

| Key | Default | Meaning |
|---|---|---|
| `type` | `html-mockup` when `mockup:` ends `.html` / `.htm`; else `other` | One of `html-mockup` · `figma` · `image` · `video` · `other`. Drives diff-tool selection. |
| `path` | value of `mockup:` | Working-copy path or external URL to the visual SoT. |
| `blueprint-ref` | `origin/main` | Git ref / tag / commit / external URL / file path to diff against. Override patterns: <ul><li>release tag — adopters cutting from version branches.</li><li>frozen snapshot path — non-trunk file baseline.</li><li>external URL — Figma version / image-baseline server.</li></ul> |
| `scope-discriminator` | `block-glob` | How to bound the diff to the issue-scoped region. `block-glob` (CSS-selector / DOM-block glob) · `section-anchor` (heading slug) · `full-file` (no scoping) · `external` (tool returns its own scoped diff). |
| `enabled` | `true` | Set `false` to disable repo-wide. |

## Per-type diff-tool selection

| `type` | Diff tool | Notes |
|---|---|---|
| `html-mockup` | `git diff <blueprint-ref> -- <path>` for text; DOM-structure diff layered on top via the dispatching role's adopter-provided tool when present | Universal — every adopter has `git`; zero new dep. |
| `figma` | Figma file-comparison URL or REST `GET /v1/files/<key>/versions` diff | Adopter wires the call via `local/`; framework cites the link in the surfaced output. |
| `image` | Perceptual-image diff via adopter's chosen tool (`pixelmatch` · `odiff` · `Resemble.js` · Playwright snapshot-compare) | Tool path lives in `local/index/commands.yaml § commands.visual-diff`. |
| `video` | Manual review checkpoint — dispatching role surfaces the working-copy + blueprint URLs side-by-side; user acks before edits proceed | No automatic diff; the gate is the explicit ack. |
| `other` | Adopter-supplied diff tool path from `local/index/commands.yaml § commands.visual-diff` | Framework runs the command; result surfaces as the diff payload. |

## Procedure

1. **Resolve config.** Read `local/framework.config.yaml § visual-source-of-truth`. If absent → derive defaults from `mockup:` key. If `enabled: false` → skip protocol; cite `"visual-SoT protocol disabled per local config"` in `## Verification log`.
2. **Compute the diff.** Run the per-type tool against `blueprint-ref` for `path`. Scope to the issue's expected-change region per `scope-discriminator`.
3. **Classify entries.** Each delta → one of:
   - **Expected** — falls inside the issue's stated scope.
   - **Unexpected** — outside the stated scope; needs explicit user resolution.
   - **Pre-existing** — present before the dispatch began; carry forward unchanged.
4. **Surface to team-lead.** Dispatching role returns the diff payload + classification table; team-lead presents to user. **No edits to the visual SoT until classification passes.**
5. **Gate Phase 4 edits.**
   - All entries `Expected` / `Pre-existing` → edits proceed.
   - Any entry `Unexpected` → forced-interactive gate per `core/automatic-mode.md § Forced-interactive triggers`; user resolves (approve · re-scope · reject) before edits continue. Auto-mode does **not** elide this gate.

## 4 mandatory checks before edits begin

1. **Config resolved** — `visual-source-of-truth` block read or defaults derived; `enabled: true`; per-task `type` matches the dispatching tool.
2. **Diff computed** — tool ran; output captured; no silent skip on tool failure (failure → `## Open issues` row + forced-interactive gate).
3. **Classification complete** — every diff entry tagged Expected / Unexpected / Pre-existing; no silent drops.
4. **Surface logged** — `## Verification log` carries one row per protocol invocation: `Blueprint-diff (<type>) vs <blueprint-ref>: <N> expected / <M> unexpected / <K> pre-existing.`

Doc-shape checks from `core/process.md § Documentation style` still apply to surrounding return text. Failure on any of the 4 → restructure; un-resolvable → escalate to user.

## Forbidden patterns

- **Editing the visual SoT before the protocol completes** — even one-line tweaks. The diff captures the baseline state; pre-diff edits poison the comparison.
- **Auto-resolving unexpected deltas.** Always surface to user; never silently re-scope.
- **Silently skipping the protocol on auto-mode.** D12 elides routine gates; D41 is a forced-interactive gate, same shape as D24 review-comment ingestion.
- **Substituting the geometry / mockup-visual harness for the blueprint diff.** Harness runs at Phase 5/6 on edits; D41 runs at Phase 4 entry on the *baseline*. The adopter incident proves these are complementary, not interchangeable.
- **Pointing `blueprint-ref` at the working copy.** Defeats the purpose — the reference must be a frozen state (commit · tag · snapshot · external URL).

## Enforcement

| Stage | Mechanism |
|---|---|
| Author | Dispatching role runs the protocol as first step of any Phase 4 dispatch touching `visual-source-of-truth.path`. |
| Self-lint | Runs the 4 checks against the draft return **before** surfacing. Violation → restructure; un-fixable → escalate to user. |
| Reviewer (team-lead) | Surfaces a one-line advisory on violation (`"Blueprint-diff missed: <check>; consuming anyway."`). Never re-dispatches purely for format. Never auto-rewrites. |
| Iteration-protocol intermediate proposals | Same 4 checks; first iteration carries the diff; subsequent iterations cite the same diff unless `blueprint-ref` changes. |

**No external linter.** Same machinery as D22 / D26 / D29 / D30 / D40 — LLM self-review against the rules above.

## Reporting

Outcome lands in `## Verification log` per `core/templates/phase-report.md` as one row per invocation. Full diff payload + classification table live in the proposal artefact (Phase 4 plan · iteration-protocol Propose output) — the return cites the artefact path or inlines under `## Notes` (≤ 200 words) when concise.

Example `## Verification log` row:

```
Blueprint-diff (html-mockup) vs origin/main on docs/mockup.html: 4 expected / 0 unexpected / 2 pre-existing — surfaced + approved.
```

## Interaction with other decisions

| Decision | Interaction |
|---|---|
| D12-automatic-mode | Unexpected-delta gate is forced-interactive — auto-mode does NOT elide it. Same carve-out as D24-review-comment-ingestion. |
| D14-github-issues | Issue body's expected-change set drives the `Expected` classification. Reporter ambiguity → forced-interactive gate; never silent. |
| D17-delivery-modes | Mode-independent — protocol runs at Phase 4 entry in all three delivery modes. |
| D22-doc-authoring-protocol | Doc-shape rules apply to surrounding return text; D41 adds the 4-check layer on top of Verification-log entries. |
| D25-classical-architect | Mockup-owning role (typically `frontend-engineer` per `local/bindings.md § Source-of-truth ownership`) gains the diff-and-surface obligation. <ul><li>Charter addendum: `core/roles/frontend-engineer.md § Mockup ownership`.</li></ul> |
| D29-strict-subagent-return-schema | Verification-log row carries the diff outcome; no new section needed. Full payload optionally lifted to `## Notes` carve-out. |
| D30-adopt-existing-solution | Diff tooling layer adopts existing tools per type (`git diff` · Figma compare · pixelmatch / odiff); protocol layer is build per the framework's load-on-demand spec pattern. |
| D36-warm-specialist-reuse | Warm-resumed specialist re-runs the protocol on each new dispatch — `blueprint-ref` may have advanced since the prior cycle. |
| D39-sub-issue-dispatch | Sub-issue body carries the expected-change set; closing comment's `## Verification log` carries the diff outcome. |

## Out of scope

- **Authoring per-adopter diff tools** — framework provides the protocol; adopter authors the tool per `local/` overrides (Figma plugin · perceptual image diff · video review checklist).
- **Replacing the mockup-visual harness** — harness still runs in Phase 5/6; blueprint diff is an additional Phase 4 entry gate, not a replacement.
- **Mandating a specific diff format** — adopters choose unified diff · DOM-tree diff · perceptual-image diff per `visual-source-of-truth.type`.
- **Authoring chrome-parity oracles** — those remain `qa-engineer`'s authoring surface in Phase 5; blueprint diff catches drift earlier and complements them.
- **Diffing non-visual artefacts** — wire contracts · API specs · architecture docs all have their own review surfaces (Phase 7 SA review · API-contract owner review).
- **License gating on adopter diff tools** — framework cites the tool; adopter `local/` owns license policy.
