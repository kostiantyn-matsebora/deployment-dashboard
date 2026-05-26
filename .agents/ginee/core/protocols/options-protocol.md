---
audience: all-cardinals
load: on-demand
triggers: [options, adopt-vs-build, proposal, phase-2]
cap-bytes: 8192
reads-before-applying: []
---

# Option protocol — adopt-vs-build proposal shape

**Load-on-demand.** Fetched by the proposing role on activation. 5 mandatory checks below run **before surfacing**; no edits / no dispatch until the option list passes.

## Activation cues

- Phase 2 design proposal — any cardinal authoring architecture · ADR · CR · wire / mockup contract.
- Iteration-protocol Propose step (`core/protocols/iteration-protocol.md § Each iteration`) for Phase 4–7 sub-tasks where adopt-vs-build is a live axis (new library · runner · framework · tool · dependency).
- Mode-aware — applies in both greenfield and delta mode.

**Inapplicable when** the sub-task carries no adopt-vs-build axis (rename · single-file bug fix inside existing logic · doc paragraph restyling). Proposer cites `"axis n/a — <reason>"` and skips the option list.

## Scope

| Surface |
|---|
| Phase 2 design proposals — architecture · ADRs · CRs · wire / mockup contracts |
| Iteration-protocol Propose step — Phase 4–7 sub-tasks with a live adopt-vs-build axis |

## Option-list schema

Every option list MUST include at least one of:

| Candidate type | Required fields | Example |
|---|---|---|
| **adopt** | name · version · source link · license · one-line fit rationale | `Adopt zstd via python-zstandard v0.22 — BSD-3; mature; 4 ms/kB on payloads.` |
| **build** | scope · one-line rationale why adoption was rejected (or `"no viable adopt candidate"` + cite) | `Build minimal in-house — surveyed compressors don't handle <1 kB efficiently (cite runtime-facts.yaml).` |
| **hybrid** | adopt portion (full fields) + build portion + boundary rationale | `Adopt zstd for compression; build the markdown-aware pre-tokenizer (no off-the-shelf fit).` |
| **`(none viable)`** | one-line reason — empty-research escape hatch | `(none viable — surveyed 3 token-aware compressors; all require tokenizer-specific dictionaries the framework does not ship).` |

### Floor

- **Hard.** ≥ 1 `adopt` candidate **OR** explicit `(none viable — <reason>)`. Never silently absent.
- **Soft.** Encourage 2–3 `adopt` candidates for non-trivial scope (architecture · stack · framework choice). Reviewer MAY advisory-flag a single-candidate list as thin without auto-rejecting.

### Tagging

Each candidate explicitly tagged `adopt` / `build` / `hybrid`. No silent mixing — quietly stitching "library X plus our own wrapper" without surfacing the boundary trips the self-lint.

## 5 mandatory checks before surfacing

1. **Adopt floor present** — ≥ 1 `adopt` candidate OR explicit `(none viable — <reason>)` cite.
2. **Citations complete** — every `adopt` carries name · version · source link · license · one-line fit rationale.
3. **Tagging explicit** — every candidate tagged `adopt` / `build` / `hybrid`; no silent mixing.
4. **Empty research documented** — surfaced as `(none viable — <reason>)`; never silently absent.
5. **Fit rationale concrete** — names a specific reason (constraint · NFR · existing-stack compatibility); not hand-waved (`"mature library"` alone fails).

Doc-shape checks from `core/process.md § Documentation style` still apply to surrounding proposal text.

## Forbidden patterns

- **Silently skipping adoption research** — no `(none viable)` cite + no adopt candidate.
- **Build-only option lists** on a sub-task with a live adopt-vs-build axis.
- **Hand-waved adopt candidates** — `"Use a charting library"` without name · version · license · fit.
- **Silently mixing adopt + build** in one candidate without explicit `hybrid` tag + boundary rationale.
- **Citing a library without fit rationale.** Existence ≠ fit.

## Worked example

**Sub-task:** add a content-compression layer for context payloads.

**Bad — build-only:**

```
Options:
- Build a custom dictionary-based compressor tuned to markdown.
- Build a simple LZ-style compressor inline.
```

**Good — adopt candidates with full citations:**

```
Options:
- adopt — zstd via `python-zstandard` v0.22 — BSD-3 — https://pypi.org/project/zstandard/
  — fit: mature, streaming API, 4 ms/kB on <1 kB payloads (cite `runtime-facts.yaml`).
- adopt — brotli v1.1 — MIT — https://pypi.org/project/Brotli/
  — fit: better text ratios; +30 ms latency cost on small payloads.
- build — minimal in-house — rationale: surveyed adopt candidates above; both
  exceed the latency NFR on the <1 kB hot path (cite `runtime-facts.yaml`).
```

**Good — empty research, explicit `(none viable)`:**

```
Options:
- (none viable — surveyed 3 token-aware compressors; all require tokenizer-specific
  dictionaries the framework does not ship).
- build — minimal in-house — see ADR draft.
```

Bad / good doc-style examples for option lists: `core/protocols/doc-authoring-examples.md § 11`.

## Enforcement

| Stage | Mechanism |
|---|---|
| Author | Drafts option list as part of Phase 2 / Propose output. |
| Self-lint | Runs the 5 checks against the draft **before** surfacing. Violation → restructure; un-fixable gap → escalate to user. |
| Reviewer (orchestrator / SA / user) | MAY surface a one-line advisory on violation (`"Option list missed: <check>; consuming anyway"`). Never re-dispatches purely for format. Never auto-rewrites. |
| Iteration-protocol intermediate proposals | Same checks; empty-research path still requires `(none viable)` cite — partial work no excuse. |

**No external linter.** LLM self-review against the rules above; same machinery as the doc-authoring protocol.

## Reporting

Outcomes land in `## Decisions made` (one-line — `<verb> <choice> — cite`). Full option list lives in the proposal artefact; the return cites the artefact path, never restates.
