# Pull-Request Description Template

<!--
  Use for every PR landing:
  - Code.
  - Tests.
  - Infra.
  - Docs.
  Every PR cites one of:
  - Requirement.
  - NFR.
  - Mockup section.
  - CR.
  - ADR.
  Usage:
  - Replace bracketed placeholders.
  - Drop sections with no content.
-->

---

## What

<!-- One or two sentences, imperative voice. -->

`<change summary>`

## Why

<!--
  Form:
  - One or two sentences.
  Trigger is one of:
  - TODO line.
  - CR.
  - Defect.
  - Explicit user request.
  Rule:
  - Reference the source.
-->

`<trigger + reference>`

## Cites

| Source | Reference |
|---|---|
| Requirement | `<FR-NN-slug | NFR-NN-slug>` (slug-glued per D34 — e.g. `FR-04-deploy-rollback`) |
| Architecture-doc section | `<§N or anchor>` |
| Mockup section / behaviour | `<section / interaction>` |
| CR | `<CR-NNNN-slug>` (post-finalization — e.g. `CR-0010-component-ci-pipeline`) |
| ADR | `<ADR-NNNN-slug>` (new architectural decision — e.g. `ADR-0001-topology-derivation-five-pass`) |
| Hand-off note | `<path or link>` (when resolving cross-domain hand-off) |

**No source → no PR.** Uncited by something authoritative:

- Write the doc update first, OR
- Flag the gap.

## Issue linkage

<!--
  Required when this PR resolves a GitHub-issue-sourced task (per D14 / core/github-integration.md).
  GitHub auto-closes referenced issues on merge when one of: Closes / Fixes / Resolves precedes the #.
  Use Fixes for bug-report issues; Closes for feature-request issues.
  Drop this section when the task originated from a TODO line or direct instruction.
-->

- Closes #`<N>` — `<one-line issue title>`
- Fixes #`<N>` — `<one-line issue title>` (bug)
- Related #`<N>` — `<no auto-close, just context>`

## Domain breakdown (for cross-domain PRs)

| Domain | Role | Files touched (top-level) | Verification |
|---|---|---|---|
| `<e.g. service-tier>` | `<role>` | `<path-glob>` | `<test command + outcome>` |
| `<e.g. client-tier>` | `<role>` | `<path-glob>` | `<test command + outcome>` |
| `<e.g. infra-tier>` | `<role>` | `<path-glob>` | `<test command + outcome>` |

## Cross-domain sign-offs

<!--
  Required when PR touches any of:
  - Wire-contract breaking change.
  - Infra change affecting application config.
  - Cross-domain bug fix.
-->

- [ ] `solution-architect` — architecture-doc / CR / ADR landed
- [ ] `backend-engineer` — wire shape confirmed
- [ ] `frontend-engineer` — client adapts to new shape
- [ ] `devops-engineer` — env var / secret / endpoint provisioned
- [ ] `qa-engineer` — fixtures + assertions match new contract
- [ ] manual smoke against running stack (per `core/cross-domain-bugs.md` Phase 3) — `<one-line result per new flow>`

## Cost impact (when applicable)

<!-- Devops-led PRs that add resources or bump SKUs. -->

| Item | Before | After | Delta |
|---|---|---|---|
| `<resource>` | `<USD/mo>` | `<USD/mo>` | `<+/- USD>` |
| **Total** | | | |

**Cost-cap NFR check:** `<still under | exceeds — explain>`.

## Verification log

| Command | Outcome |
|---|---|
| `<build / test / lint command>` | `<exit code / pass-fail / counts>` |

<!--
  PRs touching a user-facing surface:
  - Manual smoke against the running stack.
  - NOT the mockup.
-->

- `<one line per new flow>`

**Manual smoke skipped** (e.g. headless):

- State so explicitly.
- **Never** claim PASS without doing it.

**Doc-style protocol** *(when PR touches adopter markdown — rules in `core/process.md § Documentation style`; enforcement in `core/protocols/doc-authoring-protocol.md`)*

- `<discovered linter command>: PASS / N findings` OR `no linter configured; self-checked against § Mandatory checks`.

## CI status

<!--
  Optional placeholder for automatic-mode CI-watch (D20 / core/ci-watch.md).
  team-lead updates this section only on exit-clean ("all required checks green")
  or final handback ("CI failed — see comment trail"). Never mid-cycle.
  Drop this section in interactive mode or when `automatic-mode.ci-watch: disabled`.
-->

- `<all required checks green | failed after N fix cycles — see PR comments>`

## Open issues / follow-ups

- `<issue>` — `<who/what is blocked>`
- `<follow-up TODO / CR / ADR opportunity>`

## Out of scope (explicit)

- `<what this PR deliberately does NOT do, to prevent reviewer scope-creep>`
