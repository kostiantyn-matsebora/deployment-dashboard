---
description: Insert the phase-report.md schema skeleton (ready to fill). Use at the end of a cardinal dispatch to compose the return.
argument-hint: [optional context]
---

Compose your return per `core/templates/phase-report.md` — fill every required section (use `(none)` for empty), run the 7 mandatory checks, end with `<!-- self-lint: pass -->`.

$ARGUMENTS

Skeleton:

```
Status: Done | In-progress | Blocked | Hand-off

## Files touched                                     (table or (none))
| Path | Δ lines | Purpose |
|---|---|---|
| `<path>` | `+N / -M` | `<one-line why>` |

## Decisions made                                    (bullets or (none))
- `<short imperative>` — `<FR-NN-slug | NFR-NN-slug | ADR-NNNN-slug | mockup §X>`

## Verification log                                  (table; required)
| Command / check | Outcome |
|---|---|
| `<command>` | `<exit code / pass-fail / count>` |

## Open issues                                       (bullets or (none))
- `<issue>` — `<owner / blocker>`

## Next dispatch needed                              (one-line or (none))
- `<role> · <surface> · <reason>`

## Source reads (this dispatch)                      (table or (none))
| Path | Justification | Index entry consulted |
|---|---|---|

## Hand-off                                          (when Status: Hand-off — per core/templates/hand-off-note.md)
## Stop-state                                        (when Status: In-progress — Done/In-progress/Not-started)
## Time spent                                        (when sub-issue mode — <H>h <M>m perceived; <N> progress comments on #<M>)
## Notes                                             (optional · ≤ 200 words)

<!-- self-lint: pass -->
```

Run the 7 mandatory checks per `core/templates/phase-report.md § Mandatory checks before report-as-done` before writing the marker.
