---
audience: all-cardinals
load: on-demand
triggers: [changelog, release-notes, release]
cap-bytes: 4096
reads-before-applying: [core/protocols/doc-authoring-protocol.md]
---

# Changelog + release-notes protocol

**Load-on-demand** when drafting any of: `docs/CHANGELOG.md` entry · `.github/release-notes/v*.md` sidecar. Authoring rule for the release surfaces. Self-lint by the author before publish; same machinery as the doc-authoring protocol (`core/protocols/doc-authoring-protocol.md`).

## Surface topology

| Surface | Purpose | Audience | Voice | Bullet cap |
|---|---|---|---|---|
| `docs/CHANGELOG.md` | Verbose record per [Keep a Changelog](https://keepachangelog.com/) | Adopter tracking framework evolution | Framework-dev OK in sub-bullets; lead-in ≤ 25 words | Lead-in ≤ 25 words; sub-bullets allowed |
| `.github/release-notes/v*.md` | Marketing on GH Release page | Adopter scanning to decide whether to bump | **User-value voice** — lead with adopter-visible benefit | **≤ 20 words per bullet**, one thing per line |

## Voice rule — sidecar

Lead each bullet with the **adopter-visible verb / outcome**. Mechanism (if mentioned at all) follows. Worked bad/good pairs: `core/protocols/doc-authoring-examples.md`.

## 4 mandatory checks — sidecar self-lint

| # | Check |
|---|---|
| 1 | Per-bullet word cap honoured — sidecar ≤ 20 words; CHANGELOG lead-in ≤ 25 words. |
| 2 | User-value voice on sidecar — bullet leads with adopter-visible change or benefit; no framework-dev jargon in the bullet itself. |
| 3 | No implementation boilerplate — "5 mandatory checks" enumerations · file-update lists · "purely additive" stat blocks belong in the verbose CHANGELOG entry, not the sidecar. |
| 4 | Spec link present — sidecar footer cites the relevant framework spec path (`core/<file>.md`) for each highlighted change so readers can drill in. |

Run all 4 against the drafted sidecar **before** publishing. Violation → restructure. Un-restructurable content lifts to the verbose CHANGELOG entry (where the framework-dev voice + sub-bullets are permitted) — never crammed back into the sidecar.

## Forbidden

- Pasting CHANGELOG paragraphs into the sidecar — different surface, different audience.
- Implementation jargon in sidecar bullets — `default-tier:` · `phase-report.md` · "schema-bound" belong in CHANGELOG.
- PR-number stat blocks in bullet headers — `(#76 · PR #78)` reads as internal engineering log; demote to footnote or omit.
- Multi-sentence prose bullets in the sidecar — same trap the doc-authoring protocol catches in adopter docs.
- Marketing voice in CHANGELOG entries — CHANGELOG is the verbose record; facts + numbers + cites, not selling points.

## Enforcement

- **LLM self-review** by the author drafting the file. Run the 4 checks against the draft before publishing.
- **Orchestrator advisory** on violation — one-line *"sidecar bullet over 20 words; consuming anyway"* (or similar). Never auto-rewrites; never re-dispatches purely for format.
- **No external linter.** No CI gate. Self-lint only.

## Bypass

Binding. Bypass only via explicit user direction recorded in the release PR. Never silent.
