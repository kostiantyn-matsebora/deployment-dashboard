# Contributing

## How this project is built

Every commit, ADR, CR, test, and CI workflow in this repo is authored by AI specialists routed through [`ginee`](https://github.com/kostiantyn-matsebora/ginee), a multi-agent engineering process for small autonomous teams. The local install lives under [`.agents/ginee/`](.agents/ginee/); the maintainer drives all dispatches via the `team-lead` orchestrator.

## Filing an issue

- Use the bug-report or feature-request templates in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/).
- Issues opened from a template receive the `ginee:ready` label automatically.
- The maintainer picks them up via the ginee `pick up #N` workflow — no drive-by self-assignment.

## Proposing a change

- Open an issue first; drive-by PRs without a backing issue will be redirected.
- The `team-lead` skill drives the full Phase 1–8 lifecycle: analysis → design → review → implementation → test → fix → SA review → user approval.
- Wire-contract / NFR / cross-domain changes go through a CR (`docs/cr/`) and may require an ADR (`docs/adr/`) before code lands.

## Local dev

```powershell
pwsh -NoProfile -File dev_env/start.ps1
```

See [`dev_env/README.md`](dev_env/README.md) for the contributor stack details (`-Scaled`, `-Fetcher`, NFR-05 validation harness).

## Doc edits

- Architecture (`docs/architecture.md`), ADRs (`docs/adr/`), CRs (`docs/cr/`), and UI option docs (`docs/ui/*.md`) flow through the `solution-architect` role.
- The mockup (`docs/ui/deployment-dashboard.html`) is owned by `frontend-engineer`; SA reviews, does not edit.
- Full routing rules + role boundaries: [`.agents/ginee/local/bindings.md`](.agents/ginee/local/bindings.md).

## Stack pointers

| Surface | Path |
|---|---|
| Get Started (60-second demo) | [`docs/getting-started.md`](docs/getting-started.md) |
| Install (full reference) | [`docs/install.md`](docs/install.md) |
| Features (user-visible surfaces) | [`docs/features.md`](docs/features.md) |
| Solution Architecture Document (SAD) | [`docs/architecture.md`](docs/architecture.md) |
| Architecture Decision Records | [`docs/adr/`](docs/adr/) |
| Change Requests | [`docs/cr/`](docs/cr/) |
| CI/CD integration (inbound — adopter pipelines → us) | [`docs/ci-cd-integration.md`](docs/ci-cd-integration.md) |
| CI/CD pipelines (outbound — our component CI) | [`docs/ci-cd-pipelines.md`](docs/ci-cd-pipelines.md) |
| UI mockup (canonical visual ref) | [`docs/ui/deployment-dashboard.html`](docs/ui/deployment-dashboard.html) |
| Work breakdown | [`docs/WBS.md`](docs/WBS.md) |
