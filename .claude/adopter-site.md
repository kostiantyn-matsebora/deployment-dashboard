## Adopter site (the docs website is a product surface)

`docs/` → MkDocs Material → GitHub Pages is the **adopter-facing showcase** — public, aimed at end users / prospective adopters, with an advertisement role (`mkdocs.yml`: *"Documentation for adopters"*). It is NOT internal reference, and "update adopter docs" is NOT a clerical task. This is the deliberate exception to reference-doc minimalism below.

- **Significance-proportional.** Document a user-facing feature in proportion to its weight — a new primary view / page is a headline change, never a footnote.
- **Show it like its peers.** Present a new feature where existing ones live — the home showcase (`docs/index.md`) and `guide/screenshots.md` — the same way they are: a real screenshot, side-by-side, equal prominence.
- **Done-test.** If the feature isn't visible on the home page beside its peers (with a screenshot), it is NOT documented — regardless of green gates or a passing review.
- **Verify by viewing.** Confirm against the rendered page (serve locally / open it), never just that bytes were added or CI passed.
