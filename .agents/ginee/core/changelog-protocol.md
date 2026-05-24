# Changelog + release-notes protocol (D40)

**Load-on-demand** when drafting any of: `docs/CHANGELOG.md` entry · `.github/release-notes/v*.md` sidecar · `core/MIGRATIONS/D<N>-*.md` migration. Authoring rule for the three release surfaces. Self-lint by the author before publish; same machinery as D22 / D26 / D29 / D30. Full background + worked v0.12.0 4-pass convergence: `core/MIGRATIONS/D40-changelog-protocol.md`.

## Surface topology

| Surface | Purpose | Audience | Voice | Bullet cap |
|---|---|---|---|---|
| `core/MIGRATIONS/D<N>-*.md` | Full spec — schema · checks · rollback · file list | Framework dev + adopter deep-dive | Framework-dev (precise jargon OK) | None — structured tables / lists |
| `docs/CHANGELOG.md` | Verbose record per [Keep a Changelog](https://keepachangelog.com/) | Adopter tracking framework evolution | Framework-dev OK in sub-bullets; lead-in ≤ 25 words | Lead-in ≤ 25 words; sub-bullets allowed |
| `.github/release-notes/v*.md` | Marketing on GH Release page | Adopter scanning to decide whether to bump | **User-value voice** — lead with adopter-visible benefit | **≤ 20 words per bullet**, one thing per line |

## Voice rule — sidecar

Lead each bullet with the **adopter-visible verb / outcome**. Mechanism (if mentioned at all) follows. End with the `(D<N>)` tag. Worked bad/good pairs: `core/doc-authoring-examples.md § 14`.

## 5 mandatory checks — sidecar self-lint

| # | Check |
|---|---|
| 1 | Per-bullet word cap honoured — sidecar ≤ 20 words; CHANGELOG lead-in ≤ 25 words. |
| 2 | User-value voice on sidecar — bullet leads with adopter-visible change or benefit; no framework-dev jargon in the bullet itself. |
| 3 | `(D<N>)` tag suffix on sidecar bullets — ties the line back to the locked decision. |
| 4 | No implementation boilerplate — "5 mandatory checks" enumerations · file-update lists · "purely additive" stat blocks belong in the migration, not the sidecar. |
| 5 | Migration link present — sidecar footer carries the `core/MIGRATIONS/D<N>-*.md` link for every highlighted decision. |

Run all 5 against the drafted sidecar **before** publishing. Violation → restructure. Un-restructurable content lifts to the verbose CHANGELOG entry (where the framework-dev voice + sub-bullets are permitted) — never crammed back into the sidecar.

## Forbidden

- Pasting CHANGELOG paragraphs into the sidecar — different surface, different audience.
- Implementation jargon in sidecar bullets — `default-tier:` · `phase-report.md` · "schema-bound" belong in migration.
- PR-number stat blocks in bullet headers — `(#76 · PR #78)` reads as internal engineering log; demote to footnote or omit.
- Multi-sentence prose bullets in the sidecar — same trap D22 catches in adopter docs.
- Marketing voice in CHANGELOG entries — CHANGELOG is the verbose record; facts + numbers + cites, not selling points.

## Enforcement

- **LLM self-review** by the author drafting the file. Run the 5 checks against the draft before publishing.
- **Orchestrator advisory** on violation — one-line *"sidecar bullet over 20 words; consuming anyway"* (or similar). Never auto-rewrites; never re-dispatches purely for format. Mirror of D22 / D26 / D29 / D30 enforcement loop.
- **No external linter.** No CI gate. Self-lint only.
- **D34 carve-out** — sidecar D-tags are bare (`(D31)`) rather than slug-glued (`D31-model-tier`); the slug form is required only in framework specs · adopter docs · cardinal returns where copy-paste-to-filesystem-search matters. Sidecars carry the spec link in the footer.

## Bypass

Binding. Bypass only via explicit user direction recorded in the release PR. Never silent.
