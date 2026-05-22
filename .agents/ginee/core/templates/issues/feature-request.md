---
name: Feature request (ginee)
about: New functionality that the ginee framework will pick up via @team-lead
title: "[Feature] <one-line title>"
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
  Keep headings (## Summary / ## Motivation / etc.) intact — do not rename.
  Drop a section only when truly inapplicable; leave the heading + write "(none)".
  Adopters: copy this file to .github/ISSUE_TEMPLATE/ to expose it as a GitHub issue form.
-->

<!--
  D26 shape rules — apply to EVERY section, including Summary:
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
<1–2 sentences describing the proposed feature>

## Motivation

<why this matters — user pain, business driver, technical-debt cost. One short paragraph.>

## Proposed behavior

<what the system should do — observable outcomes, not implementation. Drives Phase 2 design.>

## Affected area

<!--
  One value. Drives PM routing per local/bindings.md:
    frontend | backend | devops | qa | mobile | ml | data | sre | security | docs | multiple
-->
<area>

## FR / NFR

<!--
  Identifiers from the architecture doc. Mark new ones with "new:" prefix.
  PM dispatches solution-architect for CR/ADR when an FR/NFR is added or changed.
  Examples: FR-04 (amends), new: FR-12, new: NFR-08.
-->
<list>

## Acceptance criteria

<!-- Testable conditions for Phase 8 acceptance. Drives qa-engineer's scenario authoring. -->
- [ ] <criterion>
- [ ] <criterion>

## Out of scope

<!-- What this feature explicitly does NOT cover. Prevents scope creep mid-implementation. -->
- <item>
- <item>

## References (optional)

- Related issues: `#<N>` …
- Discussion source: `#<N>` …
- External links: <url> …
