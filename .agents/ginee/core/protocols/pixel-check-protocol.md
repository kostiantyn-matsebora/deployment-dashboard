---
audience: qa-engineer
load: on-demand
triggers: [pixel-check, visual-diff, visual-oracle, qa-pixel-check]
cap-bytes: 12000
reads-before-applying: [core/protocols/blueprint-diff-protocol.md]
---

# QA pixel-check — visual diff at a shared seed-state

**Load-on-demand.** Fetched by `qa-engineer` during Phase 5 when `local/framework.config.yaml § qa.pixel-check.enabled: true` AND the change diff intersects the visual surface. Cardinals other than `qa-engineer` never load it.

## Principle

Mockup graduates from **design reference** to **runtime oracle** — render app + render mockup + pixel-diff at the same seed-state. Behaviour tests catch logic regressions; pixel-check catches CSS / layout / icon / copy / responsive-breakpoint regressions that survive behaviour green. Pairs with `blueprint-diff-protocol.md` (mockup-vs-blueprint-ref drift — mockup self-drift); pixel-check covers the **app-vs-mockup** drift axis.

## Gate — pixel-check fires when ALL hold

| Condition | Source |
|---|---|
| `qa.pixel-check.enabled: true` | `local/framework.config.yaml` |
| Change diff touches the visual surface | `visual-source-of-truth.path` OR any path in `local/bindings.md § front-end-owned` |
| Seed script + mockup snapshot + app-render command configured | `local/bindings.md` |

Any condition unmet → pixel-check skipped silently; QA falls through to manual smoke per `phase-5-testing.md`.

## State-alignment direction

Both renders MUST show the same application state. State origin is the seed script. Two adopter-chosen configurations:

| Direction | What changes | Pick when |
|---|---|---|
| `mockup-follows-seed` | Mockup is authored / re-snapshotted to match seed-script output | Seed is the stable artefact; mockup churn is cheaper |
| `seed-follows-mockup` | Seed script is authored to produce the state the mockup depicts | Mockup is the stable artefact (design-led); seed churn is cheaper |

Adopter picks; framework MUST NOT prescribe.

## Run — 4 steps

1. **Seed.** `seed-script.path` → app at canonical state.
2. **Render app.** `app-render.command` per viewport → `actual/<viewport>.png`.
3. **Read mockup.** `mockup-snapshot.path/<viewport>.png` → `expected/<viewport>.png`.
4. **Diff.** Adopter pixel-diff tool (`pixelmatch` · `playwright --update-snapshots` · `reg-cli` · `Percy` · `Chromatic` · etc.) → `diff/<viewport>.png` + delta count. Framework specifies the contract, not the tool.

## Tolerance + masks

`local/framework.config.yaml § qa.pixel-check`:

| Key | Purpose |
|---|---|
| `max-diff-pixels` | Absolute pixel ceiling per viewport |
| `max-diff-ratio` | Fraction of total pixels (e.g. `0.001`) |
| `mask-regions[].selector` | CSS selector for ignored areas (timestamps · animated · `[data-pixel-ignore]`) |
| `viewports[]` | Named `{ name, width, height }` triples |

**Oracle discipline.** Tolerance + masks ARE the oracle; audited like test code per `core/process.md § Test oracles can be wrong`.

- **Mask justification.** Every entry carries selector + `# why: <reason>`. Unjustified masks fail review.
- **Tolerance bumps.** MUST cite the specific diff that would have been caught at the prior threshold — prevents tolerance creep masking real regressions.

## Drift routing

| Diff source | Route to | Phase |
|---|---|---|
| App rendered wrong (mockup correct) | Owning front-end engineer | Phase 6 |
| Mockup outdated (app correct) | Mockup-owning role per `local/bindings.md` | Phase 2 |
| Seed produces wrong state | Owner of seed script | Phase 6 or new Phase 2 work item |
| Tolerance too tight (false positive) | `team-lead` (configuration call) | Out-of-phase |

Cross-domain bug → `team-lead` per `core/protocols/cross-domain-bugs.md` (universal trigger in `core/protocols/heavy-role-bypass.md`).

## Tolerance-bootstrap

First run on a new project / viewport — record the initial mask set from observed diffs:

1. Run with `max-diff-pixels: 0` + empty masks.
2. Inspect each region with `> 0` pixel delta.
3. Classify each: real diff (route) · stable noise (mask) · animated (mask + justification).
4. Land the mask set + agreed `max-diff-pixels` / `max-diff-ratio` in `local/framework.config.yaml`.

## Forbidden patterns

- **Auto-resnapshot the mockup** to match failing app render — mockup updates are Phase 2 with human review.
- **Auto-bump tolerance** to make a failing run green — bumps require cited justification (§ Tolerance + masks).
- **Skip drift routing** — every failure routes; "look at it later" is not an outcome.
- **Pixel-check as a gate** — it's an oracle; failures route to Phase 6 / Phase 2, not BLOCK.
- **Inline diff PNGs > 50 KB** in any phase report.

