---
audience: all-cardinals
load: on-demand
triggers: [phase-1, analysis, elicitation]
cap-bytes: 4096
reads-before-applying: []
---

# Phase 1 — Analysis

**Load triggers** — TL (always) · SA (design dip) · originating engineer (when scope is engineer-elicited).

- **Goal.** Bound scope; identify touched domains.
- **Reads.** TODO line + relevant architecture sections + mockup + code.
- **`solution-architect` design dip.** On any non-trivial scope, SA elicits the requirements register (FRs / NFRs / constraints in `local/requirements.md`) AND derives the ASR utility tree (`local/asr-utility-tree.md`) per `core/roles/solution-architect.md § Design`. Resolves **greenfield vs delta** mode. Output goes to Phase 2 dispatch.
- **Output.** Phase 2 dispatch plan + requirements / ASR diff + resolved design mode + surfaced ambiguities.
- **Acceptance.** Scope bounded enough to plan Phase 2. ≤ 1 unresolved scope question. ASR utility tree captures every quality-attribute-driver the proposed change touches.
