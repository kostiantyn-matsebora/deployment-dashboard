# CR-0001 — Project-agnostic naming and examples

- **Status:** accepted
- **Trigger:** `TODO` line 3 — "Remove all existing service names from everywhere since solution is generic (not related to particular project)".
- **Change:** The dashboard is project-agnostic and CI/CD-tool-agnostic. No project-specific service identifiers, environment identifiers, or CI/CD-tool branding may appear in the SAD, the mockup, the docs, or the codebase. All examples use generic placeholders (`service-a`, `service-b`, `dev`, `qa`, `uat`, `prod`, etc.). Where a CI/CD tool must be named (e.g. in the wire-contract examples), the SAD enumerates a representative set — GitHub Actions, Azure DevOps, Jenkins, GitLab CI — and uses GitHub Actions only as the canonical reference example.
- **Impact:**
  - **FR-09** (already in the initial SAD): "the system shall support any set of services and environments without hardcoded values; the service and environment lists shall be derived from stored data" — this CR re-anchors that requirement against the documentation surface, not just the runtime.
  - **§1 Problem Statement**: opened the framing from a single-CI/CD-tool description to "any CI/CD tool (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, etc.) that can make an HTTP POST".
  - **§2 Goals**: bullet "Support any CI/CD tool, repository, and set of services/environments — no hardcoded values" added.
  - **§7 Components → CI/CD Notify Step**: integration-options table is tool-agnostic; inline-HTTP and webhook-receiver rows make no GitHub-only claim. The "GitHub Actions composite action" row is optional, not central.
  - **§7 CI/CD Integration**: explicit "The dashboard has no dependency on any particular build system and does not query any CI/CD tool" disclaimer; `run_url`, `run_number`, `actor` are described as generic field names that "map naturally to equivalent concepts in any CI/CD platform".
  - **`docs/ci-cd-integration.md`**: per-tool snippets for GitHub Actions, Azure DevOps, Jenkins, GitLab CI, plus a generic shell pattern.
  - **Example payloads** throughout the SAD use `service-a` / `service-b`; the `(service, environment)` examples use `dev` / `qa-1` / `qa-2` / `uat` / `prod`.
- **References:**
  - SAD §1 Problem Statement, §2 Goals (already aligned).
  - SAD §4 FR-09 (already aligned).
  - SAD §7 Components → CI/CD Notify Step.
  - SAD §7 CI/CD Integration.
  - `docs/ci-cd-integration.md` (per-tool integration snippets).

## Removed SAD content (verbatim)

This CR is a re-anchoring of an existing project-wide rule — it does not delete a SAD section in this iteration because the original `service-x` / `service-y` / project-specific references had already been replaced with the generic placeholders (`service-a`, `service-b`, `dev` / `qa` / `uat` / `prod`) prior to Plan C. The CR is recorded for completeness so the rule survives in the change ledger and the requirement "no project-specific naming anywhere" is unambiguously the documented contract going forward.

Future doc updates MUST conform to this CR: any reference to a real customer / project / service name in the SAD or supporting docs is a defect and is rejected at review.
