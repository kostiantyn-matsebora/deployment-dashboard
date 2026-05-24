# Migration — D34: Taxonomy identifier short-name pairing

**Target release:** next minor after 2026-05-23.
**Affected adopters:** every adopter on every adapter — opt-in; no breaking change.

## What changed

D34 binds every cardinal output, ginee-authored GitHub artefact, and adopter doc to cite taxonomy items in **identifier + short name slug-glued form** — matching the on-disk filename convention.

| Class | Pre-D34 (bare) | Post-D34 (slug-glued) |
|---|---|---|
| D-decision | `D28` | `D28-skill-runner-boundary` |
| ADR | `ADR-0001` | `ADR-0001-topology-derivation-five-pass` |
| CR | `CR-0010` | `CR-0010-component-ci-pipeline` |
| FR | `FR-04` | `FR-04-deploy-rollback` |
| NFR | `NFR-02` | `NFR-02-cost-cap` |
| ASR | `ASR-03` | `ASR-03-availability-budget` |
| Index class | `repo-map` | `repo-map` (already a slug; no change) |

**Out of scope** — issue / PR / commit-SHA / package-name references are NOT taxonomy IDs and stay bare. `#87`, `[PR #84](...)`, git SHAs, NPM package names are correct as-is.

## Why

| Failure mode | Effect |
|---|---|
| Reader sees `ADR-0017` in a Phase-7 sign-off | Must open `<adr-directory>/ADR-0017-*.md` to know what it is |
| Reader sees `D28` in a CLAUDE.md row | Must scroll PLAN.md to find D28's body |
| Reader sees `FR-04` in a PR description | Must open `local/requirements.md` to recall the FR |

The slug is **zero-cost for the agent** (already in the filename) and **high-value for the reader** (no context-switch). Established convention across software documentation:

- Linux kernel commit subject paired with SHA prefix in changelogs.
- RFCs always travel title-with-number.
- Conventional Commits format `type(scope): subject`.
- ADR convention itself stores `<NNNN>-<slug>.md` filenames.

## Form

**Slug-glued** matches the on-disk filename convention — `<TYPE>-<NNNN>-<short-slug>` or `<TYPE>-<NN>-<short-slug>`. The full citation is also the file path's suffix → reader copy-pastes the citation directly into a filesystem search.

Examples:

- `D17-delivery-modes` — `core/MIGRATIONS/D17-delivery-modes.md`
- `ADR-0006-component-co-location` — `<adr-directory>/ADR-0006-component-co-location.md`
- `CR-0010-component-ci-pipeline` — `<cr-directory>/CR-0010-component-ci-pipeline.md`

## Resolution lookup

Cardinal MUST resolve the short name **before** emitting the output — never emit a bare ID as fallback.

| Artefact class | Short-name source | Lookup mechanism |
|---|---|---|
| File-backed (D / ADR / CR / migration) | Filename slug after the numeric prefix | `ls core/MIGRATIONS/D<NN>-*.md` / `ls <adr-directory>/ADR-<NNNN>-*.md` / `ls <cr-directory>/CR-<NNNN>-*.md` |
| Inline-table (FR / NFR / ASR in `local/requirements.md` + `local/asr-utility-tree.md`) | First noun phrase of the row's description, ≤ 5 words, kebab-cased | Read register row; lift descriptor; slugify |
| Index-class entry | `name:` field per class in `local/index/manifest.yaml § indexed[]` | Read manifest entry; use `name:` verbatim |

**On resolution failure** — surface inline (`D28-?? (slug lookup failed: core/MIGRATIONS/D28-*.md not found)`); orchestrator carries forward to next dispatch; never invent a slug; never silently degrade to bare ID.

## Self-lint

Extends the existing D22 / D26 / D29 mandatory check #5 (cross-references cite anchors):

- **Pattern.** Regex `\b(D|ADR-?|CR-?|FR-?|NFR-?|ASR-?)\d+\b` not followed by `-` + slug.
- **Excluded contexts.** Markdown links to issue / PR URLs · `#<N>` issue refs · `PR #<N>` refs · git SHAs · package names in code-fenced blocks.
- **Action on hit.** Restructure to slug-glued form before publishing / returning.

Same machinery as D22 / D26 / D29 — LLM self-review at draft time. No external linter; no runtime dependencies. Orchestrator on violation: one-line advisory (`"Output cited <bare-id> without slug; consuming anyway."`); consumes the output; never re-dispatches purely for format; never auto-rewrites.

## Files changed (framework upstream)

| Path | Change |
|---|---|
| `core/process.md § Documentation style § Mandatory checks before report-as-done` | Check #5 extended with the slug-glued rule + cross-ref to the resolution lookup. |
| `core/protocols/doc-authoring-protocol.md` | New `## Taxonomy identifier pairing (D34)` section — form table · resolution lookup · self-lint regex · enforcement. |
| `core/templates/phase-report.md § Section templates § ## Decisions made` | Cite-form updated to slug-glued · pointer line to resolution lookup. |
| `core/templates/pr-description.md § Cites` | CR / ADR / FR / NFR rows updated to slug-glued form with worked examples. |
| `core/templates/issues/framework-bug-report.md § Locked decisions referenced` | Banner + placeholder updated to slug-glued. |
| `core/templates/issues/framework-feature-request.md § Locked-decision impact` | Banner + example list updated to slug-glued. |
| `core/roles/{team-lead,solution-architect,ai-engineer,backend-engineer,frontend-engineer,devops-engineer,qa-engineer}.md § Reporting` | One-line addendum — `; taxonomy citations slug-glued (D34).` |
| `core/doc-authoring-examples.md § 12` | NEW bad/good pair — Phase-7 sign-off with bare IDs → slug-glued. |
| `CLAUDE.md` · `PLAN.md` | D34 row in locked-decisions table. |
| `docs/CHANGELOG.md` | D34 entry under Unreleased. |
| `core/MIGRATIONS/D34-identifier-short-name-pairing.md` | This file (NEW). |

## Action required — none (adopter-side)

**Purely additive.** No `local/` schema change. No `framework.config.yaml` keys. No installer change. No new commands.

**Forward-only.** Historical cardinal outputs (chat history, prior PR comments, prior issue bodies) NOT rewritten. Existing taxonomy artefact files NOT renamed — naming convention stays as-is. The rule applies to outputs produced after the kernel reload picks up the addendum.

## Backward compatibility

- Schema unchanged.
- 6 mandatory checks unchanged (rule extends check #5; count stays at 5 + D29 #6).
- Reporter-authored content unchanged (D14 forbidden upheld).
- No `local/` schema change.
- No adapter re-install required.

## Rollback

Not recommended — D34 is purely additive and improves reader signal-to-noise. To revert:

1. Remove the slug-glued clause from `core/process.md § Mandatory checks` check #5.
2. Remove `## Taxonomy identifier pairing (D34)` from `core/protocols/doc-authoring-protocol.md`.
3. Revert `core/templates/phase-report.md § ## Decisions made` example to bare-ID form.
4. Revert `core/templates/pr-description.md § Cites` table to bare-ID form.
5. Revert the 2 framework issue templates' decision-citation sections.
6. Remove the `; taxonomy citations slug-glued (D34).` clause from the 7 cardinal `## Reporting` sections.
7. Remove `§ 12` from `core/doc-authoring-examples.md`.

Outputs return to bare-ID form; the reader context-switch cost returns.

## Issue reference

Closes [#88](https://github.com/kostiantyn-matsebora/ginee/issues/88) — *"[Framework Feature] Cardinal outputs: pair taxonomy identifiers with their short name."*
