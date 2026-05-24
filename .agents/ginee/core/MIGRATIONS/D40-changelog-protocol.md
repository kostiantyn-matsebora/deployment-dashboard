# Migration — D40: Changelog + release-notes protocol — codify surface-specific voice + shape

**Target release:** next minor after 2026-05-24.
**Affected adopters:** none (framework-internal authoring rule); ginee maintainers writing release artefacts.
**Closes:** [#81](https://github.com/kostiantyn-matsebora/ginee/issues/81).

## What changed

Pre-D40 ginee had three release-surface files — `docs/CHANGELOG.md` · `.github/release-notes/v*.md` · `core/MIGRATIONS/D<N>-*.md` — with no spec binding them to surface-specific voice + word-count rules. PR #60 (2026-04) established the "concise sidecar" convention but didn't lock voice or per-bullet cap. Result: the v0.12.0 sidecar took **four authoring passes** to converge on the right shape, and v0.15.0 drifted back toward dense framework-dev prose.

D40 codifies the topology — which surface gets which voice, which word cap — and binds it to the same self-lint machinery as D22 / D26 / D29 / D30.

## Why

| Authoring pass on `.github/release-notes/v0.12.0.md` (PR #80) | Failure mode |
|---|---|
| Pass 1 | Dense framework-dev paragraphs masquerading as bullets — PR-number stat blocks, "5 mandatory checks" enumerations, file-update lists. |
| Pass 2 | Concise but implementation voice — `default-tier:` · `role-kernel` · "schema-bound". Reader can't tell what changes for them. |
| Pass 3 | User-value voice, but bullets ran 40–65 words each — D22's ≤ 25-word rule applied at this surface would have caught it. |
| Pass 4 | One short line per change, user-value voice, `(D<N>)` tag — finally matched the v0.6.0 / v0.8.0 / v0.11.0 pattern PR #60 set. |

Root cause: no rule named the three surfaces' distinct audiences + voices. Authoring drifted to whichever pattern the previous file used — convergent on the wrong shape.

## Form — three surfaces, three voices, three caps

| Surface | Purpose | Audience | Voice | Bullet cap |
|---|---|---|---|---|
| `core/MIGRATIONS/D<N>-*.md` | Full spec — schema · checks · rollback · file list | Framework dev + adopter on deep-dive | Framework-dev (precise jargon OK) | None — structured tables / lists |
| `docs/CHANGELOG.md` | Verbose record per [Keep a Changelog](https://keepachangelog.com/) | Adopter tracking framework evolution | Framework-dev OK in sub-bullets; lead-in bullet ≤ 25 words | Lead-in sentence ≤ 25 words; sub-bullets allowed |
| `.github/release-notes/v*.md` | Marketing on the GH Release page | Adopter scanning to decide whether to bump | **User-value voice** — lead with adopter-visible benefit | **≤ 20 words per bullet**, one thing per line |

## Voice rule — concrete

| Bad (implementation voice) | Good (user-value voice) |
|---|---|
| "Three vendor-neutral tiers declared as role-kernel `default-tier:`" | "Lower LLM bills — cheaper models on execution work" |
| "5 required sections + 2 conditional + Notes carve-out" | "~70% smaller subagent returns — more room in your context" |
| "Step 1 no longer requires installer scripts inside `.agents/ginee/`" | "`/ginee-update` works again" |
| "MUST surface ≥ 1 adopt candidate or `(none viable)` cite" | "Team picks existing libraries first" |
| "Affinity-injection protocol surfaces matching tools in dispatch prompts" | "Specialists hinted toward host tools they'd otherwise miss" |

Pattern — concrete adopter-visible verb / outcome at line start; mechanism (if mentioned) follows; D-number tag at end.

## 5 mandatory checks before publishing a sidecar

| # | Check |
|---|---|
| 1 | **Per-bullet word cap honoured** — sidecar bullets ≤ 20 words; CHANGELOG lead-in bullet ≤ 25 words. |
| 2 | **User-value voice on sidecar** — every bullet leads with adopter-visible change or benefit; no framework-dev jargon in the bullet itself. |
| 3 | **D-number tag suffix** — `(D<N>)` ties the line back to the locked decision for readers who want the spec. |
| 4 | **No implementation boilerplate** in sidecar — "5 mandatory checks" enumerations · file-update lists · "purely additive · no schema change" stat blocks live in the migration, not the sidecar. |
| 5 | **Migration link present** — sidecar footer carries the `core/MIGRATIONS/D<N>-*.md` link for every highlighted decision. |

LLM self-review against these five checks before publishing — same machinery as D22 / D26 / D29 / D30. No external linter; orchestrator surfaces a one-line advisory on violation; never auto-rewrites; never re-dispatches purely for format.

## Forbidden patterns

| Pattern | Why it fails |
|---|---|
| Pasting CHANGELOG paragraphs into the sidecar | Different surface, different audience — sidecar is marketing, CHANGELOG is record. |
| Implementation jargon in sidecar bullets — `default-tier:` / `phase-report.md` / "schema-bound" | Belongs in migration, not the marketing layer. |
| PR-number stat blocks in bullet headers — `(#76 · PR #78)` | Reads as internal engineering log; demote to footnote or omit. |
| Multi-sentence prose bullets | Same trap D22 catches in adopter docs. |
| Marketing voice in CHANGELOG entries | CHANGELOG is the verbose record — facts + numbers + cites; not selling points. |

## Worked example — v0.12.0 4-pass convergence

Pass 1 (dense framework-dev paragraph):

```
- D31 introduces three vendor-neutral tiers (reasoning · standard · fast) declared as
  role-kernel `default-tier:` with per-adapter `<tier> → <id>` map. Resolution: per-task
  prefix `model:<tier>` → Phase-3 answer → `local/framework.config.yaml § model-tier.per-role.<role>`
  → kernel `default-tier:`. Claude adapter writes `model: <id>` into `.claude/agents/<role>.md`
  frontmatter; non-Claude adapters emit install warning. Purely additive — absent `model-tier:`
  → defaults apply.
```

Pass 4 (user-value, ≤ 20 words, D-tag):

```
- **Lower LLM bills** — cheaper models on execution work, capable ones stay on orchestration + architecture. Out of the box. (D31)
- **Per-task model override** — prefix any dispatch with `model:reasoning` / `model:standard` / `model:fast`. (D31)
```

The Pass-1 content survives — in `docs/CHANGELOG.md` (verbose entry) and `core/MIGRATIONS/D31-model-tier.md` (full spec). The sidecar carries only the adopter-visible benefit + D-tag pointer to the spec.

## Decisions affected

| Decision | Interaction |
|---|---|
| D22 (doc-authoring protocol) | D40 extends scope to release surfaces — same self-lint machinery, surface-specific shape rules. Pattern matches D26 (which extended D22 to GH artefacts). |
| D26 (D22 scope extension to GH artefacts) | Direct precedent — same scope-extension pattern, additive to D22 surface list. |
| D29 (subagent-return schema) | Independent — different surface (return envelope vs release files); same self-lint enforcement style. |
| D30 (adopt-existing-solution) | Same enforcement style — LLM self-review · one-line advisory · no auto-rewrite. |
| PR #60 (sidecar convention) | D40 builds on PR #60's "concise highlights" rule; adds voice + word-cap binding. |
| D34 (taxonomy slug-gluing) | Sidecar D-tag `(D<N>)` exempted — sidecars are the marketing layer; the slug-glued form (`D31-model-tier`) is required only in framework specs · adopter docs · cardinal returns where copy-paste-to-filesystem-search matters. Sidecars carry the spec link in the footer. |

## Out of scope

- Retroactive rewrite of sidecars `v0.4.0` → `v0.15.0`. Forward-only.
- External markdown linter or CI gate — self-lint only, matching D22 / D26 / D29 / D30.
- New surfaces beyond the three identified (changelog · sidecar · migration).
- Translation / localization of release notes.
- Style / tone / branding beyond voice (which surface, which voice) — adopter style guides own colour, tone, idiom.

## Backward compatibility

- **Breaks existing `local/*` files: no** — framework-internal authoring rule; adopter files unaffected.
- Pre-D40 sidecars not retroactively rewritten — forward-only.
- No script changes. No installer change. No test changes. Adopter action on upgrade: **none**.

## Forward-only

Purely additive. The next release sidecar (`v0.16.0` or whichever lands after this migration) is the first that runs the 5 mandatory checks before publish.
