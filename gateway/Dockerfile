# App Gateway — the only public surface in the Deployment Dashboard topology.
#
# Single nginx reverse proxy that routes by path + method to:
#   POST /api/deployments    → write-api:8080
#   GET  /api/stream         → read-api:8080  (SSE pass-through)
#   GET  /api/*, /health     → read-api:8080
#   GET  / + everything else → dashboard:80   (SPA shell)
#
# Per SAD §7 "App Gateway": the gateway eliminates CORS (single origin),
# minimises the public surface (NFR-04), and keeps every backend container
# internal-only. nginx config lives at gateway/nginx.conf in this repo.
#
# Build context: `gateway/`. Compose:
#   build: { context: ../gateway }
#
# Image name: deployment-dashboard/gateway:dev

FROM nginx:alpine

# nginx:alpine ships /etc/nginx/nginx.conf; we replace it wholesale because
# we want full control over events {} / http {} / upstream blocks (the
# default ships an `include /etc/nginx/conf.d/*.conf;` model which we
# don't use here — everything is in one file for grep-ability).
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

# Self-healthcheck: nginx serves a tiny `/__gateway_health` location that
# returns 200 unconditionally. Stays inside the container — does not
# depend on any upstream being reachable, so we can distinguish "gateway
# is up but a backend is down" from "gateway itself is down".
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/__gateway_health || exit 1
