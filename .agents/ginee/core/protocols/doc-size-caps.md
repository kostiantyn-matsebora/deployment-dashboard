# Doc-size caps — per-class enforcement

**Audience.** `ai-engineer` (charter trigger) · `team-lead` (advisory routing) · `scripts/context-economy-check.ps1` (gate implementation). Other cardinals never load this file.

## Purpose

`core/process.md § Documentation style — structure over prose` governs doc *shape*. The doc-authoring protocol governs *self-lint*. Neither governs *size*. Once a load-on-demand doc class (ADR · CR · UI mockup) crosses an unbudgeted threshold, every dispatch that loads it pays the cost — and `ai-engineer` only learns about the bloat ad-hoc, after it lands.

Per-class size caps add the missing dimension. Same trailer-bypass machinery as the whole-PR context-economy gate; same `ai-engineer` dispatch trigger as the rest of the shape protocol.

## Default caps

| Class | Default cap | Filesystem hint |
|---|---|---|
| ADR | 4096 bytes | `<adr-directory>/*.md` per `local/framework.config.yaml § adr-directory` |
| CR | 6144 bytes | `<cr-directory>/*.md` per `local/framework.config.yaml § cr-directory` |
| UI doc | 4096 bytes | `<ui-directory>/*.md` per `local/framework.config.yaml § ui-directory` (default `docs/ui/`) |

Defaults are bytes, not tokens — matches `scripts/context-economy-check.ps1` semantics today; token-count is a future refinement and not part of v1.

## Adopter override

Per-class entry in `local/framework.config.yaml`:

```yaml
doc-size-caps:
  adr:
    cap-bytes: 6144           # raise (laxer) or lower (stricter) than framework default
  cr:
    cap-bytes: 8192
  ui:
    cap-bytes: 4096           # accept default explicitly
  # ui: disabled              # opt out of enforcement for this class
```

Resolution per class:

1. Class entry present with `cap-bytes: <N>` → use `<N>`.
2. Class entry present with `disabled` → skip enforcement for that class.
3. Class entry absent → framework default applies.
4. Top-level `doc-size-caps:` absent → all defaults apply.
5. Class directory key (`adr-directory:` / `cr-directory:` / `ui-directory:`) absent → no files to check; class skipped silently (graceful degradation, not error).

## Enforcement

| Layer | Trigger | Mechanism |
|---|---|---|
| Gate layer | Per-file diff against base ref | `scripts/context-economy-check.ps1` checks every changed file matching `<adr-directory>/*.md` · `<cr-directory>/*.md` · `<ui-directory>/*.md` against its class cap on the *current* file size (not delta); breach without `Optimized-By: ai-engineer` trailer fails the gate. Reuses the existing Claude Code hook · git hooks · CI workflow wiring. |
| PR-time CI layer | Pull-request workflow | Same script, run as a CI job on the PR target ref. Same trailer-bypass semantics as gate layer. Adopter-side wiring follows the existing `context-economy.yml` workflow shape. |

Both layers are advisory hard caps — *advisory* in that the `Optimized-By: ai-engineer` trailer bypasses (signalling an actual ai-engineer optimization pass ran), *hard* in that an unsigned breach fails the gate. No silent acceptance.

## Breach routing

A per-class cap breach is an `ai-engineer` dispatch trigger per `core/roles/ai-engineer.md § Process integration triggers`. The dispatch contract:

- **Scope** — the breaching file(s); the lossless rule binds (no rule deletion).
- **Acceptance** — file size at or below cap OR `Optimized-By: ai-engineer` trailer on the commit that lands the optimization pass (recording that the pass ran but determined a load-on-demand split / archive / scope-reduction was the correct outcome rather than literal byte-reduction).
- **Path** — same load-on-demand split pattern proven on `core/automatic-mode.md` · `core/protocols/options-protocol.md` · `core/protocols/doc-authoring-protocol.md` (D30 adopt-existing-solution — framework's own load-on-demand pattern, applied at the doc level).

## Mandatory checks before pushing a breaching commit

1. **Class identified.** The breaching file matches exactly one class via the directory keys in `local/framework.config.yaml`. Multiple-class match → `team-lead` routing question; never silent.
2. **Cap resolved correctly.** Per-class entry → `disabled` → framework default → no class entry. One unambiguous answer.
3. **Lossless rule honoured.** Every rule / invariant / cross-reference in the over-cap file survives the optimization pass — either in the file itself (after compression) or in an explicitly cross-linked sibling (after split).
4. **Trailer present.** Commit landing the optimization carries `Optimized-By: ai-engineer` exactly once (matching the existing context-economy bypass shape).

LLM self-review against these four; `team-lead` surfaces one-line advisory on violation; never auto-rewrites; never re-dispatches purely for format. Same enforcement machinery as the rest of the doc-authoring protocol.

## Out of scope (v1)

- **Token-count caps.** Byte-count for v1; token-count is closer to actual LLM-loading cost but coupling the framework to a specific tokenizer is undesirable. Open question per the originating issue.
- **Soft-advisory variant.** User explicitly requested hard cap with trailer-bypass; soft warnings without gate effect are not part of v1.
- **Caps for non-listed classes** — architecture-doc · README · runbook · scenario · API docs. These doc classes have their own ownership + lifecycle; revisit if/when there is a motivating breach.
- **Retroactive sweep of existing docs.** Forward-only — breaches surface on the next touch of an oversized file, not on a one-time repo-wide audit.
- **Per-section caps.** File-level only; subsection caps would require a parser. Out of scope.

## Forward-only

Purely additive. Absent `doc-size-caps:` in `local/framework.config.yaml` → all defaults apply silently. Absent `adr-directory:` / `cr-directory:` / `ui-directory:` → class skipped silently. Existing oversized docs surface as advisories on next touch; no retroactive rewrite. Matches the doc-authoring protocol enforcement scope.
