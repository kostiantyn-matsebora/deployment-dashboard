# Phase 1 — Analysis

**Load triggers** — any cardinal whose `phase-participation:` includes `1`. Per-role roster: `team-lead` (always) · `solution-architect` (design dip) · the originating engineer if scope is engineer-elicited.

- **Goal.** Bound scope; identify touched domains.
- **Reads.** TODO line + relevant architecture sections + mockup + code.
- **`solution-architect` design dip (D25-classical-architect).** On any non-trivial scope, SA elicits the requirements register (FRs / NFRs / constraints in `local/requirements.md`) AND derives the ASR utility tree (`local/asr-utility-tree.md`) per `core/roles/solution-architect.md § Design`. Resolves **greenfield vs delta** mode. Output goes to Phase 2 dispatch.
- **Output.** Phase 2 dispatch plan + requirements / ASR diff + resolved design mode + surfaced ambiguities.
- **Acceptance.** Scope bounded enough to plan Phase 2. ≤ 1 unresolved scope question. ASR utility tree captures every quality-attribute-driver the proposed change touches.
