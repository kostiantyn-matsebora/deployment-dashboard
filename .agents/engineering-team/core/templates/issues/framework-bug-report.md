---
name: Framework bug report (engineering-team)
about: Defect in the engineering-team framework itself (role definitions, process docs, adapters, templates, extras)
title: "[Framework Bug] <one-line title>"
labels: [engineering-team:ready, framework]
---

<!--
  Filed against the engineering-team framework upstream repo (per
  local/framework.config.yaml § github.framework-repo) via:
    @project-manager file framework-bug <title>
  Sections parsed by project-manager when picking up framework work.
  Keep headings (## Summary / ## Reproduction / etc.) intact.
-->

## Summary

<1–2 sentences describing what the framework did wrong>

## Affected framework artefact

<!--
  Where the bug lives. Pick one:
    process | role-kernel | role-details | template | adapter | extras-role | spec (index-protocol / github-integration / etc.)
  Plus the specific file path.
-->

- Type: <category>
- File: `<core/process.md | core/roles/<name>.md | adapters/<client>/... | extras/roles/<name>.md | ...>`

## Framework version

- `core/VERSION`: `<value from .agents/engineering-team/core/VERSION>`
- Last upstream sync: `<date or commit SHA — from install-script record if known>`

## Adapter in use

<!-- claude | copilot | cursor | codex | generic. Drives "is this an adapter-specific issue?" -->
<adapter>

## Reproduction

1. <user / orchestrator action that triggered it>
2. <what the framework dispatched / wrote>
3. <observed result>

## Expected framework behavior

<what should have happened per the relevant spec section — cite `core/process.md § X` / `core/<spec>.md § Y` / etc.>

## Actual framework behavior

<what happened instead — paste verbatim where useful>

## Blocking severity

<!--
  How much it blocks the adopter:
    blocker — cannot proceed | workaround-available — describe | minor — quality issue, no block
-->
<severity>

## Workaround (if any)

<temporary mitigation the adopter is using>

## Locked decisions referenced

<!-- D1 — D14. Tag affected ones so framework owners know the surface. -->
- `<DNN>` — `<one-line decision summary or "n/a">`

## Acceptance criteria

<!-- Testable conditions the framework owners would accept as "fixed". -->
- [ ] <criterion>
- [ ] <criterion>
