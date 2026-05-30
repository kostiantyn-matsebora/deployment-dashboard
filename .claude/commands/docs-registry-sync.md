---
description: Update the "Sources of truth" section.
argument-hint: [--propose-only]
model: sonnet
---

# /docs-registry-sync

Sync the host's "Sources of truth" registry to the current set of per-directory `index.md` indexes (github/docs-style children-list format).

## Pre-flight (binding)

Inherited from `.claude/agents/docs-keeper.md`:

1. **Non-overwrite policy** § — surgical writes to the host root prompt file: `Edit` preferred; `Write` surgical fallback when `Edit` is unavailable (read full file → apply diff in memory → write back; every byte outside the targeted bullet preserved). NEVER reorder unrelated bullets; NEVER touch other sections.
2. **Hard rules — project authoring conventions** § — load and honor.
3. **YAML front-matter quoting** § — parse single-quoted scalars correctly; don't normalize owner-set quoting.

**Registry** = the bullet list in the host's root prompt file under "Sources of truth" (or equivalent).

## Registry membership rule (binding — minimum-footprint)

A path is eligible to appear in the registry **only** if it satisfies exactly one of:

| Class | Eligibility |
|---|---|
| **ROOT index entry** | Path is a per-directory `index.md` AND is NOT resolved from any other index's `children:` front-matter array. Registered as its `index.md` file, e.g. `docs/index.md`. |
| **Unique-doc entry** | Path is NOT an `index.md` AND is NOT resolved from any index's `children:` array anywhere. Legacy-navigation `README.md` (per docs-keeper.md § README.md classification) is NOT eligible. Content-bearing `README.md` IS eligible. |

Any path that IS resolved from some index's `children:` is **covered** and MUST NOT appear as its own registry entry — it is already reachable via the index chain. If a covered path is found in the registry, classify it as **REMOVE** with reason `covered-by-index:<path-of-covering-index>`.

**Hierarchical collapse (the explicit goal).** A single root index that recursively covers every doc under it via `children:` (with sub-indexes acting as boundaries) collapses the registry to one bullet (`docs/index.md`). Adding sub-indexes shrinks the top index's `children:` but does NOT change the registry — sub-indexes stay covered by their parent. This is the minimum-footprint property.

## Locate the host registry

Probe in order:

1. `CLAUDE.md` → section heading containing "Sources of truth" / "Source of truth" / "Authoritative".
2. `AGENTS.md` → same section names.
3. `.agent/INDEX.md`, `docs/INDEX.md`, repo root `INDEX.md`.

If none exist: **halt and ask** the user where the registry lives.

## Steps

1. **Locate the section.**
   - `Read` the host file IN FULL (needed for surgical Write fallback in step 8).
   - Identify the exact heading and the contiguous bullet block beneath it.
   - Capture every existing entry verbatim.
   - Capture the LINE FOLLOWING the bullet block (used for Edit uniqueness padding).

2. **Build the coverage map.**
   - `Glob` every `**/index.md` under candidate doc roots (`docs/**` plus any owner-registered roots).
   - For each `index.md`, parse the YAML front-matter and extract `children:` (array of github/docs-style path strings — possibly nested).
   - For each child path, resolve to a repo-root-relative path per `.claude/agents/docs-keeper.md` § "Children path resolution".
   - Aggregate into **CoverageSet** = `{ <relative-path> → <covering-index> }`.

3. **Identify ROOT indexes.** An `index.md` is a ROOT iff it is NOT in CoverageSet. All other `index.md` files are nested.

4. **Build the candidate set.**

   | Class | Source |
   |---|---|
   | ROOT index candidates | Every `index.md` from step 3 (registered as its directory). |
   | Unique-doc candidates | All authoritative-doc-shaped files (`.md`, `.yaml`, `.html`, `.json` under candidate doc roots) that are NOT `index.md` AND NOT in CoverageSet. Classify any `README.md` per docs-keeper.md § README.md classification before including: content-bearing IS eligible; legacy-navigation IS NOT. |

5. **Compose desired entries.**

   | Part | Source | Rule |
   |---|---|---|
   | Anchor | `[<displayed path>](<relative path from host>)` | Match host's anchor style. |
   | One-line role | ROOT index ➜ front-matter `intro` (single-quoted; preserve verbatim); Unique-doc ➜ doc's H1 / front-matter `title` / `intro` / top paragraph | ≤ 25 words; imperative voice (`Consult before …`) if registry uses it. |
   | Inline file list | Generally omit for hierarchical setup. Retain only if the host registry already uses inline lists. | Default: omit. |

6. **Diff against current.** Classify each existing registry entry and each candidate as:

   | Class | Condition |
   |---|---|
   | ADD | Candidate exists, registry has no entry. |
   | UPDATE | Entry exists; path / role differs. |
   | REMOVE — index-deleted | Entry exists; ROOT `index.md` no longer at that path. |
   | REMOVE — no-longer-root | Entry exists; path is still an `index.md` but is now in some index's `children:`. |
   | REMOVE — covered-by-index | Entry exists; path is in CoverageSet. |
   | REMOVE — file-deleted | Entry exists; standalone (non-index) file no longer present. |
   | REMOVE — legacy-readme | Entry exists; path is a `README.md` and a sibling `index.md` now indexes the same directory. |
   | KEEP | Exact match. |

7. **Style-match the host.** Lock in from existing bullets before editing:
   - Bullet glyph.
   - Em-dash style.
   - "Consult …" suffix.
   - Inline file-table convention.
   - Ordering principle.

   Default: preserve current ordering; append at end when unclear.

8. **Apply (binding).** Drive each diff entry through the apply harness below. NEVER rewrite the whole section. NEVER reorder unrelated bullets. NEVER touch other sections in the same dispatch. Every byte outside the targeted bullets MUST be preserved byte-for-byte.

   ### Apply mode selection

   | Condition | Apply mode |
   |---|---|
   | `--propose-only` flag set | **Propose-only.** Skip all writes; emit Edit-call payloads in the output. |
   | `Edit` tool available | **Edit mode.** Use the per-class Edit patterns below. |
   | `Edit` tool unavailable AND `Write` available | **Surgical Write fallback.** Use the in-memory diff + full-file Write algorithm below. |
   | Neither `Edit` nor `Write` available | Halt with error: "no apply path available; re-invoke from a harness with Edit or Write." |

   ### Edit mode — tool contract

   Each `Edit` call takes:
   - `file_path`: absolute path to the host root prompt file.
   - `old_string`: text to find. **MUST be unique in the file.** Pad with surrounding lines until unique.
   - `new_string`: replacement text.
   - (Do NOT use `replace_all`.)

   ### Edit mode — per-class patterns

   | Diff class | `old_string` shape | `new_string` shape |
   |---|---|---|
   | **ADD into empty bullet block** | `"<section-heading-line>\n\n<next-line-after-block>"` | `"<section-heading-line>\n\n- <new bullet>\n\n<next-line-after-block>"` |
   | **ADD after a specific sibling bullet** | `"- <sibling bullet text>\n"` | `"- <sibling bullet text>\n- <new bullet>\n"` |
   | **ADD at end of non-empty bullet block** | `"- <last existing bullet>\n\n"` | `"- <last existing bullet>\n- <new bullet>\n\n"` |
   | **UPDATE** | `"- <old bullet text>\n"` | `"- <new bullet text>\n"` |
   | **REMOVE (mid-block)** | `"- <bullet to remove>\n"` | `""` |
   | **REMOVE (last in block)** | `"\n- <bullet to remove>\n"` | `""` |

   ### Edit mode — uniqueness padding

   If `old_string` matches more than one occurrence: prepend the previous line; if still not unique, append the following line; repeat alternating until unique. Mirror in `new_string`.

   ### Edit mode — atomicity

   - One `Edit` per bullet change.
   - Sequential — re-locate each subsequent `old_string` after the previous Edit completed.
   - Idempotent — re-running on an already-synced registry → zero `Edit` calls.

   ### Surgical Write fallback — algorithm

   When `Edit` is unavailable, apply the same diff via `Write`, preserving every byte outside the targeted bullets:

   1. **Already loaded.** The full host-file content was captured in step 1.
   2. **In-memory diff.** Apply ADDs / UPDATEs / REMOVEs as string-replace operations in memory, USING THE SAME PER-CLASS PATTERNS as Edit mode (the patterns above). Each pattern's `old_string` / `new_string` shapes apply identically.
   3. **Invariant check (binding).**
      - Modified buffer MUST be byte-identical to the original EXCEPT for the targeted bullet additions / updates / removals.
      - If any other byte changed (whitespace normalization, line-ending swap, trailing-newline drift, etc.): HALT with error `"surgical invariant violated; refusing to Write."`
      - Compare-by-region helper:
        - Capture byte range `[0, section_heading_start)` and `[section_end, EOF)` from the original.
        - Verify those ranges are bit-identical in the modified buffer.
   4. **Write the full file.** Single `Write` call with the modified buffer. `file_path` is the host file's absolute path.
   5. **Confirm.** Re-Read the file; verify the targeted bullets are present in the expected shape. If verification fails, surface the discrepancy in the output and stop further apply work.

   Surgical-Write is NOT a license to rewrite the section, normalize whitespace, fix unrelated typos, or "improve" anything outside the diff scope. It is byte-preserving except for the targeted bullets, full stop.

   ### Failure modes

   | Symptom | Action |
   |---|---|
   | `old_string not found` (Edit mode) | Re-locate the section. Retry once. If still failing, mark this entry as failed in the output. |
   | `old_string not unique` (Edit mode) | Apply more uniqueness padding. Retry. |
   | Surgical invariant violated (Write fallback) | HALT this entry. Surface in output. Do NOT Write. |
   | Both `Edit` and `Write` unavailable | Halt the dispatch with error: "no apply path available." |

   ### Propose-only mode

   Triggered **only** by the explicit `--propose-only` flag. Tool availability does NOT trigger propose-only — if `Edit` is missing, fall back to surgical Write, not to propose-only.

   In propose-only mode, emit Edit-call payloads in the output instead of invoking any tool.

## Output (binding — synthesized text only)

This is Mode D's designated structured format per `.claude/agents/docs-keeper.md` § Output format — the compact synthesized line, NOT the Documentation Report template, and never freeform prose.

**Default output is ONE line of synthesized text** describing what happened. In propose-only mode, the line is followed by ready-to-paste Edit-call blocks. NO Documentation Report template. NO coverage map block. NO rule-compliance checklist. NO Open questions block. NO Next steps narrative.

### Output shapes

| Situation | Output (≤ 2 lines + optional Edit-call block) |
|---|---|
| **Applied via Edit** | ``Updated <host-file> § <section>: +<A> ADD, ~<U> UPDATE, -<R> REMOVE. <paths>.`` |
| **Applied via surgical Write fallback** | ``Updated <host-file> § <section> (Write fallback): +<A> ADD, ~<U> UPDATE, -<R> REMOVE. <paths>.`` |
| **Propose-only — drift exists** | ``Proposed <count> change(s) to <host-file> § <section>: <class+path list>.`` ← followed by the Edit-call blocks below. |
| **No drift (idempotent)** | ``<host-file> § <section> in sync — no changes needed.`` |
| **Apply failure on one or more entries** | ``Applied <ok>/<total>. Failed: <failed paths>. See Edit calls below for manual application.`` |
| **Halt** (registry section missing, host file ambiguous, no apply path, surgical invariant violated, etc.) | ``Halted: <one-line reason>.`` |

### Edit-call block (propose-only and on-failure only)

For each diff entry that wasn't applied, emit ONE fenced block:

````markdown
#### <ADD|UPDATE|REMOVE> `<path>` (<slot or reason>)
```
file_path: <abs path>
old_string: "<exact match text with escaped newlines>"
new_string: "<exact replacement text>"
```
````

Nothing else.

### Suppression of legacy verbose output

The following MUST NOT appear in the default output:

- "Documentation Report" header
- "Host rules loaded from" block
- "Files touched" block
- "Non-overwrite gate" block
- Coverage map (full breakdown of every index and every child path)
- "Rule compliance" checklist
- "Open questions" block
- "Next steps" block
- Per-step narration ("Step 1 — Locate the section …", "Step 2 — Build the coverage map …", etc.)

These are debug-mode artifacts. Surface ONLY when the owner explicitly asks ("show coverage", "explain", "verbose") OR when a specific failure mode requires the detail (e.g., ambiguous resolution → name the two candidates).

## Mode-D non-overwrite reminders

- **Coverage trumps inclusion.** A file resolved from some index's `children:` is registered transitively. Direct registration is a redundancy — propose REMOVE.
- **Owner-curated targets out of scope.** Standalone entries the owner curated still need owner sign-off on REMOVE.
- **Preserve owner prose.** Update only drifted parts (path, role). Never down-scope cross-refs or "Consult before …" clauses.
- **No new section.** If the registry is missing a "Sources of truth" section, halt and ask.
- **Do not delete legacy README.md.** Flag for owner removal; let `/docs-sweep` track them.
- **Surgical Write is allowed as Edit fallback** when Edit is unavailable — but ONLY when the byte-preservation invariant holds (every byte outside the targeted bullets is unchanged). Surgical-Write is NOT carte-blanche to rewrite the section.
