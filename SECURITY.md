# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `main` (HEAD) | Yes |
| Tagged pre-1.0 releases | No — upgrade to latest `main` |
| LTS branches | None — no LTS policy pre-1.0 |

Pre-1.0 caveat: APIs, wire contracts, and configuration surfaces may change between minor versions per the project's [README warning](README.md).

## Reporting a vulnerability

- Open a private advisory via the GitHub Security Advisories tab: <https://github.com/kostiantyn-matsebora/deployment-dashboard/security/advisories/new>.
- Do not file public issues for suspected vulnerabilities.
- Acknowledgement target: 7 days (best-effort; single-maintainer project, pre-1.0).

## Scope

- Internal read-only tooling per NFR-04 in [`docs/SAD.md`](docs/SAD.md) — no public ingress is required.
- Write API (`POST /api/deployments` and related write endpoints) requires the static `X-Api-Key` header.
- Read API and SSE stream are unauthenticated by design — intended for trusted internal networks only.
- **Out of scope**: any deployment that exposes the Read API to the public internet. That is a deployer-side configuration choice, not a project defect.
- **Out of scope**: secrets handling in deployer-owned CI/CD pipelines that POST to `/api/deployments`.

## Not a security issue

- Feature requests — use [`.github/ISSUE_TEMPLATE/feature-request.md`](.github/ISSUE_TEMPLATE/).
- Documentation typos or clarifications — open a regular issue.
- Functional bugs without a confidentiality, integrity, or availability impact — use the bug-report template.
- Behaviour matching documented NFR-04 / SAD §8 — by-design, not a vulnerability.
