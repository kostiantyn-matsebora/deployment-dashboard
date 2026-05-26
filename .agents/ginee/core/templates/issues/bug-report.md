---
name: Bug report (ginee)
about: Defect that the ginee framework will pick up via @team-lead
title: "[Bug] <one-line title>"
labels: [ginee:ready]
---

<!--
  Priority signal (recommended) — add `value:high|medium|low` + `complexity:high|medium|low` labels
  (ATAM convention) so `ginee-triage` ranks this. team-lead auto-estimates missing `complexity:*` on pickup.
  Full: .agents/ginee/core/protocols/triage-scoring.md.

  Sections below parsed by team-lead. Keep headings intact; drop empty ones with "(none)".
  Adopters: copy to .github/ISSUE_TEMPLATE/ to expose as GitHub issue form.

  Doc shape (every section): inventories → table · steps → numbered list · multi-rule → parent + sub-bullets ·
  no paragraph > 2 sentence terminators · no parenthetical comma-lists inside sentences · cross-ref, never restate.
  Full: core/process.md § Mandatory checks before report-as-done.
-->

## Summary

<1–2 sentences describing what's wrong>

## Steps to reproduce

1. <step>
2. <step>
3. <step>

## Expected behavior

<what should happen>

## Actual behavior

<what happens instead — error messages · screenshots · log excerpts>

## Affected area

<!-- One value. Drives PM routing per local/bindings.md: frontend | backend | devops | qa | mobile | ml | data | sre | security | docs | multiple -->

<area>

## FR / NFR cited

<!-- Optional. Comma-list of architecture-doc identifiers (e.g. FR-04, NFR-02). "-" if none. -->

<list>

## Acceptance criteria

<!-- Testable conditions for Phase 8. Drives qa-engineer's scenario authoring. -->

- [ ] <criterion>
- [ ] <criterion>

## Reporter context (optional)

- Version / commit SHA: <value>
- Environment: <local-dev | staging | production>
- Browser / OS / runtime: <if relevant>
- Frequency: <always | intermittent | once>
