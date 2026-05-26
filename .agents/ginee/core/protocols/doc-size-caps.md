---
audience: ai-engineer
load: on-demand
triggers: [doc-size-caps, size-cap, breach, optimized-by]
cap-bytes: 8192
reads-before-applying: []
---

# Doc-size caps — per-class enforcement

Audience: `ai-engineer` (charter trigger) · `team-lead` (advisory routing) · `scripts/context-economy-check.ps1` (gate). Other cardinals never load.

## Default caps

| Class | Default | Filesystem |
|---|---|---|
| ADR | 4096 bytes | `<adr-directory>/*.md` per `local/framework.config.yaml § adr-directory` |
| CR | 6144 bytes | `<cr-directory>/*.md` per `§ cr-directory` |
| UI doc | 4096 bytes | `<ui-directory>/*.md` per `§ ui-directory` (default `docs/ui/`) |

Bytes, not tokens — matches `scripts/context-economy-check.ps1` semantics (token-count deferred).

## Adopter override

```yaml
doc-size-caps:
  adr:
    cap-bytes: 6144           # raise (laxer) / lower (stricter)
  cr:
    cap-bytes: 8192
  ui:
    cap-bytes: 4096           # accept default explicitly
  # ui: disabled              # opt out for this class
```

**Resolution per class (stop at first match):** class entry `cap-bytes:` · class `disabled` (skip) · class absent → framework default · `doc-size-caps:` absent → all defaults · class directory key absent → silently skip class (graceful degradation).

## Enforcement + bypass

Both layers (local gate + PR-time CI) use `scripts/context-economy-check.ps1`. Breach fails the gate UNLESS the commit carries `Optimized-By: ai-engineer` trailer (signals `ai-engineer` ran an optimization pass — literal compression OR load-on-demand split OR scope-reduction). Same trailer + same script + same `context-economy.yml` workflow shape on both layers.

| Layer | Trigger |
|---|---|
| Local gate | Per-file diff against base ref. Reuses Claude Code hook · git hooks. |
| PR-time CI | Pull-request workflow. Same script + trailer-bypass semantics. |

No silent acceptance — advisory hard cap.

## Breach routing

Cap breach → `ai-engineer` dispatch trigger per `core/roles/ai-engineer.md § Process integration`. Dispatch contract:

- **Scope** — breaching file(s); lossless rule binds.
- **Acceptance** — size ≤ cap OR `Optimized-By: ai-engineer` trailer on the optimization commit.
- **Path** — load-on-demand split pattern proven on `automatic-mode.md` · `options-protocol.md` · `doc-authoring-protocol.md`.

## Mandatory checks before breaching commit

1. **Class identified** — file matches exactly one class via directory keys; multi-class match → `team-lead` routing question; never silent.
2. **Cap resolved** — class entry · `disabled` · framework default — one unambiguous answer.
3. **Lossless rule honoured** — every rule / invariant / cross-ref survives the pass (in file OR cross-linked sibling).
4. **Trailer present** — commit carries `Optimized-By: ai-engineer` exactly once.

LLM self-review; team-lead surfaces one-line advisory on violation; never auto-rewrite; never re-dispatch for format.

**Forward-only.** Absent `doc-size-caps:` → defaults apply silently. Absent class directory keys → class silently skipped. Existing oversized docs surface as advisories on next touch.
