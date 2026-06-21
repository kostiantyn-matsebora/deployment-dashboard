---
description: Review-loop activity of .claude/team-process/process.md. Pool reviewers per competency (size ∝ effort), drain per-competency file buckets, adversarially verify + dedup findings, integrate one consolidated REVIEW. Reviewer ≠ implementer; reviewers report, never fix.
argument-hint: <the integrated change set to review>
---

# /review-loop

The **Review-loop** activity of the orchestration process
([`.claude/team-process/process.md`](../team-process/process.md)). Visual:
[`review-activity.md`](../team-process/review-activity.md).

**Purpose.** Catch what a green build can't — principle / code-smell violations on the integrated
change set. **Reviewers report, never fix.**

## 1 — Provision (pool ∝ effort, NOT one agent per file)

1. **Discover work-list.** Enumerate changed files; classify each by owning competency.
2. **Bucket.** Partition files into per-competency buckets (contract / backend / frontend /
   infrastructure / docs — only competencies the change set touched).
3. **Provision pools.** One reviewer pool per competency; **pool size ∝ that bucket's
   file-count**, capped by the concurrency limit. e.g. 10 backend + 3 frontend files →
   ~3 backend reviewers : 1 frontend reviewer — *not* 13 agents.
4. **Always provision a `security` reviewer.** One generic agent running the `security-review`
   skill over the **whole integrated diff** (not a per-file bucket) — a cross-cutting dimension that
   runs **every** review wave, no competency gating.
5. **Independence.** Every reviewer is a fresh instance, **≠ that lane's implementer**.

## 2 — Review (each agent drains its bucket)

Each competency reviewer loops until its bucket is empty:

- **Take** the next file from its competency bucket.
- **Walk the role's FULL non-negotiable bar, per symbol** — every code-smell + SOLID/DI;
  line-spans and responsibility counts **measured, not eyeballed**.
- **Emit a `REVIEW`** (`scope` · `checked` · `verdict` · `remarks`). `checked` is mandatory;
  `verdict: pass` is invalid without it — a skim is not a review.
- Read-only: a reviewer **never edits production code**.

The **`security` reviewer** runs in parallel by its own method:

- **Run the `security-review` skill** over the integrated diff (not a role-bar walk — its own
  vulnerability methodology).
- **Emit a `REVIEW` with `role: "security"`** — `checked` = the audited surface, `remarks` =
  each finding `{smell = vuln class, location, change = remediation}`.
- Read-only, reports never fixes — same as every other reviewer.

## 3 — Cross-review (barrier → verify + dedup)

- **Barrier.** Wait until every bucket is drained; collect all per-file findings.
- **Adversarially verify** each finding via an independent check — real? right severity?
- **Dedup + reconcile** findings that span multiple files (the cross-check a single per-file
  pass can't do).

## 4 — Integrate

Orchestrator merges surviving findings into **one consolidated `REVIEW`**: `pass`, or
`changes-requested` + remarks (principle/smell · location · required change).

## 5 — Internal loop / exit

- **All competencies `pass`** → hand back the consolidated `REVIEW` (`pass`).
- **Any `changes-requested`** → route each remark to the owning implementer; it fixes;
  **re-review the WHOLE changed unit** (full bar, not delta — a fix that trades one smell for
  another must be caught) → loop until all `pass`.
- Reviewers report, never fix — preserves the single-integrator model.

**Output:** one consolidated `REVIEW` with `verdict: pass`.
