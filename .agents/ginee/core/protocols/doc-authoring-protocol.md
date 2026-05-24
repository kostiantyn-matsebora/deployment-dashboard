# Doc-authoring protocol — adopter docs + ginee-authored GitHub artefacts + subagent returns (D22 + D26 + D29)

**Load-on-demand at Phase 5 / report-as-done** for any doc-touching task. Default shape rules + mandatory checks live in `core/process.md § Documentation style` (always-loaded); this file carries scope + enforcement + attestation.

Examples gallery: `core/doc-authoring-examples.md` (load on first-time authoring / explicit request).

## Scope

| Surface | Authored by | In scope since |
|---|---|---|
| Architecture doc · ADRs · CRs · READMEs · runbooks · scenarios · API docs | adopter roles per `core/doc-roles.md` | D22 |
| Project-instruction file (`CLAUDE.md` / `AGENTS.md` / equivalent) | `team-lead` per D25 | D22 |
| Role definitions (`core/roles/`, `local/roles/`) · framework specs · skills | framework upstream / adopter `local/roles/` | D22 |
| **GitHub issue bodies** authored via `ginee-file-*` skills | `team-lead` (orchestrator drafts; user approves) | **D26** |
| **Framework-authored GitHub comments** — Phase-transition · sticky `ginee:score` / `ginee:review-cycle` · audit comments · per-thread review-replies | `team-lead` + specialists per the comment-cadence procedures | **D26** |
| **Subagent returns** — every cardinal-dispatch return per `core/templates/phase-report.md` schema | every cardinal role | **D29** |
| **Release surfaces** — `docs/CHANGELOG.md` entries · `.github/release-notes/v*.md` sidecars · `core/MIGRATIONS/D<N>-*.md` migration specs — surface-specific voice + word cap per `core/changelog-protocol.md` | framework maintainers drafting release artefacts | **D40** |

**The lint covers every section, including Summary.** No section-by-length exemption — a one-sentence Summary still trips the mandatory checks if it packs a comma-separated inventory into a parenthetical.

**Subagent-return surface adds a 6th check** — *no narrative preamble* (first non-Status line must be a `##` section header). The 5 standing checks apply unchanged. Full schema: `core/templates/phase-report.md`.

### Out of scope

- **Reporter-authored issue bodies / comments.** Per D14 forbidden — *"Never edit an issue body authored by another reporter."* `ginee-pick-up` MAY surface a polite restructure advisory on pickup, but never auto-rewrites and never edits reporter content.
- **Existing adopter docs.** Forward-only — new + edited content follows the protocol; mass-restructure of legacy docs is a separate user-initiated task.
- **Discussion bodies.** Read-only context per D14; promote-to-issue first.
- **Style / tone / branding.** This protocol governs **structure**, not voice. Adopter style guides own those.
- **Framework-self-dev hygiene gates** (D21 context-economy gate · CI internals). Separate enforcement layer; cross-references the same Mandatory checks but runs via the gate script.

## Enforcement via discovered stack

ginee does **not** ship a doc linter. Adopter projects already configure markdown / prose tooling — ginee discovers it and triggers it.

| Stage | Mechanism |
|---|---|
| Discovery | `team-lead` records the lint command in `local/index/commands.yaml § commands.lint.docs` via the existing `builtin:commands` recipe. Linter configs (markdownlint / vale / proselint / prettier-md) recorded in `local/index/conventions.yaml` via `builtin:conventions`. |
| Author | Role consults `core/process.md § Documentation style` (always-loaded) for shape rules + mandatory checks. |
| Enforce | Role runs `${commands.lint.docs}` at Phase 5 / report-as-done; lint output goes into the phase report's Verification log. |
| No tool detected | Discovery report recommends a baseline — markdownlint (structural) + vale (prose). Adopter decides — never auto-install. |

## Attestation

Phase-report Verification-log entry (one line):

```
Doc-style protocol — <linter command>: PASS / N findings (see <path>).
```

If no linter discovered: `Doc-style protocol — no linter configured; self-checked against core/process.md § Mandatory checks.`

## Bypass

Binding. Bypass only via explicit user direction recorded in the phase report. Never silent.

## Enforcement for ginee-authored GitHub artefacts (D26)

Different from adopter-doc enforcement (which piggybacks on the discovered linter). For issue bodies + ginee-authored comments:

| Stage | Mechanism |
|---|---|
| Author | `ginee-file-*` skill drafts the body. Specialist drafts a Phase-transition / sticky / review-reply comment. |
| Self-lint | Author role runs the `core/process.md § Mandatory checks` against the drafted text **before** publishing — every section, including Summary. |
| Violation | Surfaces as a suggestion in the user-approval prompt. User accepts the restructure / rejects / overrides. No silent publish. |
| Publish | Only after user approval of the linted draft. |

**No external linter.** The check is LLM self-review against the same 5 mandatory rules used for adopter docs.

## Enforcement for subagent returns (D29)

Different again from D22 / D26. Returns are ephemeral (consumed by the orchestrator in-thread, not published), so the loop closes inside the dispatched role:

| Stage | Mechanism |
|---|---|
| Author | Dispatched cardinal drafts the return per `core/templates/phase-report.md` schema. |
| Self-lint | Role runs the 6 mandatory checks (5 from D22 / D26 + *no narrative preamble*) against the draft **before** returning. Violations → restructure; un-restructurable content → lift into capped `## Notes`. |
| Violation reaches orchestrator | `team-lead` surfaces a one-line advisory (`"Return missed self-lint: <violation>; consuming anyway"`), consumes the return, never re-dispatches purely for format, never auto-rewrites (analogous to D14 reporter-content forbidden). |
| Iteration-protocol intermediate return | Same schema with sections marked `(in-progress)`; `## Stop-state` required; `Status: In-progress`. |
| Failed dispatch (forced handoff per `core/cross-agent-handoff.md`) | Same schema + required `## Hand-off` section embedding `core/templates/hand-off-note.md`. |

**No external linter.** LLM self-review against the schema; identical machinery to D22 / D26 enforcement loop. Forward-only — pre-D29 returns are not retroactively rewritten.

## Taxonomy identifier pairing (D34)

Cardinal outputs · ginee-authored artefacts · adopter docs cite taxonomy items in **slug-glued form** matching the on-disk filename. Bare IDs force reader context-switch; slug-glued lets the reader copy-paste into a filesystem search.

| Class | Pattern | Example |
|---|---|---|
| D-decision | `D<NN>-<slug>` | `D28-skill-runner-boundary` |
| ADR | `ADR-<NNNN>-<slug>` | `ADR-0001-topology-derivation-five-pass` |
| CR | `CR-<NNNN>-<slug>` | `CR-0010-component-ci-pipeline` |
| FR / NFR / ASR | `<TYPE>-<NN>-<slug>` | `FR-04-deploy-rollback` · `NFR-02-cost-cap` · `ASR-03-availability-budget` |
| Index class | `<class-name>` | `repo-map` · `architecture-fr` |

**Out of scope** — issue / PR / commit-SHA / version-tag / package-name refs stay bare. `#87` correct; `#87-<slug>` wrong (titles are mutable).

### Resolution lookup

Resolve short name **before** emitting — never bare-ID fallback. Lookup failure → surface inline `D28-?? (slug lookup failed: core/MIGRATIONS/D28-*.md not found)`; carry forward.

| Class | Short-name source |
|---|---|
| File-backed (D / ADR / CR / migration) | Filename slug after numeric prefix — `ls core/MIGRATIONS/D<NN>-*.md` etc. |
| Inline-table (FR / NFR / ASR) | First noun phrase of the register-row description, ≤ 5 words, kebab-cased |
| Index-class | `name:` field per class in `local/index/manifest.yaml § indexed[]` |

### Self-lint + enforcement

Extends D22 / D26 / D29 check #5. Regex `\b(D|ADR-?|CR-?|FR-?|NFR-?|ASR-?)\d+\b` not followed by `-<slug>` trips. Excluded: issue / PR / SHA refs; markdown links to issue / PR URLs; code-fenced package names.

Same machinery as D22 / D26 / D29 — LLM self-review at draft time; no external linter. Orchestrator advisory on hit (`"Output cited <bare-id> without slug; consuming anyway."`); consumes; never re-dispatches for format; never auto-rewrites. Forward-only — historical outputs not rewritten.
