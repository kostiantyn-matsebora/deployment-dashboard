# docs-registry-sync — procedure

Sync the host's "Sources of truth" registry to the current set of per-directory
`index.md` indexes (github/docs-style children-list format). Mode D.

> Platform-neutral procedure. The Claude Code adapter exposes it as `/docs-keeper:docs-registry-sync [--propose-only]`.

## Pre-flight (binding)

Inherited from [`../role.md`](../role.md):

1. **Non-overwrite policy** § — surgical writes to the host root prompt file: `Edit`
   preferred; `Write` surgical fallback when `Edit` is unavailable (read full file →
   apply diff in memory → write back; every byte outside the targeted bullet preserved).
   NEVER reorder unrelated bullets; NEVER touch other sections.
2. **Host authoring rules** § — load and honor.
3. **YAML front-matter quoting** § — parse single-quoted scalars correctly; don't
   normalize owner-set quoting.

**Registry** = the bullet list in the host's root prompt file under "Sources of truth"
(or equivalent).

## Registry membership rule (binding — minimum-footprint)

A path is eligible to appear in the registry **only** if it satisfies exactly one of:

| Class | Eligibility |
|---|---|
| **ROOT index entry** | Path is a per-directory `index.md` AND is NOT resolved from any other index's `children:`. Registered as its `index.md` file, e.g. `docs/index.md`. |
| **Unique-doc entry** | Path is NOT an `index.md` AND is NOT resolved from any index's `children:` anywhere. Legacy-navigation `README.md` is NOT eligible; content-bearing `README.md` IS. |

Any path resolved from some index's `children:` is **covered** and MUST NOT appear as
its own registry entry. A covered path found in the registry → **REMOVE** with reason
`covered-by-index:<path-of-covering-index>`.

**Hierarchical collapse (the explicit goal).** A single root index that recursively
covers every doc under it via `children:` collapses the registry to one bullet
(`docs/index.md`). Adding sub-indexes shrinks the top index's `children:` but does NOT
change the registry — sub-indexes stay covered by their parent.

## Locate the host registry

Probe in order: `CLAUDE.md` → `AGENTS.md` → `.agent/INDEX.md` / `docs/INDEX.md` / repo
root `INDEX.md`, for a heading containing "Sources of truth" / "Source of truth" /
"Authoritative". If none exist: **halt and ask** where the registry lives.

## Steps

1. **Locate the section.** Read the host file IN FULL (needed for the surgical Write
   fallback). Identify the heading + contiguous bullet block; capture every entry
   verbatim + the line following the block (Edit uniqueness padding).
2. **Build the coverage map.** Glob every `**/index.md` under candidate doc roots; parse
   `children:`; resolve each child to a repo-root-relative path per role.md § "Children
   path resolution". Aggregate **CoverageSet** = `{ path → covering-index }`.
3. **Identify ROOT indexes.** An `index.md` is a ROOT iff it is NOT in CoverageSet.
4. **Build the candidate set.** ROOT index candidates (registered as their directory) +
   unique-doc candidates (authoritative doc-shaped files not `index.md` and not in
   CoverageSet; classify `README.md` first).
5. **Compose desired entries.** Anchor `[<displayed path>](<relative path>)` matching the
   host's style; one-line role (ROOT → front-matter `intro` verbatim; unique-doc → H1 /
   `title` / `intro` / top paragraph), ≤ 25 words. Omit inline file lists unless the host
   registry already uses them.
6. **Diff against current.** Classify each entry / candidate: ADD / UPDATE / REMOVE
   (index-deleted / no-longer-root / covered-by-index / file-deleted / legacy-readme) /
   KEEP.
7. **Style-match the host.** Lock bullet glyph, em-dash style, "Consult …" suffix, inline
   table convention, ordering. Default: preserve ordering; append at end when unclear.
8. **Apply (binding).** Drive each diff entry through the apply harness. NEVER rewrite the
   whole section; NEVER reorder unrelated bullets; NEVER touch other sections. Every byte
   outside the targeted bullets MUST be preserved.

   | Condition | Apply mode |
   |---|---|
   | `--propose-only` flag set | **Propose-only.** Skip writes; emit Edit-call payloads. |
   | `Edit` available | **Edit mode** (per-class patterns below). |
   | `Edit` unavailable AND `Write` available | **Surgical Write fallback** (in-memory diff + full-file Write, byte-preserving). |
   | Neither available | Halt: "no apply path available." |

   ### Edit mode — per-class patterns

   | Diff class | `old_string` | `new_string` |
   |---|---|---|
   | ADD into empty block | `"<heading>\n\n<next-line>"` | `"<heading>\n\n- <new>\n\n<next-line>"` |
   | ADD after a sibling | `"- <sibling>\n"` | `"- <sibling>\n- <new>\n"` |
   | ADD at end of block | `"- <last>\n\n"` | `"- <last>\n- <new>\n\n"` |
   | UPDATE | `"- <old>\n"` | `"- <new>\n"` |
   | REMOVE (mid-block) | `"- <bullet>\n"` | `""` |
   | REMOVE (last in block) | `"\n- <bullet>\n"` | `""` |

   Uniqueness padding: if `old_string` matches more than once, prepend the previous line,
   then append the following line, alternating until unique; mirror in `new_string`. One
   Edit per bullet; relocate each subsequent `old_string` after the previous Edit;
   idempotent (re-run → zero Edits).

   ### Surgical Write fallback

   Apply the same per-class patterns as in-memory string replacements on the full file
   captured in step 1. **Invariant:** the modified buffer MUST be byte-identical to the
   original except for the targeted bullets — verify `[0, section_start)` and
   `[section_end, EOF)` are bit-identical; otherwise HALT `"surgical invariant violated;
   refusing to Write."` Single `Write`; re-Read to confirm. Not a license to normalize
   whitespace or "improve" anything outside the diff.

   ### Failure modes

   | Symptom | Action |
   |---|---|
   | `old_string not found` | Re-locate the section; retry once; else mark entry failed. |
   | `old_string not unique` | More uniqueness padding; retry. |
   | Surgical invariant violated | HALT this entry; surface; do NOT Write. |

   Propose-only is triggered ONLY by the explicit flag — never by tool availability.

## Output (binding — synthesized text only)

Mode D's designated format — the compact synthesized line, NOT the Documentation Report.

| Situation | Output |
|---|---|
| Applied via Edit | `Updated <host-file> § <section>: +<A> ADD, ~<U> UPDATE, -<R> REMOVE. <paths>.` |
| Applied via surgical Write | `Updated <host-file> § <section> (Write fallback): +<A> …` |
| Propose-only — drift exists | `Proposed <count> change(s) …` + the Edit-call blocks |
| No drift | `<host-file> § <section> in sync — no changes needed.` |
| Apply failure | `Applied <ok>/<total>. Failed: <paths>. See Edit calls below.` |
| Halt | `Halted: <one-line reason>.` |

### Edit-call block (propose-only / on-failure only)

````markdown
#### <ADD|UPDATE|REMOVE> `<path>` (<slot or reason>)
```
file_path: <abs path>
old_string: "<exact match text with escaped newlines>"
new_string: "<exact replacement text>"
```
````

Suppress all legacy verbose output (Documentation Report header, coverage map, rule
checklist, Open questions, Next steps, per-step narration) unless the owner asks
("show coverage", "verbose") or a failure mode requires the detail.

## Mode-D reminders

- **Coverage trumps inclusion.** A file resolved from some index's `children:` is
  registered transitively; direct registration is redundant — propose REMOVE.
- **Owner-curated targets** still need owner sign-off on REMOVE.
- **Preserve owner prose** — update only drifted parts (path, role).
- **No new section.** Missing registry section → halt and ask.
- **Do not delete legacy README.md** — flag for owner; let `docs-sweep` track them.
