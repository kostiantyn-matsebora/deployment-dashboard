# Doc-authoring protocol — adopter docs (D22)

**Load-on-demand at Phase 5 / report-as-done** for any doc-touching task. Default shape rules + mandatory checks live in `core/process.md § Documentation style` (always-loaded); this file carries only enforcement + attestation.

Examples gallery: `core/doc-authoring-examples.md` (load on first-time authoring / explicit request).

## Enforcement via discovered stack

ginee does **not** ship a doc linter. Adopter projects already configure markdown / prose tooling — ginee discovers it and triggers it.

| Stage | Mechanism |
|---|---|
| Discovery | `team-lead` records the lint command in `local/index/commands.yaml § commands.lint.docs` via the existing `builtin:commands` recipe. Linter configs (markdownlint / vale / proselint / prettier-md) recorded in `local/index/conventions.yaml` via `builtin:conventions`. |
| Author | Role consults `core/process.md § Documentation style` (always-loaded) for shape rules + mandatory checks. |
| Enforce | Role runs `${commands.lint.docs}` at Phase 5 / report-as-done; lint output goes into the phase report's Verification log. |
| No tool detected | Discovery report recommends a baseline — markdownlint (structural) + vale (prose). Adopter decides — never auto-install. |

## Attestation

Phase-report Verification-log entry (one line):

```
Doc-style protocol — <linter command>: PASS / N findings (see <path>).
```

If no linter discovered: `Doc-style protocol — no linter configured; self-checked against core/process.md § Mandatory checks.`

## Bypass

Binding. Bypass only via explicit user direction recorded in the phase report. Never silent.

## Out of scope

- **Existing adopter docs.** Forward-only — new + edited content follows the protocol; mass-restructure of legacy docs is a separate user-initiated task.
- **Style / tone / branding.** This protocol governs **structure**, not voice. Adopter style guides own those.
- **Framework-self-dev.** Covered by D21 + `CLAUDE.md § Framework authoring — context economy`.
