# Demo-driver sidecar -- periodic JVM WireMock admin-API ticker (issue #46).
#
# Owner: devops-engineer.
# Contract: Phase 3 design lock on #46 (extension to CR-0013).
#
# This image is the 6th first-party component image alongside
# api / fetcher / frontend / gateway / demo-gha. It runs as a sidecar to
# `demo-gha` and periodically PUTs/POSTs updated mapping bodies to the
# JVM WireMock admin API so the demo-mode dashboard surfaces ongoing
# deployment activity rather than a single frozen baseline snapshot.
#
# Why a separate image (not a script baked into demo-gha):
#   - demo-gha is content-only (`build-kind: copy`, no language toolchain) --
#     CR-0013 locked that constraint to keep the baked-bundle image small +
#     fast. Embedding a Python runtime there would break the contract.
#   - Sidecar separation lets the tick loop be replaced / stopped /
#     scaled independently without re-rolling the mock-server image.
#
# Runtime: python:3.13-alpine, stdlib-only (http.client / json / os /
# pathlib / time / signal). No pip install at build, no PyPI dependencies,
# no PATH surprises. Image stays under ~50 MB.
#
# Non-root runtime user 65532:65532 -- matches the distroless-nonroot UID
# convention also used by the demo-gha base image.

FROM python:3.13-alpine

# `BUILD_EPOCH` is the wall-clock UTC seconds at image build time. The
# entrypoint anchors cycle_index = (now - BUILD_EPOCH) / cycle_length
# against this baseline so id-rewriting is monotone across container
# restarts within a single image tag.
#
# Default `0` means the reusable `_build-and-push-image.yml` does not
# need a `build-args` input to ship a working image -- the entrypoint
# treats `0` as "anchor cycle_index against process-start wall-clock
# instead" (still monotone within a process; restart resets to 0). To
# make cycle_index restart-stable across the lifetime of a single image
# tag, the caller workflow should pass `--build-arg BUILD_EPOCH=$(date
# -u +%s)`; today's reusable workflow does not yet expose that knob, so
# the graceful default keeps the image self-sufficient.
ARG BUILD_EPOCH=0
ENV DEMO_DRIVER_BUILD_EPOCH=${BUILD_EPOCH}

# Default tick cadence + id-stride per Phase 3 design lock. Compose
# overrides these via env, so editing here without a compose-row bump
# is a no-op for the release-install stack.
ENV DEMO_DRIVER_GHA_URL="http://demo-gha:80" \
    DEMO_DRIVER_PERIOD_SECONDS="15" \
    DEMO_DRIVER_ID_STRIDE="100" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Ticks = the qa-authored sequence of per-tick mapping snippets. Each
# subdirectory is one tick (sorted lexically by directory name); each
# JSON file inside encodes one PUT (list-deployments update) or POST
# (status mapping addition). The sidecar loops these indefinitely.
COPY testing/fixtures/gha/demo/ticks/ /app/ticks/

# Driver code -- last (cheapest layer to rebuild on iteration).
COPY gateway/demo-driver/entrypoint.py /app/entrypoint.py

# Run as non-root. Alpine's `adduser -D -u 65532` matches the
# distroless-nonroot UID convention also used by the demo-gha base.
RUN adduser -D -u 65532 -s /sbin/nologin nonroot \
 && chown -R 65532:65532 /app

USER 65532:65532

# No `EXPOSE` -- the sidecar has no inbound listener. No `HEALTHCHECK`
# -- the demo profile relies on demo-gha's TCP probe; the driver's
# liveness is implied by its egress traffic to demo-gha.
ENTRYPOINT ["python", "-u", "/app/entrypoint.py"]
