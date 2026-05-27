# Pull-Request Description Template

<!--
  Every PR cites one of: requirement · NFR · mockup section · CR · ADR.
  Replace placeholders; drop empty sections.

  Audience binding — PR descriptions are read by humans (reviewers · contractors · future maintainers) AND
  LLMs (CI bots · ginee CI-watch · review-comment ingestion). Lead with the adopter-visible change in `## What`;
  framework mechanics + internal IDs come AFTER in `## Cites` / `## Verification log` / `## Notes`. Full:
  core/protocols/doc-authoring-protocol.md § Audience check.
-->

---

## What

<!-- 1–2 sentences. Lead with the adopter-visible change in plain language — what users / reviewers see
     differently after this lands. Framework mechanics belong in `## Cites` and `## Verification log`,
     not here. Imperative voice. -->

`<adopter-visible change summary>`

## Why

<!-- 1–2 sentences. Trigger ∈ TODO line · CR · defect · explicit user request. Reference the source. -->

`<trigger + reference>`

## Cites

| Source | Reference |
|---|---|
| Requirement | `<FR-NN-slug | NFR-NN-slug>` (slug-glued — `FR-04-deploy-rollback`) |
| Architecture-doc section | `<§N or anchor>` |
| Mockup section / behaviour | `<section / interaction>` |
| CR | `<CR-NNNN-slug>` (post-finalization — `CR-0010-component-ci-pipeline`) |
| ADR | `<ADR-NNNN-slug>` (new architectural decision) |
| Hand-off note | `<path or link>` (resolving cross-domain hand-off) |

**No source → no PR.** Uncited → write doc update first OR flag gap.

## Issue linkage

<!-- Required for GitHub-issue-sourced tasks. GitHub auto-closes on merge with Closes / Fixes / Resolves. Drop section for TODO / direct-instruction. -->

- Closes #`<N>` — `<title>`
- Fixes #`<N>` — `<title>` (bug)
- Related #`<N>` — `<context, no auto-close>`

## Domain breakdown (cross-domain PRs only)

| Domain | Role | Files (top-level) | Verification |
|---|---|---|---|
| `<service-tier>` | `<role>` | `<path-glob>` | `<test command + outcome>` |
| `<client-tier>` | `<role>` | `<path-glob>` | `<test command + outcome>` |
| `<infra-tier>` | `<role>` | `<path-glob>` | `<test command + outcome>` |

## Cross-domain sign-offs

Required when PR touches: wire-contract breaking change · infra affecting app config · cross-domain bug fix.

- [ ] `solution-architect` — architecture-doc / CR / ADR landed
- [ ] `backend-engineer` — wire shape confirmed
- [ ] `frontend-engineer` — client adapts to new shape
- [ ] `devops-engineer` — env var / secret / endpoint provisioned
- [ ] `qa-engineer` — fixtures + assertions match new contract
- [ ] Manual smoke per `core/protocols/cross-domain-bugs.md` Phase 3 — `<one-line per new flow>`

## Cost impact (when applicable)

DevOps PRs adding resources / SKU bumps:

| Item | Before | After | Delta |
|---|---|---|---|
| `<resource>` | `<USD/mo>` | `<USD/mo>` | `<+/- USD>` |
| **Total** | | | |

**Cost-cap NFR:** `<still under | exceeds — explain>`.

## Verification log

| Command | Outcome |
|---|---|
| `<build / test / lint>` | `<exit code · pass-fail · counts>` |

PRs touching user-facing surface — manual smoke against running stack (NOT mockup), one line per flow. Skipped (e.g. headless) → state explicitly; **never** claim PASS without doing it.

**Doc-style protocol** (when PR touches adopter markdown per `core/process.md § Documentation style` · enforcement in `core/protocols/doc-authoring-protocol.md`):

- `<discovered linter>: PASS / N findings` OR `no linter configured; self-checked against § Mandatory checks`.

## CI status

<!-- Optional placeholder for automatic-mode CI-watch. team-lead updates ONLY on exit-clean ("all required green") or final handback ("CI failed — see comments"). Never mid-cycle. Drop in interactive mode or with `automatic-mode.ci-watch: disabled`. -->

- `<all required checks green | failed after N fix cycles — see PR comments>`

## Open issues / follow-ups

- `<issue>` — `<who/what is blocked>`
- `<follow-up TODO / CR / ADR>`

## Out of scope (explicit)

- `<what this PR deliberately does NOT do — prevent reviewer scope-creep>`
