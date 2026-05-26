---
audience: team-lead-only
load: on-demand
triggers: [ginee-address-review, address-review, review cycle, ginee:review-cycle, per-thread reply]
cap-bytes: 6144
reads-before-applying: [core/templates/pr-comment-cadence.md]
---

# Review-cycle schema — merged into template

Template + lints + worked example + forbidden patterns + self-lint checks now consolidated into **`core/templates/pr-comment-cadence.md`** (single canonical file per artefact).

Existing cites to this schema file resolve to the template — content unchanged in meaning.

<!-- self-lint: pass -->
