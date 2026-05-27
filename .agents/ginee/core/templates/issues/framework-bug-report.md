---
name: Framework bug report (ginee)
about: Defect in the ginee framework itself (role definitions, process docs, adapters, templates, extras)
title: "[Framework Bug] <user-facing problem in plain language — what the framework did wrong, not which file is at fault>"
labels: [ginee:ready, framework]
---

<!--
  Audience binding — title + Summary describe what the framework did wrong in language a maintainer-on-call can grok cold.
  Forbidden in title: internal IDs (D<N> · Stage N) · file paths · module names · fix mechanics.
  Framework-internal sections (Affected artefact · Reproduction · Expected/Actual) come AFTER Summary.
  Full: core/protocols/doc-authoring-protocol.md § Audience check.

  Filed against ginee upstream (per local/framework.config.yaml § github.framework-repo):
    @team-lead file framework-bug <title>
  Priority signal (recommended): add `value:*` + `complexity:*` labels (ATAM convention) per
  .agents/ginee/core/protocols/triage-scoring.md.

  Sections parsed by team-lead; keep headings intact.
  Doc shape (every section): inventories → table · steps → numbered list · multi-rule → parent + sub-bullets ·
  no paragraph > 2 sentence terminators · no parenthetical comma-lists · cross-ref never restate.
  Full: core/process.md § Mandatory checks before report-as-done.
-->

## Summary

<2–4 sentences — restate the title for a cold human reader. No jargon. No D-IDs. No assumed prior context. What the framework did wrong, when, who notices.>

## Affected framework artefact

<!-- Pick one: process | role-kernel | role-details | template | adapter | extras-role | spec (index-protocol / github-integration / etc.) -->

- Type: <category>
- File: `<core/process.md | core/roles/<name>.md | adapters/<client>/… | extras/roles/<name>.md | …>`

## Framework version

- `core/VERSION`: `<value from .agents/ginee/core/VERSION>`
- Last upstream sync: `<date or commit SHA from install-script record, if known>`

## Adapter in use

<!-- claude | copilot | cursor | codex | generic. Drives "is this adapter-specific?" -->

<adapter>

## Reproduction

1. <user / orchestrator action that triggered it>
2. <what the framework dispatched / wrote>
3. <observed result>

## Expected framework behavior

<what should have happened — cite `core/process.md § X` / `core/<spec>.md § Y`>

## Actual framework behavior

<what happened instead — paste verbatim where useful>

## Blocking severity

<!-- blocker — cannot proceed | workaround-available — describe | minor — quality issue, no block -->

<severity>

## Workaround (if any)

<temporary mitigation>

## Owner-history pointers

<!-- Optional. Pointers to PLAN.md entries by short slug; NOT load-bearing on runtime. Skip if none. -->

- `<short-slug>` — `<one-line or "n/a">`

## Acceptance criteria

- [ ] <criterion>
- [ ] <criterion>
