---
name: Framework feature request (ginee)
about: New capability or improvement to the ginee framework itself
title: "[Framework Feature] <one-line title>"
labels: [ginee:ready, framework]
---

<!--
  Filed against ginee upstream (per local/framework.config.yaml § github.framework-repo):
    @team-lead file framework-feature <title>
  Priority signal: add `value:*` + `complexity:*` labels (ATAM convention).
  Full: .agents/ginee/core/protocols/triage-scoring.md.

  Sections parsed by team-lead; keep headings intact.
  Doc shape (every section): inventories → table · steps → numbered list · multi-rule → parent + sub-bullets ·
  no paragraph > 2 sentence terminators · no parenthetical comma-lists · cross-ref never restate.
  Full: core/process.md § Mandatory checks before report-as-done.
-->

## Summary

<1–2 sentences describing the proposed framework capability>

## Motivation

<what's missing today — adopter pain · recurring workaround · gap in a locked decision>

## Affected framework surface

<!-- Pick one or more: process | role-kernel | role-details | new-role | template | adapter | extras-role |
     spec (index-protocol / github-integration / new) | install-mechanism. Plus file paths. -->

- Surface: <categories>
- Files likely touched: `<path-globs>`

## Proposed behavior

<observable framework behavior after the change — what team-lead / cardinals / ai-engineer do differently>

## Owner-decision impact

<!-- New owner decision or amends existing? Owner log in PLAN.md § Locked decisions. Pointers NOT load-bearing
     on runtime. Skip if "none". -->

- New decision needed: `<yes | no>`
- Owner-history pointers: `<short-slug-1 | short-slug-2 | … | none>`

## Backward compatibility

<!-- Adopters re-fetch core/ on update — surface any break. -->

- Breaks existing `local/` files: `<yes | no — explain>`
- Migration note required: `<yes | no>`

## Acceptance criteria

- [ ] <criterion>
- [ ] <criterion>

## Out of scope

- <item>
- <item>

## References (optional)

- Related framework issues: `#<N>` …
- Discussion source: `#<N>` …
- Adopter examples: <link / description>
