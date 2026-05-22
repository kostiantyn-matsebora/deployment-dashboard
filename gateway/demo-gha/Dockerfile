# Demo-gha image -- WireMock.Net pre-baked with the demo bundle (CR-0013).
#
# Owner: devops-engineer.
# Contract: docs/cr/CR-0013-demo-mode-default-installer.md (section 3c).
#
# This image is the 5th first-party component image alongside
# api / fetcher / frontend / gateway. It bakes the qa-owned demo bundle
# (testing/fixtures/gha/demo/) into WireMock.Net's admin-mappings layout so
# the release-install demo profile can stand up a self-contained,
# offline-capable mock GitHub Actions upstream without bind-mounting any
# source-tree path on the release host.
#
# Image lineage:
#   - Base: sheyenrath/wiremock.net:2.4.0 -- same pin CR-0012 chose for the
#     sibling `mock-gha` service. One WireMock.Net binary across both demo
#     and integration profiles; admin-route variance pre-known.
#   - Bundle path: /app/__admin/mappings/ -- WireMock.Net .NET image's
#     default admin file layout (CR-0012 S 3a footnote). The image's default
#     entrypoint scans this directory at startup and registers every JSON
#     mapping file it finds.
#   - Healthcheck: NOT baked here -- the compose definition provides the
#     same `: > /dev/tcp/localhost/80` probe that `mock-gha` uses. Keeping
#     the healthcheck at compose-level mirrors CR-0012's posture and avoids
#     duplicated lifecycle configuration.
#   - CMD: NOT overridden -- the base image's default entrypoint launches
#     WireMock.Net on port 80, which is exactly what the demo profile needs.
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

FROM sheyenrath/wiremock.net:2.4.0

# Copy the demo bundle into WireMock.Net's admin-mappings directory.
# qa-engineer owns the bundle content (per `.agents/ginee/local/bindings.md`
# governance row on `testing/fixtures/gha/`); the COPY itself is a devops
# concern -- the seam is the path string
# `testing/fixtures/gha/demo/` -> `/app/__admin/mappings/`.
COPY testing/fixtures/gha/demo/ /app/__admin/mappings/

# No CMD / ENTRYPOINT override -- the base image already runs WireMock.Net
# on :80 and scans /app/__admin/mappings/ at startup. The compose-level
# healthcheck verifies the port accepts TCP connects.
