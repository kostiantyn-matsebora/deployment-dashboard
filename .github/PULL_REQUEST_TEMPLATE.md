<!--
  Thanks for contributing! Keep the PR scoped to one concern.
  See CONTRIBUTING.md for setup, conventions, and CI gates.
-->

## What & why

<!-- What does this change, and why? Link issues with "Closes #123". -->

## Type of change

- [ ] Feature (`feat`)
- [ ] Fix (`fix`)
- [ ] Docs (`docs`)
- [ ] Refactor / perf / test / chore
- [ ] Breaking change (describe migration below)

## Checklist

- [ ] Branched off `main` (not pushing to `main` directly).
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- [ ] Tests added/updated and passing locally.
- [ ] For API changes: `docs/api/openapi.yaml` updated (contract source of truth).
- [ ] For new/moved/removed docs: affected `index.md` regenerated (`/docs-keeper:docs-index`, docs-keeper plugin), drift check green.
- [ ] For scripts: Python 3 (stdlib-only runtime), with a sibling `*_test.py` pytest suite and ruff-clean source.

## Notes for reviewers

<!-- Anything reviewers should focus on, screenshots, follow-ups, or out-of-scope items. -->
