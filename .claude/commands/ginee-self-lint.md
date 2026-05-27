---
description: Run the 7 phase-report self-lint checks against the last cardinal return. Returns PASS or violation summary.
argument-hint: [optional path to return text]
---

Run the 7 self-lint checks against the last cardinal return (or the text at `$ARGUMENTS` if supplied). Report PASS or the first violation; advisory only — never re-dispatch for format alone.

Checks per `core/templates/phase-report.md § Mandatory checks before report-as-done`:

1. **Section cardinality** — every required section present (use `(none)` when empty).
2. **No narrative preamble** — first non-Status line is a `##` section header.
3. **No restated dispatch context** — cite the dispatch prompt; don't restate.
4. **No code snippets outside `## Notes`** — diff stats + path cite in body.
5. **No verbose rationale outside `## Notes`** — one-line decision + cite in `## Decisions made`.
6. **Inventories in tables, not parenthetical comma-soup.**
7. **Marker present** — literal `<!-- self-lint: pass -->` as the LAST line (case-sensitive).

On violation: surface one-line advisory per `core/templates/phase-report.md § Worked advisories`. Format-only violations (preamble · marker absence · table shape) consume anyway — never re-dispatch. Substantive omissions (source paths touched without `## Source reads`) do trigger the single re-dispatch carve-out.
