# Cross-agent handoff — diagnose ≠ fix

**Load-on-demand.** Fetched when a specialist discovers a root cause **outside** their domain while working on their own task. The orchestrator may also load this file when a specialist's final report flags a cross-domain root cause that needs hand-off.

Default in-domain tasks do not load this file.

## Procedure

When a specialist discovers a root cause **outside** their domain:

1. **Diagnose fully; do NOT fix.** Cross-domain patches cause silent contract drift.
   - Write up: failing command, verbatim error, file + line, chain of reasoning.
   - Template: `core/templates/hand-off-note.md`.
2. **Hand off** to the owning specialist (routing in `local/bindings.md`). Package contents:
   - Symptom.
   - Verified root cause with evidence.
   - What the discoverer tried and ruled out.
   - Any local workaround in place + whether to remove it once the proper fix lands.
3. **Both specialists stay engaged.**
   - Owner fixes.
   - Discoverer reviews and removes workaround.
   - Not throw-over-the-wall.
4. **Workarounds are temporary, labelled as such.**
   - Stay only until owner lands proper fix.
   - Both specialists acknowledge in reports.
5. **Out-of-competence fixes are disallowed** — see `local/bindings.md` → "Project role boundaries".

## Orchestrator wiring

When a specialist flags a cross-domain root cause in their final report:

- Dispatch the owning specialist next.
- Pass the prior diagnosis verbatim.

## Doc updates route through the doc's owner

| Doc class | Owner |
|---|---|
| Architecture doc / project-instruction files / process docs / ADRs | `solution-architect` |
| Mockup (HTML / CSS / JS / SVG edits) | mockup-owning role |
| Mockup (governance review only) | `solution-architect` |

Engineers outside the owning domain never edit these directly.
