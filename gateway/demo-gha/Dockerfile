# Demo-gha image -- JVM WireMock pre-baked with the demo bundle (CR-0013).
#
# Owner: devops-engineer.
# Contract: docs/cr/CR-0013-demo-mode-default-installer.md (section 3c).
#           Issue #57: switched from sheyenrath/wiremock.net:2.4.0 to
#           wiremock/wiremock:3.10.0 -- WireMock.Net had an unfixed
#           memory leak in its request-handling internals under sustained
#           fetcher polling load (GC-bounded JVM vs monotonic .NET growth).
#
# This image is the 5th first-party component image alongside
# api / fetcher / frontend / gateway. It bakes the qa-owned demo bundle
# (testing/fixtures/gha/demo/) into JVM WireMock's mappings directory so
# the release-install demo profile can stand up a self-contained,
# offline-capable mock GitHub Actions upstream without bind-mounting any
# source-tree path on the release host.
#
# Image lineage:
#   - Base: wiremock/wiremock:3.10.0 -- official JVM WireMock Docker image.
#     Fixed via -Xmx environment variable cap (compose-level); JVM heap is
#     bounded, GC reclaims allocations. Fixes issue #57.
#   - Bundle path: /home/wiremock/mappings/ -- JVM WireMock's default
#     mappings directory. The entrypoint loads all JSON files from this
#     path at startup automatically.
#   - Healthcheck: NOT baked here -- the compose definition provides the
#     wget probe against `/__admin/health`. Keeping the healthcheck at
#     compose-level mirrors CR-0012's posture and avoids duplicated
#     lifecycle configuration.
#   - CMD: NOT overridden -- the base image's entrypoint launches WireMock
#     on port 8080 by default; compose-level command overrides `--port 80`
#     to match the fetcher's `GHA_API_BASE_URL=http://demo-gha:80`.
#
# Build context: REPO ROOT (`.` from a caller that runs at repo root, e.g.
# the demo-gha.yml workflow's `context-path: .`). The COPY below reaches
# into `testing/fixtures/gha/demo/`, which lives outside `gateway/` -- so
# the context must be the repo root for the path to resolve. This mirrors
# the CR-0013 design-of-record decision: "Build context -- `.` (repo root)
# -- the Dockerfile's only COPY reaches into testing/fixtures/gha/demo/".
#
# Bundle versioning: the image is tagged via `${DASHBOARD_VERSION}` by the
# CI caller (.github/workflows/demo-gha.yml), so bundle content and image
# tag are atomically versioned -- no asset-vs-bundle drift (see CR-0013
# Alternatives Considered table).

FROM wiremock/wiremock:3.10.0

# Copy the demo bundle into JVM WireMock's mappings directory.
# qa-engineer owns the bundle content (per `.agents/ginee/local/bindings.md`
# governance row on `testing/fixtures/gha/`); the COPY itself is a devops
# concern -- the seam is the path string
# `testing/fixtures/gha/demo/` -> `/home/wiremock/mappings/`.
#
# JVM WireMock DOES recurse into sub-directories under the mappings folder,
# so both `mappings/*.json` and `mappings/statuses/*.json` can be copied
# into their respective sub-paths and will be discovered automatically.
# README.md + services.md are NOT copied -- documentation only.
COPY testing/fixtures/gha/demo/mappings/*.json            /home/wiremock/mappings/
COPY testing/fixtures/gha/demo/mappings/statuses/*.json   /home/wiremock/mappings/statuses/

# No CMD / ENTRYPOINT override -- the base image already runs WireMock
# and scans /home/wiremock/mappings/ at startup. The compose-level command
# overrides the port; the healthcheck verifies /__admin/health.
