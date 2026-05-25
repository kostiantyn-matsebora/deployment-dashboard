---
name: Bug report (ginee)
about: Defect that the ginee framework will pick up via @team-lead
title: "[Bug] <one-line title>"
labels: [ginee:ready]
---

<!--
  Priority signal (optional but recommended) — add `value:high|medium|low`
  + `complexity:high|medium|low` labels (ATAM utility-tree convention) so
  `ginee-triage` ranks this against other ready work.
  `value` = user / business impact. `complexity` = implementation cost
  (team-lead will dispatch solution-architect to auto-estimate if missing).
  Full rules: `.agents/ginee/core/triage-scoring.md`.
-->


<!--
  Sections below are parsed by team-lead on pickup.
  Keep headings (## Summary / ## Steps to reproduce / etc.) intact — do not rename.
  Drop a section only when truly inapplicable; leave the heading + write "(none)".
  Adopters: copy this file to .github/ISSUE_TEMPLATE/ to expose it as a GitHub issue form.
-->

<!--
  Doc shape rules — apply to EVERY section, including Summary:
  - File / endpoint / config inventories → table, not comma-separated prose.
  - Procedures / steps → numbered list.
  - Multi-rule statements → parent bullet + sub-bullets, one rule per line.
  - No paragraph with > 2 sentence terminators.
  - No parenthetical comma-lists inside a sentence — promote to a bulleted list.
  - Cross-reference; never restate (cite `§Name`, `#anchor`).
  Full rules: `core/process.md § Mandatory checks before report-as-done`.
-->

## Summary

<!-- One short bulleted-list or 1–2 short sentences. Avoid parenthetical inventories. -->
<1–2 sentences describing what's wrong>

## Steps to reproduce

1. <step>
2. <step>
3. <step>

## Expected behavior

<what should happen>

## Actual behavior

<what happens instead — include error messages, screenshots, log excerpts>

## Affected area

<!--
  One value. Drives PM routing to the owning specialist per local/bindings.md:
    frontend | backend | devops | qa | mobile | ml | data | sre | security | docs | multiple
-->
<area>

## FR / NFR cited

<!--
  Optional but speeds Phase 1 triage.
  Comma-list of identifiers from the architecture doc (e.g. FR-04, NFR-02).
  Use "-" if none apply.
-->
<list>

## Acceptance criteria

<!-- Testable conditions for Phase 8 acceptance. Drives qa-engineer's scenario authoring. -->
- [ ] <criterion>
- [ ] <criterion>

## Reporter context (optional)

- Version / commit SHA: <value>
- Environment: <local-dev | staging | production>
- Browser / OS / runtime: <if relevant>
- Frequency: <always | intermittent | once>
