---
name: Bug report (engineering-team)
about: Defect that the engineering-team framework will pick up via @project-manager
title: "[Bug] <one-line title>"
labels: [engineering-team:ready]
---

<!--
  Sections below are parsed by project-manager on pickup.
  Keep headings (## Summary / ## Steps to reproduce / etc.) intact — do not rename.
  Drop a section only when truly inapplicable; leave the heading + write "(none)".
  Adopters: copy this file to .github/ISSUE_TEMPLATE/ to expose it as a GitHub issue form.
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
