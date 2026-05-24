# D22 — Doc-authoring protocol for adopter docs

**Date.** 2026-05-19.
**Closes.** [#39](https://github.com/kostiantyn-matsebora/ginee/issues/39).

## What changed

`core/process.md § Documentation style — structure over prose` was already declared to apply to adopter outputs (architecture doc, ADRs, READMEs, mockup). D22 promotes the rule from **aspirational → binding**, gives every cardinal role a concise authoring protocol, and wires **discovery-driven enforcement** so adopter docs are linted with the adopter's existing tooling.

| Layer | What it does | Where it lives | Load tier |
|---|---|---|---|
| Binding declaration + shape map + mandatory checks | The working contract — every role consults these when authoring docs. | `core/process.md § Documentation style` | **always-loaded** |
| Enforcement procedure + attestation format + out-of-scope | How to invoke the discovered lint, what to write in the phase report. | `core/protocols/doc-authoring-protocol.md` | load-on-demand at Phase 5 / report-as-done |
| Paired bad / good examples — 6 doc classes | Learning material. Useful first time authoring a class; dead weight once internalized. | `core/doc-authoring-examples.md` | load-on-demand on first-time / explicit request |
| Attestation entry | One-line Verification-log line. | `core/templates/phase-report.md`, `core/templates/pr-description.md` | always-loaded with template |
| Discovery | `team-lead` runs the existing `builtin:commands` + `builtin:conventions` recipes, which now recognise markdown / prose linters. | `core/roles/ai-engineer.details.md § Recipes` | load-on-demand at indexing |
| Enforcement command | `${commands.lint.docs}` discovered from `package.json § scripts` / `Makefile` / `justfile` / etc. | `local/index/commands.yaml` | load-on-demand at Phase 5 |

## Load topology — why the three-way split

The protocol is loaded by every cardinal role on every doc-touching task. Once **#37 (classical SA + per-engineer doc ownership)** lands, that's effectively every task. Putting the full protocol in one file would multiply ~8 KB across ~6 roles on most tasks.

The split:

- **Shape map + checks** (the working contract) are tiny — they ride along with `core/process.md` which is already always-loaded. Zero per-task fetch cost.
- **Enforcement + attestation** (~1.5 KB) load once per task at Phase 5 / report-as-done, via the phase-report template's reference to `core/protocols/doc-authoring-protocol.md`. No per-role-authoring fetch.
- **Examples** (~6 KB) only load when a role explicitly needs them. Empirically that's the first time a role authors a given doc class; afterwards the role internalizes the shape.

Net per-task delta after #37 amplification (vs. monolithic protocol):

| Doc-touching task with N roles | Monolithic (Δ from current) | Three-file split |
|---|---|---|
| Authoring | 8 KB × N | 0 (rules in process.md) |
| Phase 5 enforcement | (included above) | ~1.5 KB × 1 |
| First-time examples | (included above) | 6 KB × 1 (only if needed) |

## No custom lint

Earlier drafts proposed a custom `ginee-doc-style-lint` skill. **Dropped** — adopter projects already configure markdownlint / vale / prettier / proselint; shipping a parallel lint duplicates them, costs context (load-bearing logic in every dispatch), and ignores the discovered stack. The protocol document carries the rules; enforcement piggybacks on the adopter's tooling.

If no linter is discovered, `team-lead` recommends one in the discovery report. Adopter decides — never auto-install.

## Cross-issue ordering

| Issue | State | Coupling |
|---|---|---|
| [#37](https://github.com/kostiantyn-matsebora/ginee/issues/37) (classical SA Review activity) | open | When #37 lands, the SA Review activity gains doc-style compliance as a hard-reject criterion. D22 includes a TODO marker; no behaviour change at #39's merge time. |
| [#38](https://github.com/kostiantyn-matsebora/ginee/issues/38) (framework-self-dev gate) | shipped in 0.4.0 | Distinct concern. D22 governs adopter outputs; D21 governs `core/` / `adapters/` / `extras/`. The two never overlap. |

## Activation

Automatic on update. Roles fetch `core/protocols/doc-authoring-protocol.md` on-demand when authoring markdown. Discovery picks up adopter lint configs on next `rediscover`.

## Out of scope

- **Mass-restructure of legacy adopter docs.** Forward-only — new + edited content follows the protocol.
- **Style / tone / branding rules.** Protocol governs **structure**. Adopter style guides own the rest.
- **Custom ginee lint.** Permanently rejected — see § No custom lint.
