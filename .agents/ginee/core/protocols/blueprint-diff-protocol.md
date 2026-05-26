---
audience: all-cardinals
load: on-demand
triggers: [blueprint-diff, mockup, visual-source-of-truth, phase-4]
cap-bytes: 12000
reads-before-applying: []
---

# Blueprint-diff protocol — pre-implementation gate for visual source-of-truth

**Load-on-demand at Phase 4 dispatch entry** for any task touching the configured `visual-source-of-truth` artefact. Runs **before any edit**; 4 mandatory checks pass + diff surfaces to team-lead, then edits proceed.

## Activation cues

- Phase 4 dispatch where the task touches the configured `visual-source-of-truth.path`.
- Iteration-protocol Propose step inside Phase 4 sub-tasks that touch the same path.
- Mode-aware — applies in both greenfield (mockup-create) and delta (mockup-edit) work.

**Inapplicable when** the dispatch carries no edit on the configured visual SoT path (backend-only · CI tweak · doc-only · non-visual config change). Dispatching role cites `"visual-SoT untouched — protocol n/a"` in `## Verification log` and skips.

## Configuration

`local/framework.config.yaml § visual-source-of-truth` — all keys optional; defaults derive from `mockup:` when present:

| Key | Default | Meaning |
|---|---|---|
| `type` | `html-mockup` when `mockup:` ends `.html` / `.htm`; else `other` | `html-mockup` · `figma` · `image` · `video` · `other`. Drives diff-tool selection. |
| `path` | `mockup:` value | Working-copy path or external URL. |
| `blueprint-ref` | `origin/main` | Git ref / tag / commit / external URL / file path. Override patterns: release tag (version-branch cuts) · frozen snapshot path · external URL (Figma version · image-baseline server). |
| `scope-discriminator` | `block-glob` | `block-glob` (CSS-selector / DOM-block) · `section-anchor` (heading slug) · `full-file` · `external` (tool returns scoped diff). |
| `enabled` | `true` | Set `false` to disable repo-wide. |

## Per-type diff-tool selection

| `type` | Diff tool |
|---|---|
| `html-mockup` | `git diff <blueprint-ref> -- <path>` (text); optional DOM-structure layer via adopter tool. Universal — every adopter has `git`. |
| `figma` | Figma file-comparison URL or REST `GET /v1/files/<key>/versions`. Adopter wires call via `local/`; framework cites link. |
| `image` | Perceptual-image diff (`pixelmatch` · `odiff` · `Resemble.js` · Playwright snapshot-compare). Path: `local/index/commands.yaml § commands.visual-diff`. |
| `video` | Manual checkpoint — dispatching role surfaces working-copy + blueprint URLs side-by-side; user ack gates edits. |
| `other` | Adopter command from `local/index/commands.yaml § commands.visual-diff`. |

## Procedure

1. **Resolve config.** Read `visual-source-of-truth` block; absent → defaults from `mockup:`; `enabled: false` → skip + cite `"visual-SoT protocol disabled per local config"` in `## Verification log`.
2. **Compute diff** — per-type tool against `blueprint-ref` for `path`; scope per `scope-discriminator`.
3. **Classify** each delta — **Expected** (in stated scope) · **Unexpected** (outside; needs explicit resolution) · **Pre-existing** (present before dispatch; carry forward).
4. **Surface** to team-lead with diff payload + classification table. **No edits to visual SoT until classification passes.**
5. **Gate Phase 4 edits** — all `Expected` / `Pre-existing` → proceed; any `Unexpected` → forced-interactive gate per `core/protocols/automatic-mode.md § Forced-interactive triggers` (user approves · re-scopes · rejects). Auto-mode does NOT elide.

## 4 mandatory checks before edits begin

1. **Config resolved** — `visual-source-of-truth` block read or defaults derived; `enabled: true`; per-task `type` matches the dispatching tool.
2. **Diff computed** — tool ran; output captured; no silent skip on tool failure (failure → `## Open issues` row + forced-interactive gate).
3. **Classification complete** — every diff entry tagged Expected / Unexpected / Pre-existing; no silent drops.
4. **Surface logged** — `## Verification log` carries one row per protocol invocation: `Blueprint-diff (<type>) vs <blueprint-ref>: <N> expected / <M> unexpected / <K> pre-existing.`

Doc-shape checks from `core/process.md § Documentation style` still apply to surrounding return text. Failure on any of the 4 → restructure; un-resolvable → escalate to user.

## Forbidden patterns

- **Editing the visual SoT before the protocol completes** — even one-line tweaks. The diff captures the baseline state; pre-diff edits poison the comparison.
- **Auto-resolving unexpected deltas.** Always surface to user; never silently re-scope.
- **Silently skipping the protocol on auto-mode.** Auto mode elides routine gates; this one is forced-interactive, same shape as review-comment ingestion (`core/protocols/github-integration.md § Review-comment ingestion`).
- **Substituting the geometry / mockup-visual harness for the blueprint diff.** Harness runs at Phase 5/6 on edits; this protocol runs at Phase 4 entry on the *baseline*. The adopter incident proves these are complementary, not interchangeable.
- **Pointing `blueprint-ref` at the working copy.** Defeats the purpose — the reference must be a frozen state (commit · tag · snapshot · external URL).

## Enforcement

| Stage | Mechanism |
|---|---|
| Author | Dispatching role runs the protocol as first step of any Phase 4 dispatch touching `visual-source-of-truth.path`. |
| Self-lint | Runs the 4 checks against the draft return **before** surfacing. Violation → restructure; un-fixable → escalate to user. |
| Reviewer (team-lead) | Surfaces a one-line advisory on violation (`"Blueprint-diff missed: <check>; consuming anyway."`). Never re-dispatches purely for format. Never auto-rewrites. |
| Iteration-protocol intermediate proposals | Same 4 checks; first iteration carries the diff; subsequent iterations cite the same diff unless `blueprint-ref` changes. |

**No external linter.** LLM self-review against the rules above; same machinery as the doc-authoring + options + phase-report protocols.

## Reporting

Outcome lands in `## Verification log` per `core/templates/phase-report.md` as one row per invocation. Full diff payload + classification table live in the proposal artefact (Phase 4 plan · iteration-protocol Propose output) — the return cites the artefact path or inlines under `## Notes` (≤ 200 words) when concise.

Example `## Verification log` row:

```
Blueprint-diff (html-mockup) vs origin/main on docs/mockup.html: 4 expected / 0 unexpected / 2 pre-existing — surfaced + approved.
```

