---
name: Framework bug report (ginee)
about: Defect in the ginee framework itself (role definitions, process docs, adapters, templates, extras)
title: "[Framework Bug] <one-line title>"
labels: [ginee:ready, framework]
---

<!--
  Priority signal (optional but recommended) — add `value:high|medium|low`
  + `complexity:high|medium|low` labels (ATAM utility-tree convention) so
  `ginee-triage` ranks this against other ready framework work.
  Full rules: `.agents/ginee/core/triage-scoring.md`.
-->


<!--
  Filed against the ginee framework upstream repo (per
  local/framework.config.yaml § github.framework-repo) via:
    @team-lead file framework-bug <title>
  Sections parsed by team-lead when picking up framework work.
  Keep headings (## Summary / ## Reproduction / etc.) intact.
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

- `core/VERSION`: `<value from .agents/ginee/core/VERSION>`
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

<!--
  Tag affected D-decisions so framework owners know the surface.
  D34 — taxonomy IDs slug-glued (filename slug after the numeric prefix).
  Look up: `ls core/MIGRATIONS/D<NN>-*.md` and use the full `D<NN>-<slug>` form.
  Example: `D28-skill-runner-boundary`, not bare `D28`.
-->
- `<D<NN>-<slug>>` — `<one-line decision summary or "n/a">`

## Acceptance criteria

<!-- Testable conditions the framework owners would accept as "fixed". -->
- [ ] <criterion>
- [ ] <criterion>
