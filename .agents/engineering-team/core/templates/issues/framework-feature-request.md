---
name: Framework feature request (engineering-team)
about: New capability or improvement to the engineering-team framework itself
title: "[Framework Feature] <one-line title>"
labels: [engineering-team:ready, framework]
---

<!--
  Filed against the engineering-team framework upstream repo (per
  local/framework.config.yaml § github.framework-repo) via:
    @project-manager file framework-feature <title>
  Sections parsed by project-manager when picking up framework work.
  Keep headings intact.
-->

## Summary

<1–2 sentences describing the proposed framework capability>

## Motivation

<what's missing in the current framework — adopter pain, recurring workaround, gap in a locked decision>

## Affected framework surface

<!--
  Where the change would land. Pick one or more:
    process | role-kernel | role-details | new-role | template | adapter | extras-role |
    spec (index-protocol / github-integration / new) | install-mechanism
  Plus the specific file path(s).
-->

- Surface: <categories>
- Files likely touched: `<path-globs>`

## Proposed behavior

<observable framework behavior after the change — what would `project-manager` / cardinals / `ai-engineer` do differently?>

## Locked-decision impact

<!--
  Does this require a new locked decision (D15+) or amend an existing one (D1 — D14)?
  Framework's source of truth for decisions is PLAN.md + CLAUDE.md tables.
-->
- New decision needed: `<yes | no>`
- Existing decisions affected: `<D1 | D5 | D7 | ... | none>`

## Backward compatibility

<!--
  Does this break existing adopters? Required because copy-paste install
  + tarball upgrade are supported (D4) — adopters re-fetch core/ on update.
-->
- Breaks existing `local/` files: `<yes | no — explain>`
- Migration note required in `core/MIGRATIONS/`: `<yes | no>`

## Acceptance criteria

- [ ] <criterion>
- [ ] <criterion>

## Out of scope

<!-- What this proposal explicitly does NOT cover. -->
- <item>
- <item>

## References (optional)

- Related framework issues: `#<N>` …
- Discussion source: `#<N>` …
- Adopter project examples: <link / description>
