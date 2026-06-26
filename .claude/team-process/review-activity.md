# Review Workflow — Activity Diagram

Visual companion to [`/review-loop`](../commands/review-loop.md); pairs with [`process-activity.md`](process-activity.md). Depicts: partition changed files into per-competency buckets → provision reviewer pool ∝ effort (file count) → drain bucket one file at a time → cross-review (adversarially verify + dedup) → integrate into one consolidated `REVIEW`.

```mermaid
flowchart TD
    start([Integrated change set on branch]) --> disc

    disc["Discover work-list<br/>Enumerate changed files, classify each by owning competency"]
    disc --> bucket["Partition into per-competency buckets<br/>e.g. backend: 10 files · frontend: 3 files · docs: 2 files"]

    bucket --> prov["Provision reviewer pools<br/>Pool size ∝ bucket effort (file count), capped by concurrency<br/>e.g. backend ×3 · frontend ×1 · docs ×1 — NOT one agent per file"]

    prov --> fork{{Fan-out — pools run in parallel}}

    fork --> beP["Backend pool (×3)<br/>Reviewer ≠ implementer"]
    fork --> feP["Frontend pool (×1)<br/>Reviewer ≠ implementer"]
    fork --> dcP["Docs pool (×1)<br/>Reviewer ≠ implementer"]

    beP --> beW["Each backend agent loops:<br/>take next file from backend bucket →<br/>walk role's full bar per symbol → REVIEW →<br/>repeat until bucket empty"]
    feP --> feW["Each frontend agent loops:<br/>take next file → full bar → REVIEW →<br/>repeat until bucket empty"]
    dcP --> dcW["Each docs agent loops:<br/>take next file → full bar → REVIEW →<br/>repeat until bucket empty"]

    beW --> bar{{Barrier — all buckets empty, collect all findings}}
    feW --> bar
    dcW --> bar

    bar --> xrev["Cross-review (parallel per finding)<br/>Independent verifier adversarially checks: real? severity? duplicate?<br/>Dedup + reconcile findings that span files"]

    xrev --> integ["Integrate<br/>Orchestrator merges confirmed findings into one consolidated REVIEW"]

    integ --> q{Any<br/>changes-requested?}
    q -- "changes-requested" --> fix["Route each remark → owning implementer fixes"]
    fix --> rerev["Re-review the changed files<br/>(full bar on the whole changed unit, not delta)"]
    rerev --> disc

    q -- "all pass" --> done([Final result — consolidated REVIEW: all competencies pass → proceed to Verify])
```

## Modeling notes

- **Pools, not one-agent-per-file.** Files are bucketed by owning competency; pool size ∝ effort (file count), capped by concurrency (e.g. 10 backend + 3 frontend → ~3 back : 1 front, not 13 agents).
- **Work-queue drain.** Each agent takes the next file from its bucket, reviews it (full bar per symbol → `REVIEW`), and repeats until the bucket is empty — so "one reviewer per file" holds *at a time*, with a bounded, balanced worker pool.
- **Reviewer ≠ implementer.** Within a competency, reviewers are independent of that lane's implementers.
- **Barrier before cross-review.** All findings are collected once every bucket is drained, because cross-review needs the full set to dedup and reconcile findings spanning multiple files.
- **Cross-review = adversarial verify + dedup.** Each finding is independently challenged ("real? right severity?") and cross-file duplicates merged — the cross-check a single-pass per-file review can't do.
- **Integrate → one REVIEW.** The orchestrator synthesizes survivors into a single consolidated result; after fixes the loop re-discovers + re-reviews the *whole* changed unit, not just the original remark.
